/* ===== 操作日志的两语词条 =====
   项目日志和永久审计记录原来是一句句写死的中文字符串,EN 模式下整片都是中文。
   这是全站 i18n 最后一块。

   做法:每条日志存 key + 参数,显示时按当前语言套模板。不存渲染好的句子 ——
   存句子的话,写的时候是哪种语言,以后就永远是哪种语言。

   老记录怎么办:不迁移。老行没有 key,只有当初写下的那句中文,照原样显示。
   日志是「谁在什么时候做了什么」的历史记录,不该被后来的翻译改写;何况参数
   已经揉进句子里了,想拆也拆不回来。所以新行有 key、老行没有,两种并存,
   renderer 认得出来。

   ===== 加一条日志的规矩 =====
   1. 在下面 LOG_MSG 里加一个 key,中英各一句;
   2. 变量写成 {name} 这样的槽位,值由 params 传;
   3. 服务端调用 logIt(p, by, 'key', { name: ... }),不要再自己拼字符串。

   槽位里有几个名字是「要按语言翻的」,见 TRANSLATED:
     {svc}     业务类型 key(cgi / led / …)→ 按语言出业务名
     {status}  {from} {to}  排期状态(todo/wip/done/block)
     {cl}      {clFrom} {clTo}  信息清单状态(pending/received/…)
   其余槽位原样填(人名、项目名、日期、数字)。 */

import { SVC } from './templates';
import { caseFieldTerm, caseStatusTerm } from './terms';
import type { Lang } from './i18n';

export type LogParams = Record<string, string | number | null | undefined>;

export interface LogLike {
  text: string;
  k?: string;
  p?: LogParams;
}

/* ---- 枚举型槽位:值是 key,显示要按语言翻 ---- */
const SCHED_STATUS: Record<string, [string, string]> = {
  todo: ['待办', 'To do'],
  wip: ['进行中', 'In progress'],
  done: ['已完成', 'Done'],
  block: ['受阻', 'Blocked'],
};

const CL_STATUS: Record<string, [string, string]> = {
  pending: ['待收', 'Pending'],
  received: ['已收到', 'Received'],
  confirmed: ['已确定', 'Confirmed'],
  na: ['不适用', 'N/A'],
  revision: ['需修改', 'Revision'],
  rejected: ['已退回', 'Rejected'],
};

const svcTerm = (k: string, lang: Lang) => {
  const v = SVC[k];
  return v ? (lang === 'zh' ? v.label : v.en) : k;
};

const enumTerm = (map: Record<string, [string, string]>, v: string, lang: Lang) =>
  (map[v] ? map[v][lang === 'zh' ? 0 : 1] : v);

const JUDGE_KIND: Record<string, [string, string]> = {
  drawing: ['施工图', 'drawing'], drawing_screenshot: ['施工图截图', 'drawing screenshot'], site_photo: ['现场照片', 'site photo'],
  render: ['效果图', 'render'], screenshot: ['其他截图', 'screenshot'], unrelated: ['与屏无关', 'unrelated'], none: ['未判断', 'not judged'],
};
const JUDGE_ENGINE: Record<string, [string, string]> = {
  vision: ['本机视觉模型', 'local vision model'], ocr: ['文字识别（本机视觉模型不可用）', 'OCR (local model unavailable)'],
  manual: ['手填（本机识别服务不可用）', 'manual (local recognition unavailable)'], running: ['本机视觉模型，识别中', 'local vision model, running'],
};
const JUDGE_ITEM: Record<string, [string, string]> = {
  led_opening_w: ['屏宽', 'width'], led_opening_h: ['屏高', 'height'], led_mount_h: ['离地高度', 'mounting height'],
  led_view_min: ['最近观看距离', 'min viewing distance'], led_ctrl_dist: ['控制室距离', 'control room distance'],
  led_pwr_dist: ['配电距离', 'power distance'], shape: ['形状', 'shape'], mount: ['安装方式', 'mounting'],
  pitch_hint: ['图上点间距', 'pitch on picture'], intent: ['用途', 'purpose'],
};

/* 槽位名 → 怎么把值翻成当前语言。不在表里的槽位原样填。 */
const TRANSLATED: Record<string, (v: string, lang: Lang) => string> = {
  svc: svcTerm,
  status: (v, l) => enumTerm(SCHED_STATUS, v, l),
  from: (v, l) => enumTerm(SCHED_STATUS, v, l),
  to: (v, l) => enumTerm(SCHED_STATUS, v, l),
  cl: (v, l) => enumTerm(CL_STATUS, v, l),
  clFrom: (v, l) => enumTerm(CL_STATUS, v, l),
  clTo: (v, l) => enumTerm(CL_STATUS, v, l),
  /* AV-014:改的是哪个字段(cf),以及状态字段的两个取值。fv / tv 里放的多半是
     数字或自由文本,CASE_STATUS_TERMS 认不出来的原样填。
     槽位名别用 field —— sched.date / pkg.field / fin.edit 早就在用 {field},
     注册成翻译槽会把那几条老日志一起误翻(业务字段叫 name 的会变成「项目名」)。 */
  cf: caseFieldTerm,
  fv: caseStatusTerm,
  tv: caseStatusTerm,
  /* AV-015 图片判读:图片类型、识别方式、人改了哪几项(元素代码:原值:新值;…) */
  jk: (v, l) => enumTerm(JUDGE_KIND, v, l),
  eng: (v, l) => enumTerm(JUDGE_ENGINE, v, l),
  jchg: (v, l) => v.split(';').filter(Boolean).map((c) => {
    const [k, a, b] = c.split(':');
    return `${enumTerm(JUDGE_ITEM, k, l)} ${a || '—'}→${b || '—'}`;
  }).join(l === 'zh' ? '；' : '; '),
};

/* ---- 词条表 ---- */
export const LOG_MSG: Record<string, [string, string]> = {
  /* 项目 */
  'proj.create': ['创建项目 (NO. {no})', 'Project created (NO. {no})'],
  'proj.createAv': ['立项询价创建项目', 'Project opened from an AV inquiry'],
  'proj.copy': ['复制自「{from}」({mode}) · NO. {no}', 'Copied from “{from}” ({mode}) · NO. {no}'],
  'proj.rename': ['项目更名:「{from}」→「{to}」', 'Renamed: “{from}” → “{to}”'],
  'proj.client': ['客户:「{from}」→「{to}」', 'Client: “{from}” → “{to}”'],
  'proj.quotationNo': ['报价号 Quotation No.={value}', 'Quotation No. = {value}'],
  'proj.delivery': ['交付日:「{from}」→「{to}」', 'Delivery: “{from}” → “{to}”'],
  'proj.archive': ['归档项目', 'Project archived'],
  'proj.unarchive': ['取消归档', 'Project unarchived'],
  'proj.transfer': ['项目转交:{from} → {to}', 'Handover: {from} → {to}'],
  'proj.transferTasks': ['项目转交(含任务指派):{from} → {to}', 'Handover incl. task assignments: {from} → {to}'],
  'proj.invoiced': ['标记开票 / 收尾', 'Marked invoiced / closing'],
  'proj.uninvoiced': ['撤销开票', 'Invoiced mark removed'],

  /* 人员 */
  'owner.add': ['指派 PM:{name}', 'PM assigned: {name}'],
  'eng.set': ['指派工程师:{name}', 'Engineer assigned: {name}'],
  'eng.replace': ['指派工程师:{name}(原 {was})', 'Engineer assigned: {name} (was {was})'],
  'eng.clear': ['撤下工程师:{was}', 'Engineer unassigned: {was}'],
  'contact.person': ['客户联系人:「{from}」→「{to}」', 'Client contact: “{from}” → “{to}”'],

  /* 排期 */
  'sched.status': ['{task}:{from}→{to}', '{task}: {from}→{to}'],
  'sched.statusSvc': ['{svc}·{task}:{from}→{to}', '{svc} · {task}: {from}→{to}'],
  'sched.date': ['{task} 日期({field})={value}', '{task} date ({field}) = {value}'],
  'sched.addRow': ['新增阶段', 'Phase added'],
  'sched.removeRow': ['删除阶段:{task}', 'Phase removed: {task}'],
  'sched.reorder': ['调整阶段顺序', 'Phases reordered'],
  'sched.reorderDrag': ['拖动调整阶段顺序:{task}', 'Phase reordered by drag: {task}'],
  'sched.reverse': ['{svc} 倒排:按起始 + 交付自动生成各阶段日期', '{svc} back-scheduled from start + delivery'],
  'sched.reverseAll': ['按交付日倒排,各服务阶段日期自动生成', 'All services back-scheduled from the delivery date'],
  'sched.customNode': ['新增自定义节点:{name}', 'Custom node added: {name}'],
  'sched.holiday': ['新增假期行:{text}', 'Holiday row added: {text}'],
  'sched.gate': ['新增卡点行:{text}', 'Gate row added: {text}'],

  /* 日历排期 */
  'cal.save': ['{svc} 保存日历排期(第 {version} 版,{stages} 阶段)', '{svc} calendar saved (v{version}, {stages} stages)'],
  /* REQ-047:老效果图流程的日历排期 */
  'cal.flowSwitch': ['{svc} 日历排期换成新效果图流程({stages} 阶段,日期按新阶段重新分配)', '{svc} calendar switched to the new CGI flow ({stages} stages, dates redistributed)'],
  'cal.flowKeep': ['{svc} 日历排期保持原效果图流程', '{svc} calendar keeps the previous CGI flow'],
  'cal.flowUndo': ['{svc} 日历排期撤销更换,恢复原效果图流程', '{svc} calendar switch undone; previous CGI flow restored'],
  'cal.delivery': ['交付日按日历排期更新:{from} → {to}', 'Delivery updated from the calendar: {from} → {to}'],

  /* 信息清单 */
  'cl.status': ['清单「{item}」:{clFrom}→{clTo}', 'Checklist “{item}”: {clFrom}→{clTo}'],
  'cl.receiptAdd': ['清单「{item}」新增收料记录', 'Checklist “{item}” — receipt added'],
  'cl.receiptAddFile': ['清单「{item}」新增收料记录:{file}', 'Checklist “{item}” — receipt added: {file}'],
  'cl.receiptEdit': ['清单「{item}」修改了一条收料记录', 'Checklist “{item}” — receipt edited'],
  'cl.receiptRemove': ['清单「{item}」删除了一条收料记录', 'Checklist “{item}” — receipt removed'],
  'cl.renameGroup': ['重命名清单分区:{from} → {to}', 'Checklist section renamed: {from} → {to}'],
  'cl.removeGroup': ['删除清单分区:{group}', 'Checklist section removed: {group}'],
  'cl.flat': ['清单切换为「无固定分区」', 'Checklist switched to a flat list'],
  'cl.grouped': ['清单恢复分区模式', 'Checklist sections restored'],
  'cl.reset': ['恢复默认信息清单', 'Checklist reset to the default'],
  'cl.shot': ['上传资料截图:{item}', 'Reference image uploaded: {item}'],

  /* 服务包 / 资料 */
  'pkg.field': ['{svc} {field}={value}', '{svc} {field} = {value}'],
  'pkg.buffer': ['{svc} buffer={value}', '{svc} buffer = {value}'],
  'pkg.add': ['新增业务 {svc}{label}', 'Service added: {svc}{label}'],
  'pkg.addRecord': ['新增登记记录 {svc}{label}', 'Register record added: {svc}{label}'],
  'pkg.remove': ['删除业务 {svc}{label}', 'Service removed: {svc}{label}'],
  'record.update': ['更新资料 Record:{svc}', 'Record updated: {svc}'],
  'record.import': ['导入登记记录:{svc}', 'Register records imported: {svc}'],
  'frag.apply': ['{text}', '{text}'],

  /* 积分 */
  'points.manual': ['积分手动设为 {value}', 'Points set manually to {value}'],
  'points.auto': ['积分改回按积分规则自动计算', 'Points back to the rule-based score'],
  'points.tier': ['{svc} 积分档位 {tier}', '{svc} points tier {tier}'],
  'points.tierValue': ['{svc} 积分档位 {tier} = {value}', '{svc} points tier {tier} = {value}'],
  'points.tierClear': ['{svc} 清除积分档位', '{svc} points tier cleared'],
  'diff.set': ['难度改为 {value}', 'Difficulty set to {value}'],

  /* 售后工作流 */
  'wf.handoverSubmit': ['提交交接给 PM「{pm}」', 'Handover submitted to PM “{pm}”'],
  'wf.handoverEdit': ['修改交接简报', 'Handover brief edited'],
  'wf.handoverReassign': ['交接改派 PM「{from}」→「{to}」', 'Handover reassigned: “{from}” → “{to}”'],
  'wf.handoverAccept': ['接受交接,进入生产', 'Handover accepted — production started'],
  'wf.completionSubmit': ['提交完成包', 'Completion package submitted'],
  'wf.completionApprove': ['批准完成包', 'Completion package approved'],
  'wf.completionReject': ['驳回完成包,退回生产{note}', 'Completion package rejected — back to production{note}'],
  'wf.completionChanges': ['要求修改完成包,退回生产{note}', 'Changes requested on the completion package{note}'],
  'wf.salesVerify': ['Sales 核对完成(允许开票)', 'Sales verified — invoicing allowed'],
  'wf.salesVerifyHold': ['Sales 核对完成(暂不开票)', 'Sales verified — invoicing on hold'],
  'wf.variationReapprove': ['Variation(影响报价)→ 退回重走 PD 审批{note}', 'Variation affecting the quote — back to PD approval{note}'],
  'wf.variationNote': ['Variation(不影响报价,仅记录){note}', 'Variation recorded, quote unaffected{note}'],
  'wf.decision': ['Director 决定:{value}', 'Director decision: {value}'],

  /* 财务 */
  'fin.edit': ['Finance 改单 {field}={value}', 'Finance edited {field} = {value}'],
  'fin.editAfterIssue': ['Finance 改单 {field}={value}(已开票后修改)', 'Finance edited {field} = {value} (after the invoice was issued)'],
  'fin.invoiceStatus': ['开票状态 {from}→{to}{note}', 'Invoice status {from}→{to}{note}'],
  'fin.paymentStatus': ['收款状态 {from}→{to}', 'Payment status {from}→{to}'],
  'fin.risk': ['Payment Risk:{level}', 'Payment risk: {level}'],
  'fin.riskDeposit': ['Payment Risk:{level} · 定金 {deposit}', 'Payment risk: {level} · deposit {deposit}'],

  /* AV 方案成本平台 */
  'av.inquiry': ['立项询价:{lines}', 'AV inquiry opened: {lines}'],
  'av.ingest': ['LED 图纸上传并解析:{file}({grade} 级)', 'LED drawing uploaded and parsed: {file} (grade {grade})'],
  'av.review': ['LED 图纸校核完成:{file}(修正 {fixed} 项,已锁定)', 'LED drawing review done: {file} ({fixed} corrections, locked)'],
  'av.uploadFail': ['图纸已留档,解析失败:{file}({err})', 'Drawing archived, parsing failed: {file} ({err})'],
  /* AV-016:草稿自动保存(同一人同一页 10 分钟内合并成一条)、01 编辑自动保存、留档删除 / 改手填 */
  'av.draft': ['05 {svc} 方案草稿自动保存', '05 {svc} design draft saved automatically'],
  'av.inquiryEdit': ['01 立项信息自动保存:{fields}', '01 inquiry details saved automatically: {fields}'],
  'av.uploadDel': ['删除解析失败的留档:{file}', 'Failed upload removed: {file}'],
  'av.uploadManual': ['解析失败的留档改为手填:{file}', 'Failed upload switched to manual entry: {file}'],
  /* 工作台 / 步骤条「最近更新」只要一句话:带金额、毛利的那几条换成不带数字的说法(谁都一样) */
  'av.costBrief': ['{line} 成本已确认', '{line} cost confirmed'],
  'av.quoteBrief': ['提交报价 {no} 待审批', 'Quotation {no} submitted'],
  'av.quoteApproveBrief': ['批准报价 {no}', 'Quotation {no} approved'],
  'av.quoteRejectBrief': ['退回报价 {no}', 'Quotation {no} rejected'],
  /* AV-015 图片智能判读 */
  'av.judgeUpload': ['上传图片做智能判读:{file}', 'Picture uploaded for recognition: {file}'],
  'av.judgeResult': ['图片判读:{file} · {jk} · 宽 {w} × 高 {h} mm · {eng}', 'Picture read: {file} · {jk} · {w} × {h} mm · {eng}'],
  'av.judgeConfirm': ['图片判读已确认并带入 05:{file} · 宽 {w} × 高 {h} mm · P{pitch}(人工修改:{jchg})',
    'Picture confirmed into 05: {file} · {w} × {h} mm · P{pitch} (changed by hand: {jchg})'],
  'av.cfgLed': ['保存 LED 方案:P{pitch} · {sqm} ㎡ · 箱体 {cabinets} 只(规则包 {pack})',
    'LED design saved: P{pitch} · {sqm} m² · {cabinets} cabinets (pack {pack})'],
  'av.cfgPrj': ['保存投影方案:{size} mm · {n} 台 × {lm} lm(规则包 {pack})',
    'Projection design saved: {size} mm · {n} × {lm} lm (pack {pack})'],
  'av.cfgElv': ['保存弱电方案:{area} ㎡ · 端口 {ports} · 摄像机 {cams} · 扬声器 {spk}(规则包 {pack})',
    'ELV design saved: {area} m² · {ports} ports · {cams} cameras · {spk} speakers (pack {pack})'],
  'av.cfgPv': ['保存光伏方案:{kwp} kWp · 组件 {mods} 块 · 逆变器 {inv}(规则包 {pack})',
    'Solar PV design saved: {kwp} kWp · {mods} modules · {inv} inverters (pack {pack})'],
  'av.cost': ['{line} 单线成本确认:成本 S${cost},售价 S${list},毛利 {margin}',
    '{line} line cost confirmed: cost S${cost}, price S${list}, margin {margin}'],
  'av.quoteSubmit': ['提交报价 {no} 待审批:{lines} · 含税 S${total} · 折后毛利 {margin}',
    'Quotation {no} submitted: {lines} · incl. GST S${total} · margin after discount {margin}'],
  'av.quoteSubmitShared': ['提交报价 {no} 待审批:{lines} · 含税 S${total} · 共用资源去重 −S${shared} · 折后毛利 {margin}',
    'Quotation {no} submitted: {lines} · incl. GST S${total} · shared-resource saving −S${shared} · margin after discount {margin}'],
  'av.quoteApprove': ['批准报价 {no}(含税 S${total}){note}', 'Quotation {no} approved (incl. GST S${total}){note}'],
  'av.quoteReject': ['退回报价 {no}(含税 S${total}){note}', 'Quotation {no} rejected (incl. GST S${total}){note}'],
  /* AV-014 历史案例人工修改。一次保存写一条:显示第一处改动,多的用 {more}
     带过;完整的改前→改后存在参数 changes 里(模板不引用它,所以不渲染)。 */
  'av.caseEdit': ['历史案例「{screen}」:{cf} {fv} → {tv}', 'Past case "{screen}": {cf} {fv} → {tv}'],
  'av.caseEditMore': ['历史案例「{screen}」:{cf} {fv} → {tv},另 {more} 处',
    'Past case "{screen}": {cf} {fv} → {tv}, and {more} more'],
  /* 保修到期提醒上点「已联系」/ 撤销。{due} 是那一次的到期日 */
  'av.caseContacted': ['历史案例「{screen}」:保修 {due} 到期,已联系客户', 'Past case "{screen}": warranty expiring {due}, client contacted'],
  'av.caseContactUndo': ['历史案例「{screen}」:撤销「已联系」(保修 {due} 到期)', 'Past case "{screen}": "contacted" withdrawn (warranty expiring {due})'],
  /* 由同项目另一块屏的编辑带过来的(「同步到本项目其它屏」) */
  'av.caseSync': ['历史案例「{screen}」:{cf} {fv} → {tv}(随同项目其它屏同步)',
    'Past case "{screen}": {cf} {fv} → {tv} (synced from another screen of the project)'],
  'av.caseSyncMore': ['历史案例「{screen}」:{cf} {fv} → {tv},另 {more} 处(随同项目其它屏同步)',
    'Past case "{screen}": {cf} {fv} → {tv}, and {more} more (synced from another screen of the project)'],

  /* 风险 */
  'risk.dismiss': ['标记风险已处理:{key}', 'Risk dismissed: {key}'],
  'risk.restore': ['恢复风险:{key}', 'Risk restored: {key}'],
};

const SLOT = /\{(\w+)\}/g;

export function fillTemplate(tpl: string, params: LogParams | undefined, lang: Lang): string {
  return tpl.replace(SLOT, (_, name: string) => {
    const raw = params?.[name];
    if (raw == null || raw === '') return '—';
    const v = String(raw);
    const tr = TRANSLATED[name];
    return tr ? tr(v, lang) : v;
  });
}

/* 一条日志显示成什么。
   没有 key → 老记录,原样显示当初写下的那句。
   key 不在表里 → 词条被删了,回落到写入时那句(总比显示一个 key 强)。 */
export function logText(e: LogLike, lang: Lang): string {
  if (!e.k) return e.text;
  const m = LOG_MSG[e.k];
  if (!m) return e.text || e.k;
  return fillTemplate(lang === 'zh' ? m[0] : m[1], e.p, lang);
}

/* 服务端写日志时用:把中文那句渲染出来存进 text —— 导出、老客户端、以及
   将来词条被删的情况都还能读到一句人话。 */
export const logZh = (k: string, p?: LogParams): string => {
  const m = LOG_MSG[k];
  return m ? fillTemplate(m[0], p, 'zh') : k;
};
