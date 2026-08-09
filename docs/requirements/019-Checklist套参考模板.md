# 需求：Checklist 套用参考模板

- **需求编号**：REQ-019
- **标题**：Item / Status·收到内容 / Date received，按服务分组，含编辑按钮
- **所属系统**：Project-Management
- **状态**：已确认
- **创建日期**：2026-08-06
- **优先级**：P1 · 对应 0806 补充(Item4 模板) + 批注4

## 1. 背景
现清单列为 信息项/负责人/截止日期/最后更新/状态，且按写死的 建筑方/ID/Sales 分组；需对齐上传的 Information Checklist 模板。

## 2. 目标
Checklist 按模板出：列 `Item / Status（含收到内容·文件名）/ Date received`，按服务分组（如 Animation & 3D VR / 720、Brochure）；已收到显示「Received…＋文件名」＋日期，未收到 Pending 高亮；整表可编辑（编辑按钮）。

## 3. 范围
**做：** 模板列与分组；已收到显示文件名+日期；Pending 高亮；编辑按钮切换可编辑。配合 REQ-013（自动状态）、REQ-014（分类）。
**不做：** 不与外部网盘自动同步文件。

## 5. 验收标准
- [ ] 清单列与分组与参考模板一致（Item/Status·收到内容/Date received，按服务分组）。
- [ ] 已收到项显示收到说明+文件名+日期；未收到显示 Pending 高亮。
- [ ] 点「编辑」可改条目/状态/日期，保存持久化。

## 7. 备注
参考模板：schedule_and_checklist 第2页。见效果图「信息 Checklist」页。
