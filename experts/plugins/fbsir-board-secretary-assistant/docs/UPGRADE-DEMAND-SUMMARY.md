# 董秘助手新版审核包场景升级摘要

- 目标：把当前合规红队卡升级为可审核、可联调、可持续观察的新版审核包。
- 约束：当前上架包为底座；本仓不直接修改运行中的已上架包；改进只进入本次审核包产物。

| rank | demandId | priority | scenarioFamily | reviewOwner | riskClass | publishReady |
| ---: | --- | --- | --- | --- | --- | --- |
| 1 | `BRD-DU-001` | `P0` | `disclosure_drafting_and_rule_validation` | 董秘最终复核/法务合规复核/财务数字复核/管理层或董事会签发仍由人负责 | `regulated_disclosure_high` | `false` |
| 2 | `BRD-DU-002` | `P0` | `regulatory_inquiry_reply_outline` | 董秘组织协调/法务审阅/财务数据审阅/保荐机构或中介机构复核 | `regulated_disclosure_high` | `false` |
| 3 | `BRD-DU-003` | `P0` | `board_and_shareholder_meeting_materials` | 董秘/证券事务代表/会议主持或董事会办公室/法务 | `governance_sensitive_medium_high` | `false` |
| 4 | `BRD-DU-004` | `P1` | `ir_faq_and_earnings_meeting_support` | 董秘/IR 负责人/法务或合规负责人 | `public_communication_high` | `false` |
| 5 | `BRD-DU-005` | `P1` | `sentiment_and_risk_monitoring` | 董秘/公关负责人/法务/业务 owner | `market_sensitive_high` | `false` |
| 6 | `BRD-DU-007` | `P1` | `directors_supervisors_executives_trading_compliance` | 董秘/证券事务代表/法务或合规负责人 | `personal_data_and_trading_high` | `false` |
| 7 | `BRD-DU-006` | `P2` | `esg_and_governance_reporting` | 董秘/ESG 负责人/财务或内控/外部审计/咨询机构 | `regulated_reporting_medium_high` | `false` |
| 8 | `BRD-DU-008` | `P2` | `next_version_review_surface_consistency_and_routing_metadata` | Package owner confirms final bilingual naming and English routing wording for the next package/Manual review required before changing user-visible metadata that may affect host display or router matching | `metadata_and_routing_medium` | `false` |

## 审核输出字段

- `scenarioFamily`：场景族，必须来自台账或审核合同。
- `sourceRefs`：引用材料或监管依据，不允许空口给结论。
- `riskLevel` / `evidenceGap`：风险和缺证分开写。
- `reviewOwner` / `deadline` / `nextAction`：给人工复核和交接动作。
- `publicDisclosureAllowed=false` / `publishReady=false`：固定禁止自动发布。
