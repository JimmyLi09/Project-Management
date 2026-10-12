/* ===== REQ-053 上线迁移:硬件业务回到登记表,删掉 REQ-049 拆出来的 4 栏行 =====
   只看「硬件」业务(lib/jobFormat)的 p.jobRecord 行;软件的行一行不动,pk.record 一个字段都不动。
   删两类:
     1. 049 迁移写进去、之后没人改过的行:Service Item = 业务英文名,Detail = 登记表字段名(可带「LED ② · 」这类前缀),
        Quantity / Special Notes 里的值 = 那一份 pk.record 现在的值(下拉比显示名);
     2. 只预填了业务名(或实例名)、其余都空的行。
   不删:上线后有人改过 / 新加的硬件行 —— 原样留下,补上 pk,成为那一份服务包的「额外项目」,报告里单独列给 PD 看。
   删掉的行原样存进 p.jobRecordLegacy053(带原来的位置),回退脚本放回去。
   服务端第一次启动、且预演确认过之后才跑(server/db.ts);scripts/req053-dryrun 用的是同一份代码。 */

import { serviceItemOf } from './jobRecord';
import { CIRCLED_NO, fieldRowName, fieldRowValue } from './mig049';
import { projSourceOf, type FieldDef } from './records';
import type { JobRow, Project, ServicePackage } from './types';

export interface Mig053Kept { pkg: string; item: string; detail: string; qty: string; note: string }
export interface Mig053Entry {
  id: string; project: string; serial?: number;
  split: { pkg: string; detail: string; value: string }[];
  blank: string[];               // 删掉的空行属于哪一份
  kept: Mig053Kept[];
  orphan: number;                // 硬件业务、但项目里已经没有这项业务的行(不动)
  swRows: number;                // 软件行(不动,只数一数)
  problems: string[];
}

/* REQ-053 把 LED dimH 从「Width 宽 (mm)」改名成「Height 高 (mm)」—— 049 写进 Detail 的还是旧名 */
const OLD_NAMES: Record<string, Record<string, string[]>> = { led: { dimH: ['Width 宽 (mm)', 'Width (mm)'] } };

const sameStr = (a: unknown, b: unknown) => String(a ?? '').trim() === String(b ?? '').trim();

/* 这一份服务包在 049 迁移时可能用过的实例前缀 */
function prefixesOf(p: Pick<Project, 'packages'>, pk: ServicePackage): string[] {
  const same = p.packages.filter((x) => x.svc === pk.svc);
  const i = same.indexOf(pk);
  const item = serviceItemOf(pk.svc);
  return [pk.label || '', `${item} ${CIRCLED_NO[i] || '#' + (i + 1)}`, `${item} #${i + 1}`].filter(Boolean);
}

export function migrateProject053(
  p: Project,
  opts: { defsFor: (svc: string) => FieldDef[]; isHw: (svc: string) => boolean; at: number },
): Mig053Entry | null {
  if (p.mig053) return null;
  const rows = p.jobRecord || [];
  if (!rows.some((r) => opts.isHw(r.svc))) return null;
  const recBefore = JSON.stringify(p.packages.map((pk) => pk.record || {}));
  const swBefore = JSON.stringify(rows.filter((r) => !opts.isHw(r.svc)));
  const label = (pk: ServicePackage) => {
    const same = p.packages.filter((x) => x.svc === pk.svc);
    return pk.label || (same.length > 1 ? `${serviceItemOf(pk.svc)} ${CIRCLED_NO[same.indexOf(pk)] || '#' + (same.indexOf(pk) + 1)}` : serviceItemOf(pk.svc));
  };
  const e: Mig053Entry = { id: p.id, project: p.name, serial: p.serial, split: [], blank: [], kept: [], orphan: 0, swRows: rows.length, problems: [] };
  const legacy: (JobRow & { at: number; idx: number })[] = [];
  const keptIds: string[] = [];
  const next: JobRow[] = [];
  rows.forEach((r, idx) => {
    if (!opts.isHw(r.svc)) { next.push(r); return; }
    e.swRows--;
    const pkgs = p.packages.filter((x) => x.svc === r.svc);
    if (!pkgs.length) { e.orphan++; next.push(r); return; }
    /* 认出属于哪一份:Detail 前面带着那一份的实例前缀,否则看行上的 pk,再不行就是第一份 */
    let pk: ServicePackage | undefined, rest = String(r.detail || '').trim(), prefixOnly = false;
    for (const x of pkgs) {
      for (const pre of prefixesOf(p, x)) {
        if (rest === pre) { pk = x; prefixOnly = true; break; }
        if (rest.startsWith(pre + ' · ')) { pk = x; rest = rest.slice(pre.length + 3).trim(); break; }
      }
      if (pk) break;
    }
    if (!pk) pk = (r.pk && pkgs.find((x) => x.id === r.pk)) || pkgs[0];
    const itemIsDefault = !String(r.item || '').trim() || sameStr(r.item, serviceItemOf(r.svc));
    const qty = String(r.qty || '').trim(), note = String(r.note || '').trim();
    const drop = (why: 'split' | 'blank', detail = '', value = '') => {
      legacy.push({ ...r, at: opts.at, idx });
      if (why === 'split') e.split.push({ pkg: label(pk!), detail, value }); else e.blank.push(label(pk!));
    };
    /* 2. 只预填了业务名(或实例名)的空行 */
    if (itemIsDefault && !qty && !note && (!rest || prefixOnly)) { drop('blank'); return; }
    /* 1. 049 写的、没人改过的拆分行 */
    if (itemIsDefault && !prefixOnly && rest && (!qty || !note)) {
      const rec = pk.record || {};
      const val = qty || note;
      const fields = opts.defsFor(r.svc);
      const f = fields.find((x) => x.type !== 'formula' && !projSourceOf(x.key)
        && (fieldRowName(x) === rest || (OLD_NAMES[r.svc]?.[x.key] || []).includes(rest)));
      if (f) {
        const raw = rec[f.key];
        if (raw != null && String(raw).trim() && sameStr(fieldRowValue(f, raw), val)) { drop('split', rest, val); return; }
      } else if (!fields.some((x) => x.key === rest) && rec[rest] != null && sameStr(rec[rest], val) && rest !== 'status' && rest !== 'updatedAt') {
        /* 字段定义里已经没有、049 用 key 当字段名转的那一类 */
        drop('split', rest, val); return;
      }
    }
    /* 3. 其余:有人改过 / 新加的 —— 留下,成为那一份的额外项目 */
    if (r.pk !== pk.id) { r.pk = pk.id!; keptIds.push(r.id); }
    e.kept.push({ pkg: label(pk), item: r.item, detail: r.detail, qty: r.qty, note: r.note });
    next.push(r);
  });
  /* 自检:软件行、登记表字段一个都没动 */
  if (JSON.stringify(next.filter((r) => !opts.isHw(r.svc))) !== swBefore) e.problems.push('软件业务的行有变化');
  if (JSON.stringify(p.packages.map((pk) => pk.record || {})) !== recBefore) e.problems.push('登记表字段有变化');
  if (legacy.length + next.length !== rows.length) e.problems.push('行数对不上');
  p.jobRecord = next;
  if (legacy.length) p.jobRecordLegacy053 = [...(p.jobRecordLegacy053 || []), ...legacy];
  p.mig053 = { at: opts.at, removed: legacy.length, kept: keptIds };
  return e;
}

/* ===== 报告(Markdown)===== */
export function report053(list: Mig053Entry[], meta: { title: string; when: string; db?: string; ledLabel?: string }): string {
  const n = (f: (m: Mig053Entry) => number) => list.reduce((a, m) => a + f(m), 0);
  const split = n((m) => m.split.length), blank = n((m) => m.blank.length), kept = n((m) => m.kept.length);
  const bad = list.filter((m) => m.problems.length);
  const code = (m: Mig053Entry) => (m.serial ? String(m.serial).padStart(3, '0') + ' · ' : '');
  const L: string[] = [`# ${meta.title}`, '', `- 时间:${meta.when}`];
  if (meta.db) L.push(`- ${meta.db}`);
  L.push(`- 硬件业务的项目:${list.length} 个`,
    `- **删除** 049 拆出来、没人改过的行 **${split}** 行;只预填了业务名的空行 **${blank}** 行(原样存进 jobRecordLegacy053,回退脚本能放回)`,
    `- **保留** 上线后有人改过 / 新加的硬件行 **${kept}** 行 → 成为那一份服务包的「额外项目」(下面单独列出,请 PD 看一眼)`,
    `- 软件业务的行:一行不动;登记表字段 pk.record:一个不动`,
    `- 自检:${bad.length ? `**${bad.length} 个项目有问题**(见下)` : '全部通过'}`, '');
  if (meta.ledLabel) L.push(`- ${meta.ledLabel}`, '');
  L.push('## 每个项目', '', '| 项目 | 删:拆分行 | 删:空行 | 留:额外项目 |', '|---|---|---|---|');
  [...list].sort((a, b) => (b.split.length + b.blank.length) - (a.split.length + a.blank.length)).forEach((m) => {
    const by = (xs: string[]) => { const c: Record<string, number> = {}; xs.forEach((x) => { c[x] = (c[x] || 0) + 1; }); return Object.entries(c).map(([k, v]) => `${k} ${v}`).join('、'); };
    L.push(`| ${(code(m) + m.project).replace(/\|/g, '/')} | ${m.split.length ? `${m.split.length}(${by(m.split.map((x) => x.pkg))})` : '—'} | ${m.blank.length || '—'} | ${m.kept.length || '—'} |`);
  });
  const withKept = list.filter((m) => m.kept.length);
  if (withKept.length) {
    L.push('', '## 保留下来的硬件行(请 PD 看一眼)', '');
    withKept.forEach((m) => {
      L.push(`### ${code(m)}${m.project}`, '', '| 归到 | Service Item | Detail | Quantity | Special Notes |', '|---|---|---|---|---|');
      const c = (v: string) => (String(v || '').replace(/\n/g, ' ').replace(/\|/g, '/').trim() || '—');
      m.kept.forEach((k) => L.push(`| ${c(k.pkg)} | ${c(k.item)} | ${c(k.detail)} | ${c(k.qty)} | ${c(k.note)} |`));
      L.push('');
    });
  }
  if (bad.length) { L.push('## 自检问题', ''); bad.forEach((m) => L.push(`- ${code(m)}${m.project}:${m.problems.join(';')}`)); L.push(''); }
  return L.join('\n') + '\n';
}
