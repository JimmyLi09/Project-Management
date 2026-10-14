# 需求：清单导出加「Owner」开关 + Excel 导出和预览格式一致（.xlsx）

- **需求编号**：REQ-055
- **所属系统**：Project-Management（项目协作台 · 导出 / 打印）
- **状态**：已确认
- **创建日期**：2026-10-14
- **优先级**：P2
- **来源**：
  - JM 1014，附截图：173-Elite Park Avenue 的清单导出预览和导出的 CSV。原话：「1. checklist 需要勾选的部分，需要增加 Owner 这一栏的开关。2. export 出来的 excel file，需要跟 preview 的 format 统一。」
  - 1014 选定：
    - 换成 .xlsx，去掉 CSV；
    - 选了「Schedule + Checklist」时，排期放在第二个工作表；
    - 勾了「Company notes」就在 Excel 里带上。
  - 格式样板：`173-Elite Park Avenue_Checklist_Scale Model_格式样板.xlsx`，和本文档一起交付。
- **关联**：
  - REQ-013（含空白项）、REQ-014（无分类模式）、REQ-015（导出内容 / 顺序）、REQ-019（清单栏位）、REQ-021（封面）；
  - REQ-044 / REQ-050（导出可选业务、按格导出）。

## 1. 现状（查代码确认，`src/components/views/ExportOverlay.tsx`）
- **清单栏位开关**：只有 状态 / 日期 / 备注 / 适用服务 / 含空白项，在第 437-442 行左右。
- **负责人栏没有开关**：`ClBlock` 里写死 `showOwner = !flat`（约第 320 行），有分类时永远显示，无分类时永远不显示。
- **「Checklist as Excel (CSV)」**（`downloadClCsv`，约第 306-316 行）导出的是一张平铺的 CSV：
  - 8 列写死：Section / Item / Applies to / Owner / Status / Received / Date received / Remark；
  - **不跟栏位开关走**；
  - 没有标题、客户行、分组标题，也没有格式；
  - Excel 打开时还会提示「可能丢失格式」。
- **预览 / PDF 的格式**：
  - 标题「050 · 173-Elite Park Avenue — Checklist」；
  - 客户 / 业务 / 阶段一行；
  - 「Information Checklist」小标题；
  - 每个分组：灰色分组标题行 + 栏位表头 + 各项；
  - 「Status / Received」合成一栏，Pending 底色为浅黄；
  - 空值显示「—」；
  - 勾了的话，最后是公司说明。

## 2. 功能说明

### 2.1 清单栏位加「Owner 负责人」开关
- 清单的栏位开关里加「负责人 / Owner」。位置在「状态」前面，和预览里的列顺序一致。
- 默认值：
  - 有分类：勾上（和现在一样）；
  - 无分类（`p.noCategories`）：不勾（和现在一样）。
- 预览、打印 / PDF、Excel 都按这个开关显示或隐藏负责人栏。
- 实现：`Cols` 加 `clOwner`，`showOwner` 改成读它，`clSpan` 同步。

### 2.2 Excel 导出改成 .xlsx，格式和预览一致
- 按钮改名为「清单下载 Excel / Checklist as Excel」，文件名 `${fileBase}.xlsx`，例如 `173-Elite Park Avenue_Checklist_Scale Model.xlsx`。
- **CSV 按钮去掉**。`downloadClCsv` 删除，`csvCell` 其他地方还在用就保留。
- **内容和预览完全一致**：
  - 预览里看到什么，Excel 里就是什么。行、栏、顺序、文字都一样；
  - 所有开关照样生效：业务 / 实例选择、栏位、含空白项、中文 / English、无分类模式。
- **建议实现**：Excel 和预览用同一份数据。清单用 `clRows()`，排期用和 `SchedBlock` 相同的数据，不要再单独拼一套，避免两边又不一致。

**工作表 1：清单（`Checklist` / `清单`）**

| 行 | 内容 | 格式 |
|---|---|---|
| 1 | 标题：`050 · 173-Elite Park Avenue — Checklist`（跟语言） | 16 号粗体，合并到最后一栏 |
| 2 | 客户 · 业务 · 阶段（同预览那一行） | 10 号灰字 |
| 3 | 空行 | — |
| 4 | 「Information Checklist」（选了部分业务时，后面带业务名，同预览） | 12 号粗体；单一业务时用该业务的颜色，否则深色；下边框粗线 |
| 每组 | 分组标题行（如 Site / Marketing / Requirements） | 浅灰底 `#F1EEE8`，粗体，合并到最后一栏，细边框 |
| 每组 | 栏位表头：Item ·（Applies to）·（Owner）·（Status / Received）·（Date received）·（Remark） | 浅底 `#FAF8F4`，粗体，细边框 |
| 每组 | 各项 | 细边框；自动换行；顶端对齐；空值写「—」 |
| 组间 | 空一行 | — |
| 最后 | 公司说明（勾了「Company notes」且有内容时）：小标题 + 原文 | 同预览 |

- 列说明：
  - **Status / Received** 一栏，写法和预览一样：`Pending`，或 `Received — 收到内容`。
  - 状态是 Pending（未收到）的格子用浅黄底 `#FFFBEB`，和预览一致。
  - **列宽**：Item 约 58，Owner 约 16，Status / Received 约 26，Date 约 14，Remark 约 30。没显示的栏不占位。
- 无分类模式：没有分组标题行，只有一个表头加所有项，和预览一致。
- 勾了「Cover page」封面时：在第 1 行标题上面加一小块封面信息（编号 / 名称 / 客户 / PM / 日期，同预览封面），下面空一行再接清单。
- **打印设置**：
  - A4，方向跟预览的纵向 / 横向按钮；
  - 宽度缩放到一页、高度不限；
  - 标题两行每页重复；
  - 不显示网格线；
  - 字体统一 Arial（中文由 Excel 自动回落）。

**工作表 2：排期（`Schedule` / `排期`）——只在内容选「Schedule + Checklist」时才有**
- 和预览里的排期块一致：
  - 标题、客户行；
  - 每个所选服务包一段：业务名小标题（业务颜色）+ 表格；
  - 表格栏位跟排期开关走：阶段 / 任务、负责、开始、到期、状态；
  - 周数模式下显示周数和「小计 Subtotal」；
  - 有「服务内容 / 交付清单」时，后面跟着那张小表。
- 「清单在前 / 排期在前」只影响 PDF 的顺序。Excel 固定为清单在第一张、排期在第二张。
- 内容选「Schedule only」时，按钮仍然是「下载 Excel」，只出排期一张表。

### 2.3 技术说明
- 浏览器端用 **exceljs** 生成（社区版 SheetJS 写不了样式）。
  - 只在点按钮时动态 `import('exceljs')`，不增加首屏体积。
  - 如果 exceljs 体积太大，可以改为服务端生成。功能要求不变。
- 文本一律按字符串写入，不会被 Excel 当成公式。原来 CSV 防公式（`= + - @` 开头）的问题，在 xlsx 里不存在，但要用测试确认，例如电话「+65 …」、备注「- …」。
- 日期按显示格式写成文本（和预览一致），不转成 Excel 日期。

## 3. 验收标准
- [ ] 173-Elite Park Avenue，只勾 Scale Model、只出清单，栏位勾 Owner / Status / Remark（不勾 Date）：
  - 预览、PDF、Excel 三者内容一致；
  - Excel 和格式样板一样：标题、客户行、3 个分组各自带灰色标题和表头、Pending 浅黄、空值「—」、没有 Date 栏。
- [ ] 取消勾「Owner」：预览、PDF、Excel 都没有负责人栏，分组标题合并宽度跟着变。
- [ ] 无分类项目：Owner 默认不勾；勾上后三处都显示。
- [ ] 不勾「含空白项」：三处都不出空白的 Pending 项。
- [ ] 切换「中文」后导出：标题、表头、状态、分组名都是中文，工作表名「清单」。
- [ ] 内容选「Schedule + Checklist」：Excel 有两张表，排期表的栏位和预览一致（勾 / 不勾 Start、Due 试一次）。
- [ ] 勾 Company notes：清单表最后有公司说明；不勾就没有。
- [ ] 多业务项目（如 171-50JHS），只勾 CGI + Animation：Excel 只有这两个业务的项，「Applies to」栏同预览，文件名带 `CGI+Animation`。
- [ ] Excel 打开时不再出现「可能丢失格式」的提示；在 Excel 里打印预览是 A4、一页宽。
- [ ] 备注是「- 待定」、电话是「+65 9123 4567」的项，Excel 里原样显示为文字。
- [ ] 所有新文案中英两套；REQ-043 权限不变。

## 4. 落地说明

- **Owner 开关**：
  - `Cols` 加 `clOwner`，初值 `!p.noCategories`（有分类勾、无分类不勾，和原来一样）。
  - 栏位开关里排在「状态」前面：负责人 / 状态 / 日期 / 备注 /（适用服务）/ 含空白项。
  - 清单表头由 `clTable()` 按开关生成，分组标题的合并宽度（原来的 `clSpan`）就是表头栏数，自动同步。
- **预览、PDF、Excel 共用一份表**（`ExportOverlay.tsx`）：
  - `clTable()`：数据来自 `clRows()`，产出表头 + 每组的行（每格的文字、Pending 浅黄、备注保留换行）。预览的 `ClBlock` 和 Excel 都画它。
  - `schedTable(pkg)`：原来 `SchedBlock` 里三种样式（阶段表 / 按服务分组(周) / 按日期）的行，改成先出数据再画。周数模式的「小计」、最后的「Sum」，按日期样式的假期 / 节点行，都在里面。预览的 `SchedBlock` 和 Excel 都画它。
  - 标题、客户行、封面信息（`titleOf` / `subTxt` / `coverMeta`）也是同一份。
- **Excel 生成**（`lib/exportXlsx.ts`）：
  - 只管「怎么画」，格式照 `assets/055-清单Excel格式样板.xlsx`。单元测试拿样板逐格对：文字、合并、列宽、字体 / 字号 / 字色、底色、边框、行高、打印设置。
  - 点按钮时才 `import('exceljs')`（exceljs 4.4.0，MIT）。它单独打成一个包（约 930 KB），首屏没有变大。
  - 所有格子写成字符串。「+65 9123 4567」「- 待定」「=…」「@…」、日期都原样是文字，测试确认整张表没有公式。
  - 每张表的栏数取最宽的那张表。窄一点的表最后一格往右合并到底，和预览里 100% 宽的表一样。例如排期只勾「阶段 / 任务」时，下面 3 栏的交付清单就是这样。
  - 页眉 / 页脚和 PDF 一样：左上项目，左下 Audax Visuals，右下页码。
  - 公司说明那一格是合并格，Excel 不会自动撑高，所以按字数估一个行高。普通行不写行高，由 Excel 自动撑高。
- **工作表**：
  - 只出清单：`Checklist` / `清单`。
  - 排期 + 清单：清单第一张、排期第二张。「清单在前 / 排期在前」只影响 PDF。
  - 只出排期：只有 `Schedule` / `排期` 一张，按钮叫「下载 Excel / Download Excel」。
  - 封面、公司说明放在第一张表上。
- **顺带修了 PDF 列宽**：打印时表格是固定布局，列宽只看第一行。清单每组第一行是合并的分组标题，所以表头上的宽度不算，PDF 里几栏一样宽。现在用 `<colgroup>` 把宽度给到列上，PDF 和预览一样。
- **去掉**：`downloadClCsv` 和 CSV 按钮。`csvCell` 别的导出还在用，保留。
- **不改数据库**。REQ-043 权限不变：导出在浏览器里做，打不开项目的人也导不出。
- **自测**（1014）：
  - 单元测试 6 项：和样板逐格一致、文本原样、取消 Owner、无分类 + 中文、封面、两张表。
  - 端到端 e055 共 71 项，按 §3 逐条，每条都把预览、PDF、Excel 三处对一遍：
    - 预览 = Excel，逐行逐格对；
    - PDF 用打印样式导出后取文字；
    - Excel 用 LibreOffice 照文件里的打印设置排版，确认是 A4、一页宽。
