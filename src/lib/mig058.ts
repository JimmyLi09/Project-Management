/* ===== REQ-058 §2.5 · 模板覆盖的处理(只影响新项目,已有项目一个字都不改) =====
   PD / BD 在模板管理里存过的模板(templates 表,整份 Template JSON)优先于代码里的内置模板 ——
   只改内置模板,覆盖过的业务新建项目时还是旧清单。所以上线时:
     - 没覆盖过的业务:直接用新的内置模板,什么都不用做;
     - 覆盖过、清单受这次改动影响的业务:**只把清单部分换成新的**,排期部分保留覆盖值;
     - PD 存过同义项(meta cl.synonyms)的:把 REQ-058 新加的同义项并进去(原来的一条不删)。
   先预演(scripts\req058-dryrun.bat)出报告,JM 确认后 --approve,重启才真改;
   原覆盖值备份到 meta 的 templatesLegacy058,scripts\req058-rollback.bat 可以还原。
   这里只放纯函数(预演脚本和上线迁移共用同一份规则)。 */
import { TPL, getBuiltinTemplate, type Template, type TplChecklistGroup } from './templates';
import { addSynonyms, cleanSynonyms, SYNONYMS_058 } from './checklistMerge';

export const MIG_058 = 'mig.req058.templates';
export const APPROVE_058 = 'mig.req058.approved';
export const LEGACY_058 = 'templatesLegacy058';
export const SYN_KEY = 'cl.synonyms';

/* 清单这次改了的业务:效果图、动画、沙盘、3D VR/720、单元模型,加上所有用通用模板(GENERIC)的业务 */
const CHANGED = ['cgi', 'ani', 'scale', 'vrar', 'unitmodel'];
export const changed058 = (svc: string) => CHANGED.includes(svc) || !TPL[svc];

export interface Tpl058Entry { svc: string; before: TplChecklistGroup[]; after: TplChecklistGroup[]; schedule: number }
export interface Plan058 { templates: Tpl058Entry[]; synonyms: { before: string[][]; after: string[][]; added: string[] } | null }

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/* overrides:templates 表里的每一行(已经 JSON.parse);savedSynonyms:meta cl.synonyms(没存过是 null) */
export function plan058(overrides: { svc: string; data: Template }[], savedSynonyms: string[][] | null): Plan058 {
  const templates: Tpl058Entry[] = [];
  for (const o of overrides) {
    if (!changed058(o.svc) || !o.data || !Array.isArray(o.data.checklist)) continue;
    const after = structuredClone(getBuiltinTemplate(o.svc).checklist);
    if (same(o.data.checklist, after)) continue;   // 已经是新的(再跑一次不重复改)
    templates.push({ svc: o.svc, before: o.data.checklist, after, schedule: (o.data.schedule || []).length });
  }
  let synonyms: Plan058['synonyms'] = null;
  if (savedSynonyms) {
    const before = cleanSynonyms(savedSynonyms);
    const after = addSynonyms(before, SYNONYMS_058);
    if (!same(before, after)) {
      const had = new Set(before.flat());
      synonyms = { before, after, added: [...new Set(after.flat().filter((n) => !had.has(n)))] };
    }
  }
  return { templates, synonyms };
}

/* 换了清单之后的那份模板:排期照旧(覆盖值),清单换成新的内置清单 */
export const apply058 = (data: Template, e: Tpl058Entry): Template => ({ ...data, checklist: e.after });

const groupLine = (g: TplChecklistGroup) => {
  const items = g[3].map((it) => it[0]).join(' / ');
  return `- **${g[0]}** ${g[1]}${g[4] ? ` \`${g[4]}\`` : ''}(${g[3].length} 项):${items}`;
};

export function report058(plan: Plan058, opts: { title: string; when: string; db?: string; names?: (svc: string) => string }): string {
  const name = opts.names || ((s: string) => s);
  const L: string[] = [`# ${opts.title}`, '', `- 时间:${opts.when}`];
  if (opts.db) L.push(`- ${opts.db}`);
  L.push('');
  if (!plan.templates.length && !plan.synonyms) {
    L.push('**无覆盖,直接生效**:模板管理里没有存过受这次改动影响的业务模板,同义项也没有单独存过 —— 新建项目直接用新的内置模板,什么都不用改。', '');
    return L.join('\n');
  }
  L.push(`## 模板覆盖:${plan.templates.length} 个业务要换清单(排期保留覆盖值)`, '');
  if (!plan.templates.length) L.push('(没有)', '');
  for (const e of plan.templates) {
    L.push(`### ${name(e.svc)}(\`${e.svc}\`)`, '', `排期:${e.schedule} 行,保留不动。`, '', `**换之前**(${e.before.length} 组 · ${e.before.reduce((n, g) => n + g[3].length, 0)} 项):`, '');
    e.before.forEach((g) => L.push(groupLine(g)));
    L.push('', `**换之后**(${e.after.length} 组 · ${e.after.reduce((n, g) => n + g[3].length, 0)} 项):`, '');
    e.after.forEach((g) => L.push(groupLine(g)));
    L.push('');
  }
  L.push('## 同义项', '');
  if (!plan.synonyms) L.push('没有单独存过(用的是代码里的默认那份,新同义项已经包含在内),不用改。', '');
  else {
    L.push(`PD / BD 存过同义项(${plan.synonyms.before.length} 组)。把 REQ-058 新加的并进去,原来的一条不删,改完 ${plan.synonyms.after.length} 组。新加的名字:`, '');
    plan.synonyms.added.forEach((n) => L.push(`- ${n}`));
    L.push('');
  }
  L.push('已有项目的清单一个字都不改。原覆盖值(和原来的同义项)备份在 meta 的 `templatesLegacy058`,`scripts\\req058-rollback.bat` 可以还原。', '');
  return L.join('\n');
}
