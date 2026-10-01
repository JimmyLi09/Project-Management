/* ===== AV-017 · 一个项目走到了哪一步 =====
   步骤条(每一步页面顶上)和 AV 工作台问的是同一个问题,所以只在这里算一次:
   两边各算各的,迟早一个说「待核算」一个说「已完成」。

   各步状态:
     done    已完成            todo   待做
     draft   做了一半 / 没保存正式版 / 成本是草稿
     pending 等别人(图纸有项未确认、报价待审批)
     lock    还不能进(带原因)
     na      这个项目用不到这一步(没有 LED 线就没有图纸校核) */

import { projectLines } from '@/av/core/lines';
import type { BusinessLine } from '@/av/core/types';
import { canViewPrices, canViewQuotes, type Identity } from '@/lib/permissions';
import type { Project } from '@/lib/types';
import { configCount, getDraft, getInquiry, latestConfig, latestCostSheet, listDrawings, listQuotes } from './avdb';
import { listUploads } from './avupload';
import { listJudges } from './avjudge';
import { lastAvAudit } from './db';

export type StepKey = 's1' | 's2' | 's5' | 's6' | 's7';
export type StepState = 'done' | 'todo' | 'draft' | 'pending' | 'lock' | 'na';
export type Stage = 'intake' | 'review' | 'config' | 'costing' | 'quoting' | 'done';

export interface StepStatus { state: StepState; zh: string; en: string }

export interface ProjectFlow {
  lines: { line: BusinessLine; label: string; en: string }[];
  steps: Record<StepKey, StepStatus>;
  stage: Stage;
  versions: Partial<Record<BusinessLine, number>>;   // 已保存的正式版本数
  costConfirmed: boolean;
  lastUpdate: { at: number; by: string } | null;
  counts: { drawings: number; pendingDrawings: number; configured: number; costed: number; total: number };
}

const COSTED: BusinessLine[] = ['led', 'projector', 'elv', 'pv'];
const st = (state: StepState, zh: string, en: string): StepStatus => ({ state, zh, en });

/* null = 不是 AV 项目(没有 AV 业务线也没走过 01) */
export function projectFlow(p: Project, me: Identity): ProjectFlow | null {
  const inquiry = getInquiry(p.id);
  const lines = projectLines(p.packages.map((k) => k.svc), inquiry?.lines);
  if (!lines.length && !inquiry) return null;
  const money = canViewPrices(me);
  const keys = lines.map((l) => l.line).filter((l) => COSTED.includes(l));
  const drawings = listDrawings(p.id);
  const judges = listJudges(p.id);
  const quotes = listQuotes(p.id);
  const configs = new Map(keys.map((l) => [l, latestConfig(p.id, l)]));
  const sheets = new Map(keys.map((l) => [l, latestCostSheet(p.id, l)]));
  const configured = keys.filter((l) => !!configs.get(l));
  /* 成本表只有看得到价格的人能数(工作台原来的口径,不变) */
  const costed = money ? keys.filter((l) => !!sheets.get(l)) : [];
  const confirmed = keys.filter((l) => {
    const s = sheets.get(l); const c = configs.get(l);
    return s && c && s.status === 'confirmed' && s.configId === c.id;
  });
  const approved = quotes.some((q) => q.status === 'approved');
  const submitted = quotes.some((q) => q.status === 'submitted');
  const pendingDrawings = drawings.filter((d) => d.pending > 0 || (!d.reviewedAt && d.pending === 0)).length;
  const openJudges = judges.filter((j) => !j.drawingId).length;
  /* AV-016:解析失败但原件留着的,也算这一步没完 */
  const failedUploads = listUploads(p.id).filter((u) => u.status === 'failed').length;
  const drafts = keys.filter((l) => !!getDraft(p.id, l));

  /* 工作台的阶段,口径与 0929 完全一致 */
  const pendingDrawing = drawings.some((d) => d.pending > 0);
  const stage: Stage =
    approved ? 'done'
    : submitted ? 'quoting'
    : keys.length > 0 && costed.length === keys.length ? 'quoting'
    : keys.length > 0 && configured.length === keys.length ? (money ? 'costing' : 'config')
    : pendingDrawing ? 'review'
    : drawings.length > 0 || configured.length > 0 ? 'config'
    : 'intake';

  const s1 = inquiry || keys.length ? st('done', '已完成', 'Done') : st('todo', '待做', 'To do');

  const hasLed = keys.includes('led');
  const reviewed = drawings.filter((d) => d.reviewedAt > 0).length;
  /* 已经有校核完的图纸、又没有解析出来还没校核的:这一步算完成。解析失败的留档、
     没带入 05 的图片(比如「只是资料」)只作提示,不能让这一步永远卡在「待处理」 */
  const loose = failedUploads + openJudges;
  const s2 = !hasLed ? st('na', '本项目不用', 'Not needed')
    : pendingDrawings > 0
      ? st('pending', `还有 ${pendingDrawings} 张待确认`, `${pendingDrawings} to confirm`)
      : reviewed > 0
        ? (loose ? st('done', `已完成（另有 ${loose} 份未用）`, `Done (${loose} unused)`) : st('done', '已完成', 'Done'))
        : openJudges > 0 ? st('pending', `还有 ${openJudges} 张图片待确认`, `${openJudges} picture(s) to confirm`)
          : failedUploads > 0 ? st('pending', `${failedUploads} 份解析失败，原件已留档`, `${failedUploads} failed to parse (kept)`)
            : st('todo', '待做 · 也可直接去 05 手填', 'To do · or fill in 05 by hand');

  const s5 = !keys.length ? st('todo', '待做', 'To do')
    : drafts.length > 0 ? st('draft', '草稿 · 未保存正式版', 'Draft · not saved as a version')
    : configured.length === keys.length ? st('done', '正式版本已保存', 'Saved')
      : configured.length > 0 ? st('draft', `${keys.length} 条线已存 ${configured.length} 条`, `${configured.length} of ${keys.length} lines saved`)
        : st('todo', '待做 · 未保存正式版', 'To do · not saved');

  const outdated = keys.some((l) => { const s = sheets.get(l); const c = configs.get(l); return s && c && s.configId !== c.id; });
  const anySheet = keys.some((l) => !!sheets.get(l));
  const s6 = !configured.length ? st('lock', '需先在 05 保存方案', 'Save a 05 design first')
    : keys.length > 0 && confirmed.length === keys.length ? st('done', '已确认', 'Confirmed')
      : outdated ? st('draft', '方案有新版本，成本需重算', 'Design changed — recompute')
        : anySheet ? st('draft', '草稿 · 待 PD / BD 确认', 'Draft · awaiting PD / BD')
          : st('todo', '待做', 'To do');

  const costConfirmed = keys.length > 0 && confirmed.length === keys.length;
  const s7 = !canViewQuotes(me) ? st('lock', '报价由 Sales / PD / BD 负责', 'Quotes are handled by Sales / PD / BD')
    : approved ? st('done', '已批准', 'Approved')
      : !costConfirmed ? st('lock', '报价要先完成 06 成本核算', 'Complete 06 costing first')
        : submitted ? st('pending', '待 PD / BD 审批', 'Awaiting approval')
          : st('todo', '待做', 'To do');

  const last = lastAvAudit(p.id);
  return {
    lines: lines.map((l) => ({ line: l.line, label: l.label, en: l.en })),
    steps: { s1, s2, s5, s6, s7 },
    stage,
    versions: Object.fromEntries(keys.map((l) => [l, configCount(p.id, l)])),
    costConfirmed,
    lastUpdate: last ? { at: last.at, by: last.by } : null,
    counts: { drawings: drawings.length, pendingDrawings: drawings.filter((d) => d.pending > 0).length, configured: configured.length, costed: costed.length, total: keys.length },
  };
}
