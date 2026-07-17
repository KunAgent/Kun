# 文档承诺 × 用户动作 × 可用工具（对照表）

**版本**：2.0 · **背景**：确保文档规范在代码中落地，降低**承诺误解**。

## 主表

| 文档/横幅承诺 | 实际依赖 | 用户/主编 P0 动作 | 推荐 CLI / 宿主能力 |
|---------------|----------|-------------------|---------------------|
| 快速大纲 / S0 | 检索维度、宿主 WebSearch | 接受 S0 时间预算；勿假设「无检索 3 分钟成书」 | 查 `section-3-workflow` S0、**s0DimensionCompleteness** |
| 联网查证（宿主允许时） | 模型调用工具 | 宿主开放检索时启用；失败时按 policy 降级标注 | `enforce-search-policy.mjs` |
| 断点续写 / 台账 | 虚拟书房三层底座已存在（`.fbs/` / `deliverables/` / `releases/`） | **S2→S3 前**运行 `init-fbs-multiagent-artifacts.mjs` | 同左 |
| ESM 可验证 | 对话 + 磁盘一致 | 每次切换跑 `fbs-record-esm-transition.mjs`（有 Node） | `npm run fbs:esm -- --book-root …` |
| 时间标签（有成稿时） | `s3-start-gate` 内嵌调用 | 默认随门禁**自动**跑 `audit-temporal-accuracy --scan-book-s3`（警告）；严格 CI 加 `--audit-temporal-enforce` | 见 `s3-start-gate.mjs` 头注释 |
| 术语禁用变体（有成稿时） | 同上 | 自动跑 `audit-term-consistency --scan-book-s3`；阻断加 `--audit-term-enforce` | 同上 |
| 待核实台账（S5） | `writing-notes/pending-verification.md` | S5 前 `audit-pending-verification.mjs --enforce` | `search-policy` **pendingVerificationTracking** |
| P0 总览 | — | 查阅 [`search-policy.json`](./search-policy.json)（含 **`p0AutomationIndex` 键对照**） | 综合审计 P1-2 |
| S5 前三项串跑 | — | `npm run audit:all -- --skill-root . --book-root <书> --strict`（默认含断链+结构堵点守卫；紧急逃生可加 `--no-broken-links` / `--no-structure-guard`） | `run-p0-audits.mjs` |
| 增量质检（优先） | — | `npm run quality:audit:incremental`（默认最近72h、最多30文件；无增量则跳过） | `quality-audit-incremental.mjs` |
| 全景质检总控（S→P→C→B） | — | `npm run quality:audit:panorama`（阶段串行、带超时/重试/partial 落盘） | `quality-panorama-orchestrator.mjs` |
| S3 三守卫 | — | `npm run guard:s3:full -- --skill-root . --book-root <书>` | `s3-guard.mjs` |
| 大文件体检 | — | `npm run inspect:large-files`（输出 Top 大文件，支持结构化拆分决策） | `large-file-inspector.mjs` |
| 结构堵点守卫 | — | `npm run guard:structure -- --skill-root . --book-root <书> --enforce`（持续运行风险体检，含 lockfile 策略检查） | `structural-bottleneck-guard.mjs` |
| 锁文件摘要 | — | `npm run lockfile:summary`（输出 lockfile 哈希/规模摘要） | `lockfile-diff-summary.mjs` |
| HTML 终稿 D1 | `build.mjs` + 依赖 | `npm install`、脚注链完整 | `html-delivery-smoke.mjs --strict --fail-on-warn` |
| **“打开给我看” / “已打开”** | 已存在展示物 + 宿主结果展示工具 | 先运行 `node scripts/host-consume-presentation.mjs --book-root <书> --json` 解析入口，再**立即**执行返回的 `preview_url` / `open_result_view`；只拿到 URL / 路径不算已打开 | `host-consume-presentation.mjs` + 宿主 `preview_url` / `open_result_view` |
| 质量门禁自动化 | 部分规则可脚本 | 其余依赖主编与模型自觉 | `quality-auditor.mjs`（含 `--vcr-heuristic-warn`）、`audit-query-optimization.mjs`、`normalize-ledger-dimensions.mjs`、`gate:s3` |

| **S6 知识产品转化** | 终稿落盘后自动触发（A/B级必须） | 无需额外操作；产出 `.fbs/[S6]-content-units.md`、`.fbs/[S6]-product-roadmap.md`、`.fbs/[S6]-release-map.md`，并在 `releases/` 写入 `<chapterId>-release.json` | 执行规范见 `section-s6-transformation.md`（企业/平台侧包含） |
| **场景包热更新降级链** | 网络/校验失败时自动降级（四级：disk_cache→offline_cache→local_rule→no_pack） | 无需操作；降级时收到 warn 提示 | 规范见 `scene-pack-spec.md §四`（企业侧包含）；降级日志见 `.fbs/update-log.json` |
| **多宿主适配（WorkBuddy/CodeBuddy）** | 宿主能力自动探测并适配 | 无需切换；CodeBuddy 下串行模式自动激活 | 能力矩阵见 `host-capability-matrix.md`（平台侧包含） |
| **质量结果真值文件** | 当前默认写入 `qc-output/*.json` | 以 `quality-auditor-lite` / `quality-auditor` / `quality-panorama-orchestrator` 的 JSON 输出为准 | 口径见 [`metrics.md §2`](../02-quality/metrics.md) 与 [`metrics.md §5.2`](../02-quality/metrics.md)；不要在用户侧文档中提前宣称已自动写入 `.fbs/quality-dashboard.json` |

## 评级提示

- **P0**：不满足不得对外宣称阶段完成（见各章 `quality-check.md`）。
- **P1**：强烈建议落地项——不落地会明显影响体验或长期一致性，建议纳入近期改进计划。
- **P2**：可选优化项——长期治理层面的改进，时间充裕时处理。

