/* ===== REQ-050 · 信息清单的「格」 =====

   一项可以分成几格,每格各自有状态 / 内容 / 收料记录 / 参考图 / 负责人:
   - 规格项(scope = inst):这个业务有两份以上时,每份服务包一格,键 = 服务包 id
     (LED-1 / LED-2;改实例名自动更新,删掉一份只去掉那一格);
   - 单独填(mode = sep):适用两个以上业务的项,每个业务一格,键 = 业务 key。
   其余的项不分格,内容就在项本身上(和以前一样)。
   分格的项,行上的老字段始终等于第一格 —— 老代码 / 导出读它们不会出错,新代码按格读。

   这里是服务端动作和界面共用的纯函数。 */

import { scopeOf, type TplNames } from './checklistScope';
import { svcName } from './templates';
import type { ChecklistItem, ClCell, ClHistory, Project, ReceiptRecord, ServicePackage } from './types';

/* 不依赖 project.ts(project.ts 建项目时要用这里的 syncCells) */
let seq = 0;
const localId = () => Date.now().toString(36) + (seq++ % 1e6).toString(36) + Math.random().toString(36).slice(2, 6);

/* 服务包 id;老数据没有就补一个 */
export function ensurePkgIds(p: Pick<Project, 'packages'>): number {
  let n = 0;
  (p.packages || []).forEach((pk) => { if (!pk.id) { pk.id = 'pk' + localId(); n++; } });
  return n;
}

/* 一份服务包在界面 / 报告里叫什么:有实例名用实例名;同类只有一份就是业务名;否则「LED-1 / LED-2」 */
export function pkgLabel(p: Pick<Project, 'packages'>, pk: ServicePackage, lang: 'zh' | 'en' = 'zh'): string {
  const same = (p.packages || []).filter((x) => x.svc === pk.svc);
  if (pk.label) return pk.label;
  return same.length > 1 ? `${svcName(pk.svc, lang)}-${same.indexOf(pk) + 1}` : svcName(pk.svc, lang);
}

export const cellOf = (it: ChecklistItem | ClCell): ClCell => {
  const c: ClCell = {
    status: it.status || 'pending', date: it.date || '', remark: it.remark || '',
    received: it.received || '', owner: it.owner || '',
    shots: [...(it.shots || [])],
    receipts: (it.receipts || []).map((r) => ({ ...r })),
  };
  if (it.highlight) c.highlight = true;
  if (it.updatedAt) c.updatedAt = it.updatedAt;
  return c;
};
export const blankCell = (): ClCell => ({ status: 'pending', date: '', remark: '', received: '', owner: '', shots: [], receipts: [] });

/* 行上 / 格里共有的那几项内容 */
export type ClFields = Pick<ClCell, 'status' | 'date' | 'remark' | 'received' | 'owner' | 'shots' | 'receipts' | 'highlight' | 'updatedAt'>;

const pkgsOf = (p: Pick<Project, 'packages'>, svc: string) => (p.packages || []).filter((x) => x.svc === svc);
const svcOrder = (p: Pick<Project, 'packages'>) => [...new Set((p.packages || []).map((x) => x.svc))];

/* 这一项现在该有哪几格(按顺序)。没有就是 [](不分格) */
export function cellKeysFor(p: Pick<Project, 'packages'>, it: ChecklistItem, tplNames?: TplNames): string[] {
  const svcs = it.svcs || [];
  if (it.mode === 'sep' && svcs.length > 1) return svcOrder(p).filter((s) => svcs.includes(s));
  if (svcs.length !== 1) return [];
  const pkgs = pkgsOf(p, svcs[0]);
  if (pkgs.length < 2) return [];
  const scope = it.scope || scopeOf(it, svcs, tplNames).scope;
  return scope === 'inst' ? pkgs.map((pk) => pk.id!).filter(Boolean) : [];
}

/* 一格叫什么:服务包 id → 实例名 / LED-1;业务 key → 业务名 */
export function cellLabel(p: Pick<Project, 'packages'>, key: string, lang: 'zh' | 'en' = 'zh'): string {
  const pk = (p.packages || []).find((x) => x.id === key);
  if (pk) return pkgLabel(p, pk, lang);
  return svcName(key, lang);
}
/* 这一格属于哪个业务 */
export function cellSvc(p: Pick<Project, 'packages'>, key: string): string {
  return (p.packages || []).find((x) => x.id === key)?.svc || key;
}

/* 行上的老字段 = 第一格的状态 / 日期 / 内容 / 备注 / 负责人(老代码、看板读它们)。
   参考图和收料记录只在格里,不在行上再存一份(图片占地方)。 */
const SCALARS: (keyof ClFields)[] = ['status', 'date', 'remark', 'received', 'owner', 'highlight', 'updatedAt'];
export function mirrorRow(it: ChecklistItem) {
  const first = it.cells && Object.values(it.cells)[0];
  if (!first) return;
  const row = it as unknown as Record<string, unknown>;
  for (const f of SCALARS) {
    const v = first[f];
    if (v === undefined || v === false) delete row[f]; else row[f] = v;
  }
  if (!it.date) it.date = '';
  if (!it.remark) it.remark = '';
  if (!it.status) it.status = 'pending';
  it.shots = [];
  it.receipts = [];
}

const hasContent = (c: ClFields) => (c.status || 'pending') !== 'pending' || !!(c.receipts || []).length || !!(c.remark || '').trim()
  || !!(c.received || '').trim() || !!(c.owner || '').trim() || !!(c.shots || []).length;

function pushHistory(it: ChecklistItem, h: ClHistory) {
  it.history = [h, ...(it.history || [])].slice(0, 100);
}

/* 规整一个项目里所有项的格:该分的分、该收的收、多出来的格(那一份业务删了)记进修改记录。
   在每个会改变「业务 / 服务包 / 项的适用业务」的动作之后调一次。返回动了几项。
   labels:刚删掉的那份服务包已经不在 packages 里了,给它的叫法。 */
export function syncCells(p: Project, opts: { by: string; at?: number; tplNames?: TplNames; labels?: Record<string, string> } = { by: '' }): number {
  ensurePkgIds(p);
  const at = opts.at ?? Date.now();
  const nameOf = (k: string) => opts.labels?.[k] || ((p.packages || []).some((x) => x.id === k) || !k.startsWith('pk') ? cellLabel(p, k) : '已删掉的那一份');
  let n = 0;
  for (const g of p.checklist || []) for (const it of g.items) {
    const keys = cellKeysFor(p, it, opts.tplNames);
    if (it.mode === 'sep' && (it.svcs || []).length < 2) delete it.mode;
    /* 从别的项目导入时规格项的格是按「第几份」带过来的(@1、@2),这里对到本项目的服务包 */
    if (it.cells && (it.svcs || []).length === 1) {
      const pkgs = pkgsOf(p, it.svcs![0]);
      for (const k of Object.keys(it.cells)) {
        const m = /^@(\d+)$/.exec(k);
        if (!m) continue;
        const pk = pkgs[Number(m[1]) - 1];
        if (pk?.id && !it.cells[pk.id]) it.cells[pk.id] = it.cells[k];
        else if (pk?.id) { /* 目标已有这一格:导入的那份记进修改记录 */ if (hasContent(it.cells[k])) pushHistory(it, { at, by: opts.by, k: 'cell.import', text: `导入时「第 ${m[1]} 份」那一格和已有的重了,导入的那份原样记在这里`, cell: `#${m[1]}`, data: it.cells[k] }); }
        delete it.cells[k];
      }
    }
    if (!keys.length) {
      if (!it.cells) continue;
      /* 收成一条:留现在还在的那一格(只剩一份的那份 / 剩下的那个业务),其余记进修改记录 */
      const svcs = it.svcs || [];
      const prefer = [...(svcs.length === 1 ? pkgsOf(p, svcs[0]).map((pk) => pk.id!) : []), ...svcs].find((k) => it.cells![k]) || Object.keys(it.cells)[0];
      for (const [k, c] of Object.entries(it.cells)) {
        if (k === prefer || !hasContent(c)) continue;
        pushHistory(it, { at, by: opts.by, k: 'cell.drop', text: `「${nameOf(k)}」那一格不用了(那一份业务删了 / 这一项只剩一个业务),原样记在这里`, cell: nameOf(k), data: c });
      }
      const keep = it.cells[prefer];
      delete it.cells;
      if (keep) Object.assign(it, cellOf(keep));
      n++;
      continue;
    }
    const was = it.cells ? JSON.stringify(Object.keys(it.cells)) : '';
    if (!it.cells) {
      /* 第一次分格:现在的内容进第一格,其余空格 */
      it.cells = {};
      keys.forEach((k, i) => { it.cells![k] = i === 0 ? cellOf(it) : blankCell(); });
      if (it.mode !== 'sep') it.scope = 'inst';
      mirrorRow(it);
      n++;
      continue;
    }
    const next: Record<string, ClCell> = {};
    for (const k of keys) next[k] = it.cells[k] || blankCell();
    for (const [k, c] of Object.entries(it.cells)) {
      if (keys.includes(k)) continue;
      if (hasContent(c)) pushHistory(it, { at, by: opts.by, k: 'cell.drop', text: `「${nameOf(k)}」那一格去掉了(那一份业务删了),原样记在这里`, cell: nameOf(k), data: c });
    }
    it.cells = next;
    mirrorRow(it);
    if (JSON.stringify(Object.keys(next)) !== was) n++;
  }
  return n;
}

/* 动作要改的是哪一格。分格的项必须说是哪一格;不分格的项不能带格 */
export function targetOf(it: ChecklistItem, cell?: string): ClFields {
  if (it.cells) {
    if (!cell) throw new Error('这一项分格了,请刷新页面后再改');
    const c = it.cells[cell];
    if (!c) throw new Error('这一格已经不在了,请刷新页面');
    return c;
  }
  if (cell) throw new Error('这一项没有分格,请刷新页面后再改');
  return it as ClFields;
}

/* 统计 / 显示用:在某个标签下这一项算哪几格。
   不分格的项算 1 格;单独填在某个业务标签下只算那个业务的格;规格项在它的业务标签下算全部格。 */
export function unitsOf(p: Pick<Project, 'packages'>, it: ChecklistItem, scope: string): { key?: string; c: ClFields }[] {
  if (scope !== 'all' && !(it.svcs || []).includes(scope)) return [];
  if (!it.cells) return [{ c: it as ClFields }];
  return Object.entries(it.cells)
    .filter(([k]) => scope === 'all' || cellSvc(p, k) === scope)
    .map(([key, c]) => ({ key, c }));
}

/* 切换同步 / 单独填。
   sync → sep:每个业务先复制一份当前内容(收料记录也复制,id 换新);
   sep → sync:以 from 那一格为准,其余格原样记进修改记录。 */
export function setMode(p: Project, it: ChecklistItem, mode: 'sync' | 'sep', opts: { by: string; from?: string; at?: number; newId: () => string }): void {
  const svcs = svcOrder(p).filter((s) => (it.svcs || []).includes(s));
  const at = opts.at ?? Date.now();
  if (mode === 'sep') {
    if (svcs.length < 2) throw new Error('只适用于一个业务的项不用单独填');
    if (it.mode === 'sep' && it.cells) return;
    const base = cellOf(it);
    it.mode = 'sep';
    it.cells = {};
    svcs.forEach((s, i) => {
      const c = cellOf(base);
      if (i > 0) c.receipts = (c.receipts || []).map((r: ReceiptRecord) => ({ ...r, id: 'rc' + opts.newId() }));
      it.cells![s] = c;
    });
    mirrorRow(it);
    pushHistory(it, { at, by: opts.by, k: 'mode.sep', text: `切成单独填:${svcs.map((s) => svcName(s, 'zh')).join('、')} 各一格,先各复制一份当时的内容` });
    return;
  }
  if (!it.cells || it.mode !== 'sep') { delete it.mode; return; }
  const from = opts.from && it.cells[opts.from] ? opts.from : Object.keys(it.cells)[0];
  const keep = it.cells[from];
  for (const [k, c] of Object.entries(it.cells)) {
    if (k === from) continue;
    pushHistory(it, { at, by: opts.by, k: 'mode.sync', text: `改回同步,以「${svcName(from, 'zh')}」那份为准;「${svcName(k, 'zh')}」那份原样记在这里`, cell: svcName(k, 'zh'), data: c });
  }
  delete it.cells;
  delete it.mode;
  Object.assign(it, cellOf(keep));
}

/* 导出 / 存为模板时:规格项的格从服务包 id 换成「第几份」(@1、@2),到别的项目再对回去 */
export function cellsToOrdinal(p: Pick<Project, 'packages'>, it: ChecklistItem): ChecklistItem {
  if (!it.cells || it.mode === 'sep') return it;
  const out: Record<string, ClCell> = {};
  for (const [k, c] of Object.entries(it.cells)) {
    const pk = (p.packages || []).find((x) => x.id === k);
    const i = pk ? pkgsOf(p, pk.svc).indexOf(pk) : -1;
    out[i >= 0 ? `@${i + 1}` : k] = c;
  }
  return { ...it, cells: out };
}

/* 删一份服务包之前:记下它那一格的叫法(删了之后就算不出 LED-2 了) */
export function labelsBeforeDrop(p: Project, pk: ServicePackage): Record<string, string> {
  return pk.id ? { [pk.id]: pkgLabel(p, pk) } : {};
}
