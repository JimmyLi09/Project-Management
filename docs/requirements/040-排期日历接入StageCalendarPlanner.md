# 需求：排期日历（接入 stage-calendar-planner）

- **需求编号**：REQ-040
- **标题**：把排期改造成「日历式 Stage Schedule」——接入已提供的 stage-calendar-planner，并接后端
- **所属系统**：Project-Management
- **状态**：已确认（前端实现由用户提供的 stage-calendar-planner 代码为准）
- **创建日期**：2026-09-18
- **优先级**：P1 · 0917 批次

## 1. 背景
Shermin 希望「Schedule 里关于日历的功能，整个跟 link 一样的操作，需要有备注、可以拖动」。用户已经提供了一套现成实现 **stage-calendar-planner**（React + TypeScript + Vite），在月历上排 6 个阶段、拖拽边界微调。本需求是把它接入 Audax 的「排期」页并接后端持久化，而不是重写。

## 2. 目标
用 stage-calendar-planner 作为项目「排期」标签页的实现：月历上排 6 阶段、7 个边界点可拖拽微调、每阶段可备注；排期结果**存回项目数据库**（不再只存浏览器本地），并与交付日 / 冻结点 / 「我的日历」打通。

## 3. 范围
**做：**
- **接入源码**：把用户提供的 `stage-calendar-planner`（见交付物 zip / 单文件 HTML）作为排期功能来源，放入仓库（建议 `src/features/schedule-planner/` 或 `apps/schedule-planner/`），作为项目详情「排期 / Schedule」标签页渲染。**不重写其交互**（日历排期、拖拽边界、悬停预览、自动顺延、inclusive 工期、Exclude Holidays(SG)、Reverse plan、增删阶段、Reset/Confirm、导出 PDF 均沿用）。
- **接后端（关键改造）**：把它现在的「本地状态 + localStorage 存档」改成**读写项目数据**——
  - 打开排期页时，从该项目加载 boundaries（最多 7 个 ISO 本地日期）+ 阶段定义 + 每阶段备注；
  - 「Confirm Schedule」/ 调整后保存时，写回项目（boundaries、阶段名、备注、生效版本）；
  - 「存档 / 读档」升级为项目级命名版本（可选保留 localStorage 作为草稿）。
- **每阶段备注**：阶段行支持备注字段，随排期一起存。
- **打通**：排期的交付日 / 各阶段起止 / 冻结点，同步到项目的交付日与「我的日历」视图；可导出 .ics（单向订阅）。
- **i18n**：界面当前中英混排，纳入 REQ-041 一并补全。

**不做：** 不重写日历交互逻辑（沿用现有代码）；本期不做多人实时协同编辑排期；不做跨项目资源冲突检测。

## 5. 验收标准
- [ ] 项目「排期」页即 stage-calendar-planner：可在月历点选起始日→依次点 6 阶段结束日→7 点选完进入 Adjust，可**拖拽边界**微调，工期/日期实时更新。
- [ ] 每阶段可填**备注**并保存。
- [ ] 排期结果**存回项目数据库**：刷新 / 换设备 / 他人打开同项目都能看到同一排期（不再只在本地）。
- [ ] Exclude Holidays、Reverse plan、增删阶段、Reset/Confirm、导出 PDF 均可用。
- [ ] 排期交付日 / 阶段起止同步到项目交付日与「我的日历」；可导出 .ics。
- [ ] 老项目已有排期数据能平滑迁移 / 兼容显示（迁移方案在 PR 说明）。

## 7. 备注（含默认假设，如需调整请在 PR 指出）
- **源码交付物**：`stage-calendar-planner`（zip）与内联单文件 `Audax_Schedule_日历排期_真实版.html`；域模型见其 `src/domain/schedule.ts`（boundaries → 派生 stage start/end/duration）。
- **数据模型建议**：项目下存 `{ boundaries: LocalDate[], stages: {id,name,note}[], version, updatedAt }`；派生值不入库。
- 默认 **.ics 单向订阅**（把排期推到个人 Google/Outlook）；若要双向同步外部日历，另议。
- Exclude Holidays 默认按新加坡公共假期；如需多地区，另配。
