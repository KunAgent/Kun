---
name: FBS-BookWriter 文档索引
description: FBS-BookWriter 完整文档导航与分层索引
---

> **版本**：2.1.2  
> **索引范围**：`SKILL.md`、`references/`、关键构建与发布说明。  
> **文档分层说明**：见 [`documentation-layers.md`](./documentation-layers.md)。

# FBS-BookWriter 文档索引

---

## 🤖 AI / 宿主优先学习路径

| 顺序 | 文档 | 目的 |
|------|------|------|
| 1 | [`SKILL.md`](../../SKILL.md) | 技能启动必读；执行速查卡、工作面约束、双通道说明 |
| 2 | [`skill-full-spec.md`](./skill-full-spec.md) | 完整规范、边界、双通道路由、并行与展示细则 |
| 3 | [`section-3-workflow.md`](./section-3-workflow.md) | S0–S6 总入口 |
| 4 | `workflow-volumes/workflow-s0.md` ～ `workflow-volumes/workflow-s6.md` | 各阶段分卷详规 |
| 5 | [`intake-and-routing.md`](./intake-and-routing.md) | 快速起步与路径分发 |
| 6 | [`session-protocols.md`](./session-protocols.md) | 创意会 / 读者会 / 对抗会 / 评审会 |
| 7 | [`../02-quality/quality-check.md`](../02-quality/quality-check.md) | 质量评分体系 |
| 8 | [`../02-quality/quality-S.md`](../02-quality/quality-S.md) | S 层句级规则权威 |
| 9 | [`../02-quality/quality-PLC.md`](../02-quality/quality-PLC.md) | P / C / B 权威规则 |
| 10 | [`scene-pack-activation-guide.md`](./scene-pack-activation-guide.md) | 场景包激活、local_rule 与 no_pack |
| 10b | [`information-ownership-and-arbitration.md`](./information-ownership-and-arbitration.md) | 信息产权、场景包坐标、记忆仲裁（与 intake / brief 对齐） |
| 11 | [`skill-cli-bridge-matrix.md`](./skill-cli-bridge-matrix.md) | Skill↔脚本↔CLI 联动矩阵（检索前置合同、企微、乐包；非 MCP） |
| 12 | [`s0-material-phase-guard.md`](./s0-material-phase-guard.md) | S0 素材阶段强制推进、「继续」语义、防无限 S0（team-lead 必读） |
| 13 | [`s3-expansion-phase.md`](./s3-expansion-phase.md) | S3.5 扩写：计划门禁、字数实测、并行≤2 |
| 13b | [`../05-ops/fbs-narrative-gates-and-parity.md`](../05-ops/fbs-narrative-gates-and-parity.md) | 叙事门控四类、Wave、修订熔断、读者验收（对标工程化协作范式） |
| 13c | [`../05-ops/fbs-final-draft-governance.md`](../05-ops/fbs-final-draft-governance.md) | 终稿状态机、版本哈希、回退与归档口径 |
| 14 | [`s3-refinement-phase.md`](./s3-refinement-phase.md) | S3.7 精修：润色与事实收口 |
| 15 | [`../05-ops/fbs-source-of-truth-matrix.md`](../05-ops/fbs-source-of-truth-matrix.md) | 真源矩阵与发版对齐 |
| 16 | [`expansion-fact-tagging.md`](./expansion-fact-tagging.md) | 扩写事实标签（MAT） |
| 17 | [`../05-ops/web-search-strategy-deep.md`](../05-ops/web-search-strategy-deep.md) | 联网检索四支柱：截止补强、时效锚定、时态验证、方法论增强 |
| 18 | [`../05-ops/entry-state-machine-ops-onepager.md`](../05-ops/entry-state-machine-ops-onepager.md) | 入口状态机运营版：一页口径与红线 |
| 19 | [`../05-ops/entry-state-machine-tech-manual.md`](../05-ops/entry-state-machine-tech-manual.md) | 入口状态机技术版：状态、门禁、回退与验收 |
| 20 | [`intent-canonical.json`](./intent-canonical.json) | 意图单真源（2.1.2）：识别、消歧、补全、召回统一配置 |


---

## 🟢 用户侧文档（写作者 / 主编直接使用）

| 文档 | 主题 | 优先级 |
|------|------|--------|
| [SKILL.md](../../SKILL.md) | 技能主入口与执行速查卡 | **P0** |
| [完整规范](./skill-full-spec.md) | 详细规则与宿主边界 | **P0** |
| [工作流设计](./section-3-workflow.md) | S0–S6 总入口 | **P0** |
| `workflow-volumes/` | 各阶段分卷执行规范 | **P0** |
| [快速起步与路径分发](./intake-and-routing.md) | 三条路径 / 起步工作面 | **P0** |
| [会议机制规范](./session-protocols.md) | 多角色会议执行规范 | **P0** |
| [质量检查体系](../02-quality/quality-check.md) | 四层评分 + G 门禁 | **P0** |
| [P/C/B 规则](../02-quality/quality-PLC.md) | 段级 / 章级 / 篇级规则 | **P0** |
| [场景包激活指南](./scene-pack-activation-guide.md) | 激活、降级与 local_rule | **P0** |
| [联网检索策略](../05-ops/search-policy.json) | 检索前置合同与阶段策略 | **P0** |
| [联网检索专项深化](../05-ops/web-search-strategy-deep.md) | 四支柱与执行清单 | **P0** |
| [入口状态机（运营 1 页）](../05-ops/entry-state-machine-ops-onepager.md) | 启动场景速判、红线与最小命令集 | **P0** |
| [HTML 交付门禁](../05-ops/html-deliverable-gate.md) | 预览与交付展示链 | **P1** |
| [交付指南](../05-ops/delivery-guide.md) | 从 MD/HTML 到多格式输出 | **P1** |
| [去AI味自查模板](../02-quality/quality-AI-scan.md) | Writer 交稿前自检 | **P1** |
| [价值一页纸（用户向）](../03-product/fbs-value-one-pager.md) | 能做什么、边界、触发词（非技术） | **P1** |
| [认知资产「三化」与商业机制对齐](../05-ops/cognitive-asset-threeization.md) | 可进化/可分发/可增值 + 场景包/乐包/离线在线 | **P1** |

---

## 🔵 企业侧文档（授权 / 场景包 / 组织协作）

> 企业侧文档并非全部随用户包分发，具体包含范围以 [`documentation-layers.md`](./documentation-layers.md) 为准。

| 文档 | 主题 | 优先级 |
|------|------|--------|
| [多智能体委派话术](./workbuddy-agent-briefings.md) | S3 / S5 委派模板 | **P1** |
| [执行契约简报](./execution-contract-brief.md) | 宿主 × 模型 × 磁盘边界 | **P1** |
| [多智能体横向协同](../05-ops/multi-agent-horizontal-sync.md) | 并行治理、写入隔离、shutdown 协议 | **P1** |
| [全书级一致性](../02-quality/book-level-consistency.md) | 全书统一性检查 | **P1** |

---

## ⚙️ 平台侧文档（维护者 / CI / 打包）

| 文档 | 主题 | 优先级 |
|------|------|--------|
| [发版核对清单](../05-ops/release-checklist.md) | 门禁命令、产物与分发边界 | **P0** |
| [版本基线归纳（2.1.1）](../../docs/history/version-baseline-v2.1.1.md) | 当前基线与既往版本能力归纳索引 | **P1** |
| [平台运维简报](../05-ops/platform-ops-brief.md) | 构建、交付、预览、运行守卫 | **P0** |
| [WorkBuddy 宿主集成](../06-plugin/workbuddy-host-integration.md) | 最小脚本契约与调用顺序 | **P0** |
| [Tier1 市场 FAQ](../06-plugin/tier1-marketplace-faq.md) | 清单与源码树、minimax-xlsx 说明 | **P1** |
| [WorkBuddy 集成检查清单](../../releases/workbuddy-integration-checklist.md) | 发布 / 审核前核对 | **P1** |
| [S3 写入约束](../05-ops/s3-write-constraints.md) | 每轮文件数与串行说明 | **P1** |
| [搜索前置合同 JSON](../05-ops/search-preflight-contract.json) | S0–S2 四字段机读模板 | **P1** |
| [离线→在线升级指南](./offline-online-upgrade-guide.md) | 离线版升级在线增强版的收口路径（2.1+） | **P1** |
| [乐包说明](../05-ops/credits-guide.md) | 乐包获得/消耗/查询（本地行为激励） | **P1** |
| [脚本索引](../../scripts/README.md) | 入口脚本、质检脚本、打包脚本速查 | **P1** |
| [记忆分层矩阵](./memory-layer-matrix.md) | L1–L4 真值 / 宿主记忆 / 叙事日志 | **P0** |
| [防卡顿指南](../05-ops/anti-stall-guide.md) | 首响 `--fast`、场景包超时、记忆文件上限 | **P0** |
| [体验与防卡顿专项](../05-ops/fbs-performance-ux.md) | 文件体量软/硬阈值、价值显性化、`userValueSnapshot` | **P1** |
| [Agent 体验清单](../05-ops/ux-agent-playbook.md) | 对用户用语、恢复卡、推荐上限、质检话术 | **P0** |
| [入口状态机（技术细则）](../05-ops/entry-state-machine-tech-manual.md) | 状态机转移、风险门禁、工件边界 | **P0** |
| [词表治理](../05-ops/lexicon-governance.md) | 策略 C：词表评审与合入流程 | **P1** |
| [编排策略：单线/多任务/多智能体](../05-ops/agent-task-strategy.md) | 风格一致、防断链、质量优先与信号弹性 | **P0** |
| [Teams 收件箱对齐](../05-ops/teams-inbox-mapping.md) | 策略 B：宿主团队目录与 FBS 编排 | **P1** |
| [文档分层说明](./documentation-layers.md) | 三侧文档范围与分发说明 | **P0** |
| [持续改进与轨迹](../05-ops/fbs-continuous-improvement.md) | JSONL 轨迹、演进门控、与发版同级校验 | **P1** |
| [上下文压缩策略](../05-ops/fbs-context-compression.md) | SKILL/会话压缩边界与策略 | **P1** |
| [辅助任务边界](../05-ops/fbs-auxiliary-tasks.md) | 辅助任务用途与宿主路由约定 | **P1** |
| [质量检查体系](../02-quality/quality-check.md) | 四层评分真值源 | **P1** |
| [S 层规则](../02-quality/quality-S.md) | 句级规则真值源 | **P1** |
| [P/C/B 规则](../02-quality/quality-PLC.md) | reviewer 真值源 | **P1** |
| [缩写审计词表](../02-quality/abbreviation-audit-lexicon.json) | 缩写审计辅助资产 | **P2** |
| [S5 流行词词表](../02-quality/s5-buzzword-lexicon.json) | buzzword 检测词表 | **P2** |

---

## 🔍 快速查找

- **"工作流 / 阶段执行"** → [`section-3-workflow.md`](./section-3-workflow.md) / `workflow-volumes/`
- **"完整合并版工作流"** → `section-3-workflow.full.md`（⚠️ 已归档，日常运行请用精简版 `section-3-workflow.md`）
- **"场景包 / local_rule / no_pack"** → [`scene-pack-activation-guide.md`](./scene-pack-activation-guide.md)
- **"P/C/B 规则"** → [`../02-quality/quality-PLC.md`](../02-quality/quality-PLC.md)
- **"评分公式 / 综合分"** → [`../02-quality/quality-check.md`](../02-quality/quality-check.md)
- **"并行 / Team API / 写入隔离"** → [`../05-ops/multi-agent-horizontal-sync.md`](../05-ops/multi-agent-horizontal-sync.md)（合流清单见 §2.1）
- **"扩写 / expansion-plan / 字数门禁"** → [`s3-expansion-phase.md`](./s3-expansion-phase.md)；`npm run verify:expansion` / `npm run gate:expansion` / `npm run verify:expansion-plan`（计划**结构**）
- **"叙事门控 / Wave / 读者验收"** → [`../05-ops/fbs-narrative-gates-and-parity.md`](../05-ops/fbs-narrative-gates-and-parity.md)；模板见 `template-narrative-context.md`、`template-reader-uat-checklist.md`
- **"终稿状态机 / 版本漂移 / 交付哈希"** → [`../05-ops/fbs-final-draft-governance.md`](../05-ops/fbs-final-draft-governance.md)；`npm run state:final-draft`
- **"运行时提醒 / 复盘候选沉淀"** → `npm run nudge:runtime` / `npm run retro:skill-candidates`；产物 `.fbs/runtime-nudges.json` / `.fbs/retro-skill-candidates.json`
- **"精修 / S3.7"** → [`s3-refinement-phase.md`](./s3-refinement-phase.md)
- **"运行复盘模板"** → [`../05-ops/fbs-run-retrospective-template.md`](../05-ops/fbs-run-retrospective-template.md)
- **"一书稿健康快照 / BookHealthSnapshot"** → [`../05-ops/fbs-optimization-roadmap-spec.md`](../05-ops/fbs-optimization-roadmap-spec.md)；`npm run book-health:snapshot`
- **"环境预检 / PowerShell 变量被宿主吃掉"** → [`section-6-tech.md`](./section-6-tech.md) §6.3；`npm run env:preflight`
- **"入口场景 / 冷启动 / 热恢复 / 退出收口"** → [`entry-state-machine-ops-onepager.md`](../05-ops/entry-state-machine-ops-onepager.md) / [`entry-state-machine-tech-manual.md`](../05-ops/entry-state-machine-tech-manual.md)
- **"S2 机读词表 / A 类命令词"** → [`../02-quality/s2-quality-machine-lexicon.json`](../02-quality/s2-quality-machine-lexicon.json)
- **"通道 / 分发 / dist"** → [`documentation-layers.md`](./documentation-layers.md)
- **"轨迹 / 审计 / 持续改进"** → [`fbs-continuous-improvement.md`](../05-ops/fbs-continuous-improvement.md)（`.fbs/audit` JSONL、`fbs-runtime-hints.trace`）
- **"书稿索引 / 历史书稿检索"** → `intake-router --search`（登记见 `~/.workbuddy/fbs-book-projects.json`）；片段索引见 `fbs-runtime-hints.bookIndex`
- **"发版门控 / scripts 清单"** → `npm run manifest:scripts` → `scripts/generated/scripts-manifest.json`；`npm run gate:evolution`；[`fbs-continuous-improvement.md`](../05-ops/fbs-continuous-improvement.md)
- **"产品价值 / 培训试讲"** → [`fbs-value-one-pager.md`](../03-product/fbs-value-one-pager.md)
- **"认知资产三化 / 场景包乐包会员"** → [`cognitive-asset-threeization.md`](../05-ops/cognitive-asset-threeization.md)
- **"首屏菜单过长 / 退出没收尾 / 意图外提问"** → [`intake-and-routing.md`](./intake-and-routing.md)「WorkBuddy 实测复盘」· [`ux-agent-playbook.md`](../05-ops/ux-agent-playbook.md) §4.1–4.3

---

## 联系方式

- **技术支持**：`dev@u3w.com`
- **商务 / 授权**：`unique@u3w.com`
- **主页**：`https://fbs-bookwriter.u3w.com/`
