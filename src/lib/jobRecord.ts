/* ===== REQ-049 · Job Record = 一张 4 栏表 =====
   Service Item / Detail / Quantity / Special Notes,和 Sales 报价表一致,内容全部自定义。
   行存在项目上(p.jobRecord),每行带它属于哪种业务(svc),页面上按业务分组:
   组标题 = 业务名(同类两份显示「LED × 2」),每组「＋ 加一行」,每种业务至少 1 行。
   原来各业务登记表的字段(pk.record)不删,只读显示在下面「旧字段」里;上线迁移把有值的字段转成行。 */

import { SVC } from './templates';
import type { JobRow, Project } from './types';

/* 加一种业务时预填的 Service Item(业务的英文名,和报价单上的叫法一致) */
export const SVC_ITEM: Record<string, string> = {
  cgi: 'Perspectives', ani: 'Animation', scale: 'Scale Model', drone: 'Drone & 360 IPM', led: 'LED Display',
  vrar: '3D VR / 720', matterport: 'Matterport', projector: 'Projector', tv: 'TV', saleskit: 'Sales Kit',
  unitmodel: 'Unit Model', maxhub: 'MAXHUB', lightbox: 'Lightbox', av: 'AV', elv: 'ELV', pv: 'Solar PV',
  brochure: 'Brochure', video: 'Video Shooting', interior: 'Interior Design', renovation: 'Renovation',
  website: 'Website', others: 'Others',
};
export const serviceItemOf = (svc: string) => SVC_ITEM[svc] || SVC[svc]?.en || svc;

export const JOB_FIELDS = ['item', 'detail', 'qty', 'note'] as const;
export type JobField = (typeof JOB_FIELDS)[number];
export const MAX_JOB_ROWS = 400;
export const clip = (s: unknown, n = 500) => String(s ?? '').replace(/\r/g, '').slice(0, n);

let seq = 0;
export const jobRowId = () => `j${Date.now().toString(36)}${(seq++).toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
export const blankRow = (svc: string, patch: Partial<JobRow> = {}): JobRow => ({
  id: jobRowId(), svc, item: serviceItemOf(svc), detail: '', qty: '', note: '', ...patch,
});

/* 项目里有哪些业务(按服务包出现的顺序,同类只算一次)和各有几份 */
export function projectSvcCounts(p: Pick<Project, 'packages'>): { svc: string; count: number }[] {
  const out: { svc: string; count: number }[] = [];
  for (const pk of p.packages || []) {
    const x = out.find((o) => o.svc === pk.svc);
    if (x) x.count += 1; else out.push({ svc: pk.svc, count: 1 });
  }
  return out;
}

/* 页面上的分组:先按项目里的业务顺序,再是行上有、项目里已经没有的(删了业务 / 粘贴时没对上的,svc = '') */
export function jobGroups(p: Pick<Project, 'packages' | 'jobRecord'>): { svc: string; count: number; inProject: boolean; rows: JobRow[] }[] {
  const rows = p.jobRecord || [];
  const groups = projectSvcCounts(p).map((g) => ({ ...g, inProject: true, rows: rows.filter((r) => r.svc === g.svc) }));
  for (const r of rows) {
    if (groups.some((g) => g.svc === r.svc)) continue;
    groups.push({ svc: r.svc, count: 0, inProject: false, rows: rows.filter((x) => x.svc === r.svc) });
  }
  return groups;
}

/* 项目里的每种业务至少有 1 行(读项目时兜底;新加业务时服务端也会加) */
export function ensureJobRows(p: Project): number {
  if (!Array.isArray(p.jobRecord)) p.jobRecord = [];
  let added = 0;
  for (const { svc } of projectSvcCounts(p)) {
    if (!p.jobRecord.some((r) => r.svc === svc)) { p.jobRecord.push(blankRow(svc)); added++; }
  }
  return added;
}

/* ---------- 从报价单粘贴 ---------- */

/* Excel 复制出来的是 TSV:格子里有换行时整格带双引号,双引号写成两个 */
export function parseTsv(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [], cell = '', q = false;
  const s = String(text || '').replace(/\r\n?/g, '\n');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"' && s[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"' && cell === '') q = true;
    else if (c === '\t') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); out.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); out.push(row); }
  return out.map((r) => r.map((x) => x.trim())).filter((r) => r.some(Boolean));
}

const HEAD = /^(service\s*item|服务项目?|服务内容|项目名?称?|detail|details|明细|内容|描述|quantity|qty|数量|special\s*notes?|notes?|remarks?|特别说明|备注|说明)$/i;
export const isHeaderRow = (cells: string[]) => cells.filter(Boolean).length >= 2 && cells.filter(Boolean).every((c) => HEAD.test(c.replace(/[:：]$/, '').trim()));

const norm = (s: string) => s.toLowerCase().replace(/[\s&/·.,_-]+/g, '');

/* Service Item 对上哪种业务:项目里已有行的 Service Item > 业务英文名 / 中英文业务名;对不上 = ''(未归类) */
export function svcForItem(item: string, p: Pick<Project, 'packages' | 'jobRecord'>): string {
  const k = norm(item);
  if (!k) return '';
  const svcs = projectSvcCounts(p).map((x) => x.svc);
  const own = (p.jobRecord || []).find((r) => norm(r.item) === k && svcs.includes(r.svc));
  if (own) return own.svc;
  for (const svc of svcs) {
    const names = [serviceItemOf(svc), SVC[svc]?.en || '', SVC[svc]?.label || '', svc].map(norm).filter(Boolean);
    if (names.some((n) => n === k || (n.length >= 3 && (k.startsWith(n) || n.startsWith(k))))) return svc;
  }
  return '';
}

/* 粘贴的格子 → 行。4 栏 = Service Item / Detail / Quantity / Special Notes;3 栏 = 没有 Quantity。
   报价单常见合并格:Service Item 只写在一组的第一行,下面几行空着 —— 空着的接上一行的。 */
export function rowsFromPaste(text: string, p: Pick<Project, 'packages' | 'jobRecord'>): JobRow[] {
  const cells = parseTsv(text);
  const body = cells.length && isHeaderRow(cells[0]) ? cells.slice(1) : cells;
  const out: JobRow[] = [];
  let lastItem = '', lastSvc = '';
  for (const c of body) {
    const [item0, detail = '', a = '', b = '', ...rest] = c;
    const four = c.length >= 4;
    const qty = four ? a : '';
    const note = four ? [b, ...rest].filter(Boolean).join(' ') : a;
    const item = item0 || lastItem;
    if (!item && !detail && !qty && !note) continue;
    const svc = item0 ? svcForItem(item0, p) : lastSvc;
    out.push({ id: jobRowId(), svc, item: clip(item, 200), detail: clip(detail), qty: clip(qty, 80), note: clip(note) });
    lastItem = item; lastSvc = svc;
  }
  return out;
}

/* ---------- 导出 / 登记表 ---------- */

/* 导入表里「业务 / Service」那一栏写的是什么都认:key(led)、中文名、英文名、预填的 Service Item */
export function svcFromName(s: string): string {
  const k = norm(String(s || ''));
  if (!k) return '';
  for (const svc of Object.keys(SVC)) {
    if ([svc, SVC[svc]?.en || '', SVC[svc]?.label || '', serviceItemOf(svc)].map(norm).includes(k)) return svc;
  }
  return '';
}

export const JOB_HEAD_EN = ['Service Item', 'Detail', 'Quantity', 'Special Notes'];
export const JOB_HEAD_ZH = ['服务项目', '明细', '数量', '特别说明'];

/* 登记表导入:认 4 栏表头(中英都认),返回每一栏在第几列;认不出返回 null */
export function jobHeaderMap(head: string[]): Record<JobField, number> | null {
  const find = (re: RegExp) => head.findIndex((h) => re.test(String(h || '').trim().replace(/^\ufeff/, '')));
  const m = {
    item: find(/^(service\s*item|服务项目?)$/i),
    detail: find(/^(details?|明细)$/i),
    qty: find(/^(quantity|qty|数量)$/i),
    note: find(/^(special\s*notes?|特别说明|备注)$/i),
  };
  return m.item >= 0 && (m.detail >= 0 || m.qty >= 0 || m.note >= 0) ? m : null;
}
/* 同一张导入表里的项目栏 / 业务栏 */
export function jobImportCols(head: string[]): { project: number; no: number; svc: number } {
  const find = (re: RegExp) => head.findIndex((h) => re.test(String(h || '').trim().replace(/^\ufeff/, '')));
  return {
    project: find(/^(项目|项目名称|project|project\s*name)$/i),
    no: find(/^(项目编号|编号|no\.?|project\s*no\.?)$/i),
    svc: find(/^(业务|服务|服务类型|service|service\s*type)$/i),
  };
}
