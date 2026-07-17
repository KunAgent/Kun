# 数据引用与检索呈现规范（白皮书 / 行业稿）

> **定位**：解决多 Writer 并行时各选各的引用格式导致的混用问题。与 `quality-check.md` **G4**、`search-policy.json` **chapterWriting**、`section-3-workflow.md` **S3** 对齐。
> **版本**：2.0

**HTML 脚注**：终稿由 `assets/build.mjs` 输出时，智能根 **`npm install`** 已锁定 **`markdown-it-footnote`**；未安装则构建**直接失败**（见 `html-deliverable-gate.md` §4）。

**S3 执行约束**：主编须在**每个 Writer 任务**中广播本规范 §2 拣选格式；合稿前可运行 `scripts/citation-format-check.mjs`（平台侧工具，用户侧手动等价执行）。

---

## 1. 原则

| 原则 | 说明 |
|------|------|
| **就地可核** | 带数字的主张旁须有可追溯线索（机构/报告/日期/URL），禁止仅章末笼统一句话 |
| **全书统一** | 同一本书内选定**一种正文主格式**（见 §2 A 级），不得章与章混用 `[^n]`、`【来源】`、`[1]` 无定义等 |
| **检索可审计** | 每章仍须满足 `minQueriesPerChapter`；检索痕迹以「检索执行记录」区块为准（见 §3），平台侧可由 `enforce-search-policy.mjs` 自动核验 |

---

## 2. 三级标注（推荐默认：A + C）

### A 级：行内（正文主格式）

用于**统计数字、百分比、金额、增长率**等可核验主张。

**模板**：`……（机构名，《报告或页面名》，YYYY-MM 或 YYYY；可选 URL）`

**示例**：`公开仓库数量同比上升 37%（GitHub，《Octoverse 2025》，2025-11）`

### B 级：引用块（大段转述）

```markdown
> ……转述内容……
> ——来源：机构名，《报告名》，YYYY-MM，https://…
```

### C 级：章末索引表（每章强制）

章节末尾须有独立二级标题，推荐固定为：

`## 本章数据来源索引`

表格至少含：**数据点摘要 | 来源 | 检索日期**；有 URL 的列优先。

---

## 3. 与「检索执行记录」的关系

- **检索执行记录**：证明做过几次检索、查过什么（门禁用，见 `enforce-search-policy`）。
- **本章数据来源索引**：证明正文里的数据从哪来（读者与 G4 用）。
- 二者可并列存在，**至少一条**须含**可机器识别的 URL 或等价账本记录**（与 `search-policy` 一致）。

---

## 4. 并行写作时的主编动作（P0）

1. 在 **S2 定稿** 到 **S3 启动** 时，向所有 Writer **广播**本节 §2 拣选格式（复制 `workbuddy-agent-briefings.md` 中的引用块即可）。
2. 指定 **首章样板**：第一章（或任选一章）定稿后，后续章节 **对齐其引用与标题风格**。
3. 维护 `.fbs/GLOSSARY.md`（或 S1/S2 术语表）并与 `book-level-consistency.md` **C0-2** 联动。

---

## 5. 合稿检查

- 执行 **G4**（多路并行模式下默认启用，见 `quality-check.md` §G 说明）。
- 执行 **CX** 跨章核对（见 [`cross-chapter-consistency.md`](./cross-chapter-consistency.md)）。
