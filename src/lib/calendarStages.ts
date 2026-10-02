/* ===== REQ-047 · 排期日历的默认阶段按服务取 =====
   原来日历只有一套固定阶段(CGI 老流程),无人机、沙盘也显示「搭建 3D 建筑模型」。
   现在和经典排期用同一份来源:这个服务当前生效的模板(PD / BD 在模板管理里改过就用改过的)
   的排期步骤 —— 一步一个阶段,阶段名 = 任务名(中 / 英),默认工期 = 模板周数。 */

import type { Template } from './templates';
import { STAGE_TONES, type StageDefinition } from '@/features/schedule-planner/domain/schedule';

export function stagesFromTemplate(svc: string, tpl: Template): StageDefinition[] {
  return tpl.schedule.slice(0, 50).map((row, i) => {
    const name = String(row[2] || row[1] || `阶段 ${i + 1}`).trim().slice(0, 60);
    const en = String(row[3] || '').trim();
    const weeks = Number(row[5]);
    return {
      id: `${svc}-${i}`,
      name,
      ...(en ? { nameEn: en.slice(0, 120) } : {}),
      tone: STAGE_TONES[i % STAGE_TONES.length],
      weeks: Number.isFinite(weeks) && weeks >= 0 ? weeks : 1,
    };
  });
}
