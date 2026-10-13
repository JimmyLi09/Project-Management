/* ===== REQ-054 售前接洽:转为正式项目(新建 / 并入已有)、未成交、重新打开 =====
   权限:Sales / PD / BD(canCreate),路由(app/api/approach)里先校验,这里再校验一次。
   都在一个数据库事务里做,项目用 saveProjectCAS 防并发覆盖;任何一步失败整体回滚。 */

import { canAssign, canCreate, canSeeProject, type Identity } from '@/lib/permissions';
import { isApproach, isOpenApproach } from '@/lib/approach';
import { logZh, type LogParams } from '@/lib/logmsg';
import { projCode } from '@/lib/project';
import type { Project, ProjectContact } from '@/lib/types';
import { LINES } from '@/av/core/lines';
import type { BusinessLine } from '@/av/core/types';
import { applyAction, PermissionError, ValidationError } from './actions';
import { appendAudit, getDb, getEffectiveTemplate, getProject, nextProjectSerial, saveProjectCAS } from './db';
import { getInquiry } from './avdb';

export class StaleError extends Error {}

const entry = (by: string, k: string, p?: LogParams) => ({ at: Date.now(), by, text: logZh(k, p), k, p });
function logTo(p: Project, e: ReturnType<typeof entry>) {
  p.log = [e, ...(p.log || [])];
  if (p.log.length > 200) p.log.length = 200;
}
function saveOrStale(p: Project, expected: number) {
  if (saveProjectCAS(p, expected) === null) throw new StaleError('这条记录刚被别人改过,请刷新后再试');
}
function loadApproach(u: Identity, id: string): Project {
  if (!canCreate(u)) throw new PermissionError('仅 Sales / PD / BD 可以处理售前记录');
  const p = getProject(id);
  if (!p) throw new ValidationError('售前记录不存在');
  if (!canSeeProject(u, p)) throw new PermissionError('非你管理 / 参与的项目');
  if (!isApproach(p)) throw new ValidationError('这不是售前记录(已经是正式项目)');
  return p;
}

/* ① 新建正式项目:这条记录本身变成正式项目,拿下一个编号;AV 数据不用搬(project_id 不变) */
export function convertApproach(u: Identity, id: string, opts: { quotationNo?: string; pm?: string } = {}): Project {
  const d = getDb();
  return d.transaction(() => {
    const p = loadApproach(u, id);
    if (!isOpenApproach(p)) throw new ValidationError('只有还开着的售前记录能转为正式项目');
    const expected = p.version || 0;
    const logBefore = (p.log || []).length;
    p.serial = nextProjectSerial();
    p.approach = { ...p.approach!, status: 'converted', convertedAt: Date.now(), convertedBy: u.name };
    const no = String(p.serial).padStart(3, '0');
    logTo(p, entry(u.name, 'approach.convert', { no }));
    /* 顺便填的报价号、PM:走项目页同一套动作(同样的权限和校验、同样写日志) */
    const qn = String(opts.quotationNo || '').trim();
    if (qn && qn !== (p.quotationNo || '')) applyAction(u, p, { type: 'setQuotationNo', value: qn });
    const pm = String(opts.pm || '').trim();
    if (pm) {
      if (!canAssign(u, p)) throw new PermissionError('仅 PD / BD 可指派 PM(可以先转正式,之后再指派)');
      applyAction(u, p, { type: 'addOwner', name: pm });
    }
    saveOrStale(p, expected);
    appendAudit(p.id, (p.log || []).slice(0, (p.log || []).length - logBefore));
    return p;
  })();
}

/* 未成交:移到「已关闭」,只读;不删任何数据 */
export function markApproachLost(u: Identity, id: string, reason = ''): Project {
  const d = getDb();
  return d.transaction(() => {
    const p = loadApproach(u, id);
    if (!isOpenApproach(p)) throw new ValidationError('只有还开着的售前记录能标为未成交');
    const expected = p.version || 0;
    const why = String(reason || '').trim().slice(0, 300);
    p.approach = { ...p.approach!, status: 'lost', lostAt: Date.now(), lostBy: u.name, ...(why ? { lostReason: why } : {}) };
    if (!why) delete p.approach.lostReason;
    const e = why ? entry(u.name, 'approach.lostWhy', { reason: why }) : entry(u.name, 'approach.lost');
    logTo(p, e);
    saveOrStale(p, expected);
    appendAudit(p.id, [e]);
    return p;
  })();
}

/* 重新打开:未成交的回到「售前接洽」(已并入的不能 —— 它的 AV 数据已经在别的项目上了) */
export function reopenApproach(u: Identity, id: string): Project {
  const d = getDb();
  return d.transaction(() => {
    const p = loadApproach(u, id);
    if (p.approach!.status !== 'lost') throw new ValidationError(p.approach!.status === 'merged' ? '已并入别的项目的售前记录不能重新打开' : '这条售前记录没有关闭');
    const expected = p.version || 0;
    p.approach = { ...p.approach!, status: 'open', reopenedAt: Date.now(), reopenedBy: u.name };
    const e = entry(u.name, 'approach.reopen');
    logTo(p, e);
    saveOrStale(p, expected);
    appendAudit(p.id, [e]);
    return p;
  })();
}


/* ===== ② 并入已有项目 =====
   按业务逐条:目标没有这项业务 → 加一份服务包(和「加业务」一样,清单按 REQ-050 合并);已有 → 并进那一份,不加第二份。
   AV 数据按「项目 + 业务线」存,同一项目同一条线只能有一套方案:售前这条线有 AV 数据、目标这条线也有,就不能并
   (报价没有业务线:两边都有报价也算冲突)。售前这条线什么都没有的,没东西要搬,不算冲突。
   搬:av_drawing / av_config / av_config_draft(_u) / av_cost_sheet 按线改 project_id,av_judge / av_upload / av_quote 全部改;
   av_extraction 挂在图纸上,跟着走;文件按行 id 存,不用动。立项记录 av_inquiry 主键是 project_id —— 合并:
   业务线取并集;搬过去的线用售前那份的规则包(方案是按它算的);地点 / 补充说明 / 几问的答案目标为空才补,
   冲突以目标为准、售前的值写进日志;合并完删掉售前那条,原样存进 approach.inquiryLegacy。
   客户 / 交付日 / 报价号:目标为空才补,冲突以目标为准、写日志。联系人:目标没有的才加(按姓名 + 电话)。
   售前记录本身不删:status = merged、mergedInto = 目标,只读,留在「已关闭」里。 */
const LINE_TABLES = ['av_drawing', 'av_config', 'av_cost_sheet', 'av_config_draft', 'av_config_draft_u'] as const;
const ALL_TABLES = ['av_quote', 'av_judge', 'av_upload'] as const;
const lineOfSvc = (svc: string) => LINES.find((l) => l.svc === svc)?.line as BusinessLine | undefined;

function hasTable(t: string): boolean {
  return !!getDb().prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
}
function countRows(table: string, projectId: string, line?: string): number {
  if (!hasTable(table)) return 0;
  const sql = line ? `SELECT COUNT(*) AS c FROM ${table} WHERE project_id = ? AND line = ?` : `SELECT COUNT(*) AS c FROM ${table} WHERE project_id = ?`;
  return (getDb().prepare(sql).get(...(line ? [projectId, line] : [projectId])) as { c: number }).c;
}
const lineData = (projectId: string, line: string) => LINE_TABLES.reduce((n, t) => n + countRows(t, projectId, line), 0);

export interface MergeSvcPlan { svc: string; line?: string; targetHas: boolean; moves: number; conflict: string }
export interface MergePlan { ok: boolean; svcs: MergeSvcPlan[]; quotes: number; quoteConflict: boolean; reason: string }

/* 并入前先看:每项业务怎么并、搬几行、有没有冲突(弹窗用;真并入时再算一遍) */
export function mergePlan(ap: Project, t: Project): MergePlan {
  const svcs = [...new Set(ap.packages.map((x) => x.svc))];
  const tSvcs = new Set(t.packages.map((x) => x.svc));
  const out: MergeSvcPlan[] = svcs.map((svc) => {
    const line = lineOfSvc(svc);
    const moves = line ? lineData(ap.id, line) : 0;
    const clash = line && moves > 0 && lineData(t.id, line) > 0;
    return { svc, line, targetHas: tSvcs.has(svc), moves, conflict: clash ? '目标项目这条业务线已经有自己的 AV 方案 / 图纸 / 成本' : '' };
  });
  const quotes = countRows('av_quote', ap.id);
  const quoteConflict = quotes > 0 && countRows('av_quote', t.id) > 0;
  const bad = out.filter((x) => x.conflict);
  const reason = bad.length || quoteConflict
    ? `不能并入:${[...bad.map((x) => `${x.svc} —— ${x.conflict}`), ...(quoteConflict ? ['两边都已经有 AV 报价'] : [])].join(';')}。一个项目的一条业务线只能有一套 AV 方案,请改用「新建正式项目」。`
    : '';
  return { ok: !reason, svcs: out, quotes, quoteConflict, reason };
}

function loadTarget(u: Identity, ap: Project, targetId: string): Project {
  const t = getProject(targetId);
  if (!t || t.id === ap.id) throw new ValidationError('要并入的项目不存在');
  if (!canSeeProject(u, t)) throw new PermissionError('非你管理 / 参与的项目');
  if (isApproach(t)) throw new ValidationError('只能并入正式项目');
  if (t.archived) throw new ValidationError('不能并入已归档的项目');
  return t;
}
export function previewMerge(u: Identity, id: string, targetId: string): MergePlan {
  const ap = loadApproach(u, id);
  return mergePlan(ap, loadTarget(u, ap, targetId));
}

/* 同一个联系人:姓名一样(不分大小写)、电话一样(只比数字;带不带 +65 这类区号都算同一个号) */
const samePhone = (a: string, b: string) => {
  const x = String(a || '').replace(/\D/g, ''), y = String(b || '').replace(/\D/g, '');
  return x === y || (x.length >= 7 && y.length >= 7 && (x.endsWith(y) || y.endsWith(x)));
};
const sameContact = (a: ProjectContact, b: ProjectContact) =>
  String(a.person || '').trim().toLowerCase() === String(b.person || '').trim().toLowerCase() && samePhone(a.phone, b.phone);

export function mergeApproach(u: Identity, id: string, targetId: string): { approach: Project; target: Project; plan: MergePlan } {
  const d = getDb();
  return d.transaction(() => {
    const ap = loadApproach(u, id);
    if (!isOpenApproach(ap)) throw new ValidationError('只有还开着的售前记录能并入');
    const t = loadTarget(u, ap, targetId);
    const plan = mergePlan(ap, t);
    if (!plan.ok) throw new ValidationError(plan.reason);
    const expAp = ap.version || 0, expT = t.version || 0;
    const tLog0 = (t.log || []).length, apLog0 = (ap.log || []).length;
    /* 并入是一个整体动作,权限在入口校验过(Sales / PD / BD);里面给目标加服务包走现成的「加业务」,不再按目标项目的编辑权限拦 */
    const sys: Identity = { name: u.name, role: 'director' };
    for (const x of plan.svcs) {
      if (!x.targetHas) applyAction(sys, t, { type: 'addServicePackage', svc: x.svc, patch: {} }, { tplForSvc: getEffectiveTemplate });
    }
    /* AV 数据改挂到目标 */
    const lines = plan.svcs.map((x) => x.line).filter((l): l is BusinessLine => !!l);
    for (const tb of LINE_TABLES) {
      if (!hasTable(tb)) continue;
      for (const l of lines) d.prepare(`UPDATE ${tb} SET project_id = ? WHERE project_id = ? AND line = ?`).run(t.id, ap.id, l);
    }
    for (const tb of ALL_TABLES) if (hasTable(tb)) d.prepare(`UPDATE ${tb} SET project_id = ? WHERE project_id = ?`).run(t.id, ap.id);
    /* 立项记录:合并 */
    const keep = (field: string, value: string) => { if (value) logTo(t, entry(u.name, 'approach.mergeKeep', { apField: field, value: value.slice(0, 200) })); };
    const ai = getInquiry(ap.id), ti = getInquiry(t.id);
    if (ai) {
      ap.approach = { ...ap.approach!, inquiryLegacy: { ...ai } as unknown as Record<string, unknown> };
      if (!ti) {
        d.prepare('UPDATE av_inquiry SET project_id = ? WHERE project_id = ?').run(t.id, ap.id);
      } else {
        const lineSet = [...ti.lines, ...ai.lines.filter((l) => !ti.lines.includes(l))];
        const packs = { ...ti.packs };
        for (const l of ai.lines) {
          const pk = ai.packs[l];
          if (!pk) continue;
          if (ti.packs[l] && ti.packs[l] !== pk) logTo(t, entry(u.name, 'approach.mergePack', { svc: LINES.find((x) => x.line === l)?.svc || l, pack: pk, was: ti.packs[l] }));
          packs[l] = pk;
        }
        const location = ti.location.trim() ? ti.location : ai.location;
        if (ti.location.trim() && ai.location.trim() && ai.location.trim() !== ti.location.trim()) keep('location', ai.location);
        const notes = ti.notes.trim() ? ti.notes : ai.notes;
        if (ti.notes.trim() && ai.notes.trim() && ai.notes.trim() !== ti.notes.trim()) keep('notes', ai.notes);
        const answers: Record<string, unknown> = { ...(ti.answers as Record<string, unknown>) };
        for (const [k, v] of Object.entries(ai.answers as Record<string, unknown>)) {
          if (v == null || v === '') continue;
          if (answers[k] == null || answers[k] === '') answers[k] = v;
          else if (JSON.stringify(answers[k]) !== JSON.stringify(v)) keep(k, String(v));
        }
        d.prepare('UPDATE av_inquiry SET lines = ?, packs = ?, location = ?, notes = ?, answers = ? WHERE project_id = ?')
          .run(JSON.stringify(lineSet), JSON.stringify(packs), location, notes, JSON.stringify(answers), t.id);
        d.prepare('DELETE FROM av_inquiry WHERE project_id = ?').run(ap.id);
      }
    }
    /* 客户 / 交付日 / 报价号:目标为空才补,冲突以目标为准 */
    for (const f of ['client', 'delivery', 'quotationNo'] as const) {
      const av = String(ap[f] || '').trim(), tv = String(t[f] || '').trim();
      if (!av) continue;
      if (!tv) (t as unknown as Record<string, string>)[f] = av;
      else if (av !== tv) keep(f, av);
    }
    /* 联系人:目标没有的才加 */
    const tc = t.contacts || [];
    for (const c of ap.contacts || []) if (c.person.trim() && !tc.some((x) => sameContact(x, c))) tc.push({ ...c });
    t.contacts = tc;
    /* 两边的日志 */
    const tNo = projCode(t);
    logTo(t, entry(u.name, 'approach.mergeIn', { name: ap.name, svcList: plan.svcs.map((x) => x.svc).join(',') }));
    ap.approach = { ...ap.approach!, status: 'merged', mergedInto: t.id, mergedAt: Date.now(), mergedBy: u.name };
    logTo(ap, entry(u.name, 'approach.merged', { target: `${tNo ? tNo + ' · ' : ''}${t.name}` }));
    saveOrStale(t, expT);
    saveOrStale(ap, expAp);
    appendAudit(t.id, (t.log || []).slice(0, (t.log || []).length - tLog0));
    appendAudit(ap.id, (ap.log || []).slice(0, (ap.log || []).length - apLog0));
    return { approach: ap, target: t, plan };
  })();
}
