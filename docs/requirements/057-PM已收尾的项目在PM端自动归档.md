# 需求：项目进入「开票 / 收尾」后，PM / Engineer 端自动归档（只读），其他角色不变

- **需求编号**：REQ-057
- **所属系统**：Project-Management（项目协作台 · 项目列表 / 总览 / 我的待办）
- **状态**：已确认
- **创建日期**：2026-10-18
- **优先级**：P1
- **来源**：
  - JM 1017：截图是 PM 端的「162-Model Frame for P&T」，已经到「5 开票 / 收尾」、显示已完成，但还在 PM 的列表里。原话：「项目经理端已经收尾的项目，直接归档，在 pm 端不要再显示」。
  - 1017 选定：
    - 进入「5 开票 / 收尾」时触发；
    - 只对 PM / Engineer 隐藏；
    - 在「已归档」里能看，只读。
- **原型**：`docs/requirements/assets/057-PM收尾自动归档_原型_v1.html`，左下角可以切换角色。JM 1018 确认。
- **关联**：REQ-045（已开 Invoice 自动归档）、REQ-043（PM / Engineer 只看自己的项目）、REQ-051（权限表）、REQ-054（售前接洽）。

## 1. 现状（查代码确认）
- 归档只有一个存储字段 `p.archived`：
  - REQ-045 开了 Invoice 后自动设置，原因 `invoiced`；
  - PD / BD 可以手动归档，原因 `manual`。
- 进入「5 开票 / 收尾」由 `projStage(p) === 'invoice'` 算出来：PD 已批准完工 + Sales 已核对，或已开票（`project.ts` 的 `workflowStage`）。从这里到真正开票，中间可能隔好几天到几周。这段时间 PM 已经没事做，但项目仍然出现在：
  - 项目列表（`ProjectsView.tsx` 第 74 行，只看 `p.archived`）；
  - 我的待办和侧栏数字（`lib/myTasks.ts` 第 32 行）；
  - 顶栏逾期提醒（`App.tsx` 第 107 行）；
  - 搜索。
- 已经排除了 complete / invoice 的地方：
  - `OverviewView.tsx` 第 24 行的「我的进行中」；
  - `TeamView.tsx` 第 20 行的团队负载。
  - 这两处不用改。

## 2. 功能说明

### 2.1 规则
- 新增两个判断，放在 `lib/permissions.ts` 或 `lib/project.ts`：

  ```ts
  /* PM 已收尾:进入开票 / 收尾,但还没正式归档 */
  pmClosed(p) = !p.archived && projStage(p) === 'invoice'
  /* 对这个人来说算不算归档 */
  isArchivedFor(p, u) = !!p.archived || (isScopedRole(u) && pmClosed(p))   // isScopedRole = pm / member
  ```

- **不存库，每次计算**：
  - 如果 PD 退回完工、或 Sales 撤回核对，项目离开 invoice 阶段后，自动回到 PM 的列表；
  - 开了 Invoice 后，照 REQ-045 正式归档（`p.archived = true`），对所有人都是归档。
- 不需要上线迁移。上线后，162 这类项目会立刻从 PM 端消失。

### 2.2 PM / Engineer 看到什么
- 以下地方把 `p.archived` 换成 `isArchivedFor(p, me)`：
  - 项目列表默认视图；
  - 「已归档」筛选和计数；
  - 搜索默认结果，以及「另有 N 个已归档项目」的提示；
  - 总览各卡片；
  - 我的待办和侧栏数字（`myTasks.ts`，列表和数字用同一个函数，见 REQ-052）；
  - 顶栏逾期提醒。
- 「已归档」里的行和卡片下面写「**PM 已收尾 · 等开票**」，英文「Closed by PM · awaiting invoice」。已开票的照旧写「已开 Invoice · INV-xxxx」。
- **打开项目是只读的**：
  - 顶部提示条：「已归档（PM 已收尾）：这个项目已进入开票 / 收尾，由 Sales / Finance 跟进。你可以查看，但不能修改排期、清单、Job Record。」
  - 排期、清单、Job Record、项目信息的编辑入口置灰。
  - 导出照常可用。
- **后端同样拒绝**：`canEdit(u, p)` 对 `isScopedRole(u) && pmClosed(p)` 返回 false。
  - `canEditScheduleRow` 等派生判断随之生效，包括 Engineer 改自己负责的排期行那条路径。
  - 直接调用接口改排期 / 清单 / Job Record 时，返回 403「项目已进入开票 / 收尾，PM 端只读」。
- REQ-043 不变：PM / Engineer 在「已归档」里仍然只看到自己的项目。

### 2.3 其他角色：不变
- Sales、Finance、PD / BD、Viewer：照常看到、照常操作，「已开 Invoice」按钮照旧。开票后按 REQ-045 对所有人归档。
- 收款看板、向上汇报、统计报表：口径不变。

### 2.4 KPI / 积分 / 时效统计
- **照算**，和 REQ-045 开票归档一样。`kpi.ts`、`metrics.ts` 继续用 `p.archived` 口径，**不要换成** `isArchivedFor`。PM 已经收尾的项目，正是要算分的项目。

### 2.5 通知
- 这些项目的排期逾期、清单到期等提醒，**不再发给 PM / Engineer**。
- 发给 Sales / Finance 的开票、收款提醒照旧。

## 3. 验收标准
- [ ] 以 JM（PM）登录：
  - 162-Model Frame for P&T 不在项目列表、总览、我的待办、侧栏数字、顶栏提醒里；
  - 在「已归档」里能看到，标「PM 已收尾 · 等开票」；
  - 打开后有只读提示条，编辑入口全部置灰，导出可用。
- [ ] PM 直接调用改排期 / 清单 / Job Record 的接口：返回 403。
- [ ] Engineer（如 Dylan）对自己负责的排期行，在这类项目里也不能改。
- [ ] 以 Sales / Finance / PD 登录：162 照常出现在项目列表，能点「已开 Invoice」。开票后所有人都看不到它（REQ-045）。
- [ ] PD 退回完工（或 Sales 撤回核对）后：162 回到 JM 的项目列表，可以编辑。
- [ ] 087 这类「4 完成 · 待 PD 批准」的项目：PM 端照常显示，不受影响。
- [ ] KPI 看板里 JM 的积分没有因为 162 被隐藏而减少。
- [ ] 我的待办列表行数 = 侧栏数字（REQ-052 口径）。
- [ ] 所有新文案中英两套。

## 4. 落地说明

- **判断**：
  - `pmClosed(p)` 在新文件 `lib/closeout.ts`。
    - 原来 `project.ts` 里的 `workflowStage` 一起挪到这里，`project.ts` 照旧导出。
    - 挪的原因：`permissions.ts` 也要用它，而 `project.ts` 本身 import 了 `permissions.ts`，放在 `project.ts` 里会互相 import。
    - 单元测试拿 `projStage(p) === 'invoice'` 对过 10 种状态：两者完全一致，包括老项目的「已开票」勾。
  - `lib/permissions.ts` 加了两个函数：
    - `pmLocked(u, p)` = `isScopedRole(u) && pmClosed(p)`；
    - `isArchivedFor(p, u)` = `!!p.archived || pmLocked(u, p)`。
  - 每次计算，不存库，不用迁移。
- **只读**：
  - `canEdit` 对 `pmLocked` 返回 false。由它派生的 `canEditIn`、`canMeta`、AV 的 `canUploadDrawing` / `canReviewDrawing` 也一起变成 false。
  - `canRowEdit` 单独加了一道，拦住 Engineer 改自己负责的那一行。
  - 后端有三处拦截，返回 403「项目已进入开票 / 收尾，PM 端只读」：
    - `applyAction` 最前面先拦一道，在各动作自己的检查之前；
    - 从别的项目导入排期 / 清单片段的接口；
    - AV 的写接口（`denyUnlessVisible(…, write)`）。
  - 排期日历（`CalendarPlanner` / `StagePanel`）加了 `readOnly`，只对 `pmLocked` 打开。打开后：
    - 日历上点日期、拖分界点、Reverse plan、Exclude Holidays 都不能用；
    - 不能改名、加删阶段、拖动排序，没有日期框、工期、备注输入（有备注的照样显示）；
    - 没有 Reset / Confirm / 保存，也没有存档面板。
    - 导出 PDF 照常可用。
    - 其他只读角色（Sales、Viewer）维持原样：能在日历上试排，但不能保存。
- **PM / Engineer 看到的**：
  - 以下地方都换成了 `isArchivedFor`：
    - 项目列表的默认视图、「已归档」筛选和计数、搜索提示；
    - 总览（进行中、我的任务、待 Director 决定）；
    - 我的待办和侧栏数字（`myTasks`，两边用同一个函数）；
    - 顶栏逾期提醒。
  - 「已归档」里的项目写「PM 已收尾 · 等开票 / Closed by PM · awaiting invoice」；已开票的照旧写「已开 Invoice · INV-xxxx」。
  - 打开项目时顶部有提示条（`pmclosed-banner`）。原来那条「你对此项目为只读」不再重复显示。
- **不变**：
  - Sales / Finance / PD / BD / Viewer 照常看到、照常操作。
  - KPI（`kpi.ts`）、时效统计（`metrics.ts`）、团队负载、收款看板、向上汇报、统计报表的口径都不变。单元测试确认 `kpi.ts` / `metrics.ts` 里没有用 `isArchivedFor`。
  - REQ-043：PM / Engineer 在「已归档」里仍然只看到自己的项目。
- **项目回到 PM 手上**：
  - 路径是 Sales 发起「需要重审」的 Variation，或者 PD 重新审批。完成包一退回，项目离开开票 / 收尾，就自动回到 PM 的列表、恢复可改，不用另外操作。
- **自测**（1018）：
  - 单元测试新增 6 个。
  - 端到端 e057 共 36 项，按 §3 逐条：
    - 用真实流程造数据：162 / 087、JM / Dylan / Candy / Account / PD；
    - 每个角色各开浏览器看一遍；
    - 直接调接口验 403。
