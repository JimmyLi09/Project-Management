/* ===== AV-019 F11 · 控制与信号源建议(服务端) =====
   设备库 + 01 的回答 + 这次的计算结果 → advise()。05 的建议卡、保存方案时的汇总、
   技术方案「控制与信号源」一节都走这里,结果一致。 */

import { advise, type CtrlAdvice } from '@/av/core/controller';
import type { ComputeResult } from '@/av/core/compute';
import type { LedCtrlSummary } from '@/av/core/pricing';
import { controllerDevices, getInquiry } from './avdb';

export function needOf(r: ComputeResult) {
  return { px: r.trace.px?.value ?? 0, pxW: r.trace.px_w?.value ?? 0, pxH: r.trace.px_h?.value ?? 0, runs: r.wiring?.nDataRun ?? 0 };
}

export function ledAdvice(projectId: string | null, r: ComputeResult): CtrlAdvice | null {
  if (!r.layout || !r.wiring) return null;
  const inq = projectId ? getInquiry(projectId) : null;
  const a = inq?.answers ?? {};
  return advise(controllerDevices(), needOf(r), { use: a.play_use ?? null, pc: a.pc_by ?? null }, r.cfg.led_ctrl_model ?? null);
}

export function ctrlSummary(a: CtrlAdvice): LedCtrlSummary {
  return {
    model: a.primary?.device.model ?? null,
    kind: a.primary?.device.kind ?? null,
    itemId: a.primary?.device.id ?? null,
    needMedia: a.needMedia,
    mediaItemId: a.media?.id ?? null,
    needPc: a.needPc,
    pcItemId: a.pc?.id ?? null,
    pending: a.pending,
    manual: a.manual,
    use: a.use,
  };
}
