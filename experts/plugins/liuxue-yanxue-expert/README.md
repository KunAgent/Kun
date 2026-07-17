# 留学研学专家

福帮手（FBSir）出品。产品名称：留学研学专家。

- 包名：`liuxue-yanxue-expert`
- 版本：`26.6.30.1`
- 宿主：`WorkBuddy`
- 正式上架面：官方专家市场 `experts`
- 服务侧产品标识：`workbuddy_liuxue_yanxue_expert`
- 连接器关系：解耦，不依赖连接器

## 定位

本专家面向学生与家长，提供高考志愿窗口、留学、研学、小语种路径、亚洲低成本路线、合作办学和研学桥接场景的首轮规划。

它不是留学顾问的替代品，也不是连接器入口。核心目标是在用户第一次进入 WorkBuddy 时，用最少信息交付能讨论、能复核、能转交的家庭规划方案，并把服务侧需要的脱敏产品、入口、意图、乐包和下一步牵引信号完整带上。

## 26.6.30.1 审核优化点

- 统一品牌为“福帮手 / FBSir”。
- 统一产品名为“留学研学专家”。
- 修正基础包中的中文乱码和旧版本号。
- 补齐服务侧可识别的产品、入口、意图、场景包、乐包和归因字段。
- 明确“不依赖连接器”，首轮价值不以连接器能力为前置条件。
- 明确“同一用户可脱敏归一，但不同乐包来源必须分账”。
- 增加正式上架所需的机器可读合同、场景包和发货清单。

## 服务侧启动源说明

本包的服务侧启动别名与入口签名如下：

- `entryPromptCode`: `wb_qp_liuxue_yanxue_dual_track_48h`
- `defaultPromptId`: `fbss_liuxue_yanxue_dual_track_start`
- `cardActionId`: `fbss_liuxue_yanxue_dual_track_start`
- `entryId`: `liuxue-yanxue-dual-track`
- `expertEntryId`: `liuxue-yanxue-expert`
- `packCode`: `fbs.liuxue_yanxue.dual_track.v1`
- `scenePackId`: `liuxue_yanxue_dual_track`

`service-side-closure-report.schema.json` 中的 `source.tool` 固定为 `fbss_liuxue_yanxue_dual_track_start`，它表示服务侧识别和闭环启动源，不要求包内再携带一份 `src/` 服务代码。

## 首轮价值

用户首次进入后，专家应尽快交付：

- 当前窗口判断。
- 两到三条可选路线。
- 家庭一页纸。
- 学生行动卡。
- 48 小时、7 天、30 到 90 天的动作顺序。
- 风险与人工复核项。
- 乐包进度提示和下一步能力建议。
- 一个最重要的下一步。

## 服务侧闭环

包内 `.codebuddy-plugin/plugin.json`、`scene-pack.json`、`ship-manifest.json` 和 `contracts/` 共同声明服务侧闭环合同。

关键字段必须同行传递：

- `productId`: `liuxue-yanxue-expert`
- `serviceProductId`: `workbuddy_liuxue_yanxue_expert`
- `entryId`: `liuxue-yanxue-dual-track`
- `expertEntryId`: `liuxue-yanxue-expert`
- `entryPromptCode`: `wb_qp_liuxue_yanxue_dual_track_48h`
- `defaultPromptId`: `fbss_liuxue_yanxue_dual_track_start`
- `cardActionId`: `fbss_liuxue_yanxue_dual_track_start`
- `channelTrack`: `study_abroad_study_tour`
- `intentFamily`: `international_education_planning`
- `profileSegment`: `family_decision`
- `packCode`: `fbs.liuxue_yanxue.dual_track.v1`
- `scenePackId`: `liuxue_yanxue_dual_track`
- `routeCode`: `route.liuxue_yanxue.dual_track`

## 乐包与身份边界

- 用户身份可以在服务侧做脱敏归一，用于连续体验。
- 乐包必须按产品、入口、渠道和场景包分账，不能把不同专家的乐包混在一起。
- 伪造点击、过期点击或缺少同绑定证据的点击，只能进入干跑或诊断，不得进入自然产品信用。
- 非正式面、等效面或诊断面证据不得作为正式自然流量证明。
- 乐包是进度反馈和下一步建议，不是支付、充值、现金、券或会员权益。

## 分类说明

当前使用 `categoryId = 12-IndustryConsultant`。

理由是：本产品本质上是家庭决策与路径规划类专家，横跨高考志愿、留学、研学和顾问承接，优先体现“咨询型入口”而不是单一教学工具。后续如平台分类体系有更贴近“教育升学规划”的类目，可以再行调整，但这不影响本次提审。

## 包边界

本包只表达正式上架所需的产品事实、合同和运行边界，不绑定本地等效联调路径、仓库脚本名或审计过程实现。

## 合规边界

智能助手只能生成规划建议和材料清单。录取、签证、奖学金、移民、就业、合同、收费、退款、安全承诺、排名提升、营地名额、成团、未成年人出境和旅行社履约，必须人工确认。

首轮输出必须说明“AI 方案草稿，不构成保证结果”。“保底”只能解释为多准备一条风险较低的备选路，不得表达为保证录取、保证签证、保证成团或保证安全。
