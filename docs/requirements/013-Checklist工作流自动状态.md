# 需求：Checklist 工作流 — 空白可导出 + 收到自动改状态

- **需求编号**：REQ-013
- **标题**：空白项保持 Pending 正常导出；填入文件名自动 Received + 当天日期
- **所属系统**：Project-Management
- **状态**：已确认
- **创建日期**：2026-08-06
- **优先级**：P1 · 对应 0806 建议 #5 #5.1

## 1. 背景
清单用于追踪未收资料，很多项目一开始整列空白。现只有填了 Remarks 的项才进导出，于是要先随便填字、导出前再删——很绕。

## 2. 目标
空白项也正常导出并保持 Pending；在项内填入「收到内容/文件名」时自动把 Status 由 Pending→Received、Date Received 填当天；仅填 Remarks 不自动改 Received；Status/Date 仍可手动改。

## 3. 范围
**做：** 空白项导出（Pending）；填文件名触发自动 Received + 当天日期；Remarks 不触发；手动可覆盖。
**不做：** 不自动识别文件真伪。

## 5. 验收标准
- [ ] 空白项出现在导出文件中，状态 Pending。
- [ ] 在「收到内容」填入文件名 → 状态自动变 Received，Date Received 自动为当天。
- [ ] 只填 Remarks → 状态不变。
- [ ] 手动修改 Status/Date 后以手动值为准。

## 7. 备注
见效果图「信息 Checklist」页。
