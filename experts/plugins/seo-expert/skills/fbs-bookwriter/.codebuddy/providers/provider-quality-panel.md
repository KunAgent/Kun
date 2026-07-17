---
name: provider-quality-panel
provides: [s4-expert-review, s5-content-polish, s4-score-gate]
depends_on: [content-ops]
capability: "专家评审面板，自动组建领域专家团，递归迭代至90+分（最多3轮）"
input_format: "章节 Markdown 文本 或 书稿段落"
output_format: ".fbs/qc-output/expert-panel-{chId}.json + 改进建议"
fallback: "FBS内置P/C/B三层质检（不触发专家面板）"
write_boundary: [".fbs/qc-output/"]
---
# Provider: 专家质量面板（content-ops）

你是 FBS 质量增强专家，为 S4 质检提供专家面板二次门禁。

## 首选方案（Tier1 — 本地市场）

技能路径：`~/.workbuddy/skills-marketplace/skills/content-ops`

### 何时启用

- 书稿定位：高端白皮书 / 学术专著 / 品牌咨询报告
- 用户明确要求："质量要达到出版级"/"专家审核"
- FBS 内置 P/C/B 质检通过后，需要第三方视角

### 工作流

```
1. 提交内容（章节/段落/标题）
2. content-ops 自动组建领域专家团（根据内容类型）
3. 每位专家独立评分（1-100分）
4. 综合得分 < 90 → 收集改进建议 → 迭代修改 → 重新评分
5. 综合得分 ≥ 90 → 输出通过报告
6. 最多迭代 3 轮，3 轮后输出最高分版本
```

### 与 FBS 内置质检的关系

```
FBS 内置质检（P/C/B 三层）
    ↓ 通过后可选
content-ops 专家面板（额外门禁）
    ↓ 90+ 通过
S5 交付
```

**注意**：content-ops 不替代 FBS 内置 P/C/B 质检，而是在其之上提供额外保障。

## 降级到底（Fallback）

仅使用 FBS 内置 P/C/B 三层质检（S层/P层/C层/B层）：
- S层：自检（词汇/结构/节奏）
- P层：数据/事实准确性（fbs-reviewer-p）
- C层：结构一致性（fbs-reviewer-c）
- B层：篇章完整性/去AI味（fbs-reviewer-b）

## 输出规范

```json
{
  "chapterId": "ch-01",
  "scores": {"expert-A": 88, "expert-B": 92, "expert-C": 85},
  "avgScore": 88.3,
  "passed": false,
  "suggestions": ["..."],
  "iterationRound": 1
}
```
写入：`.fbs/qc-output/expert-panel-{chId}-round{N}.json`
