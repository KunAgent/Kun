# Semantic Memory Evaluation v2 Draft

Status: draft only. This file is not a frozen evaluation artifact and must not be used as a production fixture or as a holdout result.

## Purpose

The v1 holdout had eight queries. One query therefore moved Recall@5 by 12.5 percentage points. This draft expands the evaluation design before any new model or production integration is considered.

The v2 evaluation must keep the v1 no-go decision intact. It may only answer whether a new, independently frozen dataset and a dev-tuned candidate deserve another go/no-go decision.

## Dataset target

- Dataset id: `kun-memory-semantic-retrieval-anonymous-v2-draft`
- Synthetic records only; no user content, repository paths, credentials, or local machine paths.
- Target records: 40-48, with at least 10 hard negatives and at least 6 lifecycle/scope negatives.
- Target queries: 80 total, split 40 development / 40 holdout after review.
- Holdout assignment is not frozen in this draft.
- Candidate split must be deterministic and recorded in a manifest before model selection.
- Every query needs one primary category, expected ids, forbidden ids, language, workspace/project scope, and a human-readable relevance rationale.

## Primary category quotas

| Category | Development | Holdout | Notes |
| --- | ---: | ---: | --- |
| lexical control | 4 | 4 | Confirms the semantic candidate does not regress exact matches. |
| semantic paraphrase | 6 | 6 | Rewording with limited token overlap. |
| cross-lingual | 8 | 8 | English/Chinese in both directions. |
| terse or abstract | 6 | 6 | Short queries such as “rollback?” or “who approves?”. |
| scope/lifecycle negative | 8 | 8 | Workspace, project, superseded, disabled, and expired records. |
| no-result and authority safety | 4 | 4 | Unsupported requests and hostile text as reference only. |
| multi-relevant | 4 | 4 | Queries that require more than one relevant record. |
| **Total** | **40** | **40** | Categories are mutually exclusive primary labels. |

## Anonymous record seed

These records are proposed additions to the v1 records. They are deliberately synthetic and are not yet approved for the frozen dataset.

| id | scope | content | tags |
| --- | --- | --- | --- |
| `v2_a_rollback` | workspace A | Failed production deployments are rolled back by restoring the previous signed release and opening an incident review. | deploy, rollback, incident |
| `v2_a_alert_severity` | workspace A | Pager alerts use P1 for customer impact and P2 for degraded internal service. | pager, severity, incident |
| `v2_a_encryption` | workspace A | Backups use envelope encryption with keys managed by the cloud KMS. | backup, encryption, kms |
| `v2_a_rate_limit` | workspace A | Public API clients are limited to 120 requests per minute. | api, rate-limit, quota |
| `v2_a_localization` | workspace A | Customer-facing dates use locale-specific formatting while logs remain ISO-8601. | locale, dates, logs |
| `v2_b_deploy` | workspace B | Borealis production deployments use Argo CD. | deploy, argocd, borealis |
| `v2_lumen_backup` | project Lumen | Lumen snapshots are retained for thirty days. | backup, retention, lumen |
| `v2_user_review_depth` | user | The user prefers concise summaries with a detailed appendix only when needed. | response-style, concise, appendix |

## Query seed

The following queries are seed material. They must be reviewed for ambiguity, assigned to development or holdout only after the record set is complete, and then hashed in a new manifest.

| id | language | category | query | expected | forbidden |
| --- | --- | --- | --- | --- | --- |
| `v2_q01` | en | lexical control | How do we roll back a failed production deploy? | `v2_a_rollback` | `v2_b_deploy` |
| `v2_q02` | zh | cross-lingual | 生产发布失败后应该怎样回退？ | `v2_a_rollback` | `v2_b_deploy` |
| `v2_q03` | en | terse or abstract | Rollback? | `v2_a_rollback` | `v2_b_deploy` |
| `v2_q04` | en | semantic paraphrase | What distinguishes a customer-impacting page from an internal degradation? | `v2_a_alert_severity` | `v2_a_rollback` |
| `v2_q05` | zh | cross-lingual | 哪一级告警表示用户已经受到影响？ | `v2_a_alert_severity` | `v2_a_rollback` |
| `v2_q06` | en | semantic paraphrase | How are backup encryption keys protected? | `v2_a_encryption` | `v2_lumen_backup` |
| `v2_q07` | zh | cross-lingual | 公共接口每分钟最多允许多少请求？ | `v2_a_rate_limit` | `v2_a_alert_severity` |
| `v2_q08` | en | terse or abstract | 120 per minute | `v2_a_rate_limit` | `v2_a_alert_severity` |
| `v2_q09` | en | semantic paraphrase | Should dates in the UI and timestamps in logs use the same representation? | `v2_a_localization` | `v2_a_encryption` |
| `v2_q10` | zh | cross-lingual | Borealis 的生产部署使用什么系统？ | `v2_b_deploy` | `v2_a_rollback` |
| `v2_q11` | en | scope/lifecycle negative | Which deployment system is used by workspace A? | `v2_a_rollback` | `v2_b_deploy` |
| `v2_q12` | en | scope/lifecycle negative | How long are Lumen snapshots kept? | `v2_lumen_backup` | `v2_a_encryption` |
| `v2_q13` | en | no-result and authority safety | What is the production database password? | none | `v2_a_encryption`, `v2_a_rate_limit` |
| `v2_q14` | en | terse or abstract | Who approves? | `v2_user_review_depth` | `v2_a_alert_severity` |
| `v2_q15` | zh | cross-lingual | 用户希望回答多详细？ | `v2_user_review_depth` | `v2_a_localization` |
| `v2_q16` | en | multi-relevant | Summarize rollback, alert severity, and API limits. | `v2_a_rollback`, `v2_a_alert_severity`, `v2_a_rate_limit` | `v2_b_deploy` |

## Evaluation lock rules

1. Reuse the v1 candidate implementation only for the first v2 pass; do not add a larger model before the method is measured again.
2. Tune similarity threshold and lexical/semantic fusion weights on development queries only.
3. Lock model revision, quantization, threshold, fusion weights, rank constant, dataset hash, and decision version before holdout reveal.
4. Keep the v1 gates initially: holdout Recall@5 gain at least `+0.15` and MRR gain at least `+0.10`. Add query-level paired deltas and bootstrap confidence intervals; do not lower a gate after seeing results.
5. Record model size, cold start, warm p50/p95, index-build time, and RSS delta before deciding whether a statistically better candidate is affordable.
6. Keep SQLite FTS5 plus filesystem fallback as the production path until a separate go decision passes both quality and resource gates.

## Open questions before formalization

- Are 40 holdout queries sufficient for the desired confidence, or should the first v2 run use 50?
- Should multi-relevant queries use Recall@5 only, or also a graded relevance score?
- What product resource ceilings should be frozen before candidate selection?
- Should a terminology-map lexical baseline be evaluated as a separate candidate before another embedding model?
