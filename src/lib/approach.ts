/* ===== REQ-054 售前接洽(Approach)=====
   AV「立项询价」建的是售前记录:没有项目编号,只在「售前接洽」列表、AV 工作台、全局搜索、通讯录里出现;
   总览、我的待办、团队负载、统计 / KPI / 积分、收款、向上汇报、项目档案都不算它。
   客户确认后 Sales / PD / BD「转为正式项目」才拿编号(新建),或者并入一个已有的正式项目。
   和算出来的阶段「售前」(projStage = presales:正式项目还没指派负责人)是两回事 —— 那种有编号,是正式项目。
   各处统一用这里的函数分开,口径一致。 */

import type { ApproachStatus, Project } from './types';

type WithApproach = Pick<Project, 'approach'>;

/* 售前记录 = 有 approach 且没转成正式项目(open / lost / merged) */
export const isApproach = (p: WithApproach): boolean => !!p.approach && p.approach.status !== 'converted';
/* 还开着的售前记录(在「售前接洽」列表) */
export const isOpenApproach = (p: WithApproach): boolean => p.approach?.status === 'open';
/* 已关闭(未成交 / 已并入):只读 */
export const isClosedApproach = (p: WithApproach): boolean => p.approach?.status === 'lost' || p.approach?.status === 'merged';

/* 正式项目:各处列表、统计的入口 */
export const formalProjects = <T extends WithApproach>(list: T[]): T[] => list.filter((p) => !isApproach(p));
/* 售前记录;status 不给 = 全部(open / lost / merged) */
export const approachProjects = <T extends WithApproach>(list: T[], status?: ApproachStatus | ApproachStatus[]): T[] => {
  const want = status ? (Array.isArray(status) ? status : [status]) : null;
  return list.filter((p) => isApproach(p) && (!want || want.includes(p.approach!.status)));
};

/* 编号位置的标签:「售前」/ Approach(灰色) */
export const APPROACH_BADGE = { background: '#EEF0F3', color: '#5B6472', fontWeight: 700, marginRight: 6, fontSize: 11 } as const;
export const APPROACH_TAG: [string, string] = ['售前', 'Approach'];
export const approachTag = (lang: 'zh' | 'en') => (lang === 'zh' ? APPROACH_TAG[0] : APPROACH_TAG[1]);

/* 售前记录上不能做的事(后端 applyAction 也拦):指派 PM、交接、开 Invoice */
export const APPROACH_BLOCK_MSG = '售前记录请先转为正式项目 / Convert this approach to a formal project first';
export const APPROACH_CLOSED_MSG = '这条售前记录已关闭(未成交 / 已并入),只读 / This approach is closed (lost / merged) and read-only';
