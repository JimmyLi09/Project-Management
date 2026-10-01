'use client';

/* ===== AV 工作台(0929 新增)=====
   原型的话:「AV 工作台是模块首页,不是又一个菜单项。进来先看到进行中的项目
   和各自卡在哪一步,而不是一堆功能入口。」

   所以这一页不放功能入口 —— 那些在侧栏子菜单里。这里只有两样东西:五个数字
   (AV-016:五个阶段各卡了几个项目,点一下只看那一个阶段),和一张「进行中的 AV 项目」表,每行末尾直接是
   「下一步该干什么」的链接,点过去连标签都替你切好。 */

import React, { useCallback, useEffect, useState } from 'react';

import { useLang } from '@/lib/i18n';
import { logText, type LogLike } from '@/lib/logmsg';
import { fmtDate, parseISO } from '@/lib/project';
import { useStore, type View } from '../store';
import { Ell } from '../ui';
import AvShell from './AvShell';
import { lastLine } from './AvFlow';

type Stage = 'info' | 'upload' | 'failed' | 'review' | 'config' | 'costing' | 'quoting' | 'done';
type StepKey = 's1' | 's2' | 's5' | 's6' | 's7';
type StepS = { state: string; zh: string; en: string };

interface Row {
  id: string; name: string; client: string; delivery: string;
  lines: { line: string; label: string; en: string }[];
  stage: Stage; drawings: number; pendingDrawings: number;
  configured: number; costed: number; total: number;
  steps?: Record<StepKey, StepS>;
  uploaded?: boolean;
  lastUpdate?: (LogLike & { at: number; by: string }) | null;
}

interface Overview {
  projects: Row[];
  counts: { upload: number; review: number; config: number; costing: number | null; quoting: number | null; expiredPrices: number | null };
  money: boolean;
  quotes?: boolean;   // 能不能看报价(PM / 成员 / 只读看不了)
}

/* 每一步:怎么叫、什么颜色、下一步点到哪一页哪个标签 */
const STAGES: Record<Stage, { zh: string; en: string; tone: 'grey' | 'amber' | 'blue' | 'green' | 'red';
  next: { view: View['name']; sub?: string }; goZh: string; goEn: string }> = {
  info:    { zh: '缺立项信息', en: 'Details missing', tone: 'grey',
    next: { view: 'avinquiry' }, goZh: '补充信息', goEn: 'Add details' },
  upload:  { zh: '待上传图纸', en: 'Awaiting drawings', tone: 'grey',
    next: { view: 'ledingest' }, goZh: '上传图纸', goEn: 'Upload drawings' },
  failed:  { zh: '图纸待处理', en: 'Drawing needs attention', tone: 'red',
    next: { view: 'ledingest' }, goZh: '处理失败的图纸', goEn: 'Fix the failed drawing' },
  review:  { zh: '图纸校核', en: 'Drawing review', tone: 'amber',
    next: { view: 'ledingest' }, goZh: '继续校核', goEn: 'Review' },
  config:  { zh: '方案配置', en: 'Configuration', tone: 'blue',
    next: { view: 'avconfig' }, goZh: '继续配置', goEn: 'Configure' },
  costing: { zh: '成本核算', en: 'Costing', tone: 'blue',
    next: { view: 'avcostquote', sub: 'cost' }, goZh: '去核算', goEn: 'Cost it' },
  quoting: { zh: '待报价', en: 'Quotation', tone: 'green',
    next: { view: 'avcostquote', sub: 'quote' }, goZh: '去报价', goEn: 'Quote' },
  done:    { zh: '已报价', en: 'Quoted', tone: 'green',
    next: { view: 'avcostquote', sub: 'quote' }, goZh: '查看报价', goEn: 'View quote' },
};

/* 上面五个数字,各管哪几个阶段 */
type Tile = 'upload' | 'review' | 'config' | 'costing' | 'quoting';
const TILE_STAGES: Record<Tile, Stage[]> = {
  upload: ['upload', 'info'], review: ['review', 'failed'], config: ['config'], costing: ['costing'], quoting: ['quoting'],
};

const TONES: Record<string, [string, string]> = {
  grey:  ['#F3F4F6', '#6B7280'],
  amber: ['#FDF3EB', '#B85C1E'],
  blue:  ['#EEF4FA', '#2F6FA8'],
  green: ['#EAF3EE', '#2F7A5B'],
  red:   ['#FDECEA', '#B42318'],
};

/* 「今天 16:20」「昨天 09:12」「29-Sep」 */
function when(at: number, t: (zh: string, en: string) => string) {
  const d = new Date(at);
  const hm = d.toTimeString().slice(0, 5);
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(new Date()) - day(d)) / 86400000);
  if (diff === 0) return t(`今天 ${hm}`, `Today ${hm}`);
  if (diff === 1) return t(`昨天 ${hm}`, `Yesterday ${hm}`);
  return fmtDate(d).slice(0, 6);
}

export default function AvHomeView() {
  const { setView, setLedProjectId } = useStore();
  const { lang, t } = useLang();
  const [data, setData] = useState<Overview | null>(null);
  const [err, setErr] = useState('');
  /* AV-016 ③:点上面的数字,下面的表只看那一个阶段;再点一下取消 */
  const [only, setOnly] = useState<Tile | null>(null);

  const load = useCallback(async () => {
    const r = await fetch('/api/av/overview').catch(() => null);
    if (!r || !r.ok) { setErr(t('读取 AV 概览失败', 'Could not load the AV overview')); return; }
    setData(await r.json());
  }, [t]);
  useEffect(() => { load(); }, [load]);

  /* 点「下一步」:先把当前 AV 项目设成这一行,再跳过去 —— 四个配置视图和
     成本页读的都是 store 里那个 ledProjectId,不设的话点过去还得再选一次。
     05 落在这个项目上次停下的那条业务线。 */
  /* 看不了报价的人(PM / 成员 / 只读):待报价、已报价的项目「下一步」不能把他带到锁住的报价页 */
  const nextOf = (r: Row) => {
    const s = STAGES[r.stage];
    if ((r.stage === 'quoting' || r.stage === 'done') && data && data.quotes === false) {
      return data.money
        ? { view: 'avcostquote' as View['name'], sub: 'cost', zh: '查看成本', en: 'View costing' }
        : { view: 'avconfig' as View['name'], sub: undefined, zh: '查看方案', en: 'View design' };
    }
    return { view: s.next.view, sub: s.next.sub, zh: s.goZh, en: s.goEn };
  };
  const goNext = (r: Row) => {
    const n = nextOf(r);
    setLedProjectId(r.id);
    const sub = n.view === 'avconfig' ? (lastLine(r.id) || r.lines[0]?.line) : n.sub;
    setView({ name: n.view, sub });
  };

  const live = (data?.projects || []).filter((r) => r.stage !== 'done' && (!only || TILE_STAGES[only].includes(r.stage)));

  return (
    <AvShell
      view="avhome"
      crumb={t('AV 工作台', 'Workbench')}
      title={t('AV 工作台', 'AV Workbench')}
      subtitle={t('四条业务线共用一套流程。下面是还没报完价的项目,以及各自卡在哪一步。',
        'Four business lines, one flow. Below: the projects still in flight and where each one is stuck.')}
      right={
        <button className="btn-navy" onClick={() => setView({ name: 'avinquiry', sub: 'new' })}>
          ＋ {t('新建询价', 'New inquiry')}
        </button>
      }
    >
      {err && <div className="panel" style={{ padding: '14px 18px', fontSize: 13, color: 'var(--danger)' }}>{err}</div>}

      <div className={`kpi-grid${data && !data.money ? ' four' : ' six'}`} data-testid="av-counts">
        {([
          ['upload', t('待上传图纸', 'Awaiting drawings'), data?.counts.upload],
          ['review', t('待图纸校核', 'Awaiting drawing review'), data?.counts.review],
          ['config', t('待方案配置', 'Awaiting configuration'), data?.counts.config],
          ['costing', t('待核算', 'Awaiting costing'), data?.counts.costing],
          ['quoting', t('待报价', 'Awaiting quotation'), data?.counts.quoting],
        ] as [Tile, string, number | null | undefined][]).filter(([, , n]) => !data || n != null).map(([k, label, n]) => (
          <Num key={k} label={label} n={n ?? undefined}
            on={only === k} onClick={() => setOnly(only === k ? null : k)} testid={`av-count-${k}`} />
        ))}
        {/* 0929 的「价格已过期物料」保留:点了去价格库(看不到价格的人没有这一格) */}
        {(!data || data.counts.expiredPrices != null) && (
          <Num label={t('价格已过期物料', 'Expired price items')} n={data?.counts.expiredPrices ?? undefined} warn
            onClick={() => setView({ name: 'avlibrary', sub: 'prices' })} testid="av-expired" />
        )}
      </div>

      <div className="panel clip">
        <div className="panel-head">
          <span className="panel-title">{t('进行中的 AV 项目', 'AV projects in flight')}</span>
          {only && <button className="btn-line sm" onClick={() => setOnly(null)} data-testid="av-filter-clear">
            {t(`只看「${TILE_LABEL[only][0]}」 ×`, `Only “${TILE_LABEL[only][1]}” ×`)}</button>}
        </div>

        <div className="av-row av-row-head">
          <span>{t('项目', 'Project')}</span>
          <span>{t('业务线', 'Business lines')}</span>
          <span>{t('当前步骤 · 进度 01→07', 'Step · progress 01→07')}</span>
          <span>{t('最近更新', 'Last update')}</span>
          <span>{t('交付', 'Delivery')}</span>
          <span>{t('下一步', 'Next')}</span>
        </div>

        {!data && <div className="av-empty">{t('读取中…', 'Loading…')}</div>}
        {data && live.length === 0 && only && (
          <div className="av-empty">{t('这个阶段现在没有项目。', 'No project is at this stage right now.')}</div>
        )}
        {data && live.length === 0 && !only && (
          <div className="av-empty">{t('暂无进行中的 AV 项目。点右上角「新建询价」开一个。',
            'No AV projects in flight. Use “New inquiry” to open one.')}</div>
        )}

        {live.map((r) => {
          const s = STAGES[r.stage];
          const [bg, fg] = TONES[s.tone];
          const d = parseISO(r.delivery);
          const u = r.lastUpdate;
          const upd = u ? `${when(u.at, t)} · ${u.by} · ${logText(u, lang)}` : '';
          return (
            <div key={r.id} className="av-row" data-testid="av-project-row" data-stage={r.stage}>
              <div style={{ minWidth: 0 }}>
                <Ell style={{ fontSize: 13.5, fontWeight: 500 }}>{r.name}</Ell>
                <Ell style={{ fontSize: 12, color: 'var(--text2)', marginTop: 2 }}>{r.client || '—'}</Ell>
              </div>
              <Ell style={{ fontSize: 13, color: 'var(--text2)' }}>
                {r.lines.map((l) => (lang === 'zh' ? l.label : l.en)).join(' · ') || '—'}
              </Ell>
              <span style={{ display: 'grid', gap: 5, justifyItems: 'start' }}>
                <span className="badge" style={{ background: bg, color: fg }} data-testid="av-stage">{lang === 'zh' ? s.zh : s.en}</span>
                {r.steps && <Progress steps={r.steps} uploaded={!!r.uploaded} />}
              </span>
              <span data-testid="av-last-update" style={{ minWidth: 0 }}><Ell full={upd} style={{ fontSize: 12.5, color: 'var(--text2)' }}>{upd || '—'}</Ell></span>
              <span className="tnum" style={{ fontSize: 13, color: 'var(--text2)' }}>{d ? fmtDate(d) : '—'}</span>
              <button className="av-next" onClick={() => goNext(r)} data-testid="av-next">
                {lang === 'zh' ? nextOf(r).zh : nextOf(r).en} ›
              </button>
            </div>
          );
        })}
      </div>
    </AvShell>
  );
}

/* 看不到价格的角色(member / viewer)核算、报价、过期物料那几格根本不出现,而不是显示 0 ——
   显示 0 等于告诉他「这里是空的」,其实只是他看不到。 */
function Num({ label, n, warn, on, onClick, testid }: {
  label: string; n?: number; warn?: boolean; on?: boolean; onClick?: () => void; testid?: string;
}) {
  return (
    <button className="kpi" onClick={onClick} data-testid={testid} aria-pressed={on}
      style={{ textAlign: 'left', cursor: onClick ? 'pointer' : 'default', font: 'inherit',
        ...(on ? { outline: '2px solid var(--navy700)' } : {}), ...(warn ? { borderColor: 'var(--av-accent-line)' } : {}) }}>
      <div className="kpi-label" style={warn ? { color: 'var(--av-accent-ink)' } : undefined}>{label}</div>
      <div className="kpi-value tnum" style={warn && n ? { color: 'var(--av-accent-ink)' } : undefined}>
        {n == null ? '—' : n}
      </div>
    </button>
  );
}

const TILE_LABEL: Record<Tile, [string, string]> = {
  upload: ['待上传图纸', 'Awaiting drawings'], review: ['待图纸校核', 'Awaiting drawing review'],
  config: ['待方案配置', 'Awaiting configuration'], costing: ['待核算', 'Awaiting costing'], quoting: ['待报价', 'Awaiting quotation'],
};

/* AV-016 ③:01 立项 → 02 上传 → 03–04 校核 → 05 配置 → 06 成本 → 07 报价,六格。
   已完成绿色、当前这一格橙色、后面灰色;悬停看每一步的状态(和步骤条同一份)。 */
type Seg = { no: string; zh: string; en: string; s: StepS };
function Progress({ steps, uploaded }: { steps: NonNullable<Row['steps']>; uploaded: boolean }) {
  const { lang } = useLang();
  const noLed = steps.s2.state === 'na';
  const segs: Seg[] = [
    { no: '01', zh: '立项', en: 'Inquiry', s: steps.s1 },
    { no: '02', zh: '上传图纸', en: 'Upload', s: noLed ? steps.s2 : uploaded ? { state: 'done', zh: '已上传', en: 'Uploaded' } : { state: 'todo', zh: '待上传', en: 'To upload' } },
    { no: '03–04', zh: '校核', en: 'Review', s: noLed || uploaded ? steps.s2 : { state: 'todo', zh: '待做', en: 'To do' } },
    { no: '05', zh: '方案配置', en: 'Configuration', s: steps.s5 },
    { no: '06', zh: '成本', en: 'Costing', s: steps.s6 },
    { no: '07', zh: '报价', en: 'Quotation', s: steps.s7 },
  ];
  const ok = (x: Seg) => x.s.state === 'done' || x.s.state === 'na';
  const cur = segs.findIndex((x) => !ok(x));
  const done = segs.filter(ok).length;
  const color = (x: Seg, i: number) =>
    ok(x) ? (x.s.state === 'na' ? 'transparent' : 'var(--success)')
      : i === cur || x.s.state === 'draft' || x.s.state === 'pending' ? 'var(--warning)' : 'var(--row-line)';
  const tip = segs.map((x, i) => `${ok(x) ? '✓' : i === cur ? '▶' : '·'} ${x.no} ${lang === 'zh' ? x.zh : x.en} · ${lang === 'zh' ? x.s.zh : x.s.en}`).join('\n');
  return (
    <span style={{ display: 'flex', gap: 3, alignItems: 'center' }} data-testid="av-progress" title={tip} aria-label={`${done}/6`}>
      {segs.map((x, i) => (
        <span key={x.no} data-state={ok(x) ? 'done' : i === cur ? 'cur' : x.s.state}
          style={{ width: 18, height: 6, borderRadius: 3, background: color(x, i),
            border: x.s.state === 'na' ? '1px dashed var(--row-line)' : undefined }} />
      ))}
      <span className="tnum" style={{ fontSize: 11, color: 'var(--text2)', marginLeft: 4 }}>{done}/6</span>
    </span>
  );
}
