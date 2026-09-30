'use client';

/* ===== AV 工作台(0929 新增)=====
   原型的话:「AV 工作台是模块首页,不是又一个菜单项。进来先看到进行中的项目
   和各自卡在哪一步,而不是一堆功能入口。」

   所以这一页不放功能入口 —— 那些在侧栏子菜单里。这里只有两样东西:五个数字
   (AV-016:五个阶段各卡了几个项目,点一下只看那一个阶段),和一张「进行中的 AV 项目」表,每行末尾直接是
   「下一步该干什么」的链接,点过去连标签都替你切好。 */

import React, { useCallback, useEffect, useState } from 'react';

import { useLang } from '@/lib/i18n';
import { fmtDate, parseISO } from '@/lib/project';
import { useStore, type View } from '../store';
import { Ell } from '../ui';
import AvShell from './AvShell';

type Stage = 'intake' | 'review' | 'config' | 'costing' | 'quoting' | 'done';

interface Row {
  id: string; name: string; client: string; delivery: string;
  lines: { line: string; label: string; en: string }[];
  stage: Stage; drawings: number; pendingDrawings: number;
  configured: number; costed: number; total: number;
  steps?: Record<'s1' | 's2' | 's5' | 's6' | 's7', { state: string; zh: string; en: string }>;
}

interface Overview {
  projects: Row[];
  counts: { intake: number; review: number; config: number; costing: number | null; quoting: number | null; expiredPrices: number | null };
  money: boolean;
}

/* 每一步:怎么叫、什么颜色、下一步点到哪一页哪个标签 */
const STAGES: Record<Stage, { zh: string; en: string; tone: 'grey' | 'amber' | 'blue' | 'green';
  next: { view: View['name']; sub?: string }; goZh: string; goEn: string }> = {
  intake:  { zh: '立项', en: 'Intake', tone: 'grey',
    next: { view: 'avinquiry' }, goZh: '补充信息', goEn: 'Add details' },
  review:  { zh: '图纸校核', en: 'Drawing review', tone: 'amber',
    next: { view: 'ledingest' }, goZh: '去校核', goEn: 'Review' },
  config:  { zh: '方案配置', en: 'Configuration', tone: 'blue',
    next: { view: 'avconfig' }, goZh: '继续配置', goEn: 'Configure' },
  costing: { zh: '成本核算', en: 'Costing', tone: 'blue',
    next: { view: 'avcostquote', sub: 'cost' }, goZh: '去核算', goEn: 'Cost it' },
  quoting: { zh: '待报价', en: 'Quotation', tone: 'green',
    next: { view: 'avcostquote', sub: 'quote' }, goZh: '去报价', goEn: 'Quote' },
  done:    { zh: '已报价', en: 'Quoted', tone: 'green',
    next: { view: 'avcostquote', sub: 'quote' }, goZh: '查看报价', goEn: 'View quote' },
};

const TONES: Record<string, [string, string]> = {
  grey:  ['#F3F4F6', '#6B7280'],
  amber: ['#FDF3EB', '#B85C1E'],
  blue:  ['#EEF4FA', '#2F6FA8'],
  green: ['#EAF3EE', '#2F7A5B'],
};

export default function AvHomeView() {
  const { setView, setLedProjectId } = useStore();
  const { lang, t } = useLang();
  const [data, setData] = useState<Overview | null>(null);
  const [err, setErr] = useState('');
  /* AV-016 ③:点上面的数字,下面的表只看那一个阶段;再点一下取消 */
  const [only, setOnly] = useState<Stage | null>(null);

  const load = useCallback(async () => {
    const r = await fetch('/api/av/overview').catch(() => null);
    if (!r || !r.ok) { setErr(t('读取 AV 概览失败', 'Could not load the AV overview')); return; }
    setData(await r.json());
  }, [t]);
  useEffect(() => { load(); }, [load]);

  /* 点「下一步」:先把当前 AV 项目设成这一行,再跳过去 —— 四个配置视图和
     成本页读的都是 store 里那个 ledProjectId,不设的话点过去还得再选一次。 */
  const goNext = (r: Row) => {
    const s = STAGES[r.stage];
    setLedProjectId(r.id);
    setView({ name: s.next.view, sub: s.next.sub });
  };

  const live = (data?.projects || []).filter((r) => r.stage !== 'done' && (!only || r.stage === only));

  return (
    <AvShell
      view="avhome"
      crumb={t('AV 工作台', 'Workbench')}
      title={t('AV 工作台', 'AV Workbench')}
      subtitle={t('四条业务线共用一套流程。下面是还没报完价的项目,以及各自卡在哪一步。',
        'Four business lines, one flow. Below: the projects still in flight and where each one is stuck.')}
      right={
        <button className="btn-navy" onClick={() => setView({ name: 'avinquiry' })}>
          ＋ {t('新建询价', 'New inquiry')}
        </button>
      }
    >
      {err && <div className="panel" style={{ padding: '14px 18px', fontSize: 13, color: 'var(--danger)' }}>{err}</div>}

      <div className="kpi-grid five" data-testid="av-counts">
        {([
          ['intake', t('立项中', 'Intake'), data?.counts.intake],
          ['review', t('待图纸校核', 'Awaiting drawing review'), data?.counts.review],
          ['config', t('待方案配置', 'Awaiting configuration'), data?.counts.config],
          ['costing', t('待成本核算', 'Awaiting costing'), data?.counts.costing],
          ['quoting', t('待报价 / 审批', 'Awaiting quotation'), data?.counts.quoting],
        ] as [Stage, string, number | null | undefined][]).map(([k, label, n]) => (
          <Num key={k} label={label} n={n ?? undefined} hidden={!!data && n == null}
            on={only === k} onClick={() => setOnly(only === k ? null : k)} testid={`av-count-${k}`} />
        ))}
      </div>
      {data?.counts.expiredPrices ? (
        <div style={{ fontSize: 12.5, color: 'var(--av-accent-ink)', margin: '-8px 0 14px' }} data-testid="av-expired">
          {t(`价格库里有 ${data.counts.expiredPrices} 条物料价格已过期。`, `${data.counts.expiredPrices} price items have expired.`)}{' '}
          <button style={{ textDecoration: 'underline', color: 'var(--navy700)', fontSize: 12.5 }} onClick={() => setView({ name: 'avlibrary', sub: 'prices' })}>{t('去价格库', 'Open the price library')}</button>
        </div>
      ) : null}

      <div className="panel clip">
        <div className="panel-head">
          <span className="panel-title">{t('进行中的 AV 项目', 'AV projects in flight')}</span>
          {only && <button className="btn-line sm" onClick={() => setOnly(null)} data-testid="av-filter-clear">
            {t(`只看「${STAGES[only].zh}」 ×`, `Only “${STAGES[only].en}” ×`)}</button>}
        </div>

        <div className="av-row av-row-head">
          <span>{t('项目', 'Project')}</span>
          <span>{t('业务线', 'Business lines')}</span>
          <span>{t('阶段', 'Stage')}</span>
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
          return (
            <div key={r.id} className="av-row" data-testid="av-project-row">
              <div style={{ minWidth: 0 }}>
                <Ell style={{ fontSize: 13.5, fontWeight: 500 }}>{r.name}</Ell>
                <Ell style={{ fontSize: 12, color: 'var(--text2)', marginTop: 2 }}>{r.client || '—'}</Ell>
              </div>
              <Ell style={{ fontSize: 13, color: 'var(--text2)' }}>
                {r.lines.map((l) => (lang === 'zh' ? l.label : l.en)).join(' · ') || '—'}
              </Ell>
              <span style={{ display: 'grid', gap: 5, justifyItems: 'start' }}>
                <span className="badge" style={{ background: bg, color: fg }}>{lang === 'zh' ? s.zh : s.en}</span>
                {r.steps && <Progress steps={r.steps} />}
              </span>
              <span className="tnum" style={{ fontSize: 13, color: 'var(--text2)' }}>{d ? fmtDate(d) : '—'}</span>
              <button className="av-next" onClick={() => goNext(r)}>
                {lang === 'zh' ? s.goZh : s.goEn} ›
              </button>
            </div>
          );
        })}
      </div>
    </AvShell>
  );
}

function Num({ label, n, warn, hidden, on, onClick, testid }: {
  label: string; n?: number; warn?: boolean; hidden?: boolean; on?: boolean; onClick?: () => void; testid?: string;
}) {
  /* 看不到价格的角色(member / viewer)那两格根本不该出现,而不是显示 0 ——
     显示 0 等于告诉他「这里是空的」,其实只是他看不到。 */
  if (hidden) return <div />;
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

/* AV-016 ③:01→07 五格进度条,颜色与步骤条一致;悬停看每一步的状态 */
const SEG: [('s1' | 's2' | 's5' | 's6' | 's7'), string][] = [['s1', '01'], ['s2', '02–04'], ['s5', '05'], ['s6', '06'], ['s7', '07']];
const SEG_COLOR: Record<string, string> = {
  done: 'var(--success)', draft: 'var(--warning)', pending: 'var(--warning)', todo: 'var(--row-line)', lock: 'var(--row-line)', na: 'transparent',
};
function Progress({ steps }: { steps: NonNullable<Row['steps']> }) {
  const { lang } = useLang();
  const done = SEG.filter(([k]) => steps[k].state === 'done' || steps[k].state === 'na').length;
  return (
    <span style={{ display: 'flex', gap: 3, alignItems: 'center' }} data-testid="av-progress" aria-label={`${done}/5`}>
      {SEG.map(([k, no]) => (
        <span key={k} title={`${no} · ${lang === 'zh' ? steps[k].zh : steps[k].en}`} data-state={steps[k].state}
          style={{ width: 22, height: 6, borderRadius: 3, background: SEG_COLOR[steps[k].state] ?? 'var(--row-line)',
            border: steps[k].state === 'na' ? '1px dashed var(--row-line)' : undefined }} />
      ))}
      <span className="tnum" style={{ fontSize: 11, color: 'var(--text2)', marginLeft: 4 }}>{done}/5</span>
    </span>
  );
}
