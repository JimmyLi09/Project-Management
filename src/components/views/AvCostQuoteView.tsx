'use client';

/* ===== 06–07 成本与报价(0929 合并)=====
   原来「AV 成本核算」和「AV 报价审批」是两个菜单。算完成本紧接着就是出报价,
   中间隔一次菜单跳转没有道理 —— 合成一页两个标签,底下渲染的还是原来那两个
   视图,一行没动。

   原型那张图上还有第三个「收款」标签。这里没有做:收款看板是全公司所有项目
   的账,不只 AV,而且它是按 finance 角色开的;塞进 AV 模块里会让 Finance 找
   不到自己那张表。它仍然留在侧栏顶层。 */

import React from 'react';

import { useLang } from '@/lib/i18n';
import { useStore } from '../store';
import AvShell, { type AvTab } from './AvShell';
import AvCostView from './AvCostView';
import AvQuoteView from './AvQuoteView';

export default function AvCostQuoteView() {
  const { view, setView } = useStore();
  const { t } = useLang();

  const tabs: AvTab[] = [
    { key: 'cost', zh: '成本核算', en: 'Costing' },
    { key: 'quote', zh: '报价审批', en: 'Quotation' },
  ];
  const active = tabs.some((x) => x.key === view.sub) ? (view.sub as string) : 'cost';

  return (
    <AvShell
      view="avcostquote"
      crumb={t('成本与报价', 'Cost & quotation')}
      title={t('成本与报价', 'Cost & quotation')}
      subtitle={t('原「成本核算」「报价审批」两个菜单合为一页两个标签。',
        'The former Costing and Quotation menus, now two tabs on one page.')}
      tabs={tabs}
      active={active}
      onTab={(k) => setView({ name: 'avcostquote', sub: k })}
    >
      {active === 'cost' ? <AvCostView /> : <AvQuoteView />}
    </AvShell>
  );
}
