/* ===== REQ-044 · 共用信息清单:把各服务包的清单合成一张 =====

   一个项目原来每个服务包各有一份 checklist(加服务包时整份复制模板),Siteplan、
   最终 CAD 这类各业务都要的资料,CGI 一份、沙盘一份,彼此不相通。REQ-044 改成项目
   只有一张清单,每项带 svcs(哪些服务需要它),服务标签只做筛选。

   这个文件只放**纯函数**:同名判断、合并规则、合并报告。上线迁移、预演工具
   (scripts/req044-dryrun.ts)、加服务包时并入模板,用的都是这一份 —— 预演看到的
   结果,就是上线时会发生的结果。

   合并规则(文档 §3.4):
   - 同名:去掉空格、标点、大小写后中文名或英文名相同;或在「同义项」对照里属于同一组。
   - 状态取最靠后的:已确认 > 已收到 > 需修订 > 退回 > 待处理;N/A 只有所有来源都是 N/A 时才保留。
   - 收到日期取最新;负责人取第一个非空。
   - 备注不同时都保留,前面标来源服务「[CGI 静帧] …」。
   - 参考图、收料记录合并,按时间排序,去掉完全相同的。
   - 不丢东西:合并前的原样另存 checklistLegacy(由调用方负责)。 */

import type { ChecklistGroup, ChecklistItem, ChecklistStatus, ReceiptRecord } from './types';

/* 默认「同义项」:模板里名字不同、说的是同一份资料的。PD / BD 可以在模板管理里改
   (存进数据库后以那份为准)。宁少勿多 —— 合错了比没合上更难发现。 */
export const DEFAULT_SYNONYMS: string[][] = [
  ['最终 CAD + 3D 模型', '最终 CAD + SKP + 平面/立面/屋顶', '确认 3D 模型 & CAD'],
  ['场地竖向(详细标高)', '场地竖向'],
  ['彩色总平 标注设施名', '彩色总平(可最后)'],
  ['种植布局(灌木/乔木)+ 参考', '种植布局 + 参考'],
  ['景观材料(色/尺寸/排布)+ 参考', '景观材料(全规格)', '景观材料'],
  ['灯光布局 + 灯具 + 参考', '灯光布局 + 参考'],
  ['单元户型平面图', '单元户型平面'],
  ['立面图 Elevations', '立面图'],
  ['非ID木作与固定件', '非ID木作与固定件(衣柜/台盆/洁具)'],
  ['材料表(饰面/铺贴方向)', '材料表(饰面/颜色/纹理/铺贴)'],
  ['地址 + 联系人', '项目地址 + 开发商/Main Con 联系人'],
];

/* 去掉空格、标点、符号,统一全半角和大小写 */
export const normName = (s: string | undefined | null): string =>
  String(s || '').normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');

/* 同义项索引:规范化后的名字 → 组号 */
export function synonymIndex(synonyms: string[][]): Map<string, number> {
  const m = new Map<string, number>();
  synonyms.forEach((grp, gi) => grp.forEach((n) => { const k = normName(n); if (k && !m.has(k)) m.set(k, gi); }));
  return m;
}

/* 一个信息项的「身份」:中文名、英文名、所属同义组。两项只要有一个身份相同就算同一项 */
export function itemKeys(it: { zh?: string; en?: string }, syn: Map<string, number>): string[] {
  const out: string[] = [];
  const zh = normName(it.zh), en = normName(it.en);
  if (zh) { out.push('zh:' + zh); if (syn.has(zh)) out.push('syn:' + syn.get(zh)); }
  if (en) { out.push('en:' + en); if (syn.has(en)) out.push('syn:' + syn.get(en)); }
  return out;
}
export const groupKeys = (g: { group?: string; groupEn?: string }): string[] =>
  [normName(g.group) && 'zh:' + normName(g.group), normName(g.groupEn) && 'en:' + normName(g.groupEn)].filter(Boolean) as string[];

/* 已确认 > 已收到 > 需修订 > 退回 > 待处理。需修订 / 退回说明东西来过但不能用,
   比「没来」靠后、比「已收到」靠前不合适 —— 两个服务里有一个已经收到能用的,就按已收到算 */
const RANK: Record<string, number> = { na: -1, pending: 0, rejected: 0.5, revision: 0.7, received: 1, confirmed: 2 };
const ST_ZH: Record<string, string> = { pending: '待处理', received: '已收到', confirmed: '已确认', na: 'N/A', revision: '需修订', rejected: '退回' };
const stZh = (s: string | undefined) => ST_ZH[s || 'pending'] || s || '待处理';
const rankOf = (s: string) => (s in RANK ? RANK[s] : 0);

/* 状态取最靠后的;N/A 只有全部来源都是 N/A 时保留 */
export function mergeStatus(list: ChecklistStatus[]): ChecklistStatus {
  const real = list.filter((s) => s !== 'na');
  if (!real.length) return list.length ? 'na' : 'pending';
  return real.reduce((a, b) => (rankOf(b) > rankOf(a) ? b : a));
}

const receiptSig = (r: ReceiptRecord) =>
  JSON.stringify([r.date || '', r.fileName || '', r.from || '', r.via || '', r.path || '', r.status || '', r.remark || '', r.by || '', r.receivedBy || '', r.at || 0]);
/* 和 lib/receipts.ts 的 sortReceipts 同一个顺序(日期倒序,同一天按录入时间倒序) */
const sortRc = (list: ReceiptRecord[]) =>
  [...list].sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.at || 0) - (a.at || 0));

export interface MergeSource { svc: string; tag: string; item: ChecklistItem }

/* 把同一项的几份(来自不同服务包)合成一条。第一份的 id 留下(链接、展开状态都不变) */
export function mergeItems(src: MergeSource[]): { item: ChecklistItem; conflicts: string[] } {
  const first = src[0].item;
  const conflicts: string[] = [];
  const statuses = src.map((s) => s.item.status || 'pending');
  const status = mergeStatus(statuses);
  if (new Set(statuses).size > 1) conflicts.push(`状态 ${src.map((s) => `[${s.tag}] ${stZh(s.item.status)}`).join(' / ')} → ${stZh(status)}`);

  const dates = src.map((s) => s.item.date || '').filter(Boolean).sort();
  const date = dates.length ? dates[dates.length - 1] : '';
  if (new Set(dates).size > 1) conflicts.push(`收到日期 ${[...new Set(dates)].join(' / ')} → ${date}`);

  const owners = src.map((s) => (s.item.owner || '').trim()).filter(Boolean);
  const owner = owners[0] || '';
  if (new Set(owners).size > 1) conflicts.push(`负责人 ${[...new Set(owners)].join(' / ')} → ${owner}`);

  /* 备注:相同的只留一份;不同的都留,标来源 */
  const remarks: { tag: string; text: string }[] = [];
  src.forEach((s) => { const t = (s.item.remark || '').trim(); if (t && !remarks.some((r) => r.text === t)) remarks.push({ tag: s.tag, text: t }); });
  const remark = remarks.length <= 1 ? (remarks[0]?.text || '') : remarks.map((r) => `[${r.tag}] ${r.text}`).join('\n');
  if (remarks.length > 1) conflicts.push(`备注不同,都保留(${remarks.length} 条)`);

  /* 「收到内容」跟着状态走:优先取状态最靠后、日期最新的那一份 */
  const best = [...src].sort((a, b) => rankOf(b.item.status) - rankOf(a.item.status) || (b.item.date || '').localeCompare(a.item.date || ''))[0].item;
  const recvs = [...new Set(src.map((s) => (s.item.received || '').trim()).filter(Boolean))];
  const received = (best.received || '').trim() || recvs[0] || '';
  if (recvs.length > 1) conflicts.push(`收到内容 ${recvs.join(' / ')} → ${received}`);

  const shots: string[] = [];
  src.forEach((s) => (s.item.shots || []).forEach((d) => { if (d && !shots.includes(d)) shots.push(d); }));

  const seen = new Set<string>();
  const receipts: ReceiptRecord[] = [];
  src.forEach((s) => (s.item.receipts || []).forEach((r) => { const k = receiptSig(r); if (!seen.has(k)) { seen.add(k); receipts.push({ ...r }); } }));
  const ids = new Set<string>();
  receipts.forEach((r) => { if (ids.has(r.id)) r.id = r.id + '-' + ids.size; ids.add(r.id); });   // 不同来源 id 撞了也分得开

  const svcs: string[] = [];
  src.forEach((s) => { if (!svcs.includes(s.svc)) svcs.push(s.svc); });

  const updatedAt = Math.max(0, ...src.map((s) => s.item.updatedAt || 0)) || undefined;
  const item: ChecklistItem = {
    ...first,
    status, date, remark, received, owner, shots,
    receipts: sortRc(receipts),
    highlight: src.some((s) => s.item.highlight) || undefined,
    updatedAt,
    svcs,
  };
  if (!item.highlight) delete item.highlight;
  if (!item.updatedAt) delete item.updatedAt;
  return { item, conflicts };
}

export interface LegacyPackage { svc: string; label?: string; checklist?: ChecklistGroup[]; noCategories?: boolean }
export interface MergedItemReport { name: string; svcs: string[]; tags: string[]; conflicts: string[] }
export interface MergeResult {
  checklist: ChecklistGroup[];
  noCategories: boolean;
  sourceItems: number;         // 合并前一共多少项
  items: number;               // 合并后多少项
  merged: MergedItemReport[];  // 由两份以上合成的项
}

/* 把各服务包的清单合成一张。
   - 分组按名字(中文 / 英文)认,出现顺序就是排列顺序;
   - 同一项在整张清单里只出现一次,放在它第一次出现的那一组;
   - 同一种服务的两项**不合**:同一个服务包里重名的两项原来就是分开的;同一种服务有两份
     (如「大堂 LED」「户外 LED」)时,两块屏各有各的尺寸、电源,合了就分不清是哪块。
     第二份里和第一份重名的项单独保留,名字后面加上实例名,如「电源规格与位置(户外 LED)」。 */
export function mergeChecklists(pkgs: LegacyPackage[], opts: { synonyms?: string[][]; tagOf: (svc: string, label?: string) => string }): MergeResult {
  const syn = synonymIndex(opts.synonyms || DEFAULT_SYNONYMS);
  const groups: ChecklistGroup[] = [];
  const gIndex = new Map<string, ChecklistGroup>();
  type Slot = { group: ChecklistGroup; pos: number; src: MergeSource[]; svcs: Set<string> };
  const slots: Slot[] = [];
  const byKey = new Map<string, Slot>();
  let sourceItems = 0;

  const seenSvc: Record<string, number> = {};
  pkgs.forEach((pk) => {
    const nth = (seenSvc[pk.svc] = (seenSvc[pk.svc] || 0) + 1);
    const inst = pk.label || (nth > 1 ? `#${nth}` : '');   // 同一种服务的第几份
    const tag = opts.tagOf(pk.svc, inst || undefined);
    (pk.checklist || []).forEach((g) => {
      let tg = groupKeys(g).map((k) => gIndex.get(k)).find(Boolean);
      if (!tg) {
        tg = { group: g.group, groupEn: g.groupEn, color: g.color, items: [] };
        groups.push(tg);
      }
      groupKeys(g).forEach((k) => { if (!gIndex.has(k)) gIndex.set(k, tg!); });
      (g.items || []).forEach((it0) => {
        sourceItems++;
        let it = it0;
        const keys = itemKeys(it, syn);
        const cands = keys.map((k) => byKey.get(k)).filter(Boolean) as Slot[];
        const hit = cands.find((s) => !s.svcs.has(pk.svc));
        if (hit) {
          hit.src.push({ svc: pk.svc, tag, item: it });
          hit.svcs.add(pk.svc);
          keys.forEach((k) => { if (!byKey.has(k)) byKey.set(k, hit); });
          return;
        }
        /* 同一种服务第二份里的重名项:单独一条,名字后加实例名 */
        if (inst && cands.length) it = { ...it, zh: `${it.zh}(${inst})`, en: it.en ? `${it.en} (${inst})` : it.en };
        const slot: Slot = { group: tg!, pos: tg!.items.length, src: [{ svc: pk.svc, tag, item: it }], svcs: new Set([pk.svc]) };
        tg!.items.push(it);   // 占位,下面换成合并结果
        slots.push(slot);
        keys.forEach((k) => { if (!byKey.has(k)) byKey.set(k, slot); });
      });
    });
  });

  const merged: MergedItemReport[] = [];
  for (const s of slots) {
    const { item, conflicts } = mergeItems(s.src);
    s.group.items[s.pos] = item;
    if (s.src.length > 1) merged.push({ name: item.zh || item.en, svcs: item.svcs || [], tags: s.src.map((x) => x.tag), conflicts });
  }
  const withItems = pkgs.filter((pk) => (pk.checklist || []).length);
  return {
    checklist: groups,
    noCategories: withItems.length > 0 && withItems.every((pk) => !!pk.noCategories),
    sourceItems,
    items: slots.length,
    merged,
  };
}

/* 预演 / 迁移后的自检:合并前的每一项都找得到去处;已确认的没被降级;收料记录一条不少 */
export function verifyMerge(pkgs: LegacyPackage[], out: ChecklistGroup[], synonyms?: string[][]): string[] {
  const syn = synonymIndex(synonyms || DEFAULT_SYNONYMS);
  const flat = out.flatMap((g) => g.items);
  const problems: string[] = [];
  const allRc = new Set(flat.flatMap((it) => (it.receipts || []).map(receiptSig)));
  pkgs.forEach((pk) => (pk.checklist || []).forEach((g) => (g.items || []).forEach((it) => {
    const keys = itemKeys(it, syn);
    const dest = flat.find((x) => x.id === it.id) || flat.find((x) => (x.svcs || []).includes(pk.svc) && itemKeys(x, syn).some((k) => keys.includes(k)));
    const name = it.zh || it.en;
    if (!dest) { problems.push(`找不到「${name}」(${pk.svc})`); return; }
    if (it.status === 'confirmed' && dest.status !== 'confirmed') problems.push(`「${name}」原来已确认,合并后是 ${dest.status}`);
    if (it.status === 'received' && rankOf(dest.status) < rankOf('received')) problems.push(`「${name}」原来已收到,合并后是 ${dest.status}`);
    (it.receipts || []).forEach((r) => { if (!allRc.has(receiptSig(r))) problems.push(`「${name}」少了一条收料记录 ${r.date} ${r.fileName}`); });
    (it.shots || []).forEach((d) => { if (!(dest.shots || []).includes(d)) problems.push(`「${name}」少了一张参考图`); });
  })));
  return problems;
}

/* ===== 一个项目的迁移:老结构(packages[].checklist)→ 新结构(project.checklist) =====
   原样备份进 checklistLegacy(可回退),再合并。已经是新结构的项目不动,返回 null。
   上线迁移和预演工具都调它。 */
export interface ProjectMigration {
  id: string; name: string; serial?: number;
  services: string[];          // 有清单的服务包(标签)
  sourceItems: number; items: number;
  merged: MergedItemReport[];
  problems: string[];          // verifyMerge 的结果,正常应为空
}
type AnyProject = {
  id: string; name: string; serial?: number;
  packages: (LegacyPackage & Record<string, unknown>)[];
  checklist?: ChecklistGroup[]; noCategories?: boolean;
  checklistLegacy?: LegacyPackage[];
};
export function migrateProjectChecklist(p: AnyProject, opts: { synonyms?: string[][]; tagOf: (svc: string, label?: string) => string }): ProjectMigration | null {
  if (Array.isArray(p.checklist)) return null;
  const pkgs = p.packages || [];
  const legacy: LegacyPackage[] = pkgs.map((pk) => ({
    svc: pk.svc, ...(pk.label ? { label: pk.label } : {}),
    checklist: JSON.parse(JSON.stringify(pk.checklist || [])),
    ...(pk.noCategories ? { noCategories: true } : {}),
  }));
  const r = mergeChecklists(legacy, opts);
  const problems = verifyMerge(legacy, r.checklist, opts.synonyms);
  p.checklistLegacy = legacy;
  p.checklist = r.checklist;
  p.noCategories = r.noCategories;
  pkgs.forEach((pk) => { delete pk.checklist; delete pk.noCategories; });
  return {
    id: p.id, name: p.name, serial: p.serial,
    services: legacy.filter((x) => (x.checklist || []).length).map((x) => opts.tagOf(x.svc, x.label)),
    sourceItems: r.sourceItems, items: r.items, merged: r.merged, problems,
  };
}

/* 迁移报告(Markdown):多服务、有合并的项目排前面,方便 PD 抽查 */
export function migrationReport(list: ProjectMigration[], meta: { title: string; when: string; db?: string; synonyms: string[][] }): string {
  const multi = list.filter((m) => m.merged.length).sort((a, b) => b.merged.length - a.merged.length);
  const plain = list.filter((m) => !m.merged.length);
  const bad = list.filter((m) => m.problems.length);
  const code = (m: ProjectMigration) => (m.serial ? String(m.serial).padStart(3, '0') + ' · ' : '');
  const L: string[] = [];
  L.push(`# ${meta.title}`, '', `- 时间:${meta.when}`);
  if (meta.db) L.push(`- 数据库:${meta.db}`);
  L.push(`- 项目:${list.length} 个需要迁移;其中 ${multi.length} 个有跨服务合并的项`,
    `- 合并前 ${list.reduce((n, m) => n + m.sourceItems, 0)} 项 → 合并后 ${list.reduce((n, m) => n + m.items, 0)} 项`,
    `- 自检:${bad.length ? `**${bad.length} 个项目有问题,见下文「⚠ 自检」**` : '全部通过(没有丢项、已确认没被降级、收料记录和参考图一条不少)'}`,
    '- 合并前的清单原样存在每个项目的 `checklistLegacy` 里,可回退。', '');
  if (bad.length) {
    L.push('## ⚠ 自检发现的问题', '');
    bad.forEach((m) => { L.push(`### ${code(m)}${m.name}`); m.problems.forEach((x) => L.push(`- ${x}`)); L.push(''); });
  }
  L.push('## 有合并的项目(建议抽查)', '');
  if (!multi.length) L.push('(没有)', '');
  multi.forEach((m) => {
    L.push(`### ${code(m)}${m.name}`, '', `服务:${m.services.join('、')} · 合并前 ${m.sourceItems} 项 → 合并后 ${m.items} 项`, '');
    L.push('| 合并的项 | 来自 | 冲突 / 取值 |', '|---|---|---|');
    m.merged.forEach((x) => L.push(`| ${x.name.replace(/\|/g, '/')} | ${x.tags.join('、')} | ${x.conflicts.length ? x.conflicts.join('<br>').replace(/\|/g, '/') : '无冲突'} |`));
    L.push('');
  });
  L.push('## 没有跨服务合并的项目', '');
  L.push(plain.length ? plain.map((m) => `- ${code(m)}${m.name}(${m.services.join('、') || '无清单'},${m.items} 项)`).join('\n') : '(没有)', '');
  L.push('## 用到的同义项', '');
  meta.synonyms.forEach((g) => L.push(`- ${g.join(' ≈ ')}`));
  L.push('');
  return L.join('\n');
}
