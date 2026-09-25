import { NextRequest, NextResponse } from 'next/server';
import { compute } from '@/av/core/compute';
import { toHandoff } from '@/av/core/handoff';
import { computeElv, type ElvConfig } from '@/av/core/elv/compute';
import { LATEST_ELV_PACK } from '@/av/core/elv/rulepack';
import type { ElvSummary, LedSummary, PrjSummary } from '@/av/core/pricing';
import { computePrj, type PrjConfig } from '@/av/core/prj/compute';
import { LATEST_PRJ_PACK } from '@/av/core/prj/rulepack';
import { LATEST_LED_PACK } from '@/av/core/rulepack';
import type { LedConfig } from '@/av/core/types';
import { canCostProject, identityOf } from '@/lib/permissions';
import { getDrawing, getInquiry, saveConfig } from '@/server/avdb';
import { lineProjectError } from '@/server/avdrawing';
import { appendAudit, getProject } from '@/server/db';
import { currentUser } from '@/server/session';

/* 05 → project (§10 config_result). POST { projectId, line, cfg, drawingId? }.
   The server recomputes with the core rather than trusting a summary from the
   screen, on the rule pack the project was opened on; for LED a reviewed
   drawing's values override whatever the form sent for those fields. */
export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { projectId?: string; line?: string; drawingId?: number | null; cfg?: unknown };
  const line = body.line === 'projector' || body.line === 'elv' ? body.line : 'led';
  const project = getProject(String(body.projectId || ''));
  const bad = lineProjectError(project, line, line === 'led' ? ' LED ' : line === 'projector' ? '投影' : '弱电');
  if (bad) return NextResponse.json({ error: bad }, { status: 400 });
  if (!canCostProject(identityOf(user), project)) return NextResponse.json({ error: '仅该项目的 PM 可保存方案' }, { status: 403 });
  if (!body.cfg) return NextResponse.json({ error: '缺少方案参数' }, { status: 400 });
  const inquiry = getInquiry(project!.id);

  if (line === 'elv') {
    const cfg = body.cfg as ElvConfig;
    const packVersion = inquiry?.packs.elv ?? LATEST_ELV_PACK;
    let r;
    try { r = computeElv(cfg, packVersion); }
    catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : '方案参数无效' }, { status: 400 }); }
    if (!r.ok) return NextResponse.json({ error: r.findings.filter((f) => f.gate === 'compute' && f.severity === 'block').map((f) => f.message).join(' ') }, { status: 400 });
    const v = (k: string) => r.trace[k].value;
    const saved = saveConfig<ElvSummary>({
      projectId: project!.id, line, packVersion, drawingId: null, createdBy: user.name,
      summary: {
        area: cfg.elv_area, floors: cfg.elv_floors, space: cfg.elv_space,
        subsystems: (['cctv', 'access', 'net', 'pa'] as const).filter((k) => cfg[`elv_${k}`]),
        nOutlet: v('n_outlet'), nAp: v('n_ap'), nCam: v('n_cam'), nDoor: v('n_door'), nPort: v('n_port'), nSwitch: v('n_switch'),
        poeW: v('poe_w'), nBox: v('n_box'), nPatch: v('n_patch'), nSpk: v('n_spk'), ampW: v('amp_w'), nPaZone: v('n_pa_zone'),
        nvrTb: v('nvr_tb'), nNvr: v('n_nvr'), nRack: v('n_rack'),
        exportable: r.exportable, blocking: r.findings.filter((f) => f.severity === 'block').map((f) => f.code),
      },
    }, cfg);
    appendAudit(project!.id, [{
      at: Date.now(), by: user.name,
      text: `保存弱电方案：${cfg.elv_area} ㎡ · 端口 ${v('n_port')} · 摄像机 ${v('n_cam')} · 扬声器 ${v('n_spk')}（规则包 ${packVersion}）`,
    }]);
    return NextResponse.json({ config: saved });
  }

  if (line === 'projector') {
    const cfg = body.cfg as PrjConfig;
    const packVersion = inquiry?.packs.projector ?? LATEST_PRJ_PACK;
    let r;
    try { r = computePrj(cfg, packVersion); }
    catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : '方案参数无效' }, { status: 400 }); }
    if (!r.ok) return NextResponse.json({ error: r.findings.filter((f) => f.gate === 'compute' && f.severity === 'block').map((f) => f.message).join(' ') }, { status: 400 });
    const t = r.trace;
    const saved = saveConfig<PrjSummary>({
      projectId: project!.id, line, packVersion, drawingId: null, createdBy: user.name,
      summary: {
        width: cfg.prj_image_w, height: cfg.prj_image_h, area: t.area.value, nProj: t.n_proj.value, lmProj: t.lm_proj.value,
        throwRatio: t.throw_ratio.value, pxW: t.px_w.value, pxH: t.px_h.value, kw: t.kw.value, nCircuit: t.n_circuit.value,
        nSignalCable: t.n_signal_cable.value, profile: cfg.prj_profile, content: cfg.prj_content,
        exportable: r.exportable, blocking: r.findings.filter((f) => f.severity === 'block').map((f) => f.code),
      },
    }, cfg);
    appendAudit(project!.id, [{
      at: Date.now(), by: user.name,
      text: `保存投影方案：${cfg.prj_image_w}×${cfg.prj_image_h} mm · ${t.n_proj.value} 台 × ${Math.round(t.lm_proj.value)} lm（规则包 ${packVersion}）`,
    }]);
    return NextResponse.json({ config: saved });
  }

  const packVersion = inquiry?.packs.led ?? LATEST_LED_PACK;
  let cfg = body.cfg as LedConfig;
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
  const saved = saveConfig<LedSummary>({
    projectId: project!.id, line, packVersion, drawingId, createdBy: user.name,
    summary: {
      sqm: t.sqm.value, pitch: cfg.led_pitch, screenType: cfg.led_screen_type, mods: t.mods.value,
      cabinets: r.layout.cells.length, nPowerCable: t.n_power_cable.value, nDataCable: t.n_data_cable.value,
      powerCableSpec: cfg.led_power_cable, exportable: r.exportable,
      blocking: r.findings.filter((f) => f.severity === 'block').map((f) => f.code),
    },
  }, cfg);
  appendAudit(project!.id, [{
    at: Date.now(), by: user.name,
    text: `保存 LED 方案：P${cfg.led_pitch} · ${t.sqm.value.toFixed(2)} ㎡ · 箱体 ${r.layout.cells.length} 只（规则包 ${packVersion}）`,
  }]);
  return NextResponse.json({ config: saved });
}
