'use client';

/* ===== AV 工作台(0929 新增)=====
   原型的话:「AV 工作台是模块首页,不是又一个菜单项。进来先看到进行中的项目
   和各自卡在哪一步,而不是一堆功能入口。」

   所以这一页不放功能入口 —— 那些在侧栏子菜单里。这里只有两样东西:四个数字
   (各步骤各卡了几个项目),和一张「进行中的 AV 项目」表,每行末尾直接是
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
}

interface Overview {
  projects: Row[];
  counts: { review: number; config: number; quoting: number | null; expiredPrices: number | null };
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

  const live = (data?.projects || []).filter((r) => r.stage !== 'done');

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

      <div className="kpi-grid four" data-testid="av-counts">
        <Num label={t('待图纸校核', 'Awaiting drawing review')} n={data?.counts.review} />
        <Num label={t('待方案配置', 'Awaiting configuration')} n={data?.counts.config} />
        <Num label={t('待报价', 'Awaiting quotation')} n={data?.counts.quoting ?? undefined}
          hidden={!!data && data.counts.quoting == null} />
        <Num label={t('价格已过期物料', 'Expired price items')} n={data?.counts.expiredPrices ?? undefined}
          hidden={!!data && data.counts.expiredPrices == null} warn />
      </div>

      <div className="panel clip">
        <div className="panel-head"><span className="panel-title">{t('进行中的 AV 项目', 'AV projects in flight')}</span></div>

        <div className="av-row av-row-head">
          <span>{t('项目', 'Project')}</span>
          <span>{t('业务线', 'Business lines')}</span>
          <span>{t('阶段', 'Stage')}</span>
          <span>{t('交付', 'Delivery')}</span>
          <span>{t('下一步', 'Next')}</span>
        </div>

        {!data && <div className="av-empty">{t('读取中…', 'Loading…')}</div>}
        {data && live.length === 0 && (
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
              <span>
                <span className="badge" style={{ background: bg, color: fg }}>{lang === 'zh' ? s.zh : s.en}</span>
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

function Num({ label, n, warn, hidden }: { label: string; n?: number; warn?: boolean; hidden?: boolean }) {
  /* 看不到价格的角色(member / viewer)那两格根本不该出现,而不是显示 0 ——
     显示 0 等于告诉他「这里是空的」,其实只是他看不到。 */
  if (hidden) return <div />;
  return (
    <div className="kpi" style={warn ? { borderColor: 'var(--av-accent-line)' } : undefined}>
      <div className="kpi-label" style={warn ? { color: 'var(--av-accent-ink)' } : undefined}>{label}</div>
      <div className="kpi-value tnum" style={warn && n ? { color: 'var(--av-accent-ink)' } : undefined}>
        {n == null ? '—' : n}
      </div>
    </div>
  );
}
