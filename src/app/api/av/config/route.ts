import { NextRequest, NextResponse } from 'next/server';
import { compute } from '@/av/core/compute';
import { toHandoff } from '@/av/core/handoff';
import { LATEST_LED_PACK } from '@/av/core/rulepack';
import type { LedConfig } from '@/av/core/types';
import { canCostProject, identityOf } from '@/lib/permissions';
import { getDrawing, getInquiry, saveConfig } from '@/server/avdb';
import { ledProjectError } from '@/server/avdrawing';
import { appendAudit, getProject } from '@/server/db';
import { currentUser } from '@/server/session';

/* 05 → project (§10 config_result). POST { projectId, drawingId?, cfg }.
   The server recomputes with the core rather than trusting a summary from the
   screen: the rule pack is the one the project was opened on, and a reviewed
   drawing's values override whatever the form sent for those fields. */
export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { projectId?: string; drawingId?: number | null; cfg?: LedConfig };
  const project = getProject(String(body.projectId || ''));
  const bad = ledProjectError(project);
  if (bad) return NextResponse.json({ error: bad }, { status: 400 });
  if (!canCostProject(identityOf(user), project)) return NextResponse.json({ error: '仅该项目的 PM 可保存方案' }, { status: 403 });
  if (!body.cfg) return NextResponse.json({ error: '缺少方案参数' }, { status: 400 });

  const packVersion = getInquiry(project!.id)?.packs.led ?? LATEST_LED_PACK;
  let cfg: LedConfig = body.cfg;
  let prov = {};
  let drawingId: number | null = null;
  if (body.drawingId) {
    const drawing = getDrawing(Number(body.drawingId));
    if (!drawing || drawing.project_id !== project!.id) return NextResponse.json({ error: '图纸不属于该项目' }, { status: 400 });
    if (!drawing.reviewed_at) return NextResponse.json({ error: '图纸尚未通过校核' }, { status: 400 });
    const h = toHandoff(drawing);
    cfg = { ...cfg, ...h.fields };
    prov = h.prov;
    drawingId = drawing.id;
  }

  let r;
  try { r = compute(cfg, packVersion, prov); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : '方案参数无效' }, { status: 400 }); }
  if (!r.layout || !r.wiring) {
    return NextResponse.json({ error: `排布无解，不能保存：${r.findings.filter((f) => f.severity === 'block').map((f) => f.code).join('、')}` }, { status: 400 });
  }
  const t = r.trace;
  const saved = saveConfig({
    projectId: project!.id, packVersion, drawingId, createdBy: user.name,
    summary: {
      sqm: t.sqm.value, pitch: cfg.led_pitch, screenType: cfg.led_screen_type, mods: t.mods.value,
      cabinets: r.layout.cells.length, nPowerCable: t.n_power_cable.value, nDataCable: t.n_data_cable.value,
      powerCableSpec: cfg.led_power_cable, exportable: r.exportable,
      blocking: r.findings.filter((f) => f.severity === 'block').map((f) => f.code),
    },
  }, cfg, 'led');
  appendAudit(project!.id, [{
    at: Date.now(), by: user.name,
    text: `保存 LED 方案：P${cfg.led_pitch} · ${t.sqm.value.toFixed(2)} ㎡ · 箱体 ${r.layout.cells.length} 只（规则包 ${packVersion}）`,
  }]);
  return NextResponse.json({ config: saved });
}
