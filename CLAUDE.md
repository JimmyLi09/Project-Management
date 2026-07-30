# 项目协作规则（供 Claude Code 使用）

> 把本文件放到每个代码仓库的根目录（`<repo>/CLAUDE.md`）。
> Claude Code 每次在该仓库开工时会自动读取它。

## 需求来源：先读 docs/requirements/

本项目的需求以 Markdown 存放在 `docs/requirements/`，由 Cowork 侧写入、经 PR 合并。
在动手写任何代码前：

1. 先 `git pull`，确保拿到最新需求。
2. 阅读 `docs/requirements/` 下相关的需求文件；每个文件是一条需求，含固定字段。
3. **以文件里的"验收标准"作为完成定义**：优先把验收标准转成测试，循环实现直到测试通过。
4. 需求不清楚时，不要猜——在回复里指出困惑点、提出问题，或到对应需求文件里确认。

## 文档目录约定

- `docs/requirements/` —— 需求（Cowork 写，Claude Code 读并实现）
- `docs/specs/` —— 技术规格 / 设计
- `docs/decisions/` —— 关键决策记录（ADR）
- `docs/_template.md` —— 需求模板

## 变更纪律

- 需求若因实现而调整，更新对应 `docs/requirements/` 文件，并尽量与代码改动放在同一个 PR，便于追溯。
- 每一行改动都应能追溯到某条需求或用户明确要求；不顺手重构无关代码、不删除既有无效代码（除非用户要求）。
- 用最少的代码解决问题，不加未被要求的"灵活性"或推测性功能。

## 与 Cowork 的分工

- **Cowork**：定需求 → 写进 `docs/requirements/` → push（用 requirement-sync 技能）。
- **Claude Code（这里）**：pull → 照需求实现 → push；需求有变动一并回写 `docs/`。
- 两边通过 GitHub 交汇，不依赖任何本地文件同步。
