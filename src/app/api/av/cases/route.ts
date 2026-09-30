import { mkdtemp, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { NextRequest, NextResponse } from 'next/server';
import { canEditPrices, canViewPrices, identityOf } from '@/lib/permissions';
import { logZh } from '@/lib/logmsg';
import {
  appendCaseLog, applyImport, caseFacets, caseLibraryInfo, caseLog, editCase,
  searchCases, CASE_FIELD_KEYS, type CaseFilter, type HistCase,
} from '@/server/avdb';
import { DrawingServiceError, readCaseWorkbook } from '@/server/avdrawing';
import { currentUser } from '@/server/session';

/* 历史案例检索与编辑(AV-012 + AV-014).
   GET   ?q=&status=&pitchMin=&pitchMax=&sqmMin=&sqmMax=&years=&clients=&sort=&dir=
         检索;排序与年份 / 客户筛选都在服务端做(列表有 500 条上限,前端
         排序只排得到前 500 条)。?caseKey= 额外带上那块屏的修改记录。
   PATCH { caseKey, fields }      逐块屏改 —— PD / BD only
   POST  multipart { file, dryRun? }
         导入统计表。dryRun=1 只出预览不写库(AV-014 §4 的两步导入)。
         人工改过的字段与手填的交付日期 / 保修期一律保留 —— PD / BD only
   Client names and sizes are commercial data: seen by whoever sees prices. */

const MAX_BYTES = 20 * 1024 * 1024;
const list = (v: string | null) => (v?.trim() ? v.split(',').map((x) => x.trim()).filter(Boolean) : undefined);

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
    years: list(p.get('years')), clients: list(p.get('clients')),
  };
  const dir = p.get('dir');
  const found = searchCases(f, p.get('sort') || 'sqm', dir === 'asc' || dir === 'desc' ? dir : undefined);
  const key = p.get('caseKey');
  return NextResponse.json({
    ...found,
    library: caseLibraryInfo(),
    facets: caseFacets(),
    ...(key ? { log: caseLog(key) } : {}),
  });
}

export async function PATCH(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  /* 前端把「编辑」藏起来了,这里再拦一次 —— 直接调接口的绕不过去(§3.4) */
  if (!canEditPrices(identityOf(user))) return NextResponse.json({ error: '仅 PD / BD 可编辑历史案例' }, { status: 403 });

  const body = (await req.json().catch(() => null)) as
    { caseKey?: string; fields?: Record<string, unknown>; revert?: unknown } | null;
  const caseKey = body?.caseKey?.trim();
  if (!caseKey || !body?.fields) return NextResponse.json({ error: '缺少 caseKey 或 fields' }, { status: 400 });
  /* 恢复成统计表的值:白名单之外的一律忽略 */
  const revert = Array.isArray(body.revert)
    ? body.revert.filter((k): k is string => typeof k === 'string' && CASE_FIELD_KEYS.includes(k)) : [];

  /* 只认白名单里的字段,值一律当字符串收 */
  const fields: Record<string, string> = {};
  for (const k of CASE_FIELD_KEYS) {
    const v = body.fields[k];
    if (v !== undefined) fields[k] = v === null ? '' : String(v);
  }
  if (fields.name !== undefined && !fields.name.trim()) {
    return NextResponse.json({ error: '项目名不能为空' }, { status: 400 });
  }
  if (fields.status !== undefined && !['ongoing', 'completed'].includes(fields.status)) {
    return NextResponse.json({ error: '状态只能是进行中或已完成' }, { status: 400 });
  }
  if (fields.handover !== undefined && fields.handover && !/^\d{4}-\d{2}-\d{2}$/.test(fields.handover)) {
    return NextResponse.json({ error: 'Handover date 格式应为 YYYY-MM-DD' }, { status: 400 });
  }
  if (fields.warrantyMonths !== undefined && fields.warrantyMonths) {
    const m = Number(fields.warrantyMonths);
    if (!Number.isInteger(m) || m < 0 || m > 600) return NextResponse.json({ error: '保修期应为 0–600 的整数月' }, { status: 400 });
  }

  const r = editCase(caseKey, fields, user.name, revert);
  if (!r) return NextResponse.json({ error: '这块屏不在案例库里' }, { status: 404 });

  /* 一次保存写一条日志:显示第一处改动,其余用 more 带过;完整的
     改前→改后放在 changes 里存着(模板不引用它,所以不会渲染出来)。 */
  if (r.changes.length) {
    const [first, ...rest] = r.changes;
    const k = rest.length ? 'av.caseEditMore' : 'av.caseEdit';
    const p = {
      screen: r.row.name, cf: first.field, fv: first.from, tv: first.to,
      ...(rest.length ? { more: rest.length } : {}),
      changes: JSON.stringify(r.changes),
    };
    appendCaseLog(caseKey, user.name, k, { ...p, text: logZh(k, p) });
  }
  return NextResponse.json({ case: r.row, changes: r.changes, log: caseLog(caseKey) });
}

export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  if (!canEditPrices(identityOf(user))) return NextResponse.json({ error: '仅 PD / BD 可导入历史案例' }, { status: 403 });

  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  const dryRun = String(form?.get('dryRun') ?? '') === '1';
  if (!(file instanceof File)) return NextResponse.json({ error: '缺少统计表文件' }, { status: 400 });
  if (path.extname(file.name).toLowerCase() !== '.xlsx') return NextResponse.json({ error: '请上传 .xlsx 统计表' }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: '统计表超过 20 MB' }, { status: 400 });

  const dir = await mkdtemp(path.join(os.tmpdir(), 'av-cases-'));
  try {
    const target = path.join(dir, 'cases.xlsx');
    await writeFile(target, Buffer.from(await file.arrayBuffer()));
    const out = (await readCaseWorkbook(target)) as { cases: Omit<HistCase, 'id'>[]; sheets: Record<string, number | null> };
    const preview = applyImport(out.cases, user.name, { dryRun });
    return NextResponse.json({ dryRun, preview, imported: dryRun ? 0 : out.cases.length, sheets: out.sheets });
  } catch (e) {
    const status = e instanceof DrawingServiceError ? 422 : 500;
    return NextResponse.json({ error: e instanceof Error ? e.message : '导入失败' }, { status });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
