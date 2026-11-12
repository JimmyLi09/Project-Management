/* ===== REQ-061 · 业务 × 板块(和「Audax 业务流程地图」一致) =====
   业务 9 个:地图上的 8 个标签(总览 + 7 个业务)再加「其他业务」;板块 A – I 是地图的章节。
   知识库按它归类,REQ-062 的能力矩阵和派项目限制也用这张表(bizOfSvc)。
   key 和地图里的标签 id(#persp、#anim …)一样,首页切换地图就靠它。 */

export type KbBiz = 'overview' | 'persp' | 'anim' | 'model' | 'digital' | 'saleskit' | 'led' | 'control' | 'other';
export type KbSec = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I';

export interface BizDef {
  key: KbBiz;
  zh: string;
  en: string;
  color: string;
  svcs: string[];         // 平台里的业务(SVC 的 key)
  onMap: boolean;         // 地图上有没有这个标签(「其他业务」没有)
}

export const KB_BIZ: BizDef[] = [
  { key: 'overview', zh: '总览 / 通用', en: 'Overview', color: '#15202B', svcs: [], onMap: true },
  { key: 'persp', zh: '效果图', en: 'Perspectives', color: '#2F6FB0', svcs: ['cgi'], onMap: true },
  { key: 'anim', zh: '动画', en: 'Animation', color: '#C27A12', svcs: ['ani'], onMap: true },
  { key: 'model', zh: '实体模型', en: 'Scale & Unit Model', color: '#2E8B57', svcs: ['scale', 'unitmodel'], onMap: true },
  { key: 'digital', zh: 'VR · 720 · 360 · AR', en: 'Digital Tours', color: '#7A4FB5', svcs: ['vrar', 'matterport'], onMap: true },
  { key: 'saleskit', zh: 'Sales Kit APP', en: 'Sales Kit App', color: '#0E8C8C', svcs: ['saleskit'], onMap: true },
  { key: 'led', zh: 'LED · 投影 · MAXHUB', en: 'LED · Projection', color: '#B83B5E', svcs: ['led', 'projector', 'maxhub', 'tv'], onMap: true },
  { key: 'control', zh: '中控', en: 'Show Control', color: '#4E6A85', svcs: ['av', 'elv'], onMap: true },
  { key: 'other', zh: '其他业务', en: 'Other services', color: '#7F8C8D',
    svcs: ['website', 'drone', 'brochure', 'video', 'interior', 'renovation', 'lightbox', 'pv', 'others'], onMap: false },
];

export interface SecDef { key: KbSec; zh: string; en: string; overviewOnly: boolean; what: string; whatEn: string }

export const KB_SECS: SecDef[] = [
  { key: 'A', zh: '成员架构', en: 'Team structure', overviewOnly: true, what: '公司架构、深圳制作团队名单、团队 × 业务对照', whatEn: 'Company structure, Shenzhen production team, team × service map' },
  { key: 'B', zh: '交接 + 制作流程', en: 'Handover + production flow', overviewOnly: false, what: '业务 → PM → 制作的交接;各业务的制作阶段和确认闸门', whatEn: 'Sales → PM → production handover; production stages and sign-off gates per service' },
  { key: 'C', zh: '清单 · 排期 · 阶段准备', en: 'Checklist · schedule · stage prep', overviewOnly: false, what: '资料清单、标准排期、每阶段客户 / PM 要准备什么', whatEn: 'Info checklists, standard schedules, what client / PM prepare per stage' },
  { key: 'D', zh: '关键节点 + 总结邮件', en: 'Milestones + summary emails', overviewOnly: false, what: '每个业务的确认节点、必须写总结的时候、注意事项', whatEn: 'Sign-off points per service, when a summary email is required, watch-outs' },
  { key: 'E', zh: '会议 + 项目复盘', en: 'Meetings + reviews', overviewOnly: true, what: '每周会议表、复盘节奏、复盘模板', whatEn: 'Weekly meeting table, review rhythm, review template' },
  { key: 'F', zh: '邮件模板 + 项目规范', en: 'Email templates + standards', overviewOnly: true, what: 'E1 – E8 / U / W / D / S 邮件模板、修改轮数、像素与打印尺寸、12 条项目规范', whatEn: 'E1 – E8 / U / W / D / S email templates, revision rounds, pixel & print sizes, 12 project standards' },
  { key: 'G', zh: '员工培训', en: 'Staff training', overviewOnly: true, what: 'PM 分级、6 个月课程、新人第一个月', whatEn: 'PM levels, 6-month curriculum, a new joiner\'s first month' },
  { key: 'H', zh: '新技术 / 信息收集', en: 'New tech + info scouting', overviewOnly: true, what: '技术雷达、素材库收集', whatEn: 'Tech radar, asset library scouting' },
  { key: 'I', zh: '改进方案', en: 'Improvement plan', overviewOnly: true, what: '30 / 60 / 90 天改进项和负责人', whatEn: '30 / 60 / 90-day improvements and owners' },
];

export const BIZ_KEYS = KB_BIZ.map((b) => b.key);
export const SEC_KEYS = KB_SECS.map((s) => s.key);
export const isBiz = (x: unknown): x is KbBiz => typeof x === 'string' && (BIZ_KEYS as string[]).includes(x);
export const isSec = (x: unknown): x is KbSec => typeof x === 'string' && (SEC_KEYS as string[]).includes(x);
export const bizDef = (k: string | null | undefined) => KB_BIZ.find((b) => b.key === k);
export const secDef = (k: string | null | undefined) => KB_SECS.find((s) => s.key === k);
export const bizName = (k: string | null | undefined, lang: 'zh' | 'en') => { const b = bizDef(k); return b ? (lang === 'zh' ? b.zh : b.en) : ''; };
export const secName = (k: string | null | undefined, lang: 'zh' | 'en') => { const s = secDef(k); return s ? (lang === 'zh' ? s.zh : s.en) : ''; };

/* 平台里的业务 → 知识库业务。不认识的(以后新加的业务)归「其他业务」 */
export function bizOfSvc(svc: string): KbBiz {
  return (KB_BIZ.find((b) => b.svcs.includes(svc))?.key) || 'other';
}

/* 这个业务能选的板块:总览 A – I;其余业务只有 B / C / D */
export const secsFor = (biz: string | null | undefined): KbSec[] =>
  biz === 'overview' ? [...SEC_KEYS] : KB_SECS.filter((s) => !s.overviewOnly).map((s) => s.key);

/* 业务 / 板块组合是否合法;合法返回 null,不合法返回中英两句的原因。
   都空 = 未归类(老文档);只有板块没有业务不行;非「总览」只能 B / C / D。 */
export function bizSecError(biz: unknown, sec: unknown): string | null {
  const b = biz == null || biz === '' ? null : biz;
  const s = sec == null || sec === '' ? null : sec;
  if (b !== null && !isBiz(b)) return '业务不对 / Unknown service';
  if (s !== null && !isSec(s)) return '板块不对 / Unknown section';
  if (b === null && s !== null) return '先选业务,再选板块 / Pick a service before a section';
  if (b !== null && s !== null && !secsFor(b).includes(s as KbSec)) {
    return `「${bizName(b, 'zh')}」只能选板块 B / C / D;A、E – I 只放在「总览 / 通用」 / “${bizName(b, 'en')}” only takes sections B / C / D — A and E – I live under Overview`;
  }
  return null;
}
