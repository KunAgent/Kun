# 董秘服务商红队资源阵营

- 服务商只作为对抗资源、工具源、证据源或模拟资源。
- 服务商不能进入 `reviewOwner`、`approvalOwner`、`legalReviewer`、`publishAgent` 等责任链字段。
- 固定禁止：自动发布、自动法律结论、责任外包、把服务商模板写成当前公司事实。

## 角色白名单

| roleId | roleName | useInRedTeam | disallowedUse |
| --- | --- | --- | --- |
| `official_disclosure_and_ir_anchor` | 官方披露与投关锚点 | 作为已披露事实、互动问答和正式渠道边界的核验源。 | 不得把官方平台之外的草稿、新闻稿或服务商输出当成法定披露替代品。 |
| `announcement_and_data_verification_tool` | 公告与数据核验工具 | 用于交叉检查公告、财务数字、历史问询、规则版本和来源时间戳。 | 不得把接口返回或模型摘要直接写成结论，必须保留来源和时间戳。 |
| `board_office_workflow_tool` | 董办流程与协同工具 | 模拟任务排期、三会、信披、减持、问询回复等协同链路压力。 | 不得由工具自动替代董秘、法务、财务或中介机构审核。 |
| `sentiment_and_public_opinion_tool` | 舆情与开源情报工具 | 模拟热点概念、媒体报道、股价异常和传闻扩散压力。 | 不得把舆情热度当作事实确认或公告触发结论。 |
| `esg_and_governance_tool` | ESG与治理披露工具 | 核验ESG指标口径、报告范围、证据链和一致性。 | 不得自动出具鉴证、评级、投资价值或已核验结论。 |

## 服务商与工具资源

| providerId | providerName | category | credibility | redTeamUses | mappedFamilies |
| --- | --- | --- | --- | --- | --- |
| `sse_one_stop_ir` | 上交所一网通办-投资者关系 | `official_platform` | `high` | 核验IR输出是否回到官方互动和路演边界 / 检查AI问答是否越过法定披露渠道 / 模拟多渠道口径一致性测试 | RT-F03, RT-F04, RT-F05 |
| `sse_e_interactive` | 上证e互动 | `official_investor_interaction` | `high` | 抽取投资者高压问题模拟互动问答红队 / 检查热点概念、财务解释、商誉减值类问题是否触发人工复核 / 对比AI回复与既有公开回复是否口径漂移 | RT-F01, RT-F03, RT-F05 |
| `sse_one_stop_disclosure` | 上交所一网通办-信息披露 | `official_disclosure_workflow` | `high` | 检查公告生成流程是否遗漏附件、备查文件或预约节点 / 验证候选董秘、信披文件和正式报送边界 / 测试AI是否把审稿误执行为报送 | RT-F04, RT-F05, RT-F06 |
| `sse_company_portrait` | 上交所公司画像系统 | `official_supervision_tech` | `high` | 模拟交易所视角的财务异常和披露风险复核 / 检查AI输出是否缺少异常解释链 / 设计误报/漏报复核用例 | RT-F05, RT-F06 |
| `szse_irm_cninfo` | 深交所互动易 | `official_investor_interaction` | `high` | 构造互动易热点问答压力测试 / 检查提前披露、误导性承诺和股价引导风险 / 核对回复是否引用已披露事实 | RT-F01, RT-F03, RT-F05 |
| `cninfo_webapi` | 深证信数据服务平台 CNINFO WebAPI | `official_data_api` | `high` | 公告事实核验 / 历史公告时间戳锁定 / 跨源一致性检查 / 测试旧数据误用和接口混淆 | RT-F02, RT-F05, RT-F06 |
| `cninfo_portal` | 巨潮资讯 | `official_disclosure_portal` | `high` | 核验公告是否已正式披露 / 测试AI是否引用旧公告或错板块公告 / 检查公告口径一致性 | RT-F02, RT-F05, RT-F06 |
| `panorama_ir_platform` | 全景路演投资者关系互动平台 | `ir_roadshow_platform` | `medium` | 模拟业绩说明会和投资者高频问答 / 检查旧口径误复用 / 测试批量问答风险分级 | RT-F03, RT-F04, RT-F07 |
| `roadshowchina` | 路演中 | `ir_roadshow_platform` | `medium` | 模拟定向路演中的选择性披露风险 / 测试投资者画像和定向触达合规 / 检查跨境路演口径一致性 | RT-F03, RT-F04, RT-F06 |
| `easy_board` | 易董 | `board_office_saas` | `medium` | 对照董办SaaS能力检查场景覆盖缺口 / 模拟合规知识库引用污染 / 测试流程、模板、留痕和权限边界 | RT-F02, RT-F04, RT-F06 |
| `ths_i_board_secretary` | 同花顺i董秘/董秘助手 | `board_office_saas` | `high` | 验证董秘助手同类能力覆盖 / 设计生成内容幻觉和错误引用测试 / 检查越权取数和自动签发风险 | RT-F04, RT-F05, RT-F06 |
| `jindongmi_jointown` | 九州通金董秘全周期工作管理系统 | `board_office_workflow_system` | `medium` | 把董秘工作流程化、模板化、数据化作为对抗基线 / 测试任务卡片是否保留责任人和截止时间 / 模拟三会、信披、再融资任务链遗漏 | RT-F04, RT-F06, RT-F07 |
| `trs_wangcha` | 拓尔思网察企业版/舆情监测 | `sentiment_and_osint_tool` | `medium` | 模拟舆情造假、热点概念和传闻扩散 / 验证舆情告警去重、来源可信度和升级条件 / 检查舆情压力是否诱导披露越界 | RT-F02, RT-F05, RT-F07 |
| `esgai_report_generator` | ESGAI报告智能生成器 | `esg_reporting_tool` | `medium` | 测试ESG报告绿色包装和无证据陈述 / 核验指标、范围和标准映射是否可追溯 / 设计模板化空话识别用例 | RT-F02, RT-F05, RT-F06 |
| `esgcloud_jingniu` | ESG Cloud鲸牛ESG数字员工 | `esg_reporting_tool` | `medium` | 模拟ESG知识问答引用错误 / 测试私有数据暴露风险 / 检查AI解释偏差和报告口径一致性 | RT-F03, RT-F05, RT-F06 |
| `qingyue_epmap` | 青悦AI辅助ESG报告撰写工具 | `esg_reporting_tool` | `medium` | 测试通用模板套写 / 检查披露口径和行业模板约束 / 设计人工终审缺失用例 | RT-F05, RT-F06 |
| `haoshanghao_wecom_ai_query` | 好上好企业微信AI查询实践 | `internal_workflow_practice` | `high` | 模拟内部经营数据越权查询 / 检查角色权限、字段脱敏和查询审计 / 测试内部问答向外部披露漂移 | RT-F03, RT-F04, RT-F06 |
| `nanwei_form_assistant` | 南威软件填报助手实践 | `form_and_process_ai_tool` | `high` | 测试公告表单字段映射错误 / 检查身份混淆和结构化校验缺失 / 模拟填报助手将合规判断自动化 | RT-F04, RT-F05, RT-F06 |
| `chongqing_bank_triple_disclosure_check` | 重庆银行公告校验三重检验实践 | `announcement_review_practice` | `high` | 把三重校验作为发布前闸门基线 / 测试正文数字与表格不一致 / 检查引用旧版本和附件遗漏 | RT-F04, RT-F05, RT-F06 |
| `cnopendata_sse_ir_dataset` | 上证e互动投资者问答数据表 | `third_party_dataset` | `medium` | 生成投资者问题压力样本 / 测试旧口径误复用 / 训练人工评审样本池 | RT-F02, RT-F05, RT-F07 |
| `sscc_fintech` | 深圳证券通信金融科技创新业务 | `financial_infrastructure_provider` | `medium` | 设计监管数据报送和企业信披边界测试 / 检查链上留痕和数据治理口径 / 模拟基础设施级权限分层 | RT-F04, RT-F06 |
| `wind_financial_terminal` | Wind金融终端与数据服务 | `financial_data_terminal` | `high` | 测试公告数据、ESG数据和行业基准的跨源一致性 / 检查授权数据是否被越权导出或二次分发 / 模拟实体名称和证券代码对齐错误 | RT-F05, RT-F06 |
| `eastmoney_choice` | 东方财富Choice | `financial_data_terminal` | `high` | 测试舆情预警阈值和数据检索一致性 / 模拟热点放大导致的错误事实判断 / 核验实体映射和公告日期 | RT-F02, RT-F05, RT-F07 |
| `ths_ifind` | 同花顺iFinD | `financial_data_terminal` | `high` | 做公告、研报、路演、舆情和ESG多源交叉检索 / 测试批量导出和二次分发失控 / 检查同一事实在不同数据源中的口径差异 | RT-F03, RT-F05, RT-F06 |
| `datayes` | 通联数据 | `financial_data_api` | `high` | 测试数据字典、接口延迟和另类数据噪声 / 检查多源融合后的来源追溯 / 模拟数据口径不一导致的披露误判 | RT-F02, RT-F05, RT-F06 |
| `syntao_green_finance_star` | 商道融绿STαR ESG | `esg_rating_and_data` | `medium` | 检查ESG指标映射和争议事件响应 / 测试评级方法论偏好对披露判断的影响 / 模拟漂绿叙事和评级引用越界 | RT-F05, RT-F06 |
| `china_securities_index_esg` | 中证指数数据与ESG服务 | `index_and_esg_data` | `high` | 做行业和同业对标 / 核验ESG风险提示和主题赛道识别 / 测试指标基准被误写成公司事实 | RT-F05, RT-F06 |
| `pkulaw` | 北大法宝 | `legal_research_database` | `high` | 核验法规版本、效力和适用范围 / 做监管案例和条款比对 / 测试法条检索是否被误写成法律意见 | RT-F05, RT-F06 |
| `wkinfo` | 威科先行 | `legal_and_tax_research_database` | `high` | 验证税务、内控、合规和双语披露一致性 / 测试专业解读滞后和跨境适用误判 / 做条款翻译和规则引用核验 | RT-F05, RT-F06 |
| `qcc` | 企查查 | `business_registry_and_risk_data` | `medium` | 验证股东、关联方、供应链和合作方身份 / 测试实体消歧和关联关系穿透 / 模拟个人关联数据过度使用 | RT-F03, RT-F05, RT-F06 |
| `qixin` | 启信宝 | `business_registry_and_risk_data` | `medium` | 验证合作方尽调和风险监控 / 测试企业画像与投资者画像混用 / 检查关系挖掘是否超过授权边界 | RT-F03, RT-F05, RT-F06 |

## 引入边界

- 引入服务商是为了增强红队对抗资源，不构成合作背书。
- 服务商数据、接口、样本、模板和舆情信号必须单独标注来源、时间戳、授权状态和可信度。
- 任何服务商输出都必须回到董秘、法务、财务、IR 或中介机构的人工复核。
- 服务商材料不能替代证监会、交易所规则，也不能替代公司正式公告和底稿。
