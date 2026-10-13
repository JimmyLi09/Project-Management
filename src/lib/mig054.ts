/* ===== REQ-054 上线迁移:AV 立项询价建的项目去掉编号,变回售前记录 =====
   以前 AV 立项询价新建的项目一重启就被 backfillSerials 补上了编号(049 · 147-Senja Close 就是这么来的,
   和已有的 007 重复)。这次:
     - 确定要改的:049 · 147-Senja Close sales gallery(id muy6ka5ieeir)—— 去掉 serial,原编号存进
       approach.legacySerial,写上 approach = { status: 'open', source: 'av', createdAt: 原创建时间 };
     - 其他符合条件的(例如 046 · BOC Lobby LED)只在报告里列为「符合条件,待 JM 确认」,
       预演时加 --include 046 才一起改;
     - 其他编号一个不动,不重排(去掉中间的号会留空号,正常)。
   判断条件:日志里有 proj.createAv(从 AV 立项询价建的)、没有负责人、交接没提交、没开过 Invoice。
   预演脚本 scripts/req054-dryrun 和启动时的正式迁移(server/db.ts)用同一份代码。 */

import { logZh } from './logmsg';
import type { Project } from './types';

export const MIG054_DEFAULT_IDS = ['muy6ka5ieeir'];   // 049 · 147-Senja Close sales gallery

export interface Mig054Row {
  id: string; name: string; serial?: number; client?: string; created?: number;
  svcs: string[];
  fails: string[];               // 不符合的条件(空 = 符合)
  action: 'change' | 'confirm' | 'skip';   // 改 / 符合条件待确认 / 不改
  why: string;
}

/* 这个项目能不能变回售前记录:不能的话返回原因 */
export function approachFails(p: Project): string[] {
  const out: string[] = [];
  if (p.approach) out.push(p.approach.status === 'converted' ? '已经转过正式项目' : '已经是售前记录');
  if (!(p.log || []).some((l) => (l as { k?: string }).k === 'proj.createAv')) out.push('不是从 AV 立项询价建的');
  if ((p.owners || []).length) out.push(`有负责人(${(p.owners || []).join('、')})`);
  const hs = p.handover?.status;
  if (hs && hs !== 'not_started') out.push(`交接已${hs === 'accepted' ? '接单' : '提交'}`);
  const inv = p.invoiceClose;
  if (p.invoiced || inv?.invoiceStatus === 'issued' || String(inv?.invoiceRef || '').trim()) out.push('开过 Invoice');
  if (p.archived) out.push('已归档');
  if (!(typeof p.serial === 'number' && p.serial > 0)) out.push('没有编号');
  return out;
}

/* 每个从 AV 立项询价建的项目一行;include = 要一起改的项目 id(默认那几个之外的) */
export function planMig054(list: Project[], include: string[] = []): Mig054Row[] {
  const want = new Set([...MIG054_DEFAULT_IDS, ...include]);
  return list
    .filter((p) => ((p.log || []).some((l) => (l as { k?: string }).k === 'proj.createAv') || want.has(p.id))
      && !(p.approach && !p.approach.legacySerial))   // 上线后新建的售前记录本来就没有编号,不列
    .map((p) => {
      const fails = approachFails(p);
      const action: Mig054Row['action'] = fails.length ? 'skip' : want.has(p.id) ? 'change' : 'confirm';
      const why = fails.length ? `不改:${fails.join('、')}`
        : action === 'change' ? (MIG054_DEFAULT_IDS.includes(p.id) ? '要改(需求里确定的)' : '要改(预演时 --include 加上的)')
          : '符合条件,待 JM 确认(确认后预演加 --include ' + String(p.serial).padStart(3, '0') + ')';
      return { id: p.id, name: p.name, serial: p.serial || p.approach?.legacySerial, client: p.client, created: p.created, svcs: [...new Set((p.packages || []).map((x) => x.svc))], fails, action, why };
    })
    .sort((a, b) => (a.serial || 0) - (b.serial || 0));
}

/* 真改一个项目(调用前确认 approachFails 为空) */
export function applyMig054(p: Project, at: number, by = 'REQ-054'): number {
  const was = p.serial!;
  p.approach = { status: 'open', source: 'av', createdAt: p.created || at, legacySerial: was };
  delete p.serial;
  const no = String(was).padStart(3, '0');
  p.log = [{ at, by, text: logZh('approach.mig', { no }), k: 'approach.mig', p: { no } }, ...(p.log || [])];
  return was;
}

/* 把 --include 后面的写法(046 / 46 / 项目 id)认成项目 id;认不出的原样返回在 bad 里 */
export function resolveInclude(list: Pick<Project, 'id' | 'serial'>[], args: string[]): { ids: string[]; bad: string[] } {
  const ids: string[] = [], bad: string[] = [];
  for (const raw of args) {
    const a = raw.trim();
    if (!a) continue;
    const hit = /^\d+$/.test(a) ? list.find((p) => p.serial === Number(a)) : list.find((p) => p.id === a);
    if (hit) ids.push(hit.id); else bad.push(a);
  }
  return { ids, bad };
}

export function report054(rows: Mig054Row[], meta: { title: string; when: string; db?: string; next?: number; changed?: number[] }): string {
  const code = (n?: number) => (n ? String(n).padStart(3, '0') : '—');
  const ch = rows.filter((r) => r.action === 'change'), cf = rows.filter((r) => r.action === 'confirm'), sk = rows.filter((r) => r.action === 'skip');
  const L: string[] = [`# ${meta.title}`, '', `- 时间:${meta.when}`];
  if (meta.db) L.push(`- ${meta.db}`);
  L.push(
    `- **去掉编号、改为售前记录:${ch.length} 个**${ch.length ? '(' + ch.map((r) => code(r.serial) + ' · ' + r.name).join('、') + ')' : ''}`,
    `- 符合条件、待 JM 确认:${cf.length} 个${cf.length ? '(' + cf.map((r) => code(r.serial) + ' · ' + r.name).join('、') + ';确认后预演加 --include 编号)' : ''}`,
    `- 其他项目编号一个不动,不重排;去掉的号空着,下一个正式项目用「当前最大编号 + 1」${meta.next ? `(迁移后是 ${code(meta.next)})` : ''}`,
    '- 判断条件:从 AV 立项询价建的(日志里有 proj.createAv)、没有负责人、交接没提交、没开过 Invoice',
    '- 原编号存进 approach.legacySerial,回退脚本放回去;AV 立项、方案、成本、报价、日志都不动', '',
    '## 从 AV 立项询价建的项目', '', '| 编号 | 项目 | 客户 | 业务 | 结果 |', '|---|---|---|---|---|');
  rows.forEach((r) => L.push(`| ${code(r.serial)} | ${r.name.replace(/\|/g, '/')} | ${(r.client || '—').replace(/\|/g, '/')} | ${r.svcs.join('、') || '—'} | ${r.why} |`));
  if (!rows.length) L.push('| — | (没有) | | | |');
  if (sk.length) L.push('', `有 ${sk.length} 个不符合条件的不改(原因见上表)。`);
  return L.join('\n') + '\n';
}
