'use client';

/* ===== AV 模块的页壳(0929 改版原型)=====
   原型把 AV 那 10 个侧栏入口收成一个分组 + 6 个子项,页面也合并了。合并之后
   每一页都长成同一个样子:面包屑 → 标题 + 一句说明 → 页内标签 → 正文。这个
   壳把这三段固定下来,各页只管正文。

   .av-mod 里重定义了一套配色变量 —— 原型的底色偏冷、卡片不带阴影、圆角
   10px、主色比站里的古铜更橙。只在 AV 模块内生效(用户 0929 定的),站里
   其余页面一个像素都不动。 */

import React from 'react';
import { useLang } from '@/lib/i18n';
import { useStore, type View } from '../store';

export interface AvTab {
  key: string;
  zh: string;
  en: string;
  /* 置灰但仍显示:这条业务线这个项目没勾。原型要的是「看得见、点不动」,
     而不是干脆藏掉 —— 藏掉就没人知道还能勾。 */
  disabled?: boolean;
  hint?: string;
  count?: number;
}

export default function AvShell({
  view, crumb, title, subtitle, tabs, active, onTab, right, children,
}: {
  view: View['name'];
  crumb: string;
  title: string;
  subtitle?: string;
  tabs?: AvTab[];
  active?: string;
  onTab?: (key: string) => void;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { lang, t } = useLang();
  const { setView } = useStore();

  return (
    <div className="av-mod">
      <nav className="av-crumb" aria-label={t('位置', 'Breadcrumb')}>
        <button onClick={() => setView({ name: 'avhome' })}>{t('AV 方案成本', 'AV Platform')}</button>
        <span aria-hidden="true">›</span>
        <span>{crumb}</span>
      </nav>

      <div className="av-head">
        <div style={{ minWidth: 0 }}>
          <h1>{title}</h1>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {right}
      </div>

      {tabs && tabs.length > 0 && (
        <div className="av-tabs" role="tablist" aria-label={title}>
          {tabs.map((tb) => {
            const on = tb.key === active;
            const label = lang === 'zh' ? tb.zh : tb.en;
            return (
              <button key={tb.key} role="tab" aria-selected={on} disabled={tb.disabled}
                className={`av-tab${on ? ' on' : ''}`}
                title={tb.disabled ? tb.hint : undefined}
                onClick={() => !tb.disabled && onTab && onTab(tb.key)}>
                {label}
                {typeof tb.count === 'number' && <span className="av-tab-n">{tb.count}</span>}
                {tb.disabled && <span className="av-tab-off">{t('未勾选', 'not selected')}</span>}
              </button>
            );
          })}
        </div>
      )}

      <div className="av-body" data-view={view}>{children}</div>
    </div>
  );
}
