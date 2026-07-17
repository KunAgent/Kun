# 董秘助手宿主侧智能运营基础支撑需求

## 当前结论

- status: `host_ops_foundation_requirements_ready`
- versionTarget: `2.1` / semver=`2.1.0`
- currentServiceRelease: `20260624-190710`
- reviewPackageStatus: `ready_for_review`
- postSubmitAuditStatus: `ready_for_post_listing_joint_debug_review` / pass=27
- frontstageConfirmationStatus: `dual_host_frontstage_confirmed` / confirmedHostCount=2
- currentSession: `current_session_first_value_and_continued_use_proved` / firstValue=true / continuedUse=true

## 多智能体研读结论

- host_runtime: 双宿主本地等效、前台可见和 ACP 可探测已经成立；重启/刷新生命周期、机器可读点击激活和真实会话续用仍是缺口。
- service_operations: 服务侧已能使用同绑、画像和归因信号；下一步要让宿主连续带出身份、版本、动作、结果和商业意图。
- peer_package_lessons: 借鉴行业场景和长文档的首值先行、需求资产化、边界分层和双宿主矩阵；避免把可见性、本地安装或同绑 consume 过度宣称。
- review_boundary: 审核包、no-connector、红队/案例/服务商和背景资料解耦已达成；后续应增加场景门禁、续用可见性和解冻后仓内真源导入门禁。

## 需求摘要

- total: `10`
- P0/P1/P2: `5/3/2`
- externalBenchmarks: `8`
- localCapabilityReserves: `6`
- evidencePathMissing: `0`

## 2.1 强升级储备

- external Diligent GovernAI: Do not stop at risk-card generation. Package 2.1 should reserve board-material prep, meeting follow-up, action-item continuity, and service-side traction receipts as explicit host/service contracts. (https://www.diligent.com/features/boards/boards-ai)
- external Workiva AI: Reserve governed-data hooks, evidence-trace fields, and defensible disclosure boundaries so board-secretary outputs stay auditable instead of becoming free-form text. (https://www.workiva.com/platform/workiva-ai)
- external Q4 AI for IR: Reserve host and service fields for investor-intent, repeated engagement, and post-first-value followthrough so IR-style continuation becomes measurable. (https://www.q4inc.com/platform/q4-platform/)
- external Board Intelligence AI: Push 2.1 toward scenario-specific board judgement cards, board-ready summaries, mandatory human review, and visible service-side gap handling instead of generic summarization. (https://www.boardintelligence.com/ai)
- external 董秘助手官网: 2.1 should reserve governance and board-office operational surfaces, not only disclosure review, so the upgrade has enough scope to justify the version jump. (https://www.dongmiban.com/)
- external 虹安 AI 董秘写作助手: Reserve topic radar, public-opinion response, and investor-communication drafting as structured scenario families under the 2.1 package. (https://www.honganinfo.com/product-service/assistant/)
- external 价值在线: Reserve roadshow, investor Q&A, interaction-channel continuity fields, and service strategy return receipts so board-secretary 2.1 can support sustained IR workflows. (https://www.ir-online.cn/)
- external 深交所互动易: Keep channel-specific boundary checks and fairness/disclosure rules first-class in 2.1 instead of flattening all communication into one generic workflow. (https://irm.cninfo.com.cn/)
- local local_disclosure_compliance_risk_cluster: Strengthen scenario gates for announcement draft, inquiry reply, insider information, and statutory disclosure boundary.
- local local_investor_communication_content_cluster: Add IR answer copilot, roadshow follow-up, and channel-specific tone controls into the review package reserve.
- local local_data_analytics_decision_cluster: Reserve operating analytics, decision support, traffic-to-demand tooling, and connector-decoupled Lebao gap fill as explicit 2.1 capabilities.
- local local_workflow_quality_cluster: Add deliveryTaskboard, opsBoard, and meeting-material workflow checkpoints as explicit host/service interfaces.
- local local_ai_engineering_redteam_cluster: Expand the board-secretary red-team library, same-binding gates, post-submit runtime checks, and validation receipt handoff so 2.1 has stronger operational depth.
- local method_absorption_cross_package_patterns: Carry peer-package patterns into the 2.1 reserve so the version jump reflects stronger workflow design, not just more documents.

## 需求清单

### BRD-HOST-OPS-001 双宿主生命周期与刷新闭环遥测
- priority: `P0`
- purpose: 让 WorkBuddy 与 WorkBuddyAI 的注册、重启、刷新、可见性和前台激活从人工判断变成可回读事件。
- fields/events: `hostPreset, hostType, primaryLanguage, marketplaceEntryPresent, hostCacheManifestVisible, hostHistoryEntryPresent, acpReachable, pluginApiReachable, restartGateStatus, verifiedMarketplaceReloadObserved, frontstageVisible`
- acceptance: WorkBuddy and WorkBuddyAI can be reported separately without mixing language, path, or route evidence. / registered_restart_pending cannot be silently treated as verified reload. / frontstage confirmation must expose a machine-readable receipt or keep manual_visual_confirmation boundary.
- evidence: `reports/board-secretary-assistant-local-install-integrity-latest.json`, `reports/board-secretary-assistant-host-surface-probe-latest.json`, `reports/board-secretary-assistant-frontstage-confirmation-latest.json`, `reports/board-secretary-assistant-my-experts-host-matrix-latest.json`, `reports/board-secretary-assistant-upload-readiness-latest.json`, `reports/board-secretary-assistant-post-listing-runtime-reverify-latest.json`

### BRD-HOST-OPS-002 真实宿主会话显式续用事件
- priority: `P0`
- purpose: 把真实 WorkBuddy / WorkBuddyAI 会话中的首值后继续使用，从 record-only 观察升级为可验证事件。
- fields/events: `serverBindingId, anonymousUserCodeHash, requestChainLogId, priorSpineObservedStages, eventType, idempotencyKey, transportRequestSource, inputRequestSource, whoami_emitted, scene_pack_resolved, first_value_completed, continued_use_completed`
- acceptance: first_value_completed alone remains insufficient for continued-use credit. / continued_use_completed must be visible in the real host trace or an explicitly approved equivalent metric. / service-side probe continued_use remains separate from natural host-session closure.
- evidence: `reports/board-secretary-assistant-current-session-followthrough-diagnose-latest.json`, `reports/board-secretary-assistant-service-followthrough-smoke-latest.json`, `reports/board-secretary-assistant-joint-debug-readiness-latest.json`, `reports/board-secretary-assistant-post-submit-audit-latest.json`

### BRD-HOST-OPS-003 宿主动作包与唯一下一步合同
- priority: `P0`
- purpose: 让董秘助手首值后的下一步动作可被宿主执行、服务侧观察和后续商业化承接。
- fields/events: `hostActionEnvelope, actionType, toolArguments, hostDispatchArguments, idempotencyKey, packCode, scenePackId, entryPromptCode, defaultPromptId, cardActionId, nextTool, stopCondition`
- acceptance: 首值输出必须只暴露一个明确 CTA。 / 动作包必须能把场景卡、风险矩阵、证据卡和会议动作包连到同一 binding。 / 动作包字段缺失时只能进入联调待补，不能宣称自然闭环。
- evidence: `reports/board-secretary-assistant-service-followthrough-smoke-latest.json`, `src/fbss-action-contract.js`, `src/fbss-board-secretary-host-contracts.js`, `reports/board-secretary-assistant-review-package-latest.json`

### BRD-HOST-OPS-004 董秘业务证据块与人工审批链
- priority: `P0`
- purpose: 让公告、路演、问询函、三会材料和 IR 答复的风险审查可追踪、可复核、可审计。
- fields/events: `publicSourceReference, regulatoryBaseline, problematicFragments, riskLevel, rewriteSuggestion, externallySafeVersion, sourceConsistency, approvalOwner, approvalNextStep, statutoryDisclosureBoundary, fairDisclosureCheck`
- acceptance: 任何输出默认不得作为正式披露、法律意见或自动发布依据。 / 风险片段、依据、改写建议和审批下一步必须分开。 / 服务商、案例和背景资料只能作为对抗或参考资源，不进入责任链。
- evidence: `reports/board-secretary-assistant-review-package-latest.json`, `reports/board-secretary-assistant-post-submit-audit-latest.json`, `data/workbuddy-listed-board-secretary-demand-unit-ledger-20260620.json`, `dist/review/board-secretary/fbsir-board-secretary-assistant-review/docs/RED-TEAM-PATTERN-LIBRARY.md`, `dist/review/board-secretary/fbsir-board-secretary-assistant-review/docs/SERVICE-PROVIDER-RED-TEAM-ALLIANCE.md`

### BRD-HOST-OPS-005 宿主身份、版本与自然流量 cohort 稳定字段
- priority: `P0`
- purpose: 支撑自然流量分析、用户画像、经营决策和跨宿主比较。
- fields/events: `hostType, hostPlatform, hostPatchVersion, versionKey, clientVersionMajorMinor, channel, terminal, requestSource, entrySurface, entryPromptCode, profileSegment, intentFamily, channelTrack, traceId, hostTraceId, traceparentTraceId, mcpRequestId`
- acceptance: WorkBuddy and WorkBuddyAI must remain separate cohorts. / probe, diagnostic, local-equivalent and natural samples must not be mixed. / hostPatchVersion/versionKey/terminal/requestSource regression should stop expansion and enter host-side repair.
- evidence: `reports/service-traction-listed-product-upgrade-snapshot-latest.json`, `reports/service-traction-total-goal-progress-latest.json`, `reports/service-traction-global-consistency-insight-latest.json`, `src/service-traction-host-identity.js`, `src/service-traction-traffic-classification.js`

### BRD-HOST-OPS-006 董秘七类场景独立门禁
- priority: `P1`
- purpose: 把 BRD-DU-001 到 BRD-DU-007 从总括合规卡拆成可评审、可联调、可运营的场景单元。
- fields/events: ``
- acceptance: 材料不足时给最小可执行路径，不进入无限 intake。 / 每个场景有独立输入、输出、风险边界和继续动作。 / 场景门禁不得放宽无连接器首值基线。
- evidence: `data/workbuddy-listed-board-secretary-demand-unit-ledger-20260620.json`, `packages/fbsir-industry-scene-researcher/scene-pack.json`, `packages/long-manuscript-expert/scene-pack.json`

### BRD-HOST-OPS-007 统一证据链 manifest
- priority: `P1`
- purpose: 把审核包、宿主安装、前台确认、真实会话、上传就绪、联调就绪和提交后审计串成一条可接手链。
- fields/events: `reviewPackage, hostLocalInstall, frontstageConfirmation, currentSessionRecord, uploadReadiness, jointDebugReadiness, postSubmitAudit, cannotProve`
- acceptance: 每个节点必须有 path、status、canProve、cannotProve。 / 人工视觉确认必须保留 manual boundary。 / 官方替换和自然闭环仍作为后续门禁。
- evidence: `reports/board-secretary-assistant-review-package-latest.json`, `reports/board-secretary-assistant-local-install-integrity-latest.json`, `reports/board-secretary-assistant-frontstage-confirmation-latest.json`, `reports/board-secretary-assistant-current-session-followthrough-diagnose-latest.json`, `reports/board-secretary-assistant-post-listing-runtime-reverify-latest.json`, `reports/board-secretary-assistant-upload-readiness-latest.json`, `reports/board-secretary-assistant-joint-debug-readiness-latest.json`, `reports/board-secretary-assistant-post-submit-audit-latest.json`

### BRD-HOST-OPS-008 商业化与服务交付事件
- priority: `P1`
- purpose: 把首值后的兴趣、服务需求、交付、复访和乐包反馈从文本意图变成独立事件。
- fields/events: `advisorOwnerId, cloneExpertId, myExpertListingId, capabilityId, capabilityUnitId, activationMode, deliveryMode, unlockState, lebaoEventType, offer_shown, paid_intent, contact_request, delivery_started, delivery_completed, repeat_candidate, lebao_feedback_recorded`
- acceptance: lebao can support feedback and incentive loops, but must not replace payment or business closure evidence. / payment or paid-intent claims require independent commercial events. / commercial events inherit the same-binding and product-signature boundary.
- evidence: `src/fbss-commercialization-plane.js`, `reports/board-secretary-assistant-service-followthrough-smoke-latest.json`, `reports/service-traction-listed-product-upgrade-snapshot-latest.json`

### BRD-HOST-OPS-009 模板与能力单元运营底座
- priority: `P2`
- purpose: 为未来董办模板市场、场景包复用和能力单元计量预留结构化基础。
- fields/events: `templateId, capabilityClusterId, capabilityId, capabilityUnitId, activationMode, deliveryMode, unlockState, acceptanceCriteria, manualReviewCompletionState`
- acceptance: 模板采用率、返工率、人工复核完成率和风险拦截率可度量。 / 模板市场化不得绕过披露边界和人工审批。 / 模板可进入经营决策，但不能自动成为披露结论。
- evidence: `reports/service-traction-total-goal-progress-latest.json`, `src/fbss-commercialization-plane.js`, `packages/long-manuscript-expert/references/core/runtime-boundary-summary.md`

### BRD-HOST-OPS-010 解冻后仓内真源导入与复核门禁
- priority: `P2`
- purpose: 在已上架包冻结解除后，把 imported-source index 过渡为可引用的仓内 canonical package source。
- fields/events: `BRD-LIFT-001, BRD-LIFT-002, BRD-LIFT-003`
- acceptance: 冻结期只保留 record-only 需求和审核证据。 / 解冻后再执行包内 scene-pack、contract、marketplace-entry、README/support/privacy 文档落地。 / 任何真源导入必须经过 stage exclusion、no-connector、background decoupling 和 post-submit audit。
- evidence: `reports/board-secretary-assistant-post-submit-audit-latest.json`, `reports/board-secretary-assistant-review-package-latest.json`, `packages/fbsir-industry-scene-researcher/contracts/no-connector-action-contract.json`, `data/workbuddy-listed-board-import-validation-contract-20260620.json`, `data/workbuddy-listed-product-freeze-lift-touchpoint-map-20260620.json`

## 反过度宣称门禁

- local my-experts visibility does not prove official Expert Center replacement
- service-side continued-use probe does not prove real host-session natural closure
- first_value_completed does not prove continued_use_completed
- same-binding consume does not prove payment or revenue closure
- WorkBuddy and WorkBuddyAI evidence must remain separated by host, language, version, and path
- background research, service providers, and cases are review resources, not disclosure basis or liability outsourcing
- connector/MCP availability remains optional enhancement, not first-value prerequisite

## 下一步

Keep these requirements as the board-secretary host-side foundation backlog during the freeze window, and use them as the checklist when package/host code can be changed after listing or freeze lift.
