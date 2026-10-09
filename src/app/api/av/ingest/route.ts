import path from 'path';
import { NextRequest, NextResponse } from 'next/server';
import { canUploadDrawing, identityOf } from '@/lib/permissions';
import { ledProjectError } from '@/server/avdrawing';
import { getProject } from '@/server/db';
import { currentUser } from '@/server/session';
import { denyUnlessVisible, denyAvModule } from '@/server/avguard';
import { IMAGE_EXT } from '@/server/avjudge';
import { archiveUpload, parseUpload } from '@/server/avupload';
import { isFull } from '@/lib/permissions';

/* 03 解析提取: POST multipart { project, file, scale? } -> the stored drawing.
   The upload keeps its original file name, because provenance quotes it
   ("01_平面图.dxf / A-LED-DISPLAY / (0, 1200)", §9).

   AV-015: pictures and scanned PDFs do not go through the drawing readers;
   they become an image judgement ({ judge }) that the local vision model reads
   in the background. DXF and vector PDF are unchanged. */

const ALLOWED = new Set(['.dxf', '.pdf', ...IMAGE_EXT]);
const MAX_BYTES = 50 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  { const deny = denyAvModule(user); if (deny) return deny; }

  const form = await req.formData().catch(() => null);
  const projectId = String(form?.get('project') ?? '');
  const project = getProject(projectId);
  const denied = denyUnlessVisible(user, project);   // REQ-043
  if (denied) return denied;
  const bad = ledProjectError(project);
  if (bad) return NextResponse.json({ error: bad }, { status: 400 });
  if (!canUploadDrawing(identityOf(user), project)) {
    return NextResponse.json({ error: '无权为该项目上传图纸' }, { status: 403 });
  }

  const file = form?.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: '缺少图纸文件' }, { status: 400 });
  const name = path.basename(file.name).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_');
  const ext = path.extname(name).toLowerCase();
  if (!ALLOWED.has(ext)) return NextResponse.json({ error: `不支持的图纸格式 ${ext || '(无扩展名)'}` }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: '图纸超过 50 MB' }, { status: 400 });

  const scaleRaw = form?.get('scale');
  const scale = typeof scaleRaw === 'string' && scaleRaw.trim() ? Number(scaleRaw) : null;
  if (scale !== null && !(scale > 0)) return NextResponse.json({ error: '比例尺须为正数，如 1:50 填 50' }, { status: 400 });

  /* AV-016 ①:先留档再解析 —— 解析失败原件也在,可以重新解析、下载 */
  /* AV-018:同一项目里已经有这份文件 → 409 + 已有的那一份;页面问「要打开它吗？」,选「仍然再传一份」时带 force=1 */
  const archived = await archiveUpload(projectId, name, Buffer.from(await file.arrayBuffer()), user.name, form?.get('force') === '1');
  if (typeof archived !== 'number') return NextResponse.json({ error: '这份文件已经在列表里', duplicate: archived.duplicate }, { status: 409 });
  const uploadId = archived;
  const out = await parseUpload(uploadId, scale, user.name, isFull(identityOf(user)));
  if (out.kind === 'judge') return NextResponse.json({ judge: out.judge, uploadId });
  if (out.kind === 'drawing') return NextResponse.json({ ...out.drawing, uploadId });
  return NextResponse.json({ error: out.error, reason: out.reason, uploadId, archived: true }, { status: out.status });
}
