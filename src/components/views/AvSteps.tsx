'use client';

/* The AV platform's step bar (01 → 07), shown on each AV screen. 07 报价审批
   is deliberately not built yet (every business line comes first), so it shows
   but does not navigate. */

import React from 'react';
import { useLang } from '@/lib/i18n';
import { useStore, type View } from '../store';

type Step = { no: string; zh: string; en: string; view: View['name'] | null };

const STEPS: Step[] = [
  { no: '01', zh: '立项询价', en: 'Inquiry', view: 'avinquiry' },
  { no: '02–04', zh: '图纸 · 解析 · 校核', en: 'Drawings & review', view: 'ledingest' },
  { no: '05', zh: '方案配置', en: 'Configuration', view: 'ledstudio' },
  { no: '06', zh: '成本核算', en: 'Costing', view: 'avcost' },
  { no: '07', zh: '报价审批', en: 'Quotation', view: null },
];

export default function AvSteps() {
  const { view, go } = useStore();
  const { t } = useLang();
  return (
    <nav aria-label={t('AV 方案流程', 'AV workflow')}
      style={{ display: 'flex', gap: 4, flexWrap: 'wrap', background: 'var(--card)', border: '1px solid var(--border)',
        borderRadius: 10, padding: 4, marginBottom: 20 }}>
      {STEPS.map((s) => {
        /* 05 is one step with one screen per business line */
        const on = s.view === view.name || (s.view === 'ledstudio' && (view.name === 'prjstudio' || view.name === 'elvstudio'));
        const off = s.view === null;
        return (
          <button key={s.no} disabled={off} onClick={() => s.view && go(s.view)}
            title={off ? t('报价审批暂不开放：先完成全部业务线', 'Not open yet') : undefined}
            style={{
              flex: '1 1 150px', textAlign: 'left', padding: '8px 12px', borderRadius: 7, border: 0,
              background: on ? 'var(--navy900)' : 'transparent', color: on ? '#fff' : off ? 'var(--text2)' : 'var(--text)',
              cursor: off ? 'not-allowed' : 'pointer', opacity: off ? 0.55 : 1, font: 'inherit',
            }}>
            <span className="tnum" style={{ fontSize: 11, fontWeight: 700, opacity: 0.8 }}>{s.no}</span>{' '}
            <span style={{ fontSize: 13, fontWeight: 600 }}>{t(s.zh, s.en)}</span>
            {off && <span style={{ fontSize: 10.5, marginLeft: 6 }}>{t('暂不开放', 'not yet')}</span>}
          </button>
        );
      })}
      {(view.name === 'ledstudio' || view.name === 'prjstudio' || view.name === 'elvstudio') && (
        <span style={{ flexBasis: '100%', display: 'flex', gap: 6, padding: '4px 8px 2px', fontSize: 12, alignItems: 'center' }}>
          <span style={{ color: 'var(--text2)' }}>{t('业务线', 'Line')}</span>
          {([['ledstudio', 'LED 显示屏', 'LED'], ['prjstudio', '投影系统（草案）', 'Projection (draft)'], ['elvstudio', '弱电系统（草案）', 'ELV (draft)']] as const).map(([v, zh, en]) => (
            <button key={v} onClick={() => go(v)} style={{ font: 'inherit', fontSize: 12, padding: '3px 10px', borderRadius: 5, border: '1px solid var(--border)',
              background: view.name === v ? 'var(--hover-bg)' : 'transparent', fontWeight: view.name === v ? 700 : 400, cursor: 'pointer', color: 'var(--text)' }}>
              {t(zh, en)}
            </button>
          ))}
        </span>
      )}
    </nav>
  );
}
