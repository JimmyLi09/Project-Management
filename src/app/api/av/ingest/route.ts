import { mkdtemp, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { NextRequest, NextResponse } from 'next/server';
import { canUploadDrawing, identityOf } from '@/lib/permissions';
import { DrawingServiceError, runDrawingCli } from '@/server/avdrawing';
import { currentUser } from '@/server/session';

/* 03 解析提取: POST multipart { file, scale? } -> IngestResult (src/av/core/handoff.ts).
   The upload keeps its original file name, because provenance quotes it
   ("01_平面图.dxf / A-LED-DISPLAY / (0, 1200)", §9). */

const ALLOWED = new Set(['.dxf', '.pdf', '.png', '.jpg', '.jpeg', '.tif', '.tiff']);
const MAX_BYTES = 50 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  if (!canUploadDrawing(identityOf(user))) return NextResponse.json({ error: '无上传图纸权限' }, { status: 403 });

  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: '缺少图纸文件' }, { status: 400 });
  const name = path.basename(file.name).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_');
  const ext = path.extname(name).toLowerCase();
  if (!ALLOWED.has(ext)) return NextResponse.json({ error: `不支持的图纸格式 ${ext || '(无扩展名)'}` }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: '图纸超过 50 MB' }, { status: 400 });

  const scaleRaw = form?.get('scale');
  const scale = typeof scaleRaw === 'string' && scaleRaw.trim() ? Number(scaleRaw) : null;
  if (scale !== null && !(scale > 0)) return NextResponse.json({ error: '比例尺须为正数，如 1:50 填 50' }, { status: 400 });

  const dir = await mkdtemp(path.join(os.tmpdir(), 'av-ingest-'));
  try {
    const target = path.join(dir, name);
    await writeFile(target, Buffer.from(await file.arrayBuffer()));
    const args = ['ingest', target, ...(scale ? ['--scale', String(scale)] : [])];
    return NextResponse.json(await runDrawingCli(args));
  } catch (e) {
    const status = e instanceof DrawingServiceError ? 422 : 500;
    return NextResponse.json({ error: e instanceof Error ? e.message : '解析失败' }, { status });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
