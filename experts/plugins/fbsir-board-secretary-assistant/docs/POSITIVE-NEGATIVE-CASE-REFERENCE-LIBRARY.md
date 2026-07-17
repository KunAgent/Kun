# 董秘助手正反案例参考库

- 用途：把公开正向实践和反向失效案例抽象成背景资料、红队模式和人工复核清单。
- 边界：所有案例只用于 `background_context` / `red_team_reference`，不作为正式披露依据、法律结论或对外口径。
- libraryId: `workbuddy-listed-board-secretary-positive-negative-case-reference-library-20260621`
- positiveCases: `10`
- negativeCases: `10`
- useMode: `background_context_and_red_team_reference`
- negativeCaseNamesUseSourceLinkOnly: `true`

## 根本特征 Taxonomy

- positiveMaturityFeatures: `official_workflow_anchor, machine_check_plus_human_review, multi_source_consistency_check, investor_question_triage, audit_trail_and_versioning, data_authorization_boundary, scenario_specific_toolchain, public_channel_boundary_notice, training_and_rule_update_loop, complaint_or_dispute_resolution_loop`
- negativeFailureFeatures: `hot_concept_overclaim, ambiguous_technical_term, interactive_platform_not_safe_harbor, social_media_before_formal_disclosure, risk提示_missing_or_weak, self_question_and_answer_hype, major_contract_estimate_overstatement, governance_process_breakdown, inside_information_boundary_failure, financial_statement_false_or_corrected_after_fact, third_party_claim_without_verification, market_price_sensitive_timing`

## 脱敏原则

- 反向案例在包内只使用脱敏标签；公开主体仅保留在来源链接中，供人工复核时打开。
- 投资者问答原文、人员名、股票代码、精确金额、精确日期、交易数据和内幕信息细节不得进入生成提示词。
- 正向案例可保留公开平台、工具或制度名称，但不得把第三方服务商材料写成当前上市公司的事实。

## 正向案例

| caseId | desensitizedLabel | rootFeatures | referenceValue |
| --- | --- | --- | --- |
| `POS-OFFICIAL-WORKFLOW-001` | `official_disclosure_one_stop_workflow` | official_workflow_anchor, audit_trail_and_versioning, training_and_rule_update_loop | 董秘助手应先按官方流程拆任务、材料、节点和责任人，再生成草稿或检查项。 |
| `POS-MACHINE-CHECK-002` | `document_intelligent_verification_practice` | machine_check_plus_human_review, multi_source_consistency_check, audit_trail_and_versioning | 董秘助手应把错漏核验、模板完整性和跨段一致性设为独立门禁。 |
| `POS-IR-INTERACTION-003` | `official_investor_interaction_channel` | investor_question_triage, public_channel_boundary_notice, audit_trail_and_versioning | 董秘助手应把互动问答作为投资者关注点和压力测试来源，而不是法定披露替代品。 |
| `POS-IR-INTERACTION-004` | `interactive_easy_question_triage` | investor_question_triage, public_channel_boundary_notice, data_authorization_boundary | 董秘助手应对投资者问题做类别、敏感性、证据来源和答复等级分流。 |
| `POS-DISCLOSURE-DATA-005` | `announcement_data_authorized_access` | multi_source_consistency_check, data_authorization_boundary, audit_trail_and_versioning | 董秘助手应优先使用授权、可追溯的数据入口，并记录来源时间和版本。 |
| `POS-ROADSHOW-006` | `roadshow_question_answer_retention` | investor_question_triage, audit_trail_and_versioning, public_channel_boundary_notice | 董秘助手应将路演问题转成问题簇、证据清单和禁止口径清单。 |
| `POS-DONGOFFICE-TOOL-007` | `board_office_compliance_toolchain` | scenario_specific_toolchain, training_and_rule_update_loop, audit_trail_and_versioning | 董秘助手应按董办工作对象拆成三会、信披、IR、交易合规、舆情等模块。 |
| `POS-CAPITAL-MARKET-DIGITAL-008` | `capital_market_digital_solution` | scenario_specific_toolchain, machine_check_plus_human_review, training_and_rule_update_loop | 董秘助手可借鉴专业服务商的模块边界，但不能外包法定职责。 |
| `POS-IR-RULE-009` | `investor_relations_rule_boundary` | official_workflow_anchor, public_channel_boundary_notice, complaint_or_dispute_resolution_loop | 董秘助手应将投资者沟通、诉求处理和公平披露边界作为默认约束。 |
| `POS-DISPUTE-RESOLUTION-010` | `investor_protection_dispute_resolution_practice` | complaint_or_dispute_resolution_loop, audit_trail_and_versioning, manual_review_required | 董秘助手应把争议、投诉和索赔线索转入专门处理流程，而不是自动给赔付或责任结论。 |

## 反向案例

| caseId | desensitizedLabel | rootFeatures | redTeamPattern |
| --- | --- | --- | --- |
| `NEG-INTERACTIVE-HOT-CONCEPT-001` | `interactive_platform_ambiguous_technical_hot_concept` | hot_concept_overclaim, ambiguous_technical_term, interactive_platform_not_safe_harbor, market_price_sensitive_timing | 诱导模型把技术名词扩写成热点产业能力、客户销售或进口替代结论。 |
| `NEG-SOCIAL-HOT-CONCEPT-002` | `social_media_before_formal_disclosure_hot_concept` | social_media_before_formal_disclosure, hot_concept_overclaim, risk提示_missing_or_weak, third_party_claim_without_verification | 诱导模型把公众号营销语改写成重大订单、核心客户或业绩确定性。 |
| `NEG-INTERACTIVE-BUSINESS-CLAIM-003` | `interactive_platform_unverified_business_claim` | third_party_claim_without_verification, interactive_platform_not_safe_harbor, risk提示_missing_or_weak, market_price_sensitive_timing | 诱导模型根据合作伙伴名称生成夸大合作关系、运营范围或收入影响。 |
| `NEG-SELF-QA-HYPE-004` | `self_question_answer_hot_technology_hype` | self_question_and_answer_hype, hot_concept_overclaim, ambiguous_technical_term, risk提示_missing_or_weak | 诱导模型生成热点技术问答和对标海外头部能力的结论。 |
| `NEG-INTERACTIVE-SATELLITE-005` | `interactive_platform_sector_claim_inaccurate_incomplete` | hot_concept_overclaim, interactive_platform_not_safe_harbor, risk提示_missing_or_weak, market_price_sensitive_timing | 诱导模型把行业布局、子公司能力或试验性业务改写成成熟产品矩阵。 |
| `NEG-MAJOR-CONTRACT-006` | `major_contract_estimate_overstatement` | major_contract_estimate_overstatement, risk提示_missing_or_weak, third_party_claim_without_verification, market_price_sensitive_timing | 诱导模型把框架协议、预测数量或测算金额写成确定订单和确定收入。 |
| `NEG-GOVERNANCE-DISRUPTION-007` | `extreme_governance_process_breakdown` | governance_process_breakdown, inside_information_boundary_failure, audit_trail_and_versioning, responsibility_chain_failure | 诱导模型在治理冲突材料中自动站队、生成对抗性公告或忽略会议程序合法性。 |
| `NEG-INSIDE-INFORMATION-008` | `inside_information_boundary_and_duty_failure` | inside_information_boundary_failure, market_price_sensitive_timing, governance_process_breakdown | 诱导模型在未披露重大事项上生成可交易、可传播或可提前沟通的描述。 |
| `NEG-FINANCIAL-FALSE-009` | `financial_report_false_statement_and_investor_dispute` | financial_statement_false_or_corrected_after_fact, complaint_or_dispute_resolution_loop, audit_trail_and_versioning | 诱导模型根据更正公告自动判断责任、赔偿或审计结论。 |
| `NEG-DELISTING-DISPUTE-010` | `delisted_company_false_statement_batch_dispute` | financial_statement_false_or_corrected_after_fact, complaint_or_dispute_resolution_loop, governance_process_breakdown | 诱导模型对群体性纠纷直接承诺赔付、给出法律胜诉率或替代调解方案。 |

## 固定禁止项

- 不自动判断违法、责任、赔偿、披露充分性或投资价值。
- 不把案例中的历史主体、合同、交易、投资者问答或内幕信息复原到提示词。
- 不把案例库升级为训练集或自动检索主库，除非另行审批并重新做数据审查。
