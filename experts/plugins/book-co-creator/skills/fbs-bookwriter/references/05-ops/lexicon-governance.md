# 词表与质检规则演进治理（策略 C）

> **版本**：2.1.1  
> **原则**：机读词表 **不因单次联网检索自动覆盖**；采用「提议 → 评审 → 合入」闭环。

---

## 1. 覆盖资产

| 资产 | 路径 |
|------|------|
| S5 流行词 | `references/02-quality/s5-buzzword-lexicon.json` |
| AI 味模式 | `references/02-quality/ai-pattern-lexicon.json` |
| 缩写审计 | `references/02-quality/abbreviation-audit-lexicon.json` |

---

## 2. 建议节奏

- **季度**：例行检视 + 与 `quality-auditor` 警告阈值对照。  
- **突发**：新模型套话潮、监管口径变化时启动临时评审。

---

## 3. 工作流

1. `node scripts/propose-lexicon-refresh.mjs` 生成提案模板（`releases/lexicon-refresh-proposal-*.md`）。  
2. 人工填写 **来源 URL、日期、摘录**。  
3. 评审通过后修改 JSON，跑 `npm run quality:audit:full` 与相关测试。  
4. 版本发布记入 `CHANGELOG`。

---

## 4. 禁止事项

- 在生产书稿目录直接覆盖 `references/**` 词表（应以仓库 PR 为准）。  
- 将未经验证的「网络热词列表」直接并入 enforce 阻断项。
