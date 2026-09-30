import { NextRequest, NextResponse } from 'next/server';
import { compute } from '@/av/core/compute';
import { toHandoff } from '@/av/core/handoff';
import { computeElv, type ElvConfig } from '@/av/core/elv/compute';
import { LATEST_ELV_PACK } from '@/av/core/elv/rulepack';
import type { ElvSummary, LedSummary, PrjSummary, PvSummary } from '@/av/core/pricing';
import { computePrj, type PrjConfig } from '@/av/core/prj/compute';
import { LATEST_PRJ_PACK } from '@/av/core/prj/rulepack';
import { computePv, type PvConfig } from '@/av/core/pv/compute';
import { LATEST_PV_PACK } from '@/av/core/pv/rulepack';
import { LATEST_LED_PACK } from '@/av/core/rulepack';
import type { LedConfig } from '@/av/core/types';
import { canCostProject, identityOf } from '@/lib/permissions';
import { getDrawing, getInquiry, saveConfig } from '@/server/avdb';
import { lineProjectError } from '@/server/avdrawing';
import { appendAudit, getProject } from '@/server/db';
import { currentUser } from '@/server/session';
import { logZh, type LogParams } from '@/lib/logmsg';
import { denyUnlessVisible } from '@/server/avguard';

/* 一条审计记录的 text / k / p 三件套 —— 写日志的地方都是这个形状 */
const auditOf = (k: string, p: LogParams) => ({ text: logZh(k, p), k, p });

/* 05 → project (§10 config_result). POST { projectId, line, cfg, drawingId? }.
   The server recomputes with the core rather than trusting a summary from the
   screen, on the rule pack the project was opened on; for LED a reviewed
   drawing's values override whatever the form sent for those fields. */
export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { projectId?: string; line?: string; drawingId?: number | null; cfg?: unknown };
  const line = body.line === 'projector' || body.line === 'elv' || body.line === 'pv' ? body.line : 'led';
  const project = getProject(String(body.projectId || ''));
  const denied = denyUnlessVisible(user, project);   // REQ-043
  if (denied) return denied;
  const bad = lineProjectError(project, line, { led: ' LED ', projector: '投影', elv: '弱电', pv: '光伏' }[line]);
  if (bad) return NextResponse.json({ error: bad }, { status: 400 });
  if (!canCostProject(identityOf(user), project)) return NextResponse.json({ error: '仅该项目的 PM 可保存方案' }, { status: 403 });
  if (!body.cfg) return NextResponse.json({ error: '缺少方案参数' }, { status: 400 });
  const inquiry = getInquiry(project!.id);

  if (line === 'pv') {
    const cfg = body.cfg as PvConfig;
    const packVersion = inquiry?.packs.pv ?? LATEST_PV_PACK;
    let r;
    try { r = computePv(cfg, packVersion); }
    catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : '方案参数无效' }, { status: 400 }); }
    if (!r.ok) return NextResponse.json({ error: r.findings.filter((f) => f.gate === 'compute' && f.severity === 'block').map((f) => f.message).join(' ') }, { status: 400 });
    const v = (k: string) => r.trace[k].value;
    const saved = saveConfig<PvSummary>({
      projectId: project!.id, line, packVersion, drawingId: null, createdBy: user.name,
      summary: {
        area: cfg.pv_area, mount: cfg.pv_mount, module: cfg.pv_module, modW: r.module.w, nMod: v('n_mod'), kwp: v('kwp'),
        invKw: r.inverter.kw, nInv: v('n_inv'), acKw: v('ac_kw'), nStr: v('n_str'), dcM: v('dc_m'), acM: v('ac_m'),
        nMc4: v('n_mc4'), yieldKwh: v('yield_kwh'),
        exportable: r.exportable, blocking: r.findings.filter((f) => f.severity === 'block').map((f) => f.code),
      },
    }, cfg);
    appendAudit(project!.id, [{
      at: Date.now(), by: user.name,
      ...auditOf('av.cfgPv', { kwp: v('kwp').toFixed(2), mods: v('n_mod'), inv: `${v('n_inv')} × ${r.inverter.kw} kW`, pack: packVersion }),
    }]);
    return NextResponse.json({ config: saved });
  }

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
      ...auditOf('av.cfgElv', { area: cfg.elv_area, ports: v('n_port'), cams: v('n_cam'), spk: v('n_spk'), pack: packVersion }),
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
      ...auditOf('av.cfgPrj', { size: `${cfg.prj_image_w}×${cfg.prj_image_h}`, n: t.n_proj.value, lm: Math.round(t.lm_proj.value), pack: packVersion }),
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
    /* AV-015: the curve comes only from a reviewed picture, never from the form */
    if (drawing.extra?.curve) cfg.led_curve = drawing.extra.curve;
    else delete cfg.led_curve;
    prov = h.prov;
    drawingId = drawing.id;
  }
  if (!drawingId) delete cfg.led_curve;
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
      ...(cfg.led_curve ? { curve: cfg.led_curve } : {}),
    },
  }, cfg);
  appendAudit(project!.id, [{
    at: Date.now(), by: user.name,
    ...auditOf('av.cfgLed', { pitch: cfg.led_pitch, sqm: t.sqm.value.toFixed(2), cabinets: r.layout.cells.length, pack: packVersion }),
  }]);
  return NextResponse.json({ config: saved });
}
