/* ===== REQ-051 §2.1 · 按角色的权限表 =====
   行是功能模块,列是角色,每格「不可见 / 只读 / 可编辑」。

   权限表是**上限**:模块级先看表,再叠加原有的业务规则(PM 只能改自己负责的项目、
   只有 Finance 能改开票信息、Sales 要在项目里有「编辑授权」才改得了制作内容……这些
   细则照旧在 permissions.ts 里)。所以:
   · 默认值 = 每个角色在现在的代码里**最多**能做到的程度 —— 上线后行为一点不变;
   · PD / BD 可以把某个角色的某个模块收到「只读」或「不可见」;
   · 不能把一格放得比原有规则还宽(那一格的选项到上限为止)—— 想让某个人改某个项目,
     照旧在项目里给他「编辑授权」。
   PD / BD 两列锁定为全部可编辑,免得把自己锁在外面。
   REQ-043(PM / Engineer 只看自己的项目)照旧叠加:权限表管「能不能做」,REQ-043 管「对哪些项目」。

   浏览器和服务端用同一份规则:服务端从数据库读(meta 表 perm.table),浏览器从 /api/permissions 拿。 */

import type { Role } from './types';

export type PermLevel = 'none' | 'read' | 'edit';
export type PermModule =
  | 'projects' | 'record' | 'checklist' | 'schedule'
  | 'finance' | 'avcost' | 'contacts' | 'stats' | 'users';
/* 表里可以调的角色(viewer「只读」不进表,照旧只读;member 在界面上叫 Engineer) */
export type PermRole = 'sales' | 'pm' | 'member' | 'finance';
export const PERM_ROLES: Role[] = ['director', 'bd', 'sales', 'pm', 'member', 'finance'];
export const EDITABLE_ROLES: PermRole[] = ['sales', 'pm', 'member', 'finance'];

export const PERM_MODULES: { key: PermModule; zh: string; en: string; noteZh: string; noteEn: string }[] = [
  { key: 'projects', zh: '项目列表', en: 'Projects', noteZh: '新建 / 删除 / 复制项目、改项目名和客户、风险与汇报。至少只读，否则别的页面都打不开', noteEn: 'Create / delete / copy projects, rename, client, risks and updates. At least read — every other page needs it' },
  { key: 'record', zh: '项目档案 / Job Record', en: 'Project record / Job Record', noteZh: '项目详情的 Job Record、「项目档案」页、加 / 删业务', noteEn: 'Job Record tab, the Project record page, add / remove a service' },
  { key: 'checklist', zh: '信息清单', en: 'Checklist', noteZh: '信息清单与收料记录', noteEn: 'Information checklist and receipts' },
  { key: 'schedule', zh: '排期', en: 'Schedule', noteZh: '排期、日历、提交完工；不可见时「我的待办」也没有他的排期任务', noteEn: 'Schedule, calendar, completion; when hidden, My Tasks has no schedule items either' },
  { key: 'finance', zh: '财务 / 开票', en: 'Finance / invoicing', noteZh: '收款看板、开票 / 收款状态（只有 Finance 能改开票信息，这条细则不变）', noteEn: 'Collections, invoice / payment status (only Finance edits invoice details — unchanged)' },
  { key: 'avcost', zh: 'AV 方案成本', en: 'AV design & cost', noteZh: '01–07：图纸、方案、成本、报价、价格库', noteEn: '01–07: drawings, design, cost, quote, price library' },
  { key: 'contacts', zh: '通讯录', en: 'Contacts', noteZh: '通讯录与项目联系人', noteEn: 'Directory and project contacts' },
  { key: 'stats', zh: '统计报表', en: 'Reports', noteZh: '统计报表、团队负载、KPI（KPI 规则只有 PD / BD 能改）', noteEn: 'Reports, team load, KPI (KPI rules: PD / BD only)' },
  { key: 'users', zh: '用户与权限', en: 'Users & permissions', noteZh: '只有 PD / BD', noteEn: 'PD / BD only' },
];

const RANK: Record<PermLevel, number> = { none: 0, read: 1, edit: 2 };
export const atLeast = (have: PermLevel, need: PermLevel) => RANK[have] >= RANK[need];
const minOf = (a: PermLevel, b: PermLevel): PermLevel => (RANK[a] <= RANK[b] ? a : b);
const maxOf = (a: PermLevel, b: PermLevel): PermLevel => (RANK[a] >= RANK[b] ? a : b);

/* 上限 = 现在代码里这个角色最多能做到的(也是默认值)。
   · 「可编辑」的意思是「按原有规则可以改」—— 比如 Sales / Finance 改制作内容要有项目「编辑授权」;
   · PM / Engineer 在财务上本来就只看得到开票状态,不能改;
   · Engineer、Finance 在 AV 里本来就不能存方案 / 报价;
   · 统计报表大家都只能看;用户与权限只有 PD / BD。 */
export const CEILING: Record<PermRole, Record<PermModule, PermLevel>> = {
  sales:   { projects: 'edit', record: 'edit', checklist: 'edit', schedule: 'edit', finance: 'edit', avcost: 'edit', contacts: 'edit', stats: 'read', users: 'none' },
  pm:      { projects: 'edit', record: 'edit', checklist: 'edit', schedule: 'edit', finance: 'read', avcost: 'edit', contacts: 'edit', stats: 'read', users: 'none' },
  member:  { projects: 'edit', record: 'edit', checklist: 'edit', schedule: 'edit', finance: 'read', avcost: 'read', contacts: 'edit', stats: 'read', users: 'none' },
  finance: { projects: 'edit', record: 'edit', checklist: 'edit', schedule: 'edit', finance: 'edit', avcost: 'read', contacts: 'edit', stats: 'read', users: 'none' },
};
/* 下限:这两个模块收到「不可见」就什么都打不开了 */
export const FLOOR: Partial<Record<PermModule, PermLevel>> = { projects: 'read' };

export type PermTable = Record<PermRole, Record<PermModule, PermLevel>>;
export const defaultPermTable = (): PermTable =>
  JSON.parse(JSON.stringify(CEILING)) as PermTable;

/* 存进来的表不可信(旧版本、手改、缺格):每格夹在 [下限, 上限] 之间,缺的取默认 */
export function sanitizePermTable(raw: unknown): PermTable {
  const out = defaultPermTable();
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, Record<string, unknown>>;
  for (const r of EDITABLE_ROLES) {
    for (const m of PERM_MODULES) {
      const v = src[r]?.[m.key];
      if (v !== 'none' && v !== 'read' && v !== 'edit') continue;
      out[r][m.key] = maxOf(minOf(v, CEILING[r][m.key]), FLOOR[m.key] ?? 'none');
    }
  }
  return out;
}

/* 这一格能选哪些(到上限为止,不低于下限) */
export const allowedLevels = (r: PermRole, m: PermModule): PermLevel[] =>
  (['none', 'read', 'edit'] as PermLevel[]).filter((l) => RANK[l] <= RANK[CEILING[r][m]] && RANK[l] >= RANK[FLOOR[m] ?? 'none'])
;

/* 两张表的差别(写日志用) */
export function permDiff(a: PermTable, b: PermTable): { role: PermRole; module: PermModule; from: PermLevel; to: PermLevel }[] {
  const out: { role: PermRole; module: PermModule; from: PermLevel; to: PermLevel }[] = [];
  for (const r of EDITABLE_ROLES) for (const m of PERM_MODULES) if (a[r][m.key] !== b[r][m.key]) out.push({ role: r, module: m.key, from: a[r][m.key], to: b[r][m.key] });
  return out;
}

/* ---- 当前生效的表从哪儿来:服务端 = 数据库,浏览器 = /api/permissions ---- */
/* 挂在 globalThis 上:Next 的不同路由各自打包,模块级变量可能有好几份,这样只有一份 */
const G = globalThis as { __audaxPermSource?: () => PermTable; __audaxPermServer?: () => PermTable };
/* 服务端只认数据库那一份(setServerPermSource)。浏览器组件在服务端渲染时也会跑到 setPermSource,
   那是页面渲染那一刻的快照 —— 要是拿它把关,PD / BD 之后改的表在服务端就一直不生效(直到重启) */
const source = (): PermTable =>
  ((typeof window === 'undefined' ? G.__audaxPermServer : undefined) || G.__audaxPermSource || defaultPermTable)();
export function setPermSource(fn: () => PermTable) { G.__audaxPermSource = fn; }
export function setServerPermSource(fn: () => PermTable) { G.__audaxPermServer = fn; }
/* 一次请求里会问很多遍:服务端的 source 自己带缓存,浏览器的就是内存里那一份 */
export const currentPermTable = (): PermTable => source();

/* 某个角色在某个模块上的级别 */
export function permLevel(role: Role, m: PermModule): PermLevel {
  if (role === 'director' || role === 'bd') return 'edit';
  /* 「只读」角色不进表:表对它不收紧(返回可编辑),原有业务规则本来就让它什么都改不了 —— 行为不变 */
  if (role === 'viewer') return m === 'users' ? 'none' : 'edit';
  const t = source();
  return t[role as PermRole]?.[m] ?? CEILING[role as PermRole]?.[m] ?? 'none';
}
export const permAllows = (u: { role: Role }, m: PermModule, need: PermLevel) => atLeast(permLevel(u.role, m), need);

/* 项目 PATCH 的每种 action 属于哪个模块(服务端在业务规则之前先过这一道) */
export const ACTION_MODULE: Record<string, PermModule> = {
  // 排期
  toggleDone: 'schedule', cycleStatus: 'schedule', setRowStatus: 'schedule', editSched: 'schedule', editSchedNum: 'schedule',
  addRow: 'schedule', removeRow: 'schedule', moveRow: 'schedule', reorderRow: 'schedule', setPkgField: 'schedule',
  setPkgBuffer: 'schedule', reversePkg: 'schedule', reverseSchedule: 'schedule', setDelivery: 'schedule', setBuffer: 'schedule',
  saveCalendar: 'schedule', calendarFlow: 'schedule', saveCalendarArchives: 'schedule', addCustomNode: 'schedule',
  setSchedStyle: 'schedule', addSpecialRow: 'schedule', submitCompletion: 'schedule',
  // 信息清单
  setClStatus: 'checklist', addReceipt: 'checklist', editReceipt: 'checklist', removeReceipt: 'checklist', editCl: 'checklist', setClMode: 'checklist',
  renameGroup: 'checklist', removeGroup: 'checklist', setNoCategories: 'checklist', toggleHighlight: 'checklist', addItem: 'checklist',
  removeItem: 'checklist', moveItem: 'checklist', reorderItem: 'checklist', addGroup: 'checklist', resetChecklist: 'checklist',
  setItemSvcs: 'checklist', restoreClItem: 'checklist', attachShot: 'checklist', removeShot: 'checklist',
  // 项目列表(项目本身)
  renameProject: 'projects', setQuotationNo: 'projects', setClient: 'projects',
  // 项目档案 / Job Record
  setPkgTier: 'record', addScopeItem: 'record', editScopeItem: 'record', removeScopeItem: 'record', setRecord: 'record',
  addServicePackage: 'record', removeServicePackage: 'record',
  addJobRow: 'record', editJobRow: 'record', removeJobRow: 'record', pasteJobRows: 'record',
  // 财务 / 开票
  toggleInvoiced: 'finance', markInvoiced: 'finance', undoInvoice: 'finance', editFinance: 'finance', setInvoiceStatus: 'finance',
  setPaymentStatus: 'finance', setPaymentRisk: 'finance',
  // 通讯录
  addContact: 'contacts', editContact: 'contacts', removeContact: 'contacts',
  // 项目本身的风险 / 向上汇报;交接、核对、Variation(Sales / PM 的项目流程)
  editUpdate: 'projects', dismissRisk: 'projects', restoreRisk: 'projects',
  submitHandover: 'projects', editHandover: 'projects', acceptHandover: 'projects', salesVerify: 'projects', raiseVariation: 'projects',
  /* 没列的(指派 PM / 工程师、转交、归档、难度积分、决策、审批完成包)本来就只有 PD / BD 能做,
     PD / BD 两列锁定可编辑,不用过表 */
};
