# 写作阶段告警分级（Blocker / Warning / Info）

> **目的**：与 `qualityAuditProfiles`、S4「20+3」勾选、章节门禁对齐，减少误报与漏报。  
> **机读索引**：`fbs-runtime-hints.json` → **`gates`**（含 `severityDoc` / `expansionDoc` / `refinementDoc` / `searchPolicy` / `truthMatrix` / `optimizationRoadmapSpec`）。

**质检 Profile**：`quality-auditor.mjs` 支持 `--profile manuscript`（正文：`chapters/` + `deliverables/`，默认 `--warn-imperative`）与 `--profile skill-doc`（技能包 `references/` + `SKILL.md`，关闭 A 类词告警）。与写作稿 Blocker/Warning 分级配合使用，避免规范文档拖垮正文门禁。

---

## 分级定义

| 级别 | 含义 | 典型处理 |
|------|------|----------|
| **Blocker** | 不得进入下一阶段或不得标为完成 | 未冻结 Brief 即写作、ledger 必填字段缺失、`chapterAcceptanceGate` 低于 min 比且 `rejectIfBelowMinRatio` |
| **Warning** | 可继续但须记录或下一章修正 | 字数档位与章数档位不一致、章末 closure 未写、`postFreezeSearchLimits` 同主题检索超额 |
| **Info** | 提示性，不记入失败统计 | 风格建议、可选优化项 |

---

## 与配置映射（速查）

| 来源 | Blocker | Warning |
|------|---------|---------|
| `briefLifecycleGate` | Brief 未呈现即写作 | — |
| `chapterAcceptanceGate` | `rejectIfBelowMinRatio` + 低于比例 | `warnIfAboveMaxRatio` |
| `materialSufficiency` / `s25BlockOnCritical` | S2.5 严重不足且未解除 | 偏少 |
| `writing-contract-gate` | `plannedChapterTotal` 越出 min/max 区间 | 目标字数与章×初稿区间偏差过大 |
| `qualityAuditProfiles` | 由 `quality-auditor-lite` / 脚本 enforce 阈值决定 | 接近阈值 |
| **S3.5 扩写**（`expansionS35` / `s3-expansion-phase.md`） | 无用户确认的 `expansion-plan.md` 即改稿；`expansion-word-verify` 未达标却标「扩写完成」 | 并行>2；仅用模型估算报字数；未跑 `expansion-gate` |
| **S3.7 精修**（`s3-refinement-phase.md`） | 在 `iterationPhase: refinement` 下跳过 S+P 质检即宣称定稿 | 术语/事实改动未回写台账 |

---

## 与人机分工

- **灰区事实**（数据模糊、版权敏感）：标 Warning 或 Info，**不得**自动改为 Blocker 除非用户策略显式要求。

详见 [`quality-check.md`](./quality-check.md)、[`search-policy.json`](../05-ops/search-policy.json)。
