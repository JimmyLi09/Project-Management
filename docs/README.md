# docs —— 需求与设计文档

本目录把"需求"纳入 Git 管理，让 Cowork 定需求、Claude Code 写代码围绕同一份真相源协作。

## 目录约定

- `requirements/` —— 需求文档。每条需求一个文件，用编号命名：`001-简短标题.md`，照 `_template.md` 写。
- `specs/` —— 技术规格 / 设计说明。
- `decisions/` —— 关键决策记录（ADR）。
- `_template.md` —— 需求文档模板，新需求从它复制。

## 协作流程

1. **定需求（Cowork）**：整理成结构化 `.md` 放进 `requirements/`，`git push`。
2. **写代码（Claude Code）**：`git pull` 后读 `requirements/`，照"验收标准"实现。
3. 需求变更走 PR，尽量和相关代码改动放在同一个 PR 里，便于追溯。

> 需求文档用 Markdown 存 Git（便于版本控制、Claude Code 直接读）。需要给非技术同事看的正式版可另导出 .docx。
