# 需求：Job Record 改为 4 栏全自定义（Service Item / Detail / Quantity / Special Notes）

- **需求编号**：REQ-049
- **所属系统**：Project-Management（项目协作台 · Job Record / 项目档案）
- **状态**：已确认
- **创建日期**：2026-10-12
- **优先级**：P1 · 1009 批次
- **来源**：
  - `Progress comments - 0924.docx`（1009 版）第 7 条「增加的业务形态，需要跟基础需求对应」，附 Sales 报价表截图（Service Item / Detail / Special Notes）；
  - JM 1012 回复：「Job Record 里面信息都需要自定义，只需要保留 A. Service Item B. Detail C. Quantity D. Special Notes」；
  - 原型 v2 →「项目详情 · Job Record」。

## 1. 现状（查代码确认）
- 每种业务的 Job Record 字段来自 `records.ts:98-232` 的 7 个内置登记表（scale / projector / led / vrar / maxhub / av / others），另有 `record-fields` 接口让 PD / BD 覆盖字段。数据存在 `pk.record`（键值对）。
- 不在内置表里的业务（比如无人机）只有空定义，所以档案里只看到一个「Drone Service」文本框（`baseDefOf`，`records.ts:257`）。
- 导出 `JobRecordExport.tsx:29-31` 只导内置表，无人机这类业务**导不出来**。
- 导入接口拒绝非内置业务（`if (!registerDef(svc))`）。

## 2. 功能说明

### 2.1 一张 4 栏表
- Job Record 改为一张表，每行 4 栏：**Service Item / Detail / Quantity / Special Notes**，和 Sales 报价表一致。
- 行按业务分组：组标题显示业务名和份数（如「LED × 2」），每组有「＋ 加一行」。每行可以改、删；每个业务至少保留 1 行。
- **全部自定义，不预设明细**：
  - 加一个业务时，只新增一组 1 行，Service Item 预填业务的英文名（Perspectives / Animation / Scale Model / Drone & 360 IPM / LED Display…），其余留空。
  - Quantity 是文本，可以写「2」「180s」「1 set」「5 spots」。
- **从报价单粘贴**：在表上粘贴 Excel 复制的 4 栏（或 3 栏：Service Item / Detail / Special Notes），按行追加；Service Item 能对上已有业务的就归到那一组。

### 2.2 和登记表 / 其他功能的关系
- 原来各业务登记表字段（`pk.record`）**不删除**，在 Job Record 下方折叠显示为「旧字段（只读）」，供查历史。
- 「项目档案」、登记表页、CSV 导出读的都是这张 4 栏表，所有业务（含无人机等自定义业务）都能导出。
- **登记表导入**：识别 4 栏表头（Service Item / Detail / Quantity / Special Notes，中英都认），去掉「必须是内置业务」的限制。
- **旧数据迁移**：已有 `pk.record` 里有值的字段，每个字段转成一行（Service Item = 业务名，Detail = 字段名，Quantity / Special Notes = 字段值），原数据保留。迁移报告写到 `data/migrations/049-jobrecord-<时间>.md`。

## 3. 验收标准
- [ ] 171-50JHS 能录入：Perspectives / Hero - with surrounding / 2 / at least 5,000 px…，以及 Animation / 3-minutes animation / 180s。
- [ ] 无人机项目新增业务 → 出现 1 行 Drone & 360 IPM，可加到 7 行；导出 CSV 含这些行。
- [ ] 从 Excel 复制报价单的 4 栏粘贴进来 → 按行追加并归到对应业务。
- [ ] 删到最后一行时提示「每个业务至少保留一行」。
- [ ] 旧项目上线后：原字段值都转成了行，下方能看到旧字段（只读）。
- [ ] REQ-043 权限不变；所有新文案中英两套。
