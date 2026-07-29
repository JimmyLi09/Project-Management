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

/* common install columns shared by LED / Projector / MAXHUB / AV */
const INSTALL_COMMON: FieldDef[] = [
  { key: 'developer', zh: 'Developer', en: 'Developer', type: 'text' },
  { key: 'siteAddress', zh: 'Site Address', en: 'Site Address', type: 'text' },
  { key: 'mainCon', zh: 'Main Con', en: 'Main Con', type: 'text' },
  { key: 'installDate', zh: '安装日期', en: 'Install Date', type: 'date', required: true },
];
const INSTALL_TAIL: FieldDef[] = [
  { key: 'quantity', zh: '数量 Qty', en: 'Quantity', type: 'text' },
  { key: 'signedOff', zh: 'Signed Off', en: 'Signed Off', type: 'date' },
  { key: 'launch', zh: 'Launch', en: 'Launch', type: 'date' },
];

/* ---- the 7 registers ---- */
export const REGISTERS: RegisterDef[] = [
  {
    svc: 'scale', kind: 'delivery', confirmed: true, watchDateKey: 'expirationDate',
    fields: [
      { key: 'modelType', zh: 'Model Type / 比例', en: 'Model Type / Scale', type: 'text' },
      { key: 'description', zh: 'Detail / 描述', en: 'Detail / Description', type: 'textarea' },
      { key: 'clientContact', zh: 'Client Contact', en: 'Client Contact', type: 'text' },
      { key: 'modelMaker', zh: 'Model Maker', en: 'Model Maker', type: 'text' },
      { key: 'handoverDate', zh: 'Handover Date', en: 'Handover Date', type: 'date', required: true },
      { key: 'expirationDate', zh: 'Expiration Date', en: 'Expiration Date', type: 'date' },
    ],
  },
  {
    svc: 'projector', kind: 'install', confirmed: true,
    fields: [
      ...INSTALL_COMMON,
      { key: 'quantity', zh: '数量 Qty', en: 'Quantity', type: 'text' },
      { key: 'details', zh: 'Details', en: 'Details', type: 'textarea' },
      { key: 'signedOff', zh: 'Signed Off', en: 'Signed Off', type: 'date' },
      { key: 'launch', zh: 'Launch', en: 'Launch', type: 'date' },
      { key: 'ptype', zh: 'Type', en: 'Type', type: 'text' },
    ],
  },
  {
    svc: 'led', kind: 'install', confirmed: false,
    fields: [
      ...INSTALL_COMMON,
      { key: 'screenSpec', zh: '屏幕规格 (P3/P2.5)', en: 'Screen Spec (P3/P2.5)', type: 'text' },
      ...INSTALL_TAIL,
    ],
  },
  {
    svc: 'vrar', kind: 'delivery', confirmed: false, watchDateKey: 'expirationDate',
    fields: [
      { key: 'linkType', zh: '类型', en: 'Type', type: 'select', options: [['360', '360', '360'], ['720', '720', '720'], ['vr', 'VR', 'VR']] },
      { key: 'url', zh: 'Link / URL', en: 'Link / URL', type: 'url', required: true },
      { key: 'deliveryDate', zh: '交付日期', en: 'Delivery Date', type: 'date' },
      { key: 'expirationDate', zh: '有效期 Expiration', en: 'Expiration', type: 'date' },
    ],
  },
  {
    svc: 'maxhub', kind: 'install', confirmed: false,
    fields: [
      ...INSTALL_COMMON,
      { key: 'modelSpec', zh: 'Model / Spec', en: 'Model / Spec', type: 'text' },
      ...INSTALL_TAIL,
    ],
  },
  {
    svc: 'av', kind: 'install', confirmed: false,
    fields: [
      ...INSTALL_COMMON,
      { key: 'systemScope', zh: 'System Scope (设备清单)', en: 'System Scope (equipment)', type: 'textarea' },
      ...INSTALL_TAIL,
    ],
  },
  {
    svc: 'others', kind: 'delivery', confirmed: false, watchDateKey: 'deliveryDate',
    fields: [
      { key: 'serviceType', zh: 'Service / 类别', en: 'Service / Category', type: 'text' },
      { key: 'description', zh: 'Detail / 描述', en: 'Detail / Description', type: 'textarea' },
      { key: 'deliveryDate', zh: '交付日期', en: 'Delivery Date', type: 'date', required: true },
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
