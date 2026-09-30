'use client';

/* ===== 05 方案配置(0929 合并)=====
   原来是四个独立菜单:LED / 投影 / 弱电 / 光伏方案配置。一个项目常常跨好几条
   业务线,原结构逼人在四个菜单之间来回跳,还看不到合并总价 —— 现在合成一页,
   业务线做成页内标签。

   每个标签底下渲染的还是原来那四个视图,一行没动:它们都是零参数、自己从
   store 读当前 AV 项目的组件,包一层壳就行。合并的是入口,不是逻辑。 */

import React, { useMemo } from 'react';

import { LINES, projectLines } from '@/av/core/lines';
import { useLang } from '@/lib/i18n';
import { useStore } from '../store';
import AvShell, { type AvTab } from './AvShell';
import { rememberLine } from './AvFlow';
import LedStudioView from './LedStudioView';
import PrjStudioView from './PrjStudioView';
import ElvStudioView from './ElvStudioView';
import PvStudioView from './PvStudioView';

const PANES: Record<string, React.ComponentType> = {
  led: LedStudioView,
  projector: PrjStudioView,
  elv: ElvStudioView,
  pv: PvStudioView,
};

export default function AvConfigView() {
  const { view, setView, projects, ledProjectId } = useStore();
  const { t } = useLang();

  const project = projects.find((p) => p.id === ledProjectId);
  /* 这个项目勾了哪几条线。勾了的可点,没勾的置灰但仍显示 —— 藏掉的话
     没人知道还能加一条线。没选项目时四条都可点(各视图里自己有项目下拉)。 */
  const picked = useMemo(() => {
    if (!project) return LINES.map((l) => l.line);
    return projectLines(project.packages.map((k) => k.svc)).map((l) => l.line);
  }, [project]);

  const tabs: AvTab[] = LINES.map((l) => ({
    key: l.line,
    zh: l.label,
    en: l.en,
    disabled: !picked.includes(l.line),
    hint: t('这个项目没有勾选这条业务线,可在「立项询价」里补勾。',
      'This project has not selected this business line — add it in Inquiry.'),
  }));

  /* 当前标签:view.sub 说了算;它指向一条没勾的线(换了项目)就退回第一条能点的 */
  const first = tabs.find((x) => !x.disabled)?.key || 'led';
  /* AV-017:没指定就落在这个项目上次的业务线 */
  let remembered: string | undefined;
  try { remembered = project ? localStorage.getItem(`audax.avLine.${project.id}`) || undefined : undefined; } catch { /* ignore */ }
  const wanted = view.sub || remembered || 'led';
  const active = tabs.some((x) => x.key === wanted && !x.disabled) ? wanted : first;
  const Pane = PANES[active] || LedStudioView;
  /* 落在哪条线就记下来,下次从步骤条 / 侧栏进 05 还落在这里 */
  React.useEffect(() => { if (project) rememberLine(project.id, active); }, [project, active]);

  return (
    <AvShell
      view="avconfig"
      crumb={t('方案配置', 'Configuration')}
      title={t('方案配置', 'Configuration')}
      subtitle={project
        ? t(`业务线在页内切换,不再是四个独立菜单。当前项目:${project.name}`,
            `Switch business lines in-page instead of four separate menus. Project: ${project.name}`)
        : t('业务线在页内切换,不再是四个独立菜单。未勾选的业务线置灰不可点。',
            'Switch business lines in-page instead of four separate menus. Lines this project did not select are greyed out.')}
      tabs={tabs}
      active={active}
      onTab={(k) => { if (project) rememberLine(project.id, k); setView({ name: 'avconfig', sub: k }); }}
      inFlow
    >
      <Pane />
    </AvShell>
  );
}
