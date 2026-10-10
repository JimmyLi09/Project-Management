/* ===== REQ-050 上线迁移:信息清单里的「(#2)」重复项 → 同一行分格 =====

   REQ-044 之后,同一业务加第二份(第二块 LED)时,模板整份再并一次,重名的项另起一条、
   名字后加「(#2)」或实例名,并打上 inst。结果地址、联系人、时间节点都出现第二份。
   这里把它们收回成一行(预演脚本和上线迁移用同一份代码):

   1. 每份服务包补一个 id(规格项的格按它关联,改实例名、删掉前一份都对得上);
   2. 每条 inst 项按实例名 / #N 对到那一份服务包,再按名字(去掉后缀)找到原项,合成「一组」;
   3. 一组按范围处理(范围见 checklistScope.ts):
      - 规格项,且这个业务现在有两份以上:原项留下,同一行里每份一格(原项的值进第 1 格,
        (#N) 的值进第 N 格,状态、内容、收料记录各自原样);某一份原来没有这一项的,给一个空格;
      - 项目级(或这个业务只剩一份):合成一条,保留状态最靠后的那一份的状态、内容和收料记录;
        其余几份原样记进这一项的修改记录(history),一条收料记录都不丢;
   4. 对不上服务包的 inst 项不动,报告里列出来。
   清单有改动的项目,原来的整张清单原样备份进 checklistLegacy050(回退用)。
   只跑一次:跑过的项目有 mig050(没改动的也记,下次不再看)。 */

import { getSynonyms, itemKeys, mergeStatus, synonymIndex } from './checklistMerge';
import { scopeOf, type ScopeDecision, type TplNames } from './checklistScope';
import { blankCell, cellOf, ensurePkgIds, mirrorRow, pkgLabel } from './clCells';
import { svcName } from './templates';
import type { ChecklistGroup, ChecklistItem, ChecklistStatus, ClCell, ClHistory, Project, ReceiptRecord, ServicePackage } from './types';

const RANK: Record<string, number> = { na: -1, pending: 0, rejected: 0.5, revision: 0.7, received: 1, confirmed: 2 };
const rank = (s: string | undefined) => RANK[s || 'pending'] ?? 0;
export const ST_ZH: Record<string, string> = { pending: '待处理', received: '已收到', confirmed: '已确认', na: 'N/A', revision: '需修订', rejected: '退回' };
const stZh = (s: string | undefined) => ST_ZH[s || 'pending'] || s || '待处理';

export { blankCell, cellOf, ensurePkgIds, pkgLabel };

/* 名字最后的「(#2)」「(户外 LED)」去掉(全角半角括号都认) */
export function stripInst(s: string | undefined, inst: string): string {
  const esc = inst.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return String(s || '').replace(new RegExp(`\\s*[((]${esc}[))]\\s*$`), '');
}

const hasContent = (c: ClCell) => c.status !== 'pending' || !!(c.receipts || []).length || !!c.remark.trim() || !!(c.received || '').trim() || !!(c.owner || '').trim() || !!(c.shots || []).length;
const latestAt = (c: ClCell) => (c.receipts || [])[0]?.date || c.date || '';

/* 合成一条时谁的值留下:状态最靠后的;一样就看最近收料日期、再看最后修改时间;还一样就原项 */
function pickWinner<T extends { cell: ClCell }>(list: T[]): T {
  const top = mergeStatus(list.map((x) => x.cell.status));
  const cands = list.filter((x) => x.cell.status === top);
  return [...cands].sort((a, b) => latestAt(b.cell).localeCompare(latestAt(a.cell)) || (b.cell.updatedAt || 0) - (a.cell.updatedAt || 0))[0] || list[0];
}

export interface Mig050Source { label: string; pkgId?: string; id?: string; name: string; status: ChecklistStatus; receipts: number }
export interface Mig050Family {
  group: string; name: string; svc: string;
  scope: ScopeDecision['scope']; why: ScopeDecision['why'];
  result: 'cells' | 'merged';
  sources: Mig050Source[];
  cells?: { label: string; status: ChecklistStatus; blank?: boolean }[];   // result = cells
  kept?: string;            // result = merged:留下的是哪一份
  status?: ChecklistStatus; // result = merged:合并后的状态
  history: number;          // 记进修改记录的份数
  note?: string;
}
export interface Mig050Entry {
  id: string; name: string; serial?: number;
  pkgIds: number;           // 补了几个服务包 id
  multi: string[];          // 有两份以上的业务(报告里显示 LED × 2)
  itemsBefore: number; itemsAfter: number;
  families: Mig050Family[];
  blank: { name: string; label: string }[];   // 规格项里补的空格(那一份原来没有这一项)
  unresolved: { name: string; inst: string; svcs: string[] }[];
  removedInst: number;      // 「已移除的项」里带 inst 的(不动)
  receiptsBefore: number; receiptsAfter: number;
  problems: string[];
}

type Loc = { g: ChecklistGroup; it: ChecklistItem };
type Dest = { rowId: string; cell?: string; history?: boolean };

export function migrateProject050(p: Project, opts: { tplNames?: TplNames; at?: number; by?: string; synonyms?: string[][] } = {}): Mig050Entry | null {
  if (p.mig050) return null;
  if (!Array.isArray(p.checklist)) p.checklist = [];
  const at = opts.at ?? Date.now();
  const by = opts.by || '系统迁移';
  const syn = synonymIndex(opts.synonyms || getSynonyms());
  const legacy: ChecklistGroup[] = JSON.parse(JSON.stringify(p.checklist));
  const pkgIds = ensurePkgIds(p);
  const pkgsOf = (svc: string) => p.packages.filter((x) => x.svc === svc);
  const label = (pk: ServicePackage) => pkgLabel(p, pk);
  const entry: Mig050Entry = {
    id: p.id, name: p.name, serial: p.serial, pkgIds,
    multi: [...new Set(p.packages.map((x) => x.svc))].filter((s) => pkgsOf(s).length > 1).map((s) => `${svcName(s, 'zh')} × ${pkgsOf(s).length}`),
    itemsBefore: 0, itemsAfter: 0, families: [], blank: [], unresolved: [],
    removedInst: (p.checklistRemoved || []).filter((r) => r.item.inst).length,
    receiptsBefore: 0, receiptsAfter: 0, problems: [],
  };
  const locs: Loc[] = p.checklist.flatMap((g) => g.items.map((it) => ({ g, it })));
  entry.itemsBefore = locs.length;
  entry.receiptsBefore = locs.reduce((n, l) => n + (l.it.receipts || []).length, 0);
  const dest = new Map<string, Dest>();   // 原来每一项(按 id)去了哪里 —— 自检用

  /* ── 1. inst 项对到服务包 ── */
  type Resolved = { loc: Loc; svc: string; pk: ServicePackage };
  const resolved: Resolved[] = [];
  const pending: Loc[] = [];
  for (const loc of locs) {
    const inst = loc.it.inst;
    if (!inst) continue;
    let hit: Resolved | null = null;
    for (const svc of loc.it.svcs || []) {
      const pkgs = pkgsOf(svc);
      const byLabel = pkgs.slice(1).find((pk) => pk.label && pk.label === inst);
      const m = /^#(\d+)$/.exec(inst);
      const byNo = m && Number(m[1]) >= 2 ? pkgs[Number(m[1]) - 1] : undefined;
      const pk = byLabel || byNo;
      if (pk) { hit = { loc, svc, pk }; break; }
    }
    if (hit) resolved.push(hit); else pending.push(loc);
  }
  /* 实例名后来改过的:同一业务里还没对上的 inst 名字和还没被占的那几份,个数一样就按出现顺序对 */
  const bySvc = new Map<string, Loc[]>();
  pending.forEach((loc) => { const svc = (loc.it.svcs || []).find((s) => pkgsOf(s).length > 0); if (svc) bySvc.set(svc, [...(bySvc.get(svc) || []), loc]); });
  const stillPending = new Set(pending);
  for (const [svc, list] of bySvc) {
    /* 这一业务只剩一份(前面那份删了):都是它的 */
    if (pkgsOf(svc).length === 1) { list.forEach((loc) => { resolved.push({ loc, svc, pk: pkgsOf(svc)[0] }); stillPending.delete(loc); }); continue; }
    /* 只认像实例名的(「#9」这种序号对不上就是对不上,不猜) */
    const named = list.filter((l) => !/^#\d+$/.test(l.it.inst!));
    const names = [...new Set(named.map((l) => l.it.inst!))];
    const taken = new Set(resolved.filter((r) => r.svc === svc).map((r) => r.pk));
    const free = pkgsOf(svc).slice(1).filter((pk) => !taken.has(pk));
    if (names.length && names.length === free.length) {
      named.forEach((loc) => { resolved.push({ loc, svc, pk: free[names.indexOf(loc.it.inst!)] }); stillPending.delete(loc); });
    }
  }
  stillPending.forEach((loc) => entry.unresolved.push({ name: loc.it.zh || loc.it.en, inst: loc.it.inst!, svcs: loc.it.svcs || [] }));

  /* ── 2. 合成「一组」:原项 + 各份的 inst 项 ── */
  type Member = { loc: Loc; pk: ServicePackage; base?: boolean };
  type Family = { svc: string; base?: Loc; members: Member[]; zh: string; en: string };
  const families = new Map<string, Family>();
  for (const r of resolved) {
    const zh = stripInst(r.loc.it.zh, r.loc.it.inst!), en = stripInst(r.loc.it.en, r.loc.it.inst!);
    const keys = itemKeys({ zh, en }, syn);
    const base = locs.find((l) => !l.it.inst && (l.it.svcs || []).includes(r.svc) && itemKeys(l.it, syn).some((k) => keys.includes(k)));
    const fk = base ? `b:${base.it.id}` : `n:${r.svc}:${keys[0] || r.loc.it.id}`;
    let f = families.get(fk);
    if (!f) {
      f = { svc: r.svc, base, members: base ? [{ loc: base, pk: pkgsOf(r.svc)[0], base: true }] : [], zh: base?.it.zh ?? zh, en: base?.it.en ?? en };
      families.set(fk, f);
    }
    f.members.push({ loc: r.loc, pk: r.pk });
  }

  const removeLoc = (loc: Loc) => { const i = loc.g.items.indexOf(loc.it); if (i >= 0) loc.g.items.splice(i, 1); };
  /* 存的是合并之前那一份的快照(c):行本身可能已经被换成了别的那份 */
  const histOf = (m: Member, c: ClCell, cellLabel: string, text: string): ClHistory => ({
    at, by, k: 'mig050.merge', text, cell: cellLabel,
    data: { ...c, zh: m.loc.it.zh, en: m.loc.it.en, id: m.loc.it.id },
  });

  for (const f of families.values()) {
    const pkgs = pkgsOf(f.svc);
    const row = (f.base || f.members[0].loc).it;
    const rowGroup = (f.base || f.members[0].loc).g;
    const svcs = [...new Set(f.members.flatMap((m) => m.loc.it.svcs || []))];
    const dec = scopeOf({ zh: f.zh, en: f.en, scope: row.scope }, [f.svc], opts.tplNames);
    const fam: Mig050Family = {
      group: rowGroup.group, name: f.zh || f.en, svc: f.svc, scope: dec.scope, why: dec.why,
      result: 'merged', history: 0,
      sources: f.members.map((m) => ({ label: label(m.pk), pkgId: m.pk.id, id: m.loc.it.id, name: m.loc.it.zh || m.loc.it.en, status: m.loc.it.status || 'pending', receipts: (m.loc.it.receipts || []).length })),
    };
    const history: ClHistory[] = [...(row.history || [])];
    /* 跨业务共用的项不分实例格(那是「同步 / 单独填」管的);只剩一份的业务也不用分格 */
    const asCells = dec.scope === 'inst' && pkgs.length > 1 && svcs.length === 1;
    if (asCells) {
      const cells: Record<string, ClCell> = {};
      fam.cells = [];
      for (const pk of pkgs) {
        const mine = f.members.filter((m) => m.pk === pk);
        let c: ClCell;
        if (!mine.length) { c = blankCell(); entry.blank.push({ name: f.zh || f.en, label: label(pk) }); }
        else {
          /* 同一份里有两条(少见):留状态靠后的,另一条进修改记录 */
          const list = mine.map((m) => ({ m, cell: cellOf(m.loc.it) }));
          const w = pickWinner(list);
          c = w.cell;
          list.filter((x) => x !== w).forEach((x) => { history.push(histOf(x.m, x.cell, label(pk), `合并重复项「${x.m.loc.it.zh || x.m.loc.it.en}」:同一份(${label(pk)})里有两条,留下${stZh(c.status)}那条,这一条原样记在这里`)); fam.history++; });
        }
        cells[pk.id!] = c;
        fam.cells.push({ label: label(pk), status: c.status, blank: !mine.length || undefined });
        mine.forEach((m) => { if (m.loc.it.id) dest.set(m.loc.it.id, { rowId: row.id!, cell: pk.id }); });
      }
      fam.result = 'cells';
      row.cells = cells;
      /* 行上的老字段跟第 1 格(老代码、看板读它们;新代码按格读);参考图和收料记录只在格里 */
      mirrorRow(row);
    } else {
      const list = f.members.map((m) => ({ m, cell: cellOf(m.loc.it) }));
      const w = pickWinner(list);
      Object.assign(row, { ...w.cell, shots: [...new Set(list.flatMap((x) => x.cell.shots || []))] });
      if (!w.cell.highlight) delete row.highlight;
      if (!w.cell.updatedAt) delete row.updatedAt;
      fam.kept = label(w.m.pk);
      fam.status = w.cell.status;
      for (const x of list) {
        if (x === w) continue;
        if (hasContent(x.cell)) {
          history.push(histOf(x.m, x.cell, label(x.m.pk), `合并重复项:这一项整个项目只留一条,留下的是「${label(w.m.pk)}」那份(${stZh(w.cell.status)});「${label(x.m.pk)}」那份(${stZh(x.cell.status)})原样记在这里`));
          fam.history++;
        }
      }
      if (pkgs.length <= 1 && dec.scope === 'inst') fam.note = `${svcName(f.svc, 'zh')}只剩一份,不用分格`;
      if (svcs.length > 1 && dec.scope === 'inst') fam.note = '跨业务共用的项,按一条处理(要分开的话上线后切「单独填」)';
      f.members.forEach((m) => { if (m.loc.it.id) dest.set(m.loc.it.id, { rowId: row.id!, history: m !== w.m }); });
    }
    row.zh = f.zh; row.en = f.en;
    row.svcs = svcs;
    row.scope = dec.scope;
    delete row.inst;
    if (history.length) row.history = history;
    f.members.forEach((m) => { if (m.loc.it !== row) removeLoc(m.loc); });
    entry.families.push(fam);
  }

  /* ── 3. 有两份以上的业务里,没有 (#N) 的规格项也补上格(每份一格,新的那格是空的) ── */
  for (const g of p.checklist) for (const it of g.items) {
    if (it.cells || it.inst || (it.svcs || []).length !== 1) continue;
    const svc = it.svcs![0];
    const pkgs = pkgsOf(svc);
    if (pkgs.length < 2) continue;
    const dec = scopeOf(it, [svc], opts.tplNames);
    if (dec.scope !== 'inst') continue;
    it.scope = 'inst';
    it.cells = {};
    pkgs.forEach((pk, i) => {
      it.cells![pk.id!] = i === 0 ? cellOf(it) : blankCell();
      if (i > 0) entry.blank.push({ name: it.zh || it.en, label: label(pk) });
    });
    mirrorRow(it);
    if (it.id) dest.set(it.id, { rowId: it.id, cell: pkgs[0].id });
  }

  p.checklist = p.checklist.filter((g) => g.items.length);
  const after = p.checklist.flatMap((g) => g.items);
  entry.itemsAfter = after.length;
  entry.receiptsAfter = after.reduce((n, it) => n + (it.cells ? Object.values(it.cells).reduce((a, c) => a + (c.receipts || []).length, 0) : (it.receipts || []).length)
    + (it.history || []).reduce((a, h) => a + (h.data?.receipts || []).length, 0), 0);
  entry.problems = verify050(legacy, p, dest);
  /* 清单真的动了才备份(清单里有参考图,没动的项目不必再存一份) */
  if (entry.families.length || entry.blank.length) p.checklistLegacy050 = legacy;
  p.mig050 = { at, rows: entry.itemsAfter, merged: entry.families.length, cells: after.filter((it) => it.cells).length };
  return entry;
}

const rcSig = (r: ReceiptRecord) => JSON.stringify([r.date || '', r.fileName || '', r.from || '', r.via || '', r.path || '', r.status || '', r.remark || '', r.by || '', r.at || 0]);

/* 自检:每一项都找得到去处、没有被降级、收料记录和参考图一条不少、没有残留的 (#N) 项 */
export function verify050(legacy: ChecklistGroup[], p: Pick<Project, 'checklist'>, dest: Map<string, Dest>): string[] {
  const out: string[] = [];
  const rows = (p.checklist || []).flatMap((g) => g.items);
  const byId = new Map(rows.map((it) => [it.id, it]));
  const allRc = new Set<string>(), allShots = new Set<string>();
  rows.forEach((it) => {
    const parts: ClCell[] = [cellOf(it), ...Object.values(it.cells || {}), ...(it.history || []).map((h) => h.data).filter(Boolean) as ClCell[]];
    parts.forEach((c) => { (c.receipts || []).forEach((r) => allRc.add(rcSig(r))); (c.shots || []).forEach((s) => allShots.add(s)); });
  });
  legacy.flatMap((g) => g.items).forEach((it) => {
    const name = it.zh || it.en;
    const d = it.id ? dest.get(it.id) : undefined;
    const row = d ? byId.get(d.rowId) : byId.get(it.id);
    if (!row) { out.push(`找不到「${name}」的去处`); return; }
    if (d?.cell) {
      const c = row.cells?.[d.cell];
      if (!c) out.push(`「${name}」应该在一格里,但那一格不在`);
      else if (c.status !== (it.status || 'pending')) out.push(`「${name}」那一格的状态从${stZh(it.status)}变成了${stZh(c.status)}`);
    } else if (rank(row.status) < rank(it.status)) {
      out.push(`「${name}」原来${stZh(it.status)},合并后是${stZh(row.status)}(被降级)`);
    }
    (it.receipts || []).forEach((r) => { if (!allRc.has(rcSig(r))) out.push(`「${name}」少了一条收料记录 ${r.date} ${r.fileName}`); });
    (it.shots || []).forEach((s) => { if (!allShots.has(s)) out.push(`「${name}」少了一张参考图`); });
  });
  return out;
}

/* ===== 报告(Markdown)=====
   有合并的项目排前面,每个项目一张表:分组 / 项 / 范围 / 原来几份各什么状态 / 合并后。 */
export function report050(list: Mig050Entry[], meta: { title: string; when: string; db?: string; skipped?: number; broken?: number; scopeTable?: string[] }): string {
  const code = (m: Mig050Entry) => (m.serial ? String(m.serial).padStart(3, '0') + ' · ' : '');
  const touched = list.filter((m) => m.families.length || m.blank.length || m.unresolved.length).sort((a, b) => b.families.length - a.families.length);
  const bad = list.filter((m) => m.problems.length);
  const sum = (f: (m: Mig050Entry) => number) => list.reduce((n, m) => n + f(m), 0);
  const rcLost = list.filter((m) => m.receiptsAfter < m.receiptsBefore);
  const L: string[] = [];
  L.push(`# ${meta.title}`, '', `- 时间:${meta.when}`);
  if (meta.db) L.push(`- 数据库:${meta.db}`);
  L.push(
    `- 项目:看了 ${list.length} 个;有「(#N)」重复项或要分格的 ${touched.length} 个`,
    `- 清单行数:${sum((m) => m.itemsBefore)} → ${sum((m) => m.itemsAfter)}(收掉 ${sum((m) => m.itemsBefore - m.itemsAfter)} 条重复)`,
    `- 规格项分格:${sum((m) => m.families.filter((f) => f.result === 'cells').length)} 组;项目级合成一条:${sum((m) => m.families.filter((f) => f.result === 'merged').length)} 组;补的空格 ${sum((m) => m.blank.length)} 个;记进修改记录 ${sum((m) => m.families.reduce((a, f) => a + f.history, 0))} 份`,
    `- 收料记录:${sum((m) => m.receiptsBefore)} 条 → ${sum((m) => m.receiptsAfter)} 条(含修改记录里的)${rcLost.length ? ` **⚠ ${rcLost.length} 个项目变少了**` : ',一条不少'}`,
    `- 对不上服务包的 (#N) 项:${sum((m) => m.unresolved.length)} 条(不动,见下文)`,
    `- 自检:${bad.length ? `**${bad.length} 个项目有问题,见下文「⚠ 自检」**` : '全部通过(每一项都有去处、没有被降级、收料记录和参考图一条不少)'}`,
    '- 迁移前的清单原样存在每个项目的 `checklistLegacy050` 里,可回退。',
  );
  if (meta.skipped) L.push(`- 有 ${meta.skipped} 个项目已经迁移过,跳过。`);
  if (meta.broken) L.push(`- 有 ${meta.broken} 个项目数据读不出来,跳过(请把报告发回来看)。`);
  L.push('');
  if (bad.length) {
    L.push('## ⚠ 自检发现的问题', '');
    bad.forEach((m) => { L.push(`### ${code(m)}${m.name}`); m.problems.forEach((x) => L.push(`- ${x}`)); L.push(''); });
  }
  L.push('## 要抽查的项目', '');
  if (!touched.length) L.push('(没有)', '');
  const why = { item: '项上已设', template: '按模板', hint: '按名字猜', default: '默认项目级' } as const;
  touched.forEach((m) => {
    L.push(`### ${code(m)}${m.name}`, '', `${m.multi.length ? `同类多份:${m.multi.join('、')} · ` : ''}清单 ${m.itemsBefore} 行 → ${m.itemsAfter} 行 · 收料记录 ${m.receiptsBefore} → ${m.receiptsAfter} 条`, '');
    if (m.families.length) {
      L.push('| 分组 | 项 | 范围 | 原来 | 上线后 |', '|---|---|---|---|---|');
      m.families.forEach((f) => {
        const src = f.sources.map((s) => `${s.label}:${ST_ZH[s.status] || s.status}${s.receipts ? `(${s.receipts} 条记录)` : ''}`).join('<br>');
        const res = f.result === 'cells'
          ? '一行分格:' + (f.cells || []).map((c) => `${c.label} ${ST_ZH[c.status] || c.status}${c.blank ? '(空格)' : ''}`).join(' / ')
          : `合成一条:${ST_ZH[f.status || 'pending']}(留「${f.kept}」那份)${f.history ? `,${f.history} 份进修改记录` : ''}`;
        const scope = `${f.scope === 'inst' ? '规格项' : '项目级'}(${why[f.why]})`;
        L.push(`| ${f.group.replace(/\|/g, '/')} | ${f.name.replace(/\|/g, '/')} | ${scope} | ${src} | ${res}${f.note ? `<br>${f.note}` : ''} |`);
      });
      L.push('');
    }
    if (m.blank.length) {
      const by = new Map<string, string[]>();
      m.blank.forEach((b) => by.set(b.label, [...(by.get(b.label) || []), b.name]));
      L.push(`补的空格(那一份原来没有这一项):${[...by].map(([k, v]) => `${k} — ${v.join('、')}`).join(';')}`, '');
    }
    if (m.unresolved.length) {
      L.push(`对不上服务包、不动的:${m.unresolved.map((u) => `「${u.name}」(${u.inst})`).join('、')}`, '');
    }
  });
  if (meta.scopeTable?.length) L.push('## 规格项默认值(请 PD 复核)', '', ...meta.scopeTable, '');
  return L.join('\n');
}
