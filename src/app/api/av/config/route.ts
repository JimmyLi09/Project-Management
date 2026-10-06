import { NextRequest, NextResponse } from 'next/server';
import { compute } from '@/av/core/compute';
import { toHandoff } from '@/av/core/handoff';
import { computeElv, type ElvConfig } from '@/av/core/elv/compute';
import { LATEST_ELV_PACK } from '@/av/core/elv/rulepack';
import type { ElvSummary, LedSummary, PrjSummary, PvSummary } from '@/av/core/pricing';
import { computePrj, type PrjConfig } from '@/av/core/prj/compute';
import { computePrjGroups, isGroupsConfig } from '@/av/core/prj/groups';
import { isGroupsPack, LATEST_PRJ_PACK, PRJ_V01_PACK, prjPackUpgradable } from '@/av/core/prj/rulepack';
import { computePv, type PvConfig } from '@/av/core/pv/compute';
import { LATEST_PV_PACK } from '@/av/core/pv/rulepack';
import { LATEST_LED_PACK, ledPackUpgradable } from '@/av/core/rulepack';
import type { LedConfig } from '@/av/core/types';
import { canCostProject, identityOf } from '@/lib/permissions';
import { clearDraft, configCount, draftOwners, getDraft, getDrawing, getInquiry, latestConfig, saveConfig, setInquiryPack } from '@/server/avdb';
import { lineProjectError } from '@/server/avdrawing';
import { appendAudit, getProject } from '@/server/db';
import { currentUser } from '@/server/session';
import { logZh, type LogParams } from '@/lib/logmsg';
import { denyUnlessVisible } from '@/server/avguard';
import { ctrlSummary, ledAdvice } from '@/server/avctrl';

/* 一条审计记录的 text / k / p 三件套 —— 写日志的地方都是这个形状 */
const auditOf = (k: string, p: LogParams) => ({ text: logZh(k, p), k, p });

const lineOf = (v: unknown) => (v === 'projector' || v === 'elv' || v === 'pv' ? v : 'led');

/* AV-017: GET ?project=&line= — 这条线最新的正式版本(含参数)和版本号,05 打开时载入。
   方案参数本身不含价格,看得见项目的人都能读。 */
export async function GET(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  const project = getProject(req.nextUrl.searchParams.get('project') ?? '');
  if (!project) return NextResponse.json({ error: '项目不存在' }, { status: 404 });
  const denied = denyUnlessVisible(user, project);
  if (denied) return denied;
  const line = lineOf(req.nextUrl.searchParams.get('line'));
  const c = latestConfig(project.id, line);
  return NextResponse.json({
    config: c && { id: c.id, drawingId: c.drawingId, packVersion: c.packVersion, cfg: c.cfg, createdBy: c.createdBy, createdAt: c.createdAt },
    version: configCount(project.id, line),
    canSave: canCostProject(identityOf(user), project),
    /* AV-016 ②:自己的草稿(打开时恢复)+ 别人还没存成正式版本的草稿(只提示,不载入) */
    draft: getDraft(project.id, line, user.id),
    others: draftOwners(project.id, line).filter((o) => o.userId !== user.id).map((o) => ({ by: o.updatedBy, at: o.updatedAt })),
  });
}

/* 05 → project (§10 config_result). POST { projectId, line, cfg, drawingId? }.
   The server recomputes with the core rather than trusting a summary from the
   screen, on the rule pack the project was opened on; for LED a reviewed
   drawing's values override whatever the form sent for those fields. */
export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { projectId?: string; line?: string; drawingId?: number | null; cfg?: unknown; upgradePack?: boolean };
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
    clearDraft(project!.id, line, user.id);
  return NextResponse.json({ config: saved, version: configCount(project!.id, line) });
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
    clearDraft(project!.id, line, user.id);
  return NextResponse.json({ config: saved, version: configCount(project!.id, line) });
  }

  if (line === 'projector') {
    /* AV-020: a project opened on prj@0.1-draft stays on it until 05 upgrades it on save;
       an unbound project follows the shape of what was sent */
    const boundPrj = inquiry?.packs.projector ?? null;
    const upgradingPrj = !!body.upgradePack && prjPackUpgradable(boundPrj ?? PRJ_V01_PACK) && isGroupsConfig(body.cfg);
    const prjPack = upgradingPrj ? LATEST_PRJ_PACK : boundPrj ?? (isGroupsConfig(body.cfg) ? LATEST_PRJ_PACK : PRJ_V01_PACK);
    if (isGroupsPack(prjPack)) {
      if (!isGroupsConfig(body.cfg)) return NextResponse.json({ error: `规则包 ${prjPack} 需要按融合组填写的方案` }, { status: 400 });
      const cfg = body.cfg;
      let r;
      try { r = computePrjGroups(cfg, prjPack); }
      catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : '方案参数无效' }, { status: 400 }); }
      if (!r.ok) return NextResponse.json({ error: r.findings.filter((f) => f.gate === 'compute' && f.severity === 'block').map((f) => f.message).join(' ') }, { status: 400 });
      const g0 = r.groups[0];
      const saved = saveConfig<PrjSummary>({
        projectId: project!.id, line, packVersion: prjPack, drawingId: null, createdBy: user.name,
        /* 06 still reads the prj@0.1 summary fields until AV-020 PR3 brings the new device rows */
        summary: {
          width: Math.round(Math.max(...r.groups.map((g) => g.L)) * 1000), height: Math.round(Math.max(...r.groups.map((g) => g.H)) * 1000),
          area: r.groups.reduce((a, g) => a + g.L * g.H, 0), nProj: r.nProj, lmProj: Math.max(...r.groups.map((g) => g.projector.lumens)),
          throwRatio: g0.d / g0.w, pxW: Math.round((g0.projector.resW * g0.L) / g0.w), pxH: Math.round((g0.projector.resH * g0.H) / g0.h),
          kw: r.kw, nCircuit: r.nCircuit, nSignalCable: r.nProj + 1,
          profile: [...new Set(r.groups.map((g) => g.projector.code))].join(' / '), content: cfg.prj_env,
          groups: r.groups.map((g) => ({ name: g.group.name, projector: g.projector.code, lens: g.lens.code, n: g.n, faces: g.group.faces.length })),
          interact: cfg.prj_interact,
          exportable: r.exportable, blocking: r.findings.filter((f) => f.severity === 'block').map((f) => f.code),
        },
      }, cfg);
      if (upgradingPrj && boundPrj) setInquiryPack(project!.id, 'projector', prjPack);
      appendAudit(project!.id, [...(upgradingPrj ? [{
        at: Date.now(), by: user.name, ...auditOf('av.packUpgrade', { line: '投影', from: boundPrj ?? PRJ_V01_PACK, to: prjPack }),
      }] : []), {
        at: Date.now(), by: user.name,
        ...auditOf('av.cfgPrj2', { groups: r.groups.length, n: r.nProj, kw: r.kw.toFixed(2), pack: prjPack }),
      }]);
      clearDraft(project!.id, line, user.id);
      return NextResponse.json({ config: saved, version: configCount(project!.id, line), packVersion: prjPack });
    }
    const cfg = body.cfg as PrjConfig;
    const packVersion = prjPack;
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
    clearDraft(project!.id, line, user.id);
  return NextResponse.json({ config: saved, version: configCount(project!.id, line) });
  }

  /* AV-019:旧项目保持立项时的规则包;用户在 05 点了「升级」才在这次保存时换成最新一版 */
  const boundPack = inquiry?.packs.led ?? LATEST_LED_PACK;
  const upgrading = !!body.upgradePack && ledPackUpgradable(boundPack);
  const packVersion = upgrading ? LATEST_LED_PACK : boundPack;
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
  /* AV-019 §2.3:人工调整有违规只能存草稿;输入变了已失效的调整不再带进新版本(原调整留在历史版本里) */
  if (r.manualBlock) return NextResponse.json({ error: r.manualBlock.zh, manualBlock: r.manualBlock }, { status: 400 });
  if (r.manualStale || (cfg.led_wiring_override && !r.manual)) {
    const { led_wiring_override: _stale, ...rest } = cfg;
    cfg = rest;
  }
  const t = r.trace;
  /* AV-019 F11:按设备库和 01 的回答选好控制器 / 媒体播放器 / 播控电脑,06 据此出设备行 */
  const ctrl = ledAdvice(project!.id, r);
  const saved = saveConfig<LedSummary>({
    projectId: project!.id, line, packVersion, drawingId, createdBy: user.name,
    summary: {
      sqm: t.sqm.value, pitch: cfg.led_pitch, screenType: cfg.led_screen_type, mods: t.mods.value,
      cabinets: r.layout.cells.length, nPowerCable: t.n_power_cable.value, nDataCable: t.n_data_cable.value,
      powerCableSpec: cfg.led_power_cable, exportable: r.exportable,
      ...(ctrl ? { ctrl: ctrlSummary(ctrl) } : {}),
      blocking: r.findings.filter((f) => f.severity === 'block').map((f) => f.code),
      ...(cfg.led_curve ? { curve: cfg.led_curve } : {}),
    },
  }, cfg);
  if (upgrading) setInquiryPack(project!.id, 'led', packVersion);
  appendAudit(project!.id, [...(upgrading ? [{
    at: Date.now(), by: user.name, ...auditOf('av.packUpgrade', { line: 'LED', from: boundPack, to: packVersion }),
  }] : []), {
    at: Date.now(), by: user.name,
    ...auditOf('av.cfgLed', { pitch: cfg.led_pitch, sqm: t.sqm.value.toFixed(2), cabinets: r.layout.cells.length, pack: packVersion }),
  }]);
  clearDraft(project!.id, line, user.id);
  return NextResponse.json({ config: saved, version: configCount(project!.id, line), packVersion });
}
