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

import { compileFormula, evalFormula, findFormulaCycle } from './formula';
import type { ServiceRecord } from './types';
export type { ServiceRecord };

export type RegisterKind = 'install' | 'delivery';
export type FieldType = 'text' | 'date' | 'url' | 'textarea' | 'select' | 'number' | 'formula';

export interface FieldDef {
  key: string;
  zh: string;
  en: string;
  type: FieldType;
  required?: boolean;               // counts toward the "资料不完整" KPI
  options?: [string, string, string][]; // for select: [value, zh, en]
  /* REQ-027 —— 公式字段 */
  formula?: string;                 // 用户填的表达式,引用同卡其它字段的 key
  decimals?: number;                // 结果小数位,默认 2
  group?: string;                   // 分组名;同组字段聚在一起、组内两列排布
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

/* ===== REQ-023: 每个服务类型的字段可以被用户改掉 =====
   上面的 REGISTERS 是出厂默认;用户在「增减字段」里改过之后,改动存进
   record_fields 表,按 svc 覆盖 fields。Job Record 与项目档案登记表读的是
   同一份覆盖表 —— 改一次两边一致,这正是需求要的「同源」。
   字段值仍然挂在各项目的 packages[i].record 上,不动。 */
export type FieldOverrides = Record<string, FieldDef[]>;

/* 取某个登记表的生效字段:有覆盖用覆盖,没有就用出厂默认 */
export function fieldsOf(def: RegisterDef, ov?: FieldOverrides): FieldDef[] {
  const custom = ov && ov[def.svc];
  return custom && custom.length ? custom : def.fields;
}

export const FIELD_TYPES: [FieldType, string, string][] = [
  ['text', '文本', 'Text'],
  ['number', '数字', 'Number'],
  ['date', '日期', 'Date'],
  ['select', '下拉', 'Dropdown'],
  ['url', '链接', 'Link'],
  ['textarea', '多行文本', 'Long text'],
  ['formula', '公式', 'Formula'],
];

/* 校验一份字段定义:key 必须存在且唯一,类型必须合法。服务端落库前跑一遍,
   免得一个手滑的 key 冲突把整张表的数据读花。 */
export function validateFields(raw: unknown): { ok: true; fields: FieldDef[] } | { ok: false; error: string } {
  if (!Array.isArray(raw)) return { ok: false, error: '字段定义必须是数组' };
  if (raw.length > 60) return { ok: false, error: '字段最多 60 个' };
  const types = new Set(FIELD_TYPES.map((x) => x[0]));
  const seen = new Set<string>();
  const out: FieldDef[] = [];
  for (const item of raw) {
    const f = item as Partial<FieldDef>;
    const key = String(f?.key || '').trim();
    if (!key) return { ok: false, error: '字段 key 不能为空' };
    if (!/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(key)) return { ok: false, error: `字段 key「${key}」只能用字母开头的字母/数字/下划线` };
    if (seen.has(key)) return { ok: false, error: `字段 key「${key}」重复` };
    seen.add(key);
    const type = String(f?.type || 'text') as FieldType;
    if (!types.has(type)) return { ok: false, error: `字段「${key}」的类型无效` };
    const zh = String(f?.zh || key).slice(0, 60);
    const def: FieldDef = { key, zh, en: String(f?.en || zh).slice(0, 60), type };
    if (f?.required) def.required = true;
    if (f?.group) def.group = String(f.group).slice(0, 40);
    if (type === 'formula') {
      def.formula = String(f?.formula || '').slice(0, 500);
      const dp = Number(f?.decimals);
      def.decimals = Number.isFinite(dp) && dp >= 0 && dp <= 6 ? Math.floor(dp) : 2;
    }
    if (type === 'select') {
      const opts = Array.isArray(f?.options) ? f!.options! : [];
      def.options = opts.slice(0, 40).map((o) => {
        const a = Array.isArray(o) ? o : [String(o), String(o), String(o)];
        const v = String(a[0] ?? '').slice(0, 60);
        return [v, String(a[1] ?? v).slice(0, 60), String(a[2] ?? a[1] ?? v).slice(0, 60)] as [string, string, string];
      }).filter((o) => o[0]);
      if (!def.options.length) return { ok: false, error: `下拉字段「${zh}」至少要有一个选项` };
    }
    out.push(def);
  }

  /* REQ-027: 公式要等所有字段都收齐了才能校验 —— 它可能引用后面定义的字段。
     两步:先逐条编译(语法 + 引用是否存在),再整体查循环引用。
     循环引用必须在这里拦下:漏掉的话渲染时会无限递归,页面直接卡死。 */
  const allKeys = new Set(out.map((f) => f.key));
  const deps: Record<string, string[]> = {};
  for (const f of out) {
    if (f.type !== 'formula') continue;
    if (!f.formula || !f.formula.trim()) return { ok: false, error: `公式字段「${f.zh}」还没填表达式` };
    const c = compileFormula(f.formula, allKeys);
    if (!c.ok) return { ok: false, error: `公式字段「${f.zh}」:${c.error}` };
    deps[f.key] = c.refs;
  }
  const cycle = findFormulaCycle(deps);
  if (cycle) {
    const label = (k: string) => out.find((f) => f.key === k)?.zh || k;
    return { ok: false, error: `公式循环引用:${cycle.map(label).join(' → ')}` };
  }

  return { ok: true, fields: out };
}

/* REQ-027: 算出一张资料卡上某个公式字段的值。
   派生值,不落库 —— 每次渲染时算,免得存下来之后和源字段对不上。
   算不出来(空值 / 非数字 / 除零 / 坏公式)一律返回 null,显示「—」。 */
export function computeFormula(field: FieldDef, fields: FieldDef[], rec: ServiceRecord | undefined): number | null {
  if (field.type !== 'formula' || !field.formula) return null;
  const values: Record<string, string> = {};
  fields.forEach((f) => { if (f.type !== 'formula') values[f.key] = recordVal(rec, f.key); });
  /* 公式可以引用另一个公式字段 —— 递归解析,深度由 evalFormula 兜底 */
  const resolve = (key: string, depth: number): number | null => {
    const t = fields.find((f) => f.key === key);
    if (!t || t.type !== 'formula' || !t.formula) return null;
    return evalFormula(t.formula, values, resolve, depth);
  };
  return evalFormula(field.formula, values, resolve);
}

/* 公式结果的显示串 */
export function formulaText(field: FieldDef, fields: FieldDef[], rec: ServiceRecord | undefined): string {
  const v = computeFormula(field, fields, rec);
  return v == null ? '—' : v.toFixed(field.decimals ?? 2);
}

/* ---- record helpers ---- */
export const recordVal = (rec: ServiceRecord | undefined, key: string): string =>
  rec && rec[key] != null ? String(rec[key]) : '';

/* a required field is blank → the record is "incomplete" (also true when draft) */
export function isIncomplete(def: RegisterDef, rec: ServiceRecord | undefined, ov?: FieldOverrides): boolean {
  if (!rec) return true;
  if ((rec.status || defaultStatus(def.kind)) === 'draft') return true;
  return fieldsOf(def, ov).some((f) => f.required && !recordVal(rec, f.key).trim());
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
