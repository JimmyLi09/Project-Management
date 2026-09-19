/* ===== REQ-041 —— 中英词条的单一来源 =====

   界面里的**一次性文案**(按钮、说明、空态)一直走 `t('中文', 'English')`,
   那套不动;这个文件收的是另一类东西:**枚举与固定名词**。它们会在很多
   页面重复出现,以前各处要么直接写中文、要么把两种语言塞进同一个字符串
   (「简单 Easy」「基本信息 Basics」「总监 PD」),结果就是切到 EN 之后
   还剩一半中文 —— Shermin 说的「英文显示不完善」大半是这个。

   规矩:
   · 新增一个**枚举值 / 角色 / 分组名 / 难度档**这类固定名词 → 加到这里,
     两语同增,界面上一律用下面的取词函数拿。
   · 新增一句**页面文案** → 照旧写 `t('中文', 'English')`,不必进这张表。
   · 已经落库的旧数据里那些「中文 English」混排字符串,用 `splitTerm()`
     临时劈开,不改库 —— 库里的历史值不该因为界面改语言而被重写。 */

export type Lang = 'zh' | 'en';
export type Term = [string, string];            // [zh, en]

export const pick = (term: Term | undefined, lang: Lang, fallback = ''): string =>
  term ? (lang === 'zh' ? term[0] : term[1]) : fallback;

/* 旧数据里的「中文 English」/「中文 (English)」混排值,按第一个 ASCII 字母
   切开。切不开就原样返回 —— 宁可显示原值,也不要猜错把内容弄丢。 */
export function splitTerm(raw: string): Term {
  const s = String(raw || '').trim();
  const m = s.match(/^([^\x00-\x7F][^A-Za-z]*?)\s*[（(]?([A-Za-z][A-Za-z0-9 /&'.\-]*)[）)]?$/);
  if (!m) return [s, s];
  const zh = m[1].trim(), en = m[2].trim();
  return zh && en ? [zh, en] : [s, s];
}

/* 混排值按语言取一边;没有中文或没有英文的就整串返回。 */
export const termOf = (raw: string, lang: Lang): string => pick(splitTerm(raw), lang, raw);

/* ---- 角色(permissions.Role)---- */
export const ROLE_TERMS: Record<string, Term> = {
  director: ['PD', 'PD'],   // 中文侧沿用原来的 ROLE_LABEL,别改动 ZH 观感
  bd: ['BD', 'BD'],
  sales: ['销售', 'Sales'],
  pm: ['PM', 'PM'],
  member: ['成员', 'Member'],
  viewer: ['只读', 'Viewer'],
  finance: ['财务', 'Finance'],
};
export const roleTerm = (role: string, lang: Lang): string => pick(ROLE_TERMS[role], lang, role);

/* ---- 项目难度(templates.DIFF 的显示名)---- */
export const DIFF_TERMS: Record<string, Term> = {
  easy: ['简单', 'Easy'],
  medium: ['中等', 'Medium'],
  hard: ['较难', 'Hard'],
  complex: ['复杂', 'Complex'],
};
export const diffTerm = (d: string, lang: Lang): string => pick(DIFF_TERMS[d], lang, d);

/* ---- 联系人角色(ProjectDetail.CONTACT_ROLES 存进库的是中文那一串)----
   存的值不动,只在显示时换一边。手填的角色查不到就原样显示。 */
export const CONTACT_ROLE_TERMS: Record<string, Term> = {
  '客户 Client': ['客户', 'Client'],
  '总包 Main-con': ['总包', 'Main contractor'],
  '建筑师 Architect': ['建筑师', 'Architect'],
  '景观 Landscape': ['景观', 'Landscape'],
  '室内 Interior': ['室内', 'Interior'],
  '创意 Creative': ['创意', 'Creative'],
};
export const contactRoleTerm = (v: string, lang: Lang): string =>
  pick(CONTACT_ROLE_TERMS[v], lang, termOf(v, lang));

/* ---- 资料卡字段分组(records.ts 里那几个 G_* 常量)----
   分组名是 PD 可以自己改的自由文本,所以这里只认出厂的几个;
   自定义的分组照原样显示,不去猜。 */
export const FIELD_GROUP_TERMS: Record<string, Term> = {
  '基本信息 Basics': ['基本信息', 'Basics'],
  '尺寸与计算 Dimension & Calc': ['尺寸与计算', 'Dimension & Calc'],
  '电源与线缆 Power & Cable': ['电源与线缆', 'Power & Cable'],
  '安装与保修 Install & Warranty': ['安装与保修', 'Install & Warranty'],
  '备注 Remarks': ['备注', 'Remarks'],
};
export const fieldGroupTerm = (g: string, lang: Lang): string =>
  pick(FIELD_GROUP_TERMS[g], lang, termOf(g, lang));

/* ---- 排期模板里的「典型工期」与「冻结点提示」----
   这两列出厂只写了中文。模板结构里已经补上 typicalEn / gateEn 两个可选位
   (PD 在模板管理里能自己填),但出厂那 90 来行不值得为此全部改写 ——
   所以出厂值在这里查表,查不到再回落中文。显示时的优先级:
     模板里显式填的 EN  >  这张表  >  中文原值 */

/* 「1 周」「2–3 天」「≈5 天」「≤1 周」这类:换个单位就行,不必逐条列。 */
export function durationTerm(raw: string, lang: Lang): string {
  const s = String(raw || '').trim();
  if (lang === 'zh' || !s || s === '—') return s;
  const m = s.match(/^([≈≤≥~<>]?)\s*(\d+(?:\.\d+)?)(?:\s*[-–~]\s*(\d+(?:\.\d+)?))?\s*(周|天|月)\s*(\+?)$/);
  if (!m) return s;
  const [, pre, a, b, unit, plus] = m;
  const many = !!b || Number(a) > 1;
  const word = unit === '周' ? (many ? 'weeks' : 'week')
    : unit === '天' ? (many ? 'days' : 'day')
    : (many ? 'months' : 'month');
  return `${pre}${a}${b ? '–' + b : ''} ${word}${plus}`;
}

export const GATE_TERMS: Record<string, string> = {
  '★ UI风格确认': '★ UI style signed off',
  '★ 交互定案': '★ Interaction locked',
  '★ 交接签收': '★ Handover signed off',
  '★ 全渲染前确认材质': '★ Materials confirmed before full render',
  '★ 冻结:图纸现场确认': '★ Freeze: drawings confirmed on site',
  '★ 冻结:铁架图客户签字后方可下单': '★ Freeze: order only after the client signs the frame drawing',
  '★ 冻结①:出细节前先锁角度 Lock angles': '★ Freeze 1: lock angles before detailing',
  '★ 冻结②:全渲染前发「公司政策」邮件': '★ Freeze 2: send the company-policy email before full render',
  '★ 后期后不接受大改模型/角度': '★ No major model / angle changes after post-production',
  '★ 客户签收': '★ Client sign-off',
  '★ 对照信息清单 QC': '★ QC against the checklist',
  '★ 对照信息清单逐项 QC': '★ QC item by item against the checklist',
  '★ 情绪确认': '★ Mood confirmed',
  '★ 排期从Briefing确认起算': '★ Schedule starts from the confirmed briefing',
  '★ 排期从此起算 Schedule starts here': '★ Schedule starts here',
  '★ 排期从确认信息起算': '★ Schedule starts from the confirmed information',
  '★ 排期从需求确认起算': '★ Schedule starts from the confirmed requirements',
  '★ 材料/处理/灯光在此定案': '★ Material / finish / lighting locked here',
  '★ 材料/色调在此定案': '★ Material / colour tone locked here',
  '★ 测试须现场通电': '★ Testing needs live power on site',
  '★ 海外:装箱前客户签收+备足余料': '★ Overseas: client sign-off before crating + spare stock',
  '★ 海外:装箱前签收': '★ Overseas: sign-off before crating',
  '★ 立面色号最终确认才进立面': '★ Façade colours finalised before façade work starts',
  '★ 视角数=工作量;排期从此起算': '★ View count drives the workload; schedule starts here',
  '★ 路径改动影响全部下游,确认后冻结': '★ Path changes hit everything downstream — frozen once confirmed',
  '备注:不建议加人物': 'Note: adding figures is not recommended',
  '提前下单以免误期': 'Order early so the date holds',
  '此后不接受重建模/大改': 'No re-modelling or major changes after this point',
  '注意各国插座': 'Mind the local plug standards',
};
export const gateTerm = (raw: string, lang: Lang): string =>
  lang === 'zh' ? raw : (GATE_TERMS[String(raw || '').trim()] || raw);
