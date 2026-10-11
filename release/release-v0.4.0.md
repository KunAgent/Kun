# Kun 0.4.0

0.4.0 将 Agent 私聊、群聊和第三方 Agent 接入整合进 Code，统一 Work 的文档与论文工作流，并带来 Kun 账号、衣橱与羽毛商店。本地模型网关、模型选择、用量展示和插件市场也迎来更新。

## ✨ 新功能

- **Code 中的 Agent 对话**：在 Code 中与个人 Agent、Codex、Claude Code、OpenCode 持续对话，集中查看子任务、执行进度和用量。原 Rooms 的私聊、群聊与 Agent 目录并入 Code，会话支持未读与待处理提示、归档、删除和恢复。第三方 Agent 接入页统一管理安装、连接、模型、启动配置与版本，后台安装和更新持续显示进度；支持查看来源 Agent 提供的子 Agent 卡片、子任务列表与只读侧会话。
- **统一 Work 工作区**：在同一个 Work 工作区组织文档、文件和论文，使用所选 Agent 处理当前资料，并用 `@` 引用文件。Work 助手复用 Code 的 Agent 选择，携带打开的文档、论文及 PDF 标注上下文；多面板与右侧工具栏连接资料预览、编辑、对话和白板。手机远程端补齐 Work 文档与论文操作。
- **Kun 账号与衣橱**：登录 Kun 账号，收集漂流瓶、装扮和角色卡，通过羽毛商店与邀请奖励丰富你的 Kun。侧栏新增账号卡与头像菜单，可进入全页衣橱、商店和邀请；支持试穿搭配、单抽与十连、重复装扮转换羽毛、兑换未拥有的装扮，以及导出邀请海报。衣橱与装扮绑定账号；美术资源支持独立更新与回退。
- **本地模型网关**：外部客户端可通过本机网关复用 Kun 配置的兼容模型连接，并查看近期路由、会话用量和客户端额度。新增 OpenAI Responses 与 Gemini 原生协议入口，扩展路由规则、会话亲和性和账户调度；客户端密钥可分别限制模型、协议、有效期与用量。供应商配置支持变更预览、导入导出和加密备份，自定义余额查询可配置单位与认证头。
- **模型选择与用量**：模型选择器支持搜索、按供应商分组，并记住各 Agent 的模型与推理设置。原生 Agent 支持在会话内切换模型；上下文占用、首字耗时、生成速度、模型调用和工具详情展示更完整。用量页整合额度与趋势；输入框可显示当前匹配的 Claude Code / Codex 登录账号的订阅剩余额度和重置时间。
- **论文检索与阅读**：论文检索、候选结果与导入流程重新整理，批量解读为每篇论文保留独立会话。阅读用途可直接从阅读器选择，对比与 Related Work 请求送入 Work 助手。新增绑定 PDF 版本的证据卡与对比矩阵，区分原文、解读和人工核验，支持保留手工编辑、标记未知数据与撤销；替换 PDF 后旧证据不会自动改绑。
- **插件与技能市场**：插件页接入有道 Skill / MCP 市场，支持分类浏览、分页、来源标记与缓存目录。已安装列表集中管理启用、配置和更新；MCP 配置表单汇总必填密钥、启动命令或远程连接参数，缺少配置时显示待处理状态。
- **个人 Agent 与记忆管理**：个人 Agent 可在自己的工作区持续跟进目标、提醒和已授权的 Code / Work 任务，任务结果可回到原会话。记忆检索增加来源证据，管理界面支持版本历史、修正、回退、停用、忘记与永久删除；项目记忆可通过经过预览的 Markdown 导入导出。
- **多 Agent 协作（实验功能）**：开启协作功能后，Kun 可派发 worker、跟进状态和预算，在独立任务工作区检查改动、审阅结果并预览合入。支持不同 Agent 的任务分工、交叉审查与结果比较；外部 Agent 的具体能力以接入检测为准。
- **更新摘要与首次引导**：升级后首次启动可查看内置的中英文更新摘要，设置中也能重新打开。设置页加入可搜索导航，首次引导更新为五步流程；会话导出支持选择范围，暂停的消息队列可从输入框继续。终端新增供应商检测、网关路由、Agent 与额度查询命令。

## 🐛 修复与改进

- **会话连续性**：修复原生 Agent 连续回合、失败后继续和模型切换时丢失会话或回复的问题。补齐切换 Agent、模型与账号后的上下文衔接；Codex、Pi、OpenCode 和 CodeMaker 的中途指导能实际送达当前执行过程。
- **性能与启动**：减少空闲时重复探测与进程开销，加快后台会话重新打开。外部 Agent 会话缓存和长过程时间线保持有界；修复 OAuth 刷新死锁导致启动卡住，以及多个进行中计划步骤导致回合失败的问题。
- **群聊与任务恢复**：面向整个群的消息可由成员并行回应，发送失败提供可关闭的错误提示。修复过期协调器租约、排队消息恢复、后台结果与审批通知衔接，以及上传取消和重试中的状态问题。
- **供应商与模型配置**：模型目录刷新保留账号作用域元数据、用户价格与限制，失效模型引用可逐项修复。修复空模型路由进入运行时配置、原生登录识别和模型目录加载问题；网关近期路由可跨重启保留，多实例发现文件与长轮询更可靠。
- **用量与工具详情**：第三方 Agent 的模型调用、用量与缓存按实际调用记录，原生和 ACP Agent 使用统一工具详情。修复趋势图缩放后的悬停定位，避免把订阅额度、API 余额和上下文占用混为一项。
- **界面与多语言**：窄窗口输入框、模型菜单、Agent 配置页与插件页布局更清晰，Focus 模式保留完整账号卡。改进衣橱加载、头像裁剪与装扮对齐，修复中文复数字符串和俄语复数形式，并同步各语言的目录文案。
- **更新与语音**：加固 Windows 更新回滚协调、工作流持久化和下载恢复，改进安装器界面。修复语音朗读资源下载与缺失资源处理，更新后可从设置重新查看本次发行说明。

## 更新方式与兼容说明

通过应用内更新入口下载更新，完成后重启 Kun 安装。Kun Runtime 和终端命令随桌面应用一同更新。

供应商配置会迁移到新的配置结构；使用新版配置或记忆生命周期功能后，不应直接用旧版程序或旧配置文件覆盖当前数据。衣橱收集、换装和美术资源更新需要登录 Kun 账号。

---

## English

Kun 0.4.0 brings Agent private chats, groups, and third-party Agent connections into Code, unifies document and paper workflows in Work, and adds Kun accounts, a wardrobe, and a feather shop. The local model gateway, model selection, usage views, and plugin marketplace also receive updates.

### Features

- **Agent conversations in Code**: Chat with personal Agents, Codex, Claude Code, and OpenCode, and follow subtasks in Code. Former Rooms private chats, groups, and the Agent directory now live in Code, with unread and attention indicators, archiving, deletion, and recovery. A unified third-party Agent page manages installation, connections, models, launch settings, and versions, with progress for background installs and updates. View subagent cards, subtask lists, and read-only side sessions where the source Agent provides them.
- **Unified Work workspace**: Keep files and papers together, and use your selected Agent with open material and `@` references. The Work assistant shares Code's Agent selection and receives context from open documents, papers, and PDF annotations. Multiple panels and the right rail connect previews, editing, conversations, and whiteboards. Mobile remote access gains Work document and paper operations.
- **Kun account and wardrobe**: Sign in to collect outfits and character cards, with feathers and invitation rewards. The sidebar account card and avatar menu open the full-page wardrobe, shop, and invitations. Try on outfits, open one or ten bottles, convert duplicate outfits to feathers, redeem unowned outfits, and export invitation posters. Wardrobe ownership belongs to the account. Artwork can update independently and roll back.
- **Local model gateway**: External clients can reuse compatible model connections configured in Kun through its local gateway, with recent routes, session usage, and client allowances. New OpenAI Responses and Gemini-native ingress expand protocol support, alongside routing rules, session affinity, and account scheduling. Client keys can limit models, protocols, expiry, and usage. Provider configuration gains change previews, import/export, encrypted backups, and configurable balance units and authentication headers.
- **Model selection and usage**: Search models by provider and retain each Agent's model and reasoning settings. Native Agents can switch models within a session. Context usage, time to first token, generation speed, model calls, and tool details are more complete. Usage views combine allowances and trends; the composer can show subscription allowance and reset times for the currently matched Claude Code or Codex login account.
- **Paper search and reading**: Redesigned search, candidate results, and import flows keep a separate conversation for each paper in batch interpretation. Choose a reading purpose in the reader and send comparison or Related Work requests to the Work assistant. PDF-version-bound evidence cards and comparison matrices separate quotations, interpretations, and manual verification, preserve manual edits, mark unknown values, and support undo. Replacing a PDF does not silently rebind earlier evidence.
- **Plugin and skill marketplace**: Browse the Youdao Skill / MCP market with categories, pagination, source badges, and cached catalogs. Installed items have shared enablement, configuration, and update controls. The MCP form brings required keys, launch commands, and remote connection settings together, and marks incomplete configuration as needing attention.
- **Personal Agents and memory management**: Personal Agents can follow goals, reminders, and authorized Code / Work tasks in their own workspaces, with results returning to the original conversation. Memory recall gains source evidence, while management supports revision history, corrections, rollback, disabling, forgetting, and permanent erasure. Project memories can be exchanged as Markdown through reviewed import/export.
- **Multi-Agent collaboration (experimental)**: With collaboration enabled, Kun can dispatch workers, follow their status and budgets, inspect changes in isolated task workspaces, review results, and preview integration. Task delegation, cross-review, and result comparison support different Agents, subject to each connection's detected capabilities.
- **What's new and onboarding**: An offline bilingual update summary appears on the first launch after an upgrade and can be reopened in Settings. Settings gain searchable navigation and onboarding becomes a five-step flow. Choose the scope of conversation exports and resume a paused message queue from the composer. Terminal commands add provider checks, gateway routing, Agent, and allowance queries.

### Fixes and improvements

- **Conversation continuity**: Native Agent sessions and replies survive follow-up turns, failed turns, and model changes more reliably. Context continuity improves across Agent, model, and account switches; mid-turn guidance reaches Codex, Pi, OpenCode, and CodeMaker execution.
- **Performance and startup**: Less repeated detection and process work while idle makes background conversations faster to reopen. External Agent caches and long-running timelines stay bounded. Fixes address startup deadlocks during OAuth refresh and turns failing on plans with multiple in-progress steps.
- **Group chats and task recovery**: Whole-group messages can receive parallel replies, and send failures show dismissible errors. Recovery improves for stale coordinator leases, queued messages, background results, approval notifications, canceled uploads, and retries.
- **Provider and model configuration**: Catalog refreshes preserve account-scoped metadata, user prices, and limits, while stale model references can be repaired individually. Fixes cover empty model routes entering runtime configuration, native-login detection, and catalog loading. Recent gateway routes survive restarts, with more reliable multi-instance discovery and long polling.
- **Usage and tool details**: Third-party Agent usage and cache accounting follow actual model calls, with shared tool details for native and ACP Agents. Trend-chart hover follows scaled layouts, and subscription allowances, API balances, and context usage remain distinct.
- **Interface and languages**: Narrow-window composers, model menus, Agent configuration, and plugin layouts are clearer, and Focus mode retains the full account card. Wardrobe loading, avatar cropping, and outfit alignment improve. Chinese and Russian plural forms are fixed, with folder wording updated across locales.
- **Updates and speech**: Windows update rollback coordination, workflow persistence, and download recovery are hardened, with an updated installer interface. Speech resource downloads and missing-resource handling are fixed, and the release notes can be reopened in Settings.

### How to update and compatibility

Download the update from Kun and restart to install. The bundled runtime and terminal commands update with the desktop application.

Provider configuration migrates to the new structure. After using the new configuration or memory lifecycle features, do not overwrite the current data with an older application or configuration file. Collecting wardrobe items, changing outfits, and updating artwork require a Kun account.

[Full changelog](https://github.com/KunAgent/Kun/compare/v0.3.12...v0.4.0)
