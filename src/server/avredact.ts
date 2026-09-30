/* ===== 字段级隔离:把看不该看的数从接口回包里拿掉(2026-09-30)=====

   口径在 lib/permissions.ts 的 priceView:
     full  PD / BD / 财务    成本价、售价、毛利全看
     list  Sales             只看售价与报价金额
     none  PM                任何单价与金额都不看,只看方案和数量

   为什么集中在这一个文件:成本价藏在好几种形状里 —— 价格条目、价格历史、
   成本单每一行的快照单价、成本单合计、共用资源去重、报价分段、检查提示的
   文字、还有项目日志的参数。散在各个路由里各写一遍,迟早漏一处。每个带
   价格的接口在回包前都过这里。

   拿掉的字段一律置 null(不是删键):前端照旧按形状取值,拿到 null 显示
   「—」,不会因为少一个键而崩。 */

import type { CostCheck, CostLine, PriceItem } from '@/av/core/pricing';
import type { QuoteSection } from '@/av/core/quote';
import type { Deduction, SharedRow } from '@/av/core/xline';
import { logZh, type LogParams } from '@/lib/logmsg';
import type { PriceView } from '@/lib/permissions';

/* 这些类型在回包里的数值字段可能是 null —— 前端要按可空处理 */
type Nullable<T, K extends keyof T> = Omit<T, K> & { [P in K]: T[P] | null };

export const redactItem = (it: PriceItem, v: PriceView): Nullable<PriceItem, 'costPrice' | 'listPrice'> =>
  v === 'full' ? it : { ...it, costPrice: null, listPrice: v === 'list' ? it.listPrice : null };

export const redactHistory = <H extends { cost_price: number | null; list_price: number | null }>(h: H, v: PriceView): H =>
  v === 'full' ? h : { ...h, cost_price: null, list_price: v === 'list' ? h.list_price : null };

export const redactLine = (l: CostLine, v: PriceView): CostLine =>
  v === 'full' ? l : { ...l, unitCost: null, unitList: v === 'list' ? l.unitList : null };

export function redactSheet<S extends { lines: CostLine[]; cost: number; list: number }>(s: S, v: PriceView):
  Omit<S, 'cost' | 'list'> & { cost: number | null; list: number | null } {
  if (v === 'full') return s;
  return { ...s, lines: s.lines.map((l) => redactLine(l, v)), cost: null, list: v === 'list' ? s.list : null };
}

export const redactShared = (r: SharedRow, v: PriceView): Nullable<SharedRow, 'cost' | 'list'> =>
  v === 'full' ? r : { ...r, cost: null, list: v === 'list' ? r.list : null };

export const redactDedup = (d: Deduction, v: PriceView): Nullable<Omit<Deduction, 'items'>, 'cost' | 'list'> & { items: ReturnType<typeof redactShared>[] } =>
  v === 'full' ? d : { ...d, cost: null, list: v === 'list' ? d.list : null, items: d.items.map((r) => redactShared(r, v)) };

export const redactSection = (s: QuoteSection, v: PriceView): Nullable<QuoteSection, 'cost'> =>
  v === 'full' ? s : { ...s, cost: null };

/** 报价:Sales 看售价、折扣、税、合计,不看成本与毛利下限。PM 根本进不来,
 *  这里不处理 none(调用方先 403)。 */
export function redactQuote<Q extends { sections: QuoteSection[]; dedup: Deduction[]; marginFloor: number }>(q: Q, v: PriceView) {
  if (v === 'full') return q;
  return { ...q, sections: q.sections.map((s) => redactSection(s, v)), dedup: q.dedup.map((d) => redactDedup(d, v)), marginFloor: null };
}

/* ---- 检查提示 ----
   提示是一句话,数字写在句子里 —— 拿掉字段不够,得连句子一起换。
   COST-MARGIN 整条拿掉(Sales 按 09-30 的决定「完全不提示」,PM 本来就不看)。
   COST-STALE 把句子里的价格去掉,只留「价格库变了,可重算」—— 这个信息 PM
   也用得上(该重算了),只是不能带数。 */
export function redactChecks(checks: CostCheck[], v: PriceView): CostCheck[] {
  if (v === 'full') return checks;
  return checks
    .filter((c) => c.code !== 'COST-MARGIN' && c.code !== 'QUOTE-MARGIN')
    .map((c) => {
      if (c.code !== 'COST-STALE') return c;
      const who = /^「[^」]*」/.exec(c.message)?.[0] ?? '';
      return { ...c, message: `${who}价格库已变动，本表按旧价计算，可重算。` };
    });
}

/* ---- 项目日志 ----
   AV 的几条日志在参数里带着金额与毛利(成本确认、提交报价、审批)。日志存的
   是 key + 参数,读的时候按人把参数置空(模板里显示「—」),再按置空后的参数
   重新渲染中文那句 —— 老客户端读 text 也读不到数。

   09-29 之前写下的老日志只有一句中文、没有参数,只能按那几句的固定句式把
   数字抹掉。句式就是当时的模板,见 lib/logmsg.ts 同名词条。 */
const LOG_HIDE: Record<string, { list: string[]; none: string[] }> = {
  'av.cost': { list: ['cost', 'margin'], none: ['cost', 'list', 'margin'] },
  'av.quoteSubmit': { list: ['margin'], none: ['total', 'margin'] },
  'av.quoteSubmitShared': { list: ['margin'], none: ['total', 'shared', 'margin'] },
  'av.quoteApprove': { list: [], none: ['total'] },
  'av.quoteReject': { list: [], none: ['total'] },
};

/* 数字按千分位认:「15,000,毛利」里第二个逗号是分隔符,不是数的一部分 */
const NUM = String.raw`\d+(?:,\d{3})*(?:\.\d+)?`;
const blank = (label: string): [RegExp, string] => [new RegExp(`${label}${NUM}`), `${label.replace(/\\/g, '')}—`];
const LEGACY: { test: RegExp; list: [RegExp, string][]; none: [RegExp, string][] }[] = [
  { test: /单线成本确认/,
    list: [blank(String.raw`成本 S\$`), [new RegExp(`毛利 ${NUM}%`), '毛利 —']],
    none: [blank(String.raw`成本 S\$`), blank(String.raw`售价 S\$`), [new RegExp(`毛利 ${NUM}%`), '毛利 —']] },
  { test: /提交报价/,
    list: [[new RegExp(`折后毛利 ${NUM}%`), '折后毛利 —']],
    none: [blank(String.raw`含税 S\$`), blank(String.raw`−S\$`), [new RegExp(`折后毛利 ${NUM}%`), '折后毛利 —']] },
  { test: /(批准|退回)报价/,
    list: [],
    none: [blank(String.raw`含税 S\$`)] },
];

export function redactLog<E extends { text: string; k?: string | null; p?: LogParams | null }>(e: E, v: PriceView): E {
  if (v === 'full') return e;
  if (e.k && LOG_HIDE[e.k]) {
    const hide = LOG_HIDE[e.k][v];
    if (!hide.length) return e;
    const p: LogParams = { ...(e.p ?? {}) };
    for (const f of hide) p[f] = '';
    return { ...e, p, text: logZh(e.k, p) };
  }
  if (!e.k) {
    const rule = LEGACY.find((r) => r.test.test(e.text));
    if (rule) return { ...e, text: rule[v].reduce((t, [re, to]) => t.replace(re, to), e.text) };
  }
  return e;
}
