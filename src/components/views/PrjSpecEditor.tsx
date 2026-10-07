'use client';

/* ===== 价格库 · 投影设备规格（AV-020 §3.5） =====
   投影机、镜头、投影配套三类条目在价格库里多一行规格:05 的投影计算按它取
   流明、功耗、镜头投射比和位移、镜头适配哪些机型;06 按「配套」的角色出行。
   PD / BD 改了,下一次计算就跟着变。 */

import React from 'react';

import { PRJ_LENS_CATEGORY, PRJ_PART_CATEGORY, PRJ_PROJECTOR_CATEGORY, type PrjDeviceSpec, type PrjLensSpec, type PrjPartRole, type PrjProjectorSpec } from '@/av/core/prj/library';
import { useLang } from '@/lib/i18n';

export const PRJ_ROLE_LABEL: Record<PrjPartRole, [string, string]> = {
  mount: ['投影支架', 'Mount'], blend: ['融合服务器 / 软件', 'Blending server'], box: ['多屏宝', 'Multi-output box'], pc: ['PC 主机', 'Media PC'],
  cable: ['线材辅材', 'Cables'], radar: ['雷达', 'Radar'], switch: ['交换机', 'Switch'], control: ['中控', 'Control system'],
  install: ['安装调试', 'Installation'], trip: ['出差费', 'Travel'],
};

/* which kind of spec a projection price row carries, from its spec or its category label */
export function prjSpecKind(label: string | undefined, spec: unknown): PrjDeviceSpec['kind'] | null {
  const k = spec && typeof spec === 'object' ? (spec as { kind?: string }).kind : undefined;
  if (k === 'projector' || k === 'lens' || k === 'part') return k;
  const t = (label ?? '').trim();
  if (t === '投影机' || t === PRJ_PROJECTOR_CATEGORY) return 'projector';
  if (t === '镜头' || t === PRJ_LENS_CATEGORY) return 'lens';
  if (t === '投影配套' || t === PRJ_PART_CATEGORY) return 'part';
  return null;
}

export function blankPrjSpec(kind: PrjDeviceSpec['kind']): PrjDeviceSpec {
  if (kind === 'projector') return { kind, code: '', brand: '', lumens: 0, resW: 1920, resH: 1200, watts: null, kg: null, db: null, shiftUp: 0, shiftDown: 0, std: null };
  if (kind === 'lens') return { kind, code: '', nameEn: '', throwMin: 0, throwMax: 0, fits: [] };
  return { kind, role: 'mount' };
}

const pct = (x: number | null | undefined) => (x == null ? '' : String(Math.round(x * 100)));
const lbl: React.CSSProperties = { display: 'inline-flex', gap: 4, alignItems: 'center' };

export function PrjSpecFields({ spec, onChange }: { spec: PrjDeviceSpec; onChange: (s: PrjDeviceSpec) => void }) {
  const { t } = useLang();
  const set = (patch: Partial<PrjProjectorSpec> | Partial<PrjLensSpec>) => onChange({ ...spec, ...patch } as PrjDeviceSpec);
  const num = (v: string) => (v === '' ? null : Number(v));
  const box = (label: string, value: string | number, on: (v: string) => void, w = 70, testid?: string, ph = '') => (
    <label style={lbl}>{label}<input className="in sm" style={{ width: w }} value={value} placeholder={ph} onChange={(e) => on(e.target.value)} data-testid={testid} /></label>
  );
  if (spec.kind === 'part') {
    return (
      <label style={lbl}>{t('06 配置模板里的行', 'Row in the 06 template')}
        <select className="in sm" value={spec.role} onChange={(e) => onChange({ kind: 'part', role: e.target.value as PrjPartRole })} data-testid="prj-spec-role">
          {(Object.keys(PRJ_ROLE_LABEL) as PrjPartRole[]).map((r) => <option key={r} value={r}>{t(PRJ_ROLE_LABEL[r][0], PRJ_ROLE_LABEL[r][1])}</option>)}
        </select>
      </label>
    );
  }
  if (spec.kind === 'lens') {
    return (<>
      {box(t('代码', 'Code'), spec.code, (v) => set({ code: v }), 70, 'prj-spec-code', 'f050')}
      {box(t('英文名', 'English name'), spec.nameEn, (v) => set({ nameEn: v }), 160)}
      {box(t('投射比 最小', 'Throw min'), spec.throwMin || '', (v) => set({ throwMin: Number(v) || 0 }), 60, 'prj-spec-tmin')}
      {box(t('最大', 'max'), spec.throwMax || '', (v) => set({ throwMax: Number(v) || 0 }), 60, 'prj-spec-tmax')}
      {box(t('位移 上 %', 'Shift up %'), pct(spec.shiftUp), (v) => set({ shiftUp: v === '' ? null : Number(v) / 100 }), 50, undefined, t('同机器', 'unit'))}
      {box(t('下 %', 'down %'), pct(spec.shiftDown), (v) => set({ shiftDown: v === '' ? null : Number(v) / 100 }), 50, undefined, t('同机器', 'unit'))}
      {box(t('适配机型代码', 'Fits projector codes'), spec.fits.join(', '), (v) => set({ fits: v.split(/[,，、\s]+/).filter(Boolean) }), 160, 'prj-spec-fits', 'PU800, PU900')}
      <label style={lbl}><input type="checkbox" checked={!!spec.ust} onChange={(e) => set({ ust: e.target.checked || undefined })} />{t('超短焦', 'Ultra-short throw')}</label>
    </>);
  }
  const std = spec.std;
  const setStd = (patch: Partial<NonNullable<PrjProjectorSpec['std']>>) => {
    const next = { name: '', nameEn: '', throwMin: 0, throwMax: 0, ...(std ?? {}), ...patch };
    set({ std: next.throwMin > 0 || next.throwMax > 0 || next.name ? next : null });
  };
  return (<>
    {box(t('代码', 'Code'), spec.code, (v) => set({ code: v }), 80, 'prj-spec-code', 'PU800')}
    {box(t('品牌', 'Brand'), spec.brand, (v) => set({ brand: v }), 70)}
    {box(t('流明', 'Lumens'), spec.lumens || '', (v) => set({ lumens: Number(v) || 0 }), 70, 'prj-spec-lumens')}
    {box(t('分辨率', 'Resolution'), `${spec.resW}×${spec.resH}`, (v) => { const [w, h] = v.split(/[×x*]/).map(Number); set({ resW: w || 1920, resH: h || 1200 }); }, 90)}
    {box(t('功耗 W', 'Power W'), spec.watts ?? '', (v) => set({ watts: num(v) }), 60, 'prj-spec-watts', t('待补', 'tbc'))}
    {box(t('重量 kg', 'kg'), spec.kg ?? '', (v) => set({ kg: num(v) }), 50, undefined, '—')}
    {box(t('噪音 dB', 'dB'), spec.db ?? '', (v) => set({ db: num(v) }), 50, undefined, '—')}
    {box(t('位移 上 %', 'Shift up %'), pct(spec.shiftUp), (v) => set({ shiftUp: (Number(v) || 0) / 100 }), 50)}
    {box(t('下 %', 'down %'), pct(spec.shiftDown), (v) => set({ shiftDown: (Number(v) || 0) / 100 }), 50)}
    <span style={{ ...lbl, flexWrap: 'wrap' }}>{t('标配镜头', 'Standard lens')}
      {box('', std?.name ?? '', (v) => setStd({ name: v }), 120, undefined, t('名称', 'name'))}
      {box(t('投射比', 'throw'), std?.throwMin || '', (v) => setStd({ throwMin: Number(v) || 0 }), 55, 'prj-spec-std-min')}
      {box('–', std?.throwMax || '', (v) => setStd({ throwMax: Number(v) || 0 }), 55, 'prj-spec-std-max')}
      <label style={lbl}><input type="checkbox" checked={!!std?.ust} onChange={(e) => setStd({ ust: e.target.checked || undefined })} />{t('超短焦', 'UST')}</label>
    </span>
  </>);
}

export function prjSpecText(sp: PrjDeviceSpec, t: (zh: string, en: string) => string): string {
  if (sp.kind === 'part') return t(`06 模板：${PRJ_ROLE_LABEL[sp.role][0]}`, `06 template: ${PRJ_ROLE_LABEL[sp.role][1]}`);
  const p = (x: number) => `${Math.round(x * 100)}%`;
  if (sp.kind === 'lens') {
    return [sp.code, t(`投射比 ${sp.throwMin === sp.throwMax ? sp.throwMin : `${sp.throwMin}–${sp.throwMax}`}`, `throw ${sp.throwMin === sp.throwMax ? sp.throwMin : `${sp.throwMin}–${sp.throwMax}`}`),
      ...(sp.shiftUp != null ? [t(`位移 +${p(sp.shiftUp)} / −${p(sp.shiftDown ?? 0)}`, `shift +${p(sp.shiftUp)} / −${p(sp.shiftDown ?? 0)}`)] : []),
      t(`适配 ${sp.fits.join(' / ') || '—'}`, `fits ${sp.fits.join(' / ') || '—'}`)].join(' · ');
  }
  const missing = [sp.watts == null && t('功耗', 'power'), !sp.std && t('镜头', 'lens')].filter(Boolean);
  return [sp.code, `${sp.lumens.toLocaleString('en-US')} lm`, `${sp.resW}×${sp.resH}`, ...(sp.watts != null ? [`${sp.watts} W`] : []),
    t(`位移 +${p(sp.shiftUp)} / −${p(sp.shiftDown)}`, `shift +${p(sp.shiftUp)} / −${p(sp.shiftDown)}`),
    ...(sp.std ? [`${sp.std.name}`] : []), ...(missing.length ? [t(`待补：${missing.join('、')}`, `to add: ${missing.join(', ')}`)] : [])].join(' · ');
}
