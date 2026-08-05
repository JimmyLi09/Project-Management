/* ===== Business "资料 record" model (Job Record & Project Registers) =====
   Each service package carries ONE record (the single source of truth). The
   Job Record tab (single project) and the Project Registers (cross-project,
   7 tables) are two views of the same package.record data — edits in either
   go through the same setRecord action + version CAS, so they never diverge.

   This file is the single source of truth for what each register holds:
   its field columns, its status family, and its KPI definitions. Adjust a
   column here and both views update.

   Confirmed columns: Scale Model + Projector (from PD reference sheets).
   The other five (LED / 3D Links / MAXHUB / AV / Others) use the suggested
   columns from the spec — flagged `confirmed: false` — pending PD tweak. */

import type { ServiceRecord } from './types';
export type { ServiceRecord };

export type RegisterKind = 'install' | 'delivery';
export type FieldType = 'text' | 'date' | 'url' | 'textarea' | 'select';

export interface FieldDef {
  key: string;
  zh: string;
  en: string;
  type: FieldType;
  required?: boolean;               // counts toward the "资料不完整" KPI
  options?: [string, string, string][]; // for select: [value, zh, en]
}

export interface RegisterDef {
  svc: string;                      // matches templates.SVC key
  kind: RegisterKind;
  confirmed: boolean;               // false = suggested columns, PD to tweak
  fields: FieldDef[];               // columns beyond the common project columns
  watchDateKey?: string;            // date field that drives "即将到期" (delivery only)
}

/* ---- status families (§3.2) ---- */
export type StatusMeta = [string, string, string, string]; // key, zh, en, cssColor

export const INSTALL_STATUS: StatusMeta[] = [
  ['pending_signoff', '待签收', 'Pending sign-off', 'var(--warning)'],
  ['installing', '安装中', 'Installing', 'var(--info)'],
  ['signed_off', '已签收', 'Signed off', 'var(--success)'],
  ['pending_launch', '待启动', 'Pending launch', 'var(--warning)'],
  ['needs_followup', '需跟进', 'Needs follow-up', 'var(--danger)'],
  ['archived', '已归档', 'Archived', 'var(--text2)'],
];

export const DELIVERY_STATUS: StatusMeta[] = [
  ['draft', '草稿', 'Draft', 'var(--text2)'],
  ['in_progress', '进行中', 'In progress', 'var(--info)'],
  ['delivered', '已交付', 'Delivered', 'var(--success)'],
  ['archived', '已归档', 'Archived', 'var(--text2)'],
];

export const statusFamily = (kind: RegisterKind) => (kind === 'install' ? INSTALL_STATUS : DELIVERY_STATUS);
export const defaultStatus = (kind: RegisterKind) => (kind === 'install' ? 'pending_signoff' : 'draft');
export const statusMeta = (kind: RegisterKind, key: string): StatusMeta =>
  statusFamily(kind).find((s) => s[0] === key) || [key, key, key, 'var(--text2)'];

/* ---- the 7 registers — columns mirror the studio's Google Sheet tabs ----
   Required fields are limited to project info (name is a project-level column,
   so the only required record field is the site address, per PD); 3D Links also
   requires the Link. */
export const REGISTERS: RegisterDef[] = [
  {
    // Scale Model sheet: Project detail · Client Company · Client Contact Person ·
    // PM · Status · Handover Date · Expiration Date · Model Maker
    svc: 'scale', kind: 'delivery', confirmed: true, watchDateKey: 'expirationDate',
    fields: [
      { key: 'projectDetail', zh: 'Project detail 项目详情', en: 'Project detail', type: 'text' },
      { key: 'clientContact', zh: 'Client Contact 客户联系人', en: 'Client Contact Person', type: 'text' },
      { key: 'modelMaker', zh: 'Model Maker 模型师', en: 'Model Maker', type: 'text' },
      { key: 'handoverDate', zh: 'Handover Date 交付日期', en: 'Handover Date', type: 'date' },
      { key: 'expirationDate', zh: 'Expiration Date 有效期', en: 'Expiration Date', type: 'date' },
    ],
  },
  {
    // Projector sheet: Developer · Site Address · Main Con · Installation ·
    // Quantity · Details · Signed Off · Launch · Type
    svc: 'projector', kind: 'install', confirmed: true,
    fields: [
      { key: 'developer', zh: 'Developer', en: 'Developer', type: 'text' },
      { key: 'siteAddress', zh: 'Site Address 地址', en: 'Site Address', type: 'text', required: true },
      { key: 'mainCon', zh: 'Main Con', en: 'Main Con', type: 'text' },
      { key: 'installation', zh: 'Installation 安装日期', en: 'Installation', type: 'date' },
      { key: 'quantity', zh: 'Quantity 数量', en: 'Quantity', type: 'text' },
      { key: 'details', zh: 'Details 详情', en: 'Details', type: 'textarea' },
      { key: 'signedOff', zh: 'Signed Off 签收', en: 'Signed Off', type: 'date' },
      { key: 'launch', zh: 'Launch', en: 'Launch', type: 'date' },
      { key: 'ptype', zh: 'Type 类型', en: 'Type', type: 'text' },
    ],
  },
  {
    // LED sheet: Address · Main Con · Metal Frame · Installation · Signed Off ·
    // Dimension (L/H/SQM) · Quantity (L/H/Total) · Type · DB Box · Power/Data
    // Cable · Speaker · Remarks.  PD edits: drop Launch, add Warranty.
    svc: 'led', kind: 'install', confirmed: true,
    fields: [
      { key: 'siteAddress', zh: 'Address 地址', en: 'Address', type: 'text', required: true },
      { key: 'mainCon', zh: 'Main Con', en: 'Main Con', type: 'text' },
      { key: 'metalFrame', zh: 'Metal Frame 金属框', en: 'Metal Frame', type: 'text' },
      { key: 'installation', zh: 'Installation 安装日期', en: 'Installation', type: 'date' },
      { key: 'signedOff', zh: 'Signed Off 签收', en: 'Signed Off', type: 'date' },
      { key: 'dimL', zh: 'L (mm)', en: 'L (mm)', type: 'text' },
      { key: 'dimH', zh: 'H (mm)', en: 'H (mm)', type: 'text' },
      { key: 'sqm', zh: 'SQM 面积', en: 'SQM', type: 'text' },
      { key: 'qtyL', zh: '数量 L', en: 'Qty L', type: 'text' },
      { key: 'qtyH', zh: '数量 H', en: 'Qty H', type: 'text' },
      { key: 'qtyTotal', zh: '数量 Total', en: 'Qty Total', type: 'text' },
      { key: 'ledType', zh: 'Type 类型', en: 'Type', type: 'text' },
      { key: 'dbBox', zh: 'DB Box (KW)', en: 'DB Box (KW)', type: 'text' },
      { key: 'powerCable', zh: 'Power Cable (No.)', en: 'Power Cable (No.)', type: 'text' },
      { key: 'dataCable', zh: 'Data Cable (No.)', en: 'Data Cable (No.)', type: 'text' },
      { key: 'speaker', zh: 'Speaker 音箱', en: 'Speaker', type: 'text' },
      { key: 'remarks', zh: 'Remarks 备注', en: 'Remarks', type: 'textarea' },
      { key: 'warranty', zh: 'Warranty 保修到期', en: 'Warranty', type: 'date' },
    ],
  },
  {
    // Matterport / 3D Links sheet: Project Record · Project Unit Type ·
    // Client Company · Client Contact · PM · Shooting Date · Handover Date ·
    // Expiration Date · Nature · Link · Source.  PD edits: Type dropdown
    // 360/720/VR/AR, Link required.
    svc: 'vrar', kind: 'delivery', confirmed: true, watchDateKey: 'expirationDate',
    fields: [
      { key: 'projectRecord', zh: 'Project Record 项目编号', en: 'Project Record', type: 'text' },
      { key: 'unitType', zh: 'Unit Type 单元类型', en: 'Project Unit Type', type: 'text' },
      { key: 'clientContact', zh: 'Client Contact 客户联系人', en: 'Client Contact Person', type: 'text' },
      { key: 'shootingDate', zh: 'Shooting Date 拍摄日期', en: 'Shooting Date', type: 'date' },
      { key: 'handoverDate', zh: 'Handover Date 交付日期', en: 'Handover Date', type: 'date' },
      { key: 'expirationDate', zh: 'Expiration 有效期', en: 'Expiration Date', type: 'date' },
      { key: 'nature', zh: 'Nature 性质', en: 'Nature', type: 'select', options: [['matterport', 'Matterport', 'Matterport'], ['3drender', '3D Render', '3D Render'], ['drone', 'Drone 航拍', 'Drone']] },
      { key: 'linkType', zh: 'Type 类型', en: 'Type', type: 'select', options: [['360', '360', '360'], ['720', '720', '720'], ['vr', 'VR', 'VR'], ['ar', 'AR', 'AR']] },
      { key: 'url', zh: 'Link 链接', en: 'Link', type: 'url', required: true },
      { key: 'source', zh: 'Source 来源', en: 'Source', type: 'text' },
    ],
  },
  {
    // MAXHUB sheet: Address · Main Con · End User · Installation · Signed Off ·
    // Quantity · Type/Size · Remarks
    svc: 'maxhub', kind: 'install', confirmed: true,
    fields: [
      { key: 'siteAddress', zh: 'Address 地址', en: 'Address', type: 'text', required: true },
      { key: 'mainCon', zh: 'Main Con', en: 'Main Con', type: 'text' },
      { key: 'endUser', zh: 'End User 终端用户', en: 'End User', type: 'text' },
      { key: 'installation', zh: 'Installation 安装日期', en: 'Installation', type: 'date' },
      { key: 'signedOff', zh: 'Signed Off 签收', en: 'Signed Off', type: 'date' },
      { key: 'quantity', zh: 'Quantity 数量', en: 'Quantity', type: 'text' },
      { key: 'typeSize', zh: 'Type / Size 型号尺寸', en: 'Type / Size', type: 'text' },
      { key: 'remarks', zh: 'Remarks 备注', en: 'Remarks', type: 'textarea' },
    ],
  },
  {
    // AV System — PD: add Project No. (links to project progress) + Remarks.
    svc: 'av', kind: 'install', confirmed: true,
    fields: [
      { key: 'projectRecord', zh: '项目编号', en: 'Project No.', type: 'text' },
      { key: 'developer', zh: 'Developer', en: 'Developer', type: 'text' },
      { key: 'siteAddress', zh: 'Site Address 地址', en: 'Site Address', type: 'text', required: true },
      { key: 'mainCon', zh: 'Main Con', en: 'Main Con', type: 'text' },
      { key: 'installation', zh: 'Installation 安装日期', en: 'Installation', type: 'date' },
      { key: 'systemScope', zh: 'System Scope 设备清单', en: 'System Scope', type: 'textarea' },
      { key: 'quantity', zh: 'Quantity 数量', en: 'Quantity', type: 'text' },
      { key: 'signedOff', zh: 'Signed Off 签收', en: 'Signed Off', type: 'date' },
      { key: 'remarks', zh: 'Remarks 备注', en: 'Remarks', type: 'textarea' },
    ],
  },
  {
    // Others — PD edit: Delivery Date renamed 完成日期.
    svc: 'others', kind: 'delivery', confirmed: true, watchDateKey: 'completedDate',
    fields: [
      { key: 'serviceType', zh: 'Service / 类别', en: 'Service / Category', type: 'text' },
      { key: 'description', zh: 'Detail / 描述', en: 'Detail / Description', type: 'textarea' },
      { key: 'completedDate', zh: '完成日期', en: 'Completed Date', type: 'date' },
    ],
  },
];

export const REGISTER_SVCS = REGISTERS.map((r) => r.svc);
export const registerDef = (svc: string): RegisterDef | undefined => REGISTERS.find((r) => r.svc === svc);

/* ---- record helpers ---- */
export const recordVal = (rec: ServiceRecord | undefined, key: string): string =>
  rec && rec[key] != null ? String(rec[key]) : '';

/* a required field is blank → the record is "incomplete" (also true when draft) */
export function isIncomplete(def: RegisterDef, rec: ServiceRecord | undefined): boolean {
  if (!rec) return true;
  if ((rec.status || defaultStatus(def.kind)) === 'draft') return true;
  return def.fields.some((f) => f.required && !recordVal(rec, f.key).trim());
}

/* delivery records expiring within `days` (default 30) of the watch date, not
   yet delivered/archived → drive the "即将到期" KPI and an amber badge */
export function isExpiring(def: RegisterDef, rec: ServiceRecord | undefined, today: Date, days = 30): boolean {
  if (def.kind !== 'delivery' || !def.watchDateKey || !rec) return false;
  const st = rec.status || defaultStatus(def.kind);
  if (st === 'delivered' || st === 'archived') return false;
  const raw = recordVal(rec, def.watchDateKey);
  if (!raw) return false;
  const d = new Date(raw + 'T00:00:00');
  if (isNaN(d.getTime())) return false;
  const diff = Math.round((d.getTime() - today.getTime()) / 86400000);
  return diff >= 0 && diff <= days;
}
