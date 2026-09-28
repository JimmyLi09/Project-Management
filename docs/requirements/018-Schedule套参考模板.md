# 需求：Schedule 套用参考模板

- **需求编号**：REQ-018
- **标题**：按服务分组的生产排期（#/Phase/Duration + 日期 + 小计/Sum + 可编辑）
- **所属系统**：Project-Management
- **状态**：已确认
- **创建日期**：2026-08-06
- **优先级**：P1 · 对应 0806 补充(Item4 模板) + 批注1/2/3/4

## 1. 背景
现排期为阶段编辑器，未对齐客户参考模板。需按上传的两个参考模板出 Schedule。

## 2. 目标
Schedule 支持两种模板样式：
- **按服务分组（周）**：Animation / 3D VR / Brochure 等，每组表头 `# / Phase / Task / 日期(Start–End) / Duration`，每组底部「小计 Subtotal」，全表底部「Sum 合计 Overall duration」；去掉右侧周数括号。
- **按日期（Scale Model）**：`Date Range / Task / Duration`，含红色卡点行（资料需在 X 日前提供）、CNY HOLIDAY 行、右侧阶段分组（Production/Delivery/Handover）。
排期列成清单、每任务带日期且同步到「交付日历」；整表可编辑（编辑按钮切换），日期/时长/任务可改。

## 3. 范围
**做：** 两种模板样式；日期列；小计+底部 Sum；编辑按钮切换只读/可编辑；日期同步交付日历；底部 Note。
**不做：** 不做甘特第三方库。

## 5. 验收标准
- [ ] 可切换「按服务分组」与「按日期」两种模板样式，样式与参考模板一致。
- [ ] 每任务显示日期(Start–End)，改后同步交付日历。
- [ ] 每服务底部有小计，全表底部有 Sum 合计；不再显示右侧周括号。
- [ ] 点「编辑」整表可改，保存后回只读。

## 7. 备注
参考模板：schedule template（Scale Model）与 065-Carmen（多服务）。见效果图「Schedule」页。
