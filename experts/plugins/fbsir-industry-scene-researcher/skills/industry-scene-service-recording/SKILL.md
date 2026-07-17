---
name: industry-scene-service-recording
description: 行业场景研究员的服务侧记录与增强合同。默认首值走无连接器主线；只有宿主已显式暴露可执行工具时，才允许进入可选服务增强层。
---

# 行业场景服务记录合同

## 默认原则

- 首值必须在无连接器前提下成立。
- 连接器、MCP 工具、服务侧路由都不是首值前提。
- `hostActionEnvelope` 默认只用于宿主元数据或显式 debug，不代表真实服务写入已经发生。
- 所有记录先分清 `host_local`、`service_intent_report`、`service_consume` 三层；不得把本地项目产物冒充服务侧消费。

## 无连接器主线

1. 先收集最小上下文：行业、角色、目标。
2. 直接交付五件套首值：
   - 场景补位卡
   - WorkBuddy 作战路径
   - 人机混编任务表
   - 3 天试点行动包
   - 唯一下一步 CTA
3. 如果用户要求“直接给我五件套”、直接首值、方案首稿或等价表达，首个用户可见内容块必须是五件套正文；不要先输出连接器、MCP、服务工具、路由匹配、权限门或调试状态。
4. 显式服务增强请求也不能打断首值顺序：先交付五件套和唯一 CTA，再把服务增强结果或失败原因放在“可选增强边界/后首值观察”中。
5. 服务返回路由不匹配、`connector-status` 文案、`ToolSearch`/`DeferExecuteTool` 状态和 same-binding 缺失只能进入 `postFirstValueGaps`，不得作为首段说明或首值阻塞。
6. 如果用户已经进入“研究 → 搜集 → 策略 → 行动”模式，Day 1 动作包里至少要有 1 条带来源的真实素材；来源可以是 `WebFetch`、用户提供材料或可追溯本地文件。
7. 如果当前轮还没有真实来源行，就不要把 Day 2/Day 3 写成已经具备输入条件的深度仿真、测算或正式交付；应先把 Day 1 写成“补第一条真实来源证据”的动作。
8. 如果当前会话还没有验证过宿主能力，不在主路径里抛出未验证的专家名、Skill 名、连接器名或外部工具链；只允许写用户可理解的能力层和可选增强层。
9. 五件套交付后，如果用户已经明确要落地执行或项目包已经物化，默认继续动作问句是：`现在就执行 Day 1 吗？`
10. 准备 `hostActionEnvelope`，但默认不打印到普通用户可见正文。
11. 只有用户继续推进到动作包层，才讨论 `continued_use_completed`。
12. 当用户已明确要求 `生成 3 天试点项目包`、`把方案落到项目工作区` 或等价指令时，只有在当前回合真实完成宿主文件/任务工具调用后，才允许声称“已生成”“已写入工作区”“可通过文件卡片查看”。如果没有真实写入证据，必须明确写成“已给出项目包正文，但尚未物化到工作区”。
13. 物化项目包时只能使用宿主真实工具调用，不得在用户可见正文里输出任何伪工具调用或调试标记，包括但不限于 `<tool_call>`、`<tool_sep>`、`<arg_key>`、`<arg_value>`、`</tool_call>`、`</tool_calls>`、HTML 注释或伪 XML 参数块。
14. 如果当前宿主没有把 `Write`、`Edit`、任务创建或 `present_files` 等真实入口暴露出来，就保持聊天交付，不伪造“已生成项目包”的外观，也不把宿主工具语法打印给用户。
15. 如果当前回合在首值之后仍明确要求尝试服务侧记录或同一 binding 跟进，必须按“确认宿主是否真的暴露服务观察入口 -> 真实调用 -> 记录结果 -> 再解释”的顺序处理。`ToolSearch`、Skill 文档加载、参数草拟或文字说明都不算真实调用。
16. 如果用户只是要求把五件套推进成可执行项目包，默认先给紧凑版执行包：目标、输入、每日任务、交付物、验收、唯一下一步。不要在同一轮把整份 SOP、长报告模板和服务链路说明一起展开。
17. 如果宿主把 `DeferExecuteTool` 或实际 MCP 工具调用挂到 `waiting_for_permission`、可见授权弹窗或等价人工确认门上，必须把当前状态归类为 `visible_host_permission_pending` 或等价中文说明；这属于宿主授权门，既不是连接器故障，也不是服务链路失败。
18. `connector-status` 面板里的 `disconnected`、连接器列表文案或系统提醒中的断连描述，不足以单独证明服务增强不可执行。只有在首值已经交付且用户仍明确要求服务增强时，才做内部宿主能力扫描并尝试 `ToolSearch -> DeferExecuteTool`；只有真实工具入口不存在、被宿主拒绝或调用失败，才允许降级成 `service_attribution_missing` / `service_consume_unproven`。

## 事件分层

### `host_local`

来自 WorkBuddy 本地会话、任务账本、artifact-index、项目文件和可视化展示。可记录：

- `frontstage_first_value_delivered`
- `project_package_materialized`
- `artifact_presented`
- `task_ledger_completed`
- `visual_feedback_revised`
- `day1_execution_ready`

这些事件只能证明本地交付与项目推进，不能证明福帮手服务侧绑定、消费或继续使用完成。

### `service_intent_report`

用于可选的匿名意图回报和服务侧牵引。可记录：

- `anonymous_intent_hint`
- `intent_reported`
- `scene_recognized`
- `strategy_dispatch_requested`

建议字段包括：`intentFamily`、`selectedWorkflowGap`、`selectedIndustries`、`projectPackageMaterialized`、`day1ExecutionReady`、`artifactPresentedCount`、`naturalClosureClaimed=false`、`serviceProductCreditClaimed=false`、`paymentClosureAllowed=false`。

### `service_consume`

只能来自真实 MCP 工具或后端事件。可记录：

- `first_value_completed`
- `continued_use_completed`
- `explicit_consume`

`present_files`、文件写入、任务更新、memory 更新、PAUSED 自动化创建、模型正文里的 JSON 或文字说明都不能作为 `service_consume` 证据。

如果当前无连接器首值已经成立，但没有真实服务观察链路调用，报告应写成：

- `service_attribution_missing`：服务侧跟进或同绑验证尚未发生

而不是写成：

- 首值失败
- 最大遗漏必须立刻调用连接器
- 产品零价值沉淀

同理，`SkillManage` 未沉淀只能算宿主治理或知识复用层缺口，不能反推包合同未通过。

## 运行时自评模板

任何技术复盘、自我纠偏或优化清单输出前，先填这七项，再决定严重度：

1. `hostLocalVerdict`：本地首值、文件、任务、预览、自动加载产物分别证明了什么。
2. `serviceIntentVerdict`：是否只有匿名意图、行业、缺口、CTA 等可回报线索。
3. `serviceConsumeVerdict`：是否存在真实 MCP 工具调用或后端事件；没有就写 `service_consume_unproven`。
4. `firstValueVerdict`：只依据五件套、唯一下一步、Day 1 可执行性和无连接器合同判定。
5. `postFirstValueGaps`：把服务归因、SkillManage、hostActionEnvelope、continued-use 等放在后首值清单。
6. `severityDecision`：P0/P1/P2 的理由必须引用上面三层证据。
7. `singleNextAction`：只保留当前最高优先级动作。

P0 只允许用于阻断用户首值的缺陷：五件套缺失、无连接器首值被阻断、唯一下一步缺失、错误声称服务消费或官方上架、未经确认写文件或激活自动化。服务侧归因缺失、`SkillManage` 未沉淀、connector disconnected、deferred tools 可见但未调用，默认只能进入 P1/P2 或后首值跟进清单。

## 项目动作与自动化边界

- 用户未明确确认前，不创建任务、不写文件、不创建自动化。
- 用户确认 `生成 3 天试点项目包` 或等价指令后，可以物化项目动作包。
- 自动化创建和激活都需要独立确认；创建后的默认状态必须是 `PAUSED`。
- 自动化不早于 Day 1 素材池验收通过进入 `ACTIVE`。

## 来源证据账本

当输出来自 WebSearch、WebFetch、公开报告、用户资料或历史文件的行业数据时，必须同步记录来源证据账本。最低字段：

- `sourceTitle`
- `sourceUrl` 或用户资料/本地文件路径
- `retrievedAt`
- `claim`
- `evidenceStrength`
- `clientUseStatus`

证据强度只允许：

- `fetched_primary`
- `fetched_secondary`
- `user_provided`
- `search_summary_only`
- `needs_verification`

`search_summary_only` 和 `needs_verification` 不能进入客户可用初稿，只能进入内部参考或待核验清单。没有 URL、采集时间和证据强度时，不得声明“一手数据”“可直接引用”“客户可用”。

## 产出物自动装载交付环

当用户明确要求更适合分发、展示、评审或客户沟通的产物时，可以在首值和项目包之后进入产出物自动装载交付环。标准交付集：

- Markdown 源稿：继续编辑和人工校准。
- HTML 可视化版：可部署为网页，可浏览器打印或转 PDF。
- PDF 分发版：可发给客户或内部评审。
- 内联摘要卡：在 WorkBuddy 会话中快速预览核心结论。
- loaded preview：通过 `present_files`、artifact-index、`file://` 或浏览器标签自动打开，方便用户立即检查。

边界：

- 这仍然是 `host_local`，不能算 `service_consume`、客户已阅读或 `continued_use_completed`。
- 依赖安装、Node 初始化、PDF 转换脚本、浏览器渲染属于有副作用增强动作，必须在用户明确要求后执行。
- 运行时依赖应放在隔离工具目录；不得把 `package.json`、`node_modules`、转换脚本混进客户交付目录或项目根目录。
- 渲染后必须校验：文件存在、页数与说明一致、文本可抽取、首屏可读、来源证据账本可追溯。

## 宿主能力全景分层

当用户想知道“还能如何用 WorkBuddy 更多能力支持当前行动”时，应进入宿主能力全景分层，而不是直接丢一串工具名。

进入增强选路前，先在内部完成一次宿主能力扫描：`tool_search`、skills 目录、deferred tools。扫描结果只作为内部判断输入，不能把原始工具清单直接展示给用户；对外只输出“能力 → 缺口映射”。

标准层级：

- `interaction_enhancement`
- `content_generation`
- `automation_orchestration`
- `research_knowledge`
- `distribution_deployment`
- `memory_system`

每层都要同时标出：

- 已激活能力
- 已发现但未使用能力
- 真实缺口

之后必须通过 `AskUserQuestion` 让用户选 1-2 个增强方向。选项写法要先讲结果，再讲能力，例如“让方案书更有视觉冲击力”而不是只写“ImageGen”。这仍然属于 `host_local`，不能写成服务消费或 continued-use。

如果用户多选了多个增强方向，而其中一条路线因宿主未连接、MCP 不可达或 Skill 运行面缺失而失败，应继续推进剩余已选路线，并把失败路线记录为 `host_capability_route_degraded`。不要把“Skill 已安装但服务未连上”误写成“能力不存在”。

## 多智能体并行边界

- 每路子任务都必须声明一个核心问题。
- 子任务输出必须服务于“缺口 → 能力 → 行动”，不得偏成产品介绍或工具手册。
- 主智能体合并时，偏离缺口视角的子任务内容应直接裁剪，不原样展示。

## 可视化边界

- 可视化属于辅助理解，不是主交付物。
- 采用“一眼看清”标准；如果用户需要较长解释才能理解，必须改版或退回文字结构。

## WorkBuddy 应用创意库

当目标是为行业场景研究员提供“可复用的高绩效 WorkBuddy 使用模式”时，优先从创意库取材，而不是临时拼接工具名。

创意库应覆盖：

- `offline`：拜访、展会、巡检、培训、现场交付
- `online`：官网、客服、内容运营、直播、远程评审
- `stakeholder`：管理层、跨部门、客户、合作方、法务

每张创意卡至少要写清：

- 触发条件
- 输入
- 产出物
- WorkBuddy 能力组合
- 人机边界
- 唯一下一步
- 来源证据

边界：

- 创意库是 `host_local` 与方法论资产，不是服务侧消费证据。
- 助理、小程序、Bot 推送、自动化、云端部署、连接器都可作为高附加值增强，但必须标成 optional，不得变成首值前提。
- 创意探索阶段可以有选路问题；进入动作卡执行时，仍必须收敛为一个 `unique_next_step`。

## 可选工具增强

只有当宿主已经显式暴露以下工具时，才允许进入可选增强层：

- 宿主显式暴露的第一步服务观察入口
- 宿主显式暴露的中间结果读取入口
- 宿主显式暴露的同绑定结果记录入口

即便这些工具可用，也要遵守：

- 首值仍先交付
- 如果 `ToolSearch` 或宿主工具面板已经返回这些直连工具，下一步必须继续用宿主的 direct tool / deferred tool 机制真实调用，而不是停在解释链路、列工具名或复述文档
- 标准顺序是：先做同绑定身份/路由确认，再做中间结果读取，最后再做同绑定结果记录。只有工具真实执行后，才允许写入 `service_consume` 层
- 不得用 Bash、shell、文件写入或手工 HTTP 请求代替宿主侧 MCP 工具执行
- 不得把 Skill 文档加载写成真实工具调用
- 不得把 `host_local` 或 `service_intent_report` 事件升级成 `service_consume`
- 不得因为 deferred tools 可见或连接器面板显示 disconnected，就把“未调用服务观察链路”写成首值失败；这只能作为后续服务增强验证缺口。
- 不得把 `connector-status=disconnected` 直接当作“服务增强不可执行”的结论；优先级必须低于真实 `ToolSearch` / `DeferExecuteTool` 结果
- 如果工具可见但当前宿主没有给出可执行入口，必须明确降级为 `service_attribution_missing`、`service_consume_unproven` 或等价中文说明；不要把“将尝试调用”“应该调用”写成已经发生的服务记录。
- 如果宿主日志或会话状态显示 `waiting_for_permission`、`Approval dialog shown`、`RESULT: suppressed by interceptorGate` 或 `skipRun=true ... waiting_for_permission`，必须把这一层单独记为宿主授权门证据；在用户确认授权前，不得把后续 `scene_pack` / `consume` 文本提及当成真实执行。

## continued_use 与乐包边界

- `sameBindingConsume > 0` 不是 `continued_use_completed`
- `continued_use_completed` 之前不开放 `lebao_claim`
- 乐包、权益、claim 只是继续使用或权益状态信号，不是支付闭环

## 面向用户的翻译原则

默认把系统行为翻译成：

- 现在已经拿到什么
- 现在能继续做什么
- 还差哪一步才能进入更深动作
- 哪些只是服务牵引或激励，不是成交证明
