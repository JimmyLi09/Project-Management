'use client';

/* ===== REQ-063:待 Sales 出 revised quotation 的修改轮 =====
   mode = 'sales':Sales 的「我的待办」—— 项目的 Sales(交接是他提交的)或项目没记 Sales 的;
                  超过时限(默认 48 小时)标红,点「已出报价」后消失。
   mode = 'overdue':PD / BD 的总览 —— 全公司超过时限还没出报价的。
   时间按打开页面那一刻算(现算,不存库)。 */
import React, { useMemo, useState } from 'react';
import { useStore } from './store';
import { useLang } from '@/lib/i18n';
import { canQuoteRev } from '@/lib/permissions';
import { dueItems, salesTodo } from '@/lib/revisions';
import { svcName } from '@/lib/templates';
import { pkgSuffix } from '@/lib/project';
import { Ell, Icon } from './ui';

export default function RevQuoteList({ mode }: { mode: 'sales' | 'overdue' }) {
  const { projects, allUsers, kpiRules, me, dispatch, setView, setToast } = useStore();
  const { lang, t } = useLang();
  const [busy, setBusy] = useState('');
  const rules = kpiRules.rev;
  const now = Date.now();
  const items = useMemo(() => {
    const all = dueItems(projects, allUsers, rules, now);
    return mode === 'sales' ? salesTodo(all, me.name) : all.filter((x) => x.overdue);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects, allUsers, rules, mode, me.name]);
  if (!items.length) return null;
  const over = items.filter((x) => x.overdue).length;

  return (
    <div className="panel clip" style={{ marginBottom: 18, borderColor: over ? 'var(--danger)' : '#f0d9a8' }} data-testid={mode === 'sales' ? 'rev-quote-todo' : 'rev-quote-overdue'}>
      <div className="panel-head" style={{ background: over ? '#fdeeee' : '#fbf3e6' }}>
        <span className="panel-title">
          <Icon name="flag" style={{ color: over ? 'var(--danger)' : 'var(--bronze)' }} />
          {mode === 'sales'
            ? t(`修改轮待出 revised quotation(${rules.quoteHours} 小时内)`, `Revision rounds awaiting a revised quotation (within ${rules.quoteHours} h)`)
            : t(`超过 ${rules.quoteHours} 小时还没出报价的修改轮`, `Revision rounds still unquoted after ${rules.quoteHours} h`)}
          <span className="badge" style={{ background: over ? 'var(--danger)' : 'var(--bronze)', color: '#fff', marginLeft: 6 }}>{items.length}</span>
        </span>
      </div>
      {items.slice(0, 12).map((x) => {
        const sfx = pkgSuffix(x.p, x.pi);
        const svc = `${svcName(x.pk.svc, lang)}${sfx ? ` · ${sfx}` : ''}`;
        const hours = x.r.dueAt ? Math.floor((now - x.r.dueAt) / 3600_000) : 0;
        return (
          <div key={x.r.id} data-testid="rev-quote-item" data-overdue={x.overdue ? '1' : '0'} className="row-hover"
            style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 20px', borderTop: '1px solid var(--row-line)', cursor: 'pointer' }}
            onClick={() => setView({ name: 'project', pid: x.p.id, tab: 'revisions', pkg: 0 })}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <Ell style={{ fontSize: 13, fontWeight: 600, color: x.overdue ? 'var(--danger)' : 'var(--navy900)' }}>
                {t(`${x.p.name} · ${svc}第 ${x.round} 轮修改:${rules.quoteHours} 小时内出 revised quotation`, `${x.p.name} · ${svc} revision round ${x.round}: send a revised quotation within ${rules.quoteHours} h`)}
              </Ell>
              <div style={{ fontSize: 11.5, color: x.overdue ? 'var(--danger)' : 'var(--text2)' }}>
                {x.overdue ? t(`已过 ${hours} 小时`, `${hours} h ago — overdue`) : t(`${hours} 小时前标为应收费`, `marked chargeable ${hours} h ago`)}
                {mode === 'overdue' && <> · {x.sales ? `Sales:${x.sales}` : t('项目没记 Sales', 'no Sales on the project')}</>}
              </div>
            </div>
            {canQuoteRev(me, x.p) && (
              <button className="btn-line sm" data-testid="rev-quote-done" disabled={busy === x.r.id}
                onClick={async (e) => {
                  e.stopPropagation();
                  setBusy(x.r.id);
                  const ok = await dispatch(x.p.id, { type: 'setRevFee', pkg: x.pi, id: x.r.id, fee: 'quoted' }, { onError: (m) => setToast(`⚠ ${m}`) });
                  setBusy('');
                  if (ok) setToast(t('已标「已出报价」', 'Marked as quoted'));
                }}>{t('已出报价', 'Quoted')}</button>
            )}
          </div>
        );
      })}
      {items.length > 12 && <div style={{ padding: '10px 20px', fontSize: 12, color: 'var(--text2)', borderTop: '1px solid var(--row-line)' }}>{t(`还有 ${items.length - 12} 条…`, `+${items.length - 12} more…`)}</div>}
    </div>
  );
}
