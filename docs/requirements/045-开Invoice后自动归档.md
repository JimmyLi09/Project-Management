# 需求：开了 Invoice 的项目自动归档，不再出现在 PM 的项目列表

- **需求编号**：REQ-045
- **标题**：「已开 Invoice」（填 Invoice 号 + 开票日期）后项目自动归档
- **所属系统**：Project-Management（项目协作台 · 项目列表 / 开票收尾）
- **状态**：已确认
- **创建日期**：2026-10-01
- **优先级**：P1 · 0924 批次
- **来源**：`Progress comments - 0924.docx` 第 2 条「所有的项目发了 invoice 之后，就直接归档，不要再出现在 PM 的项目列表」，截图：087-7 Margate Road 已到「收尾 · 100% · 已完成」仍在列表。1001 Jimmy 确认：**新增「已开 Invoice」，填号和日期后自动归档**。
- **原型**：`Audax_0924反馈_原型_v1.html` →「② 开 Invoice 自动归档」

## 1. 现状（查代码确认）
- 归档是手动布尔值 `p.archived`，只有 PD / BD 能点「归档」（`actions.ts:1019`，`ProjectDetail.tsx:197`）。**没有任何地方会自动归档**。
- 开票信息已经有：`p.invoiceClose = {invoiceRef, issuedDate, dueDate, invoiceStatus, paymentStatus, financeNote}`，目前只有 Finance 能改（`actions.ts:820-856`）。另有旧的「已开票」开关 `toggleInvoiced`（Sales / PD / BD，`ProjectDetail.tsx:191`）。
- 财务页会**过滤掉已归档项目**（`FinanceView.tsx:46`）——如果开票即归档，财务就看不到待收款的项目了，必须一起改。

## 2. 功能说明

### 2.1 「已开 Invoice」
- 位置：项目详情的阶段 5「开票 / 收尾」区域，按钮「**已开 Invoice**」。
- 谁能点：Finance、Sales、PD / BD（= 现在能改开票信息或点「已开票」的人）。PM / Engineer 看不到这个按钮。
- 点了弹窗，必填：**Invoice 号**、**开票日期**（默认今天）；选填：金额、到期日、备注。
- 写入**现有的** `invoiceClose`（`invoiceRef`、`issuedDate`、`invoiceStatus='issued'`），不另建字段；旧的 `toggleInvoiced` 开关合并到这个流程，不再单独存在。
- 确认后：项目**自动归档**，记录 `archivedAt`、`archivedBy`、`archiveReason='invoiced'`，写操作日志「已开 Invoice INV-xxxx · 自动归档」。

### 2.2 归档后谁看到什么
- **项目列表**（所有角色的默认视图）不再显示；「已归档」筛选里能看到，卡片 / 列表行显示「已开 Invoice · INV-xxxx · 01-Oct」。
- **我的待办、KPI 看板、向上汇报、统计**：已归档项目不再算「进行中」。
- **财务页**：已开票但未收款的项目**照常显示**（不受归档影响），直到「已收款」。
- 搜索：默认不搜已归档；结果底部提示「另有 2 个已归档项目」，点了展开。
- REQ-043 可见性不变：PM / Engineer 在「已归档」里仍只看到自己的项目。

### 2.3 撤回
- 开错了：Finance / Sales / PD / BD 在项目里点「撤回开票」→ 清掉开票状态，若归档原因是 `invoiced` 则自动取消归档，回到项目列表；写日志。
- PD / BD 仍可手动归档 / 取消归档（现有功能不变）。

### 2.4 旧数据（上线时一次性处理）
- `invoiceStatus='issued'` 且有 Invoice 号的项目：自动归档（原因 `invoiced`）。
- 走旧开关「已开票」（`p.invoiced=true`）但**没有 Invoice 号**的项目：不自动归档，列进一张清单交给 PD / BD 补号。在项目列表顶部提示「有 N 个项目已标开票但缺 Invoice 号」，点开可逐个补号，补完即归档。
- 像 087-7 Margate Road 这种「收尾 100%」但没开票的项目：保持不变，等开 Invoice。

## 3. 验收标准
- [ ] 以 Sales / Finance 登录，在阶段 5 点「已开 Invoice」，填号和日期 → 项目从项目列表消失，在「已归档」里可见，并显示 Invoice 号。
- [ ] 不填 Invoice 号无法确认。PM / Engineer 看不到这个按钮，后端也拒绝。
- [ ] 财务页仍显示这个项目，直到标记已收款。
- [ ] 「撤回开票」后项目回到列表。
- [ ] 上线后：已有 Invoice 号的旧项目自动归档；只标了「已开票」没号的项目出现在待补清单。
- [ ] 我的待办 / KPI / 统计不再把已归档项目算作进行中。
- [ ] 所有新文案中英两套。
