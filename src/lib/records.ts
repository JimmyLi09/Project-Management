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
import type { Project, ServiceRecord } from './types';
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
  /* REQ-039 —— 关键信息:资料卡与登记表里加粗显示,一眼能找到 */
  highlight?: boolean;
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

/* ===== REQ-039: LED 计算口径(源:《Calculator reference》)=====
   写在这里只是「出厂默认」—— 落到界面上它们是普通的 REQ-027 公式字段,
   PD 在「增减字段」里能改系数、能加自己的算式,不需要动代码。
     SQM     = 长(mm) × 宽(mm) ÷ 1,000,000
     Max KW  = SQM × 450W ÷ 1000
     AVG KW  = Max KW × 0.5      (≈250W/㎡)
     Heat KW = AVG KW × 0.8
   电源线 / 数据线数量参考表里本来就是手填(无公式),保持手填。 */
const G_BASIC = '基本信息 Basics';
const G_DIM = '尺寸与计算 Dimension & Calc';
const G_POWER = '电源与线缆 Power & Cable';
const G_INSTALL = '安装与保修 Install & Warranty';
const G_REMARK = '备注 Remarks';

const opt = (...vals: ([string, string, string] | [string, string])[]): [string, string, string][] =>
  vals.map((v) => [v[0], v[1], (v[2] ?? v[1]) as string]);

const LED_PITCH = opt(...(['P0.9', 'P1.25', 'P1.53', 'P1.86', 'P2', 'P2.5', 'P3', 'P4', 'P5', 'P6', 'P8', 'P10'].map((x) => [x, x] as [string, string])));
const LED_TYPE = opt(['fixed', 'Fixed 固装', 'Fixed'], ['rental', 'Rental 租赁', 'Rental'], ['transparent', 'Transparent 透明屏', 'Transparent'],
  ['floor', 'Floor 地砖屏', 'Floor'], ['curved', 'Curved 弧形屏', 'Curved'], ['outdoor', 'Outdoor 户外屏', 'Outdoor']);
const LED_LOCATION = opt(['indoor', 'Indoor 室内', 'Indoor'], ['outdoor', 'Outdoor 室外', 'Outdoor'], ['lobby', 'Lobby 大堂', 'Lobby'],
  ['gallery', 'Sales Gallery 售楼处', 'Sales Gallery'], ['showroom', 'Showroom 展厅', 'Showroom'], ['meeting', 'Meeting Room 会议室', 'Meeting Room']);
const YES_NO = opt(['yes', '有', 'Yes'], ['no', '无', 'No']);
const YES_NO_CLIENT = opt(['yes', '有', 'Yes'], ['no', '无', 'No'], ['client', '客户提供', 'By client']);

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
      /* REQ-038: 积分按比例分档(1:30–1:50 = 5 分,50 以上 = 3 分)。
         填了这一栏,积分就自动落档,不用 PM 再选。 */
      { key: 'scaleRatio', zh: '比例 1:N', en: 'Scale 1:N', type: 'number' },
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
    /* REQ-039: LED 自带一套「内置计算器」—— 长宽填完,面积 / 功率 / 散热
       自动算出来(口径见 LED_CALC)。它走的就是 REQ-027 的公式字段,
       所以 PD 想换系数、加一条自己的算式,在「增减字段」里改就行,
       不需要动代码;电源线 / 数据线参考表里本来就是手填,保持手填。 */
    svc: 'led', kind: 'install', confirmed: true,
    fields: [
      { key: 'siteAddress', zh: 'Address 地址', en: 'Address', type: 'text', required: true, group: G_BASIC, highlight: true },
      { key: 'mainCon', zh: 'Main Con', en: 'Main Con', type: 'text', group: G_BASIC },
      { key: 'location', zh: 'Location 位置', en: 'Location', type: 'select', group: G_BASIC, options: LED_LOCATION },
      { key: 'ledType', zh: 'Type 类型', en: 'Type', type: 'select', group: G_BASIC, options: LED_TYPE },
      { key: 'resolution', zh: 'Screen Resolution 点间距', en: 'Screen Resolution', type: 'select', group: G_BASIC, options: LED_PITCH, highlight: true },
      { key: 'metalFrame', zh: 'Metal Frame 金属框', en: 'Metal Frame', type: 'select', group: G_BASIC, options: YES_NO_CLIENT },
      { key: 'speaker', zh: 'Speaker 音箱', en: 'Speaker', type: 'select', group: G_BASIC, options: YES_NO },

      { key: 'dimL', zh: 'Length 长 (mm)', en: 'Length (mm)', type: 'number', group: G_DIM, highlight: true },
      { key: 'dimH', zh: 'Width 宽 (mm)', en: 'Width (mm)', type: 'number', group: G_DIM, highlight: true },
      { key: 'sqm', zh: 'SQM 面积 (㎡)', en: 'SQM', type: 'formula', formula: 'dimL * dimH / 1000000', decimals: 3, group: G_DIM, highlight: true },
      { key: 'qtyL', zh: '数量 L', en: 'Qty L', type: 'number', group: G_DIM },
      { key: 'qtyH', zh: '数量 H', en: 'Qty H', type: 'number', group: G_DIM },
      /* 0917 变更单:数量 Total = 数量L × 数量H,不再手填 */
      { key: 'qtyTotal', zh: '数量 Total', en: 'Qty Total', type: 'formula', formula: 'qtyL * qtyH', decimals: 0, group: G_DIM, highlight: true },

      /* 0917 变更单按 Calculator reference 对齐字段名:
         DB Box (KW) 就是原来的 Max KW(SQM × 450 / 1000),散热 = DB × 0.5 × 0.8。
         原先中间那个 AVG KW 去掉 —— 它是派生值,不落库,去掉不丢任何数据,
         而变更单给的字段清单里也没有它。 */
      { key: 'dbBox', zh: 'DB Box (KW)', en: 'DB Box (KW)', type: 'formula', formula: 'sqm * 450 / 1000', decimals: 2, group: G_POWER, highlight: true },
      { key: 'heatKw', zh: 'Heat 散热 (KW)', en: 'Heat (KW)', type: 'formula', formula: 'dbBox * 0.5 * 0.8', decimals: 2, group: G_POWER, highlight: true },
      { key: 'powerCable', zh: '20A 单相电源线 (条)', en: '20A single-phase power cable (No.)', type: 'number', group: G_POWER },
      { key: 'dataCable', zh: 'Cat6 数据线 (条)', en: 'Cat6 data cable (No.)', type: 'number', group: G_POWER },

      { key: 'installation', zh: 'Installation 安装日期', en: 'Installation', type: 'date', group: G_INSTALL, highlight: true },
      { key: 'signedOff', zh: 'Signed Off 签收', en: 'Signed Off', type: 'date', group: G_INSTALL },
      { key: 'warranty', zh: 'Warranty 保修到期', en: 'Warranty', type: 'date', group: G_INSTALL },

      { key: 'remarks', zh: 'Remarks 备注', en: 'Remarks', type: 'textarea', group: G_REMARK },
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
      /* REQ-038: 积分按房数分档(1–2 房 = 2 分、3–4 房 = 3.5 分、4 房以上 = 5 分) */
      { key: 'rooms', zh: '房数 Rooms', en: 'Rooms', type: 'number' },
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

/* ===== 0917 变更单 · REQ-023:出厂没有登记表的业务也能自己加字段 =====
   出厂只给 7 类业务配了登记表,别的业务(网站 / 无人机 / 宣传册…)在 Job Record
   里只有一句「暂无资料登记表」,连一个格子都填不了。PD 在那张卡上点「加字段」
   之后,record_fields 里就有了这个 svc 的列定义,它跟内置的 7 张表走同一条路:
   同一份覆盖表、同一个 setRecord、同一张 record —— 只是出厂默认是空的。
   状态按交付类走(没装机概念的业务多半是交付型),confirmed 置 true,
   因为这几列本来就是 PD 自己定的,没有「待确认」一说。 */
export const baseDefOf = (svc: string): RegisterDef =>
  registerDef(svc) || { svc, kind: 'delivery', confirmed: true, fields: [] };

/* 这个业务现在有没有登记表可看 —— 内置的有,或者 PD 自己加过列 */
export const hasRecordDef = (svc: string, ov?: FieldOverrides): boolean =>
  !!registerDef(svc) || !!(ov && ov[svc] && ov[svc].length);

/* PD 自建的登记表(内置 7 张之外的),按 svc 排一下给跨项目档案页做页签 */
export const customRegisterSvcs = (ov?: FieldOverrides): string[] =>
  Object.keys(ov || {}).filter((svc) => !registerDef(svc) && (ov as FieldOverrides)[svc].length).sort();

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
    if (f?.highlight) def.highlight = true;   // REQ-039: 关键信息加粗
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
export function computeFormula(field: FieldDef, fields: FieldDef[], rec: ServiceRecord | undefined, d?: AvDerived): number | null {
  if (field.type !== 'formula' || !field.formula) return null;
  const values: Record<string, string> = {};
  /* REQ-039:数量 Total = 数量L × 数量H。L 和 H 可能是方案配置带过来的、
     根本不在 record 里 —— 这里也得走同一套兜底,否则 Total 会算成 0。 */
  fields.forEach((f) => { if (f.type !== 'formula') values[f.key] = fieldVal(f, rec, undefined, d); });
  /* 公式可以引用另一个公式字段 —— 递归解析,深度由 evalFormula 兜底 */
  const resolve = (key: string, depth: number): number | null => {
    const t = fields.find((f) => f.key === key);
    if (!t || t.type !== 'formula' || !t.formula) return null;
    return evalFormula(t.formula, values, resolve, depth);
  };
  return evalFormula(field.formula, values, resolve);
}

/* 公式结果的显示串。
   REQ-039: 算不出来时,如果这个 key 上有历史手填值(比如 SQM 以前是文本列、
   有人直接填过数字),回落显示那个旧值,不要让改列类型把老数据「弄丢」。
   源字段一填,算出来的值立刻盖过旧值。 */
export function formulaText(field: FieldDef, fields: FieldDef[], rec: ServiceRecord | undefined, d?: AvDerived): string {
  const v = computeFormula(field, fields, rec, d);
  if (v != null) return v.toFixed(field.decimals ?? 2);
  const legacy = recordVal(rec, field.key).trim();
  return legacy || '—';
}

/* 下拉字段的显示文字:值对得上选项就显示选项名,对不上(改类型前留下的旧值)
   就原样显示 —— 显示不了才是真丢数据。 */
export function optionLabel(f: FieldDef, val: string, lang: 'zh' | 'en'): string {
  const o = (f.options || []).find((x) => x[0] === val);
  return o ? (lang === 'zh' ? o[1] : o[2]) : val;
}

/* ---- record helpers ---- */
export const recordVal = (rec: ServiceRecord | undefined, key: string): string =>
  rec && rec[key] != null ? String(rec[key]) : '';

/* ===== 0922 变更单 · REQ-006 / REQ-032:档案里这几栏与项目同源 =====
   Project detail / Client Contact / Handover Date 以前是登记表自己的一栏,
   跟项目抬头上的同一条信息各存各的 —— 改了项目名,档案里还是旧的。

   这里做的是真·同源,不是「改完再抄一份过去」:这几个 key 的**存储位置就是
   项目本身**。读的时候一律读项目(record 里可能还留着老值,读不到它,也不
   删 —— 删掉就没法回头核对了);写的时候由服务端把它路由到对应的项目字段。
   双向:在档案里就地改,和在项目抬头改是同一件事。

   Model Maker(模型师)和 比例 1:N 不在此列 —— 前者是 scale model 这块业务
   自己的工作人员,不是项目工程师;后者项目上没有对应字段。两者仍是档案字段。 */
export type ProjSource = 'name' | 'clientContact' | 'delivery';

const PROJ_SOURCED: Record<string, ProjSource> = {
  projectDetail: 'name',
  clientContact: 'clientContact',
  handoverDate: 'delivery',
};

export const projSourceOf = (key: string): ProjSource | undefined => PROJ_SOURCED[key];

/* 项目联系人里哪一条是客户。建项目时播的是「客户 Client」,但这一栏 PD 能
   自己改字,所以按关键词认而不是全等。 */
const CLIENT_ROLE = /客户|client/i;
export const clientContactIdx = (p: Project): number =>
  (p.contacts || []).findIndex((c) => CLIENT_ROLE.test(c.role || ''));

export function projFieldVal(src: ProjSource, p: Project): string {
  if (src === 'name') return p.name || '';
  if (src === 'delivery') return p.delivery || '';
  const i = clientContactIdx(p);
  return i >= 0 ? (p.contacts || [])[i].person || '' : '';
}

/* 读一个格子的值。带上项目就走同源那套;不带(比如还没拿到项目的场合)
   退回读 record —— 调用点漏传不会炸,只是读到老值。 */
export const fieldVal = (f: FieldDef, rec: ServiceRecord | undefined, p?: Project, d?: AvDerived): string => {
  const src = p && projSourceOf(f.key);
  if (src) return projFieldVal(src, p);
  const raw = recordVal(rec, f.key);
  /* REQ-039:手填过就以手填为准(覆写),没填过才用方案配置带过来的 */
  if (raw !== '') return raw;
  const dv = derivedVal(f.key, d);
  return dv == null ? '' : String(dv);
};

/* ===== REQ-039 收尾:资料卡上四个数由 LED 方案配置带过来(0929 确认)=====
   数量 L / 数量 H / 电源线 / 数据线。它们是 LED 规则包 F3(箱体排布)与
   F6–F9(回路与线缆)的输出 —— 资料卡上没有箱体库和控制系统这些输入,自己
   算不出来,所以不是公式字段,而是从方案配置带过来的派生值。

   「带过来但允许覆写」:record 里没有值就显示带过来的数;有人填过就以他填的
   为准,并在界面上标出来、把带过来的那个数留在 hover 里。现场和图纸对不上是
   常事,不能不让人改;但改过和没改过必须一眼分得出。 */
export interface AvDerived {
  qtyL: number;
  qtyH: number;
  qtyTotal: number;
  powerCable: number;
  dataCable: number;
  packVersion: string;
  at: number;
}

const DERIVED_KEYS: Record<string, keyof AvDerived> = {
  qtyL: 'qtyL', qtyH: 'qtyH', powerCable: 'powerCable', dataCable: 'dataCable',
};

export const isDerivedKey = (key: string) => key in DERIVED_KEYS;

export function derivedVal(key: string, d?: AvDerived): number | undefined {
  const k = DERIVED_KEYS[key];
  return k && d ? (d[k] as number) : undefined;
}

/* 这一格是不是「人改过、和带过来的不一样」。相等就不算覆写 —— 有人照着
   方案配置抄了一遍进去,没必要标成人工调整。 */
export function isOverridden(key: string, rec: ServiceRecord | undefined, d?: AvDerived): boolean {
  if (!isDerivedKey(key) || !d) return false;
  const raw = recordVal(rec, key).trim();
  if (!raw) return false;
  const dv = derivedVal(key, d);
  return dv != null && Number(raw) !== dv;
}

/* 操作日志 i18n:这里也回 key + 参数,不回渲染好的句子 */
export type ProjFieldLog = { k: string; p?: Record<string, string | number | null | undefined> };
export type ProjFieldResult = { ok: true; log: ProjFieldLog | null } | { ok: false; error: string };

/* 把档案里改的那一格写到项目上。服务端的三条写入路径(setRecord /
   addServicePackage / CSV 导入)都过这里,所以不管从哪个口子进来,落点都一样。
   返回要写进项目日志的那一行 —— 在档案里改项目名,日志里也该看得出来。 */
export function applyProjField(p: Project, src: ProjSource, raw: string): ProjFieldResult {
  const v = String(raw ?? '').trim();
  if (src === 'name') {
    const name = v.slice(0, 120);
    /* 项目名是各处的显示主键,清空等于把项目弄丢 —— 和 REQ-028 一样两层都拦 */
    if (!name) return { ok: false, error: 'Project detail 就是项目名,不能清空' };
    if (name === p.name) return { ok: true, log: null };
    const was = p.name;
    p.name = name;
    return { ok: true, log: { k: 'proj.rename', p: { from: was, to: name } } };
  }
  if (src === 'delivery') {
    const d = v.slice(0, 10);
    if (d === (p.delivery || '')) return { ok: true, log: null };
    const was = p.delivery;
    p.delivery = d;
    return { ok: true, log: { k: 'proj.delivery', p: { from: was, to: d } } };
  }
  const person = v.slice(0, 200);
  const i = clientContactIdx(p);
  if (i < 0) {
    /* 这个项目还没有客户那一条联系人 —— 建一条,别让填进来的名字没地方放 */
    if (!person) return { ok: true, log: null };
    if (!Array.isArray(p.contacts)) p.contacts = [];
    p.contacts.push({ role: '客户 Client', company: p.client || '', person, phone: '', email: '' });
    return { ok: true, log: { k: 'contact.person', p: { from: '', to: person } } };
  }
  const c = (p.contacts || [])[i];
  if (c.person === person) return { ok: true, log: null };
  const was = c.person;
  c.person = person;
  return { ok: true, log: { k: 'contact.person', p: { from: was, to: person } } };
}

/* a required field is blank → the record is "incomplete" (also true when draft) */
export function isIncomplete(def: RegisterDef, rec: ServiceRecord | undefined, ov?: FieldOverrides, p?: Project): boolean {
  if (!rec) return true;
  if ((rec.status || defaultStatus(def.kind)) === 'draft') return true;
  /* 0922 变更单:同源那几栏要读项目 —— 出厂的必填项里没有它们,但 PD 在
     「增减字段」里可以把任何一栏设成必填,那时读错地方就会误报「缺资料」。 */
  return fieldsOf(def, ov).some((f) => f.required && !fieldVal(f, rec, p).trim());
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
