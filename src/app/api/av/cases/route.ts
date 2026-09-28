import { mkdtemp, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { NextRequest, NextResponse } from 'next/server';
import { canEditPrices, canViewPrices, identityOf } from '@/lib/permissions';
import { caseLibraryInfo, replaceCases, searchCases, type CaseFilter, type HistCase } from '@/server/avdb';
import { DrawingServiceError, readCaseWorkbook } from '@/server/avdrawing';
import { currentUser } from '@/server/session';

/* 历史案例检索.
   GET ?q=&status=&pitchMin=&pitchMax=&sqmMin=&sqmMax=   search the library
   POST multipart { file }   import the company's project statistics workbook
                             (xlsx), replacing the library — PD / BD only.
   Client names and sizes are commercial data: seen by whoever sees prices. */

const MAX_BYTES = 20 * 1024 * 1024;

export async function GET(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  if (!canViewPrices(identityOf(user))) return NextResponse.json({ error: '无权查看历史案例' }, { status: 403 });
  const p = req.nextUrl.searchParams;
  const num = (k: string) => {
    const v = Number(p.get(k));
    return p.get(k)?.trim() && Number.isFinite(v) ? v : undefined;
  };
  const f: CaseFilter = {
    q: p.get('q') ?? undefined, status: p.get('status') || undefined,
    pitchMin: num('pitchMin'), pitchMax: num('pitchMax'), sqmMin: num('sqmMin'), sqmMax: num('sqmMax'),
  };
  return NextResponse.json({ ...searchCases(f), library: caseLibraryInfo() });
}

export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  if (!canEditPrices(identityOf(user))) return NextResponse.json({ error: '仅 PD / BD 可导入历史案例' }, { status: 403 });

  const file = (await req.formData().catch(() => null))?.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: '缺少统计表文件' }, { status: 400 });
  if (path.extname(file.name).toLowerCase() !== '.xlsx') return NextResponse.json({ error: '请上传 .xlsx 统计表' }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: '统计表超过 20 MB' }, { status: 400 });

  const dir = await mkdtemp(path.join(os.tmpdir(), 'av-cases-'));
  try {
    const target = path.join(dir, 'cases.xlsx');
    await writeFile(target, Buffer.from(await file.arrayBuffer()));
    const out = (await readCaseWorkbook(target)) as { cases: Omit<HistCase, 'id'>[]; sheets: Record<string, number | null> };
    return NextResponse.json({ imported: replaceCases(out.cases, user.name), sheets: out.sheets });
  } catch (e) {
    const status = e instanceof DrawingServiceError ? 422 : 500;
    return NextResponse.json({ error: e instanceof Error ? e.message : '导入失败' }, { status });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
