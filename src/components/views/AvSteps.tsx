'use client';

/* The AV platform's step bar (01 → 07), shown on each AV screen. 06 and 07 —
   cost and quotation — are phase 2 in spec v1.0 §2.2, so they show but do not
   navigate. */

import React from 'react';
import { useLang } from '@/lib/i18n';
import { useStore, type View } from '../store';

type Step = { no: string; zh: string; en: string; view: View['name'] | null };

const STEPS: Step[] = [
  { no: '01', zh: '立项询价', en: 'Inquiry', view: 'avinquiry' },
  { no: '02–04', zh: '图纸 · 解析 · 校核', en: 'Drawings & review', view: 'ledingest' },
  { no: '05', zh: '方案配置', en: 'Configuration', view: 'ledstudio' },
  { no: '06', zh: '成本核算', en: 'Costing', view: null },
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
        const on = s.view === view.name;
        const off = s.view === null;
        return (
          <button key={s.no} disabled={off} onClick={() => s.view && go(s.view)}
            title={off ? t('第二期：价格库、成本核算与报价审批尚未开放', 'Phase 2 — not available yet') : undefined}
            style={{
              flex: '1 1 150px', textAlign: 'left', padding: '8px 12px', borderRadius: 7, border: 0,
              background: on ? 'var(--navy900)' : 'transparent', color: on ? '#fff' : off ? 'var(--text2)' : 'var(--text)',
              cursor: off ? 'not-allowed' : 'pointer', opacity: off ? 0.55 : 1, font: 'inherit',
            }}>
            <span className="tnum" style={{ fontSize: 11, fontWeight: 700, opacity: 0.8 }}>{s.no}</span>{' '}
            <span style={{ fontSize: 13, fontWeight: 600 }}>{t(s.zh, s.en)}</span>
            {off && <span style={{ fontSize: 10.5, marginLeft: 6 }}>{t('第二期', 'phase 2')}</span>}
          </button>
        );
      })}
    </nav>
  );
}
