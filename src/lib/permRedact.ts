/* ===== REQ-051 · 「不可见」的模块,接口也不给数据 =====
   权限表里某个模块对这个角色是「不可见」时,项目接口回给他的那份项目里把这块拿掉 ——
   只在前端藏起来、接口照样回数据,等于没设。

   拿掉的是内容,不是结构:排期行还在(状态、日期、负责人照旧,项目进度、谁在这个项目上
   都还算得出来),只是任务名和备注清空;清单 / 联系人 / Job Record / 开票信息整块清空。
   写操作不会受影响 —— 服务端改的永远是数据库里那份完整的,而且这些模块「不可见」时
   它的写操作本来就被权限表挡住了。 */

import type { Identity } from './permissions';
import { canSeeModule } from './permissions';
import type { Project } from './types';

export function redactProject<T extends Project>(u: Identity, p: T): T {
  const hide = {
    schedule: !canSeeModule(u, 'schedule'),
    checklist: !canSeeModule(u, 'checklist'),
    record: !canSeeModule(u, 'record'),
    contacts: !canSeeModule(u, 'contacts'),
    finance: !canSeeModule(u, 'finance'),
  };
  if (!Object.values(hide).some(Boolean)) return p;
  const q = JSON.parse(JSON.stringify(p)) as T;
  if (hide.schedule) {
    (q.packages || []).forEach((pk) => {
      pk.schedule = (pk.schedule || []).map((r) => ({ ...r, task: '', taskEn: '', note: '', delayNote: '' }));
      if (pk.calendar) pk.calendar = { ...pk.calendar, archives: [] };
    });
  }
  if (hide.checklist) {
    q.checklist = [];
    (q.packages || []).forEach((pk) => { if (pk.checklist) pk.checklist = []; });
    delete q.checklistLegacy;
    delete q.checklistRemoved;
  }
  if (hide.record) {
    (q.packages || []).forEach((pk) => {
      if (pk.record) pk.record = { ...(pk.record.status ? { status: pk.record.status } : {}), ...(pk.record.updatedAt ? { updatedAt: pk.record.updatedAt } : {}) };
      pk.scopeItems = [];
      pk.resourceLinks = '';
    });
  }
  if (hide.contacts) {
    q.contacts = [];
    q.parties = { mainContractor: '', architect: '', landscape: '', interior: '', creative: '' };
  }
  if (hide.finance) {
    delete q.invoiceClose;
    delete q.paymentRisk;
  }
  const hiddenLog = logHiddenFor(u);
  q.log = (q.log || []).filter((e) => !hiddenLog(e.k));
  return q;
}

/* 日志里属于「不可见」模块的条目也拿掉(项目里的 200 条和永久审计记录都用这一条)。
   老日志没有 key,分不出是哪块的,原样留着。 */
export function logHiddenFor(u: Identity): (k?: string) => boolean {
  const h = (m: Parameters<typeof canSeeModule>[1]) => !canSeeModule(u, m);
  const schedule = h('schedule'), checklist = h('checklist'), record = h('record'), contacts = h('contacts'), finance = h('finance');
  return (k?: string) => !!k && (
    (schedule && /^(sched|cal)\./.test(k))
    || (checklist && /^(cl|frag)\./.test(k))
    || (record && /^record\./.test(k))
    || (contacts && /^contact\./.test(k))
    || (finance && (/^fin\./.test(k) || /^proj\.(invoice|uninvoiced)/.test(k))));
}

export const redactProjects = <T extends Project>(u: Identity, ps: T[]): T[] => ps.map((p) => redactProject(u, p));
