'use client';

/* ===== 资料库(0929 合并)=====
   原来「AV 历史案例」和「AV 价格库」是两个菜单。两者都是「查过去的数」——
   配方案时想知道同类项目做成什么样、单价多少,本来就该在一个地方翻。
   合成一页两个标签,底下渲染的还是原来那两个视图,一行没动。

   原型那张图上还画了「规则包」「图块映射表」两个标签。这两块现在没有独立
   界面(规则包写在代码里按版本管理),所以这次没有做 —— 留着空标签点进去
   是一片白,不如不放。 */

import React from 'react';

import { useLang } from '@/lib/i18n';
import { useStore } from '../store';
import AvShell, { type AvTab } from './AvShell';
import AvCasesView from './AvCasesView';
import AvPricesView from './AvPricesView';

export default function AvLibraryView() {
  const { view, setView } = useStore();
  const { t } = useLang();

  const tabs: AvTab[] = [
    { key: 'cases', zh: '历史案例', en: 'Past projects' },
    { key: 'prices', zh: '价格库', en: 'Price library' },
  ];
  const active = tabs.some((x) => x.key === view.sub) ? (view.sub as string) : 'cases';

  return (
    <AvShell
      view="avlibrary"
      crumb={t('资料库', 'Library')}
      title={t('资料库', 'Library')}
      subtitle={t('原「历史案例」「价格库」两个菜单合为一页两个标签。',
        'The former Past projects and Price library menus, now two tabs on one page.')}
      tabs={tabs}
      active={active}
      onTab={(k) => setView({ name: 'avlibrary', sub: k })}
    >
      {active === 'cases' ? <AvCasesView /> : <AvPricesView />}
    </AvShell>
  );
}
