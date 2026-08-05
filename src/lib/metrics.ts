/* ===== Post-sales workflow timing & SLA metrics (v2.2 §8) =====
   Derives per-step turnaround time (in Singapore working days) from the
   numeric timestamps written on each workflow block, then an on-time rate
   against the SLA targets below.

   Only turnaround steps (someone owes an action) carry an SLA. Production
   duration is scope-dependent, so it is reported for reference but never
   scored pass/fail.

   SLA_TARGETS — working days allowed per step. These are sensible defaults;
   adjust to your studio's agreed policy. Changing a number here immediately
   re-scores the on-time rate — this is the single source of truth. */
import type { Project } from './types';
import { workingDaysBetween } from './sla';

export const SLA_TARGETS: Record<string, number> = {
  accept: 1,   // PM accepts the handover within 1 working day
  pd: 2,       // PD decides on the completion package within 2
  verify: 2,   // Sales verifies within 2
  invoice: 3,  // Finance issues the invoice within 3
};

const ts = (n?: number): number | null => (typeof n === 'number' && n > 0 ? n : null);
const parseISO = (s?: string): number | null => {
  if (!s) return null;
  const d = new Date(s + 'T00:00:00');
  return isNaN(d.getTime()) ? null : d.getTime();
};

interface StepDef {
  key: string;
  zh: string;
  en: string;
  from: (p: Project) => number | null;
  to: (p: Project) => number | null;
  reached: (p: Project) => boolean;
}

/* ordered pipeline steps; `reached` gates a project into a step's sample set */
const STEPS: StepDef[] = [
  {
    key: 'accept', zh: '交接接单', en: 'Accept handover',
    from: (p) => ts(p.handover?.submittedAt), to: (p) => ts(p.handover?.briefingAt),
    reached: (p) => p.handover?.status === 'accepted',
  },
  {
    key: 'produce', zh: '生产制作(参考)', en: 'Production (ref)',
    from: (p) => ts(p.handover?.briefingAt), to: (p) => ts(p.completionReview?.submittedAt),
    reached: (p) => !!p.completionReview && (p.completionReview.status === 'submitted' || p.completionReview.approval?.status === 'approved'),
  },
  {
    key: 'pd', zh: 'PD 审批', en: 'PD review',
    from: (p) => ts(p.completionReview?.submittedAt), to: (p) => ts(p.completionReview?.approval?.decidedAt),
    reached: (p) => p.completionReview?.approval?.status === 'approved',
  },
  {
    key: 'verify', zh: 'Sales 核对', en: 'Sales verify',
    from: (p) => ts(p.completionReview?.approval?.decidedAt), to: (p) => ts(p.salesVerification?.at),
    reached: (p) => p.salesVerification?.status === 'verified',
  },
  {
    key: 'invoice', zh: '开票', en: 'Invoice issue',
    from: (p) => ts(p.salesVerification?.at), to: (p) => parseISO(p.invoiceClose?.issuedDate),
    reached: (p) => p.invoiceClose?.invoiceStatus === 'issued',
  },
];

export interface StepStat {
  key: string;
  zh: string;
  en: string;
  samples: number;
  avgDays: number | null;   // mean working-day turnaround, null when no samples
  maxDays: number | null;
  target: number | null;    // SLA target (working days); null = reference only
  onTime: number;           // # of samples within target (0 when no SLA)
  onTimeRate: number | null; // onTime / samples, null when no SLA or no samples
}

export interface WorkflowMetrics {
  steps: StepStat[];
  overallSamples: number;   // total SLA-bearing observations
  overallOnTime: number;
  overallRate: number | null;
}

export function workflowMetrics(projects: Project[]): WorkflowMetrics {
  const live = projects.filter((p) => !p.archived);
  const steps: StepStat[] = STEPS.map((s) => {
    const target = SLA_TARGETS[s.key] ?? null;
    const durations: number[] = [];
    let onTime = 0;
    live.forEach((p) => {
      if (!s.reached(p)) return;
      const from = s.from(p);
      const to = s.to(p);
      if (from == null || to == null || to < from) return;
      const d = workingDaysBetween(new Date(from), new Date(to));
      durations.push(d);
      if (target != null && d <= target) onTime++;
    });
    const samples = durations.length;
    const avgDays = samples ? durations.reduce((a, b) => a + b, 0) / samples : null;
    const maxDays = samples ? Math.max(...durations) : null;
    return {
      key: s.key, zh: s.zh, en: s.en, samples, avgDays, maxDays, target, onTime,
      onTimeRate: target != null && samples ? onTime / samples : null,
    };
  });

  let overallSamples = 0;
  let overallOnTime = 0;
  steps.forEach((s) => {
    if (s.target == null) return;
    overallSamples += s.samples;
    overallOnTime += s.onTime;
  });
  return {
    steps,
    overallSamples,
    overallOnTime,
    overallRate: overallSamples ? overallOnTime / overallSamples : null,
  };
}
