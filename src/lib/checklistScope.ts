/* ===== REQ-050 · 信息清单每一项的「范围」 =====

   项目级(proj):地址、联系人、图纸、时间节点…… 整个项目只有一条,同一业务加第二份也不多;
   规格项(inst):屏幕尺寸 / 类型、是否含铁架 / 电脑 / 音响、放置位置…… 每一份业务各不相同,
                  同一行里每份一格(LED-1 / LED-2)。

   默认值由开发按现有出厂模板整理(下面这张表),PD 在模板管理里复核、可以改。
   模板里没有的项(项目里手加的、自定义模板来的)按名字里的关键词猜,猜不出来算项目级 ——
   项目级最多是少一格,不会凭空多出要填的东西;预演报告里每一项都写明是怎么定的。 */

import { normName } from './checklistMerge';
import { GENERIC, TPL, type Template } from './templates';
import type { ChecklistItem } from './types';

export type ClScopeKind = 'proj' | 'inst';

/* 出厂模板里的规格项(中文名,和 templates.ts 一字不差)。没列出的都是项目级。 */
export const INST_DEFAULTS: Record<string, string[]> = {
  led: [
    '屏幕尺寸与类型(P3/P2.5等)',
    '是否含铁架/电脑/音响',
    'LED/DB Box/电脑 放置位置',
    '电源规格与位置',
    '电线/网线/HDMI 布线',
    '音响线',
  ],
  projector: [
    '投屏尺寸要求',
    '投影机型号',
    '电脑/音响/播放盒/无线投屏/雷达',
    '是否融合 / 中控',
    '电源/网线/HDMI/音响 规格数量',
    '布线',
  ],
  scale: [
    '比例 Scale',
    '模型类型',
    '是否需 App 控制',
    '特殊要求',
    '标题牌',
    '模型台信息',
    '单元命名/灯光逻辑/UI配色',
    'Mock-up 部位决定',
  ],
  unitmodel: [
    '单元户型平面',
    '天花反射图(墙高/假天花)',
    '非ID木作与固定件(衣柜/台盆/洁具)',
    'ID处理 / FF&E 表',
    '立面图',
    '室内材料分区',
    '比例 Scale(1:25/1:150等)',
    '模型台 Model stand table',
  ],
  vrar: [
    '单元户型平面图',
    '天花反射图(墙高/假天花)',
    '非ID木作与固定件',
    '材料表(饰面/铺贴方向)',
    'ID处理 / FF&E 表',
    '立面图 Elevations',
  ],
  /* 没有专属模板的业务(TV、MAXHUB、灯箱……)用通用模板:只有「需求 / 规格」每份不同 */
  _generic: ['需求 / 规格'],
};

/* 模板里没有的项:名字里带这些词的多半每份不同 */
const INST_HINT = /(尺寸|规格|型号|类型|比例|放置位置|安装位置|铁架|支架|模型台|size|dimension|model\b|spec|type|scale|placement|frame|stand)/i;
/* 带这些词的一定是整个项目一条(就算也带了上面的词,比如「项目地址」「图纸规格」) */
const PROJ_HINT = /(地址|联系人|图纸|时间节点|截止|下单|发货|海运|签证|address|contact|drawing|deadline|time node|order|shipping|visa)/i;

const keysOf = (it: { zh?: string; en?: string }) => [normName(it.zh), normName(it.en)].filter(Boolean) as string[];
const instIndex = new Map<string, Set<string>>();
for (const [svc, names] of Object.entries(INST_DEFAULTS)) instIndex.set(svc, new Set(names.map((n) => normName(n)).filter(Boolean) as string[]));

/* 业务模板里有哪些项 —— 模板里有的按规格项表定,不再猜 */
export type TplNames = Map<string, Set<string>>;   // svc → 该业务模板里所有项的名字(规整后)
/* 出厂模板 + PD 存过的模板(后者覆盖前者)。没有专属模板的业务用通用模板 */
export function tplNamesFrom(saved: Record<string, Pick<Template, 'checklist'>> = {}): TplNames {
  const out: TplNames = new Map();
  const add = (svc: string, t: Pick<Template, 'checklist'> | undefined) => {
    if (!t) return;
    const set = new Set<string>();
    (t.checklist || []).forEach((g) => (g[3] || []).forEach((it) => [it[0], it[1]].forEach((n) => { const k = normName(n); if (k) set.add(k); })));
    out.set(svc, set);
  };
  Object.entries(TPL).forEach(([svc, t]) => add(svc, t));
  Object.entries(saved).forEach(([svc, t]) => add(svc, t));
  add('_generic', GENERIC);
  return out;
}
let builtin: TplNames | null = null;
const builtinNames = () => (builtin ||= tplNamesFrom());

export interface ScopeDecision { scope: ClScopeKind; why: 'item' | 'template' | 'hint' | 'default' }

/* 一项的范围。顺序:
   1. 项上已经写了 scope(PD 改过 / 迁移过)—— 照它;
   2. 业务模板里(出厂的或 PD 存过的)有这一项 —— 规格项表里有就是规格项,否则项目级;
   3. 名字里的关键词;
   4. 都不是:项目级。 */
export function scopeOf(it: Pick<ChecklistItem, 'zh' | 'en' | 'scope'>, svcs: string[], tplNames: TplNames = builtinNames()): ScopeDecision {
  if (it.scope === 'proj' || it.scope === 'inst') return { scope: it.scope, why: 'item' };
  const keys = keysOf(it);
  const own = (svc: string) => (tplNames.has(svc) ? svc : '_generic');   // 没有专属模板 = 通用模板
  for (const svc of svcs) {
    const inst = instIndex.get(own(svc) === '_generic' ? '_generic' : svc);
    if (inst && keys.some((k) => inst.has(k))) return { scope: 'inst', why: 'template' };
  }
  for (const svc of svcs) {
    const names = tplNames.get(own(svc));
    if (names && keys.some((k) => names.has(k))) return { scope: 'proj', why: 'template' };
  }
  const name = `${it.zh || ''} ${it.en || ''}`;
  if (PROJ_HINT.test(name)) return { scope: 'proj', why: 'hint' };
  if (INST_HINT.test(name)) return { scope: 'inst', why: 'hint' };
  return { scope: 'proj', why: 'default' };
}

export const scopeWhyZh: Record<ScopeDecision['why'], string> = {
  item: '项上已设',
  template: '按模板',
  hint: '按名字猜',
  default: '默认项目级',
};
