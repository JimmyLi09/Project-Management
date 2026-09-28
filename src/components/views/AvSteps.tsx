'use client';

/* The AV platform's step bar (01 → 07), shown on each AV screen. */

import React from 'react';
import { useLang } from '@/lib/i18n';
import { useStore, type View } from '../store';

type Step = { no: string; zh: string; en: string; view: View['name'] };

const STEPS: Step[] = [
  { no: '01', zh: '立项询价', en: 'Inquiry', view: 'avinquiry' },
  { no: '02–04', zh: '图纸 · 解析 · 校核', en: 'Drawings & review', view: 'ledingest' },
  { no: '05', zh: '方案配置', en: 'Configuration', view: 'ledstudio' },
  { no: '06', zh: '成本核算', en: 'Costing', view: 'avcost' },
  { no: '07', zh: '报价审批', en: 'Quotation', view: 'avquote' },
];

/* 05 is one step with one screen per business line */
const STUDIOS: View['name'][] = ['ledstudio', 'prjstudio', 'elvstudio', 'pvstudio'];

export default function AvSteps() {
  const { view, go } = useStore();
  const { t } = useLang();
  return (
    <nav aria-label={t('AV 方案流程', 'AV workflow')}
      style={{ display: 'flex', gap: 4, flexWrap: 'wrap', background: 'var(--card)', border: '1px solid var(--border)',
        borderRadius: 10, padding: 4, marginBottom: 20 }}>
      {STEPS.map((s) => {
        const on = s.view === view.name || (s.view === 'ledstudio' && STUDIOS.includes(view.name));
        return (
          <button key={s.no} onClick={() => go(s.view)}
            style={{
              flex: '1 1 150px', textAlign: 'left', padding: '8px 12px', borderRadius: 7, border: 0,
              background: on ? 'var(--navy900)' : 'transparent', color: on ? '#fff' : 'var(--text)', cursor: 'pointer', font: 'inherit',
            }}>
            <span className="tnum" style={{ fontSize: 11, fontWeight: 700, opacity: 0.8 }}>{s.no}</span>{' '}
            <span style={{ fontSize: 13, fontWeight: 600 }}>{t(s.zh, s.en)}</span>
          </button>
        );
      })}
      {STUDIOS.includes(view.name) && (
        <span style={{ flexBasis: '100%', display: 'flex', gap: 6, padding: '4px 8px 2px', fontSize: 12, alignItems: 'center' }}>
          <span style={{ color: 'var(--text2)' }}>{t('业务线', 'Line')}</span>
          {([['ledstudio', 'LED 显示屏', 'LED'], ['prjstudio', '投影系统（草案）', 'Projection (draft)'], ['elvstudio', '弱电系统（草案）', 'ELV (draft)'], ['pvstudio', '太阳能光伏（草案）', 'Solar PV (draft)']] as const).map(([v, zh, en]) => (
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
