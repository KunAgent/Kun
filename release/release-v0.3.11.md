# Kun 0.3.11

0.3.11 引入 Rooms 多智能体协作空间、远程移动端访问和论文研究工作区；Write 模式重构为无损 Markdown 单视图编辑器，并改进模型连接、记忆、上下文导入与全链路性能。

## ✨ 新功能

- **Rooms 多智能体协作**：新增持久化 Agent 协作空间，支持私聊与群组讨论、内置五人初始团队、持久 Agent 身份与作用域记忆；统一的紧凑侧边栏整合 Agent 与群聊，右侧 IM 气泡为标准布局，支持 @ 提及成员选择器、已送达/输入中回执、行内重命名与自定义群头像；只读 Run 检查面板可查看 Agent 会话时间线 (#1333)。
- **Excalidraw 白板**：Rooms 支持 Excalidraw 画板与 PNG 投递，Agent 可直接在打开的画布上绘图，并提供可选的 Excalidraw 引擎。
- **远程访问与移动端**：新增远程访问设置面板，支持二维码、密码可见性切换与 Tailscale 检测；手机尺寸视口下提供完整移动端布局——远程 App 外壳、Rooms/Work 界面、可搜索的分组模型选择器、触屏友好的侧边抽屉与会话隔离。
- **Write 单视图编辑器**：Write 模式重构为无损 Markdown 编解码器驱动的单视图界面，支持块级编辑（悬停意图块菜单、子菜单与图标）、块级差异审阅、数学编辑、Mermaid、代码高亮与链接，以及共享导出渲染管线；格式工具栏新增下划线与查找选项，文档属性支持 AI 辅助生成。
- **论文研究工作区**：Work 论文模式新增多源快速检索、会议与 arXiv 发现，以及独立会话式 Agent 检索；论文池汇总结果、推荐、批量导入与 BibTeX。文库支持元数据编辑、分组、空文件夹与指定文件夹导入，并在全库范围复用已有论文。PDF 阅读器加入翻译叠层与双语镜像、批注和区域标记、引用与阅读活动视图。外部检索源的限流或失败会在结果中呈现。
- **模型连接与故障切换**：供应商支持多账户切换组、配额感知路由、按失败原因冷却与智能/轮询/最少使用策略；可分别配置 Chat Completions、Responses 和 Messages 端点，检测协议并从常用客户端导入供应商配置；本地网关支持 Anthropic Messages 兼容接口。
- **Agent 上下文导入**：新增 `/import` 命令与导入引擎，支持 Cursor、Gemini、Copilot、Windsurf、Cline、Zed、OpenCode、Kiro、Roo Code、Kilo Code、Continue、Amp、Goose 等来源的规则导入，保留作用域条件与围栏代码块，并在覆盖手改导入块前警告 (#1316, #1319)。
- **记忆反馈进化**：新增显式记忆反馈操作（确认/纠正）、持久化反馈账本与离线反馈排序评估器，反馈诊断独立隔离，预注册评估门槛 (#1324, #1325, #1326)。
- **记忆检索与规则**：Agent 可用只读工具检索和列出长期记忆；用户确认的规则可跨回合生效，创建、提升或重新启用规则均需明确的人类决定。导入与自动蒸馏的记忆仍作为参考资料，不会自动变成规则 (#1344)。
- **StepFun 供应商**：新增 StepFun 预设，支持 API 与 Step Plan 订阅，含品牌图标与 Step Plan 模型目录。
- **其他**：Rooms 增加成员注意力模式、一次性提醒、私聊中途导向与待用户决定的提案卡；远程桥接脚本与传输增强；图表渲染组件与工具提示；Work 界面未读会话活动提示；X 文章图片处理与标题复制；Code 项目可附加额外文件夹；语音朗读替换为按需加载的 sanoTTS。

## 🐛 修复与改进

- **性能**：事件总线去除尾部保留并去重序列化；JSONL 线程日志增量读取与折叠；事件高水位批量提交；游标检查点改为内存态；渲染层按事件批次合并 store 提交、时间线回合引用稳定、流式打字动画期间跳过 Shiki 高亮；安装包通过压缩与载荷裁剪减小体积。
- **会话与运行时**：修复会话恢复锁序死锁 (#1335, #1336)；共享模式 serve 可附加而不抢占应用会话；应用进程生命周期绑定 GUI；Windows 启动器失败正确暴露；响应被 max output tokens 截断时自动续写；Responses 推理项重放与 wire 级 400 恢复；orphan dev 会话回退到最近的内置渲染器。
- **Rooms 可靠性**：私有响应流式渲染、无轮询与历史重绘；侧边栏置顶即时生效；缓冲文本快照在 context_window 事件后保持类型；失败终态回合的已受理提交被消费；协调器租约围栏提交。
- **供应商与模型**：OpenCode 免费层请求携带会话头；StepFun API 域名更新；registry 凭证处理新增 OAuth 刷新控制；模型连接状态监测；修正 Gemini 预设、各协议端点 URL、重试提示与配额故障判断。
- **Write/编辑器**：修复块菜单布局、缩放位置与列表复制；保留文件边缘、frontmatter 原位修补；空段落显示块手柄；恢复 Notion 风格块 UI。
- **论文与输入可靠性**：移动论文时校验文件夹层级与保留目录，避免移入后从文库消失；大线程的 `user_input` 结算只探测请求之后的事件，并在中止时保留提交或取消结果；Service Manager 忙碌时，Runtime 启动探测会有界重试。
- **其他**：修复首见客户端清空共享业务状态；移动端 Sheet 内容折叠修复；设置补丁接受规范化定时任务字段；bot 通知可关闭；Rooms 成员面板可切换模型；拆分超限 i18n 资源文件。

**兼容提醒**：若降级到不认识“记忆规则”的旧版本，已创建的规则记录会被保留，但旧版本不会显示或使用它们；重新升级后可恢复。需要每轮遵守的偏好可在新版本中经确认提升为规则。

## 更新方式

通过应用内更新入口下载更新，完成后重启 Kun 安装。此更新沿用桌面应用的稳定更新通道，Kun Runtime 和终端命令随桌面应用一同更新。

---

## English

Kun 0.3.11 adds Rooms multi-agent collaboration, remote mobile access, and a paper research workspace; rebuilds Write mode as a lossless Markdown single-view editor; and improves model connections, memory, context import, and end-to-end performance.

- **Rooms**: persistent agent collaboration workspace with private and group chats, a five-member starter team, durable agent identities and scoped memory; a compact unified sidebar for agents and group chats, right-aligned IM bubbles, @-mention picker with avatars, delivered/typing receipts, inline rename, custom group avatars, and a read-only run inspector showing agent session timelines (#1333).
- **Excalidraw whiteboard**: boards and PNG delivery in private chats, agents can draw into open canvases, optional Excalidraw engine beside the Kun canvas.
- **Remote & mobile**: remote access settings panel with QR code, password visibility toggle, and Tailscale detection; a full mobile layout for phone-sized viewports including the remote app shell, Rooms/Work surfaces, a searchable grouped model picker, touch-friendly drawers, and isolated sessions.
- **Write single-view editor**: lossless Markdown codec driving a single-view surface with block-level editing (hover-intent block menu with submenus and icons), block-level diff review, math editing, Mermaid, code highlight, links, and a shared export render pipeline; underline and find options in the format toolbar and AI-assisted document properties.
- **Paper research workspace**: multi-source quick search, conference and arXiv discovery, and conversational Agent research sessions in Work; a paper pool with recommendations, bulk import, and BibTeX. The library supports metadata editing, groups, empty folders, folder-targeted imports, and library-wide reuse of existing papers. The PDF reader adds translation overlays and a bilingual mirror, annotations and region marks, citations, and reading activity. Search results surface source rate limits and failures.
- **Model connections and failover**: multi-account failover groups with quota-aware routing, reason-specific cooldowns, and smart/round-robin/least-used strategies; separate Chat Completions, Responses, and Messages endpoints, protocol detection, and imports from common clients; an Anthropic Messages-compatible local gateway.
- **Context import**: new `/import` command and engine with adapters for Cursor, Gemini, Copilot, Windsurf, Cline, Zed, OpenCode, Kiro, Roo Code, Kilo Code, Continue, Amp, and Goose; preserves scoped-rule conditions and fenced code blocks, and warns before overwriting hand-edited import blocks (#1316, #1319).
- **Memory feedback**: explicit feedback actions (confirm/correct), a persisted feedback ledger, an offline feedback ranking evaluator, isolated diagnostics, and preregistered evaluation gates (#1324, #1325, #1326).
- **Memory recall and directives**: read-only memory search/list tools for agents; user-confirmed standing rules can apply across turns, while creation, promotion, and reactivation require an explicit human decision. Imported and distilled memories remain reference material (#1344).
- **StepFun provider**: preset with API and Step Plan subscription support, brand icon, and expanded Step Plan model catalog.
- **More**: per-member attention in Rooms, one-shot reminders, steering into running private chats, and proposal cards for actions requiring a user decision; remote bridge script and transport enhancements, chart rendering components, unread activity in Work, X article image/title copy, extra folder attach for Code projects, and sanoTTS replacing Kokoro for on-demand speech.

### Fixes and improvements

- **Performance**: event-bus tail retention removed with deduped serialization; incremental JSONL tail reads for thread documents; batched event high-water commits; in-memory cursor checkpoints; renderer store commits batched per inbound event batch with referentially stable timeline turns; Shiki re-highlight skipped during streaming typewriter; smaller installers via minification and payload trimming.
- **Sessions & runtime**: session recovery lock-order deadlock fixed (#1335, #1336); shared-mode serve attaches without seizing the app session; application processes bound to GUI lifetime; Windows launcher failures surfaced; auto-continue when responses are truncated by max output tokens; Responses reasoning items replayed with wire-level 400 recovery; orphaned dev sessions fall back to the last bundled renderer.
- **Rooms reliability**: streaming private responses without polling or history redraws; immediate sidebar pinning; buffered text snapshots stay typed after context_window events; accepted submissions consumed from failed terminal turns; coordinator-lease fenced commits.
- **Providers & models**: OpenCode free-tier session headers; updated StepFun API domain; OAuth refresh controls for registry credentials; model connection watch; fixes for the Gemini preset, per-protocol endpoint URLs, retry hints, and quota-failure classification.
- **Write/editor**: block menu layout, zoom placement, and list copy fixes; preserved file edges with in-place frontmatter patching; block handle on empty paragraphs; restored Notion-style block UI.
- **Paper and input reliability**: paper moves validate folder depth and reserved paths so units remain visible; `user_input` settlement on large threads probes only events after the request and preserves submitted or canceled results during abort; Runtime startup retries a temporarily busy Service Manager within a bounded deadline.
- **Misc**: first-seen clients no longer wipe shared business state; mobile sheet collapse fix; normalized scheduled-task fields accepted in settings patches; dismissible bot notices; model switching from the room members panel; oversized i18n locale files split.

**Compatibility note**: If you downgrade to a version that does not understand memory directives, existing directive records are retained but hidden and inactive until you upgrade again. Preferences that must apply every turn can be promoted to directives with your confirmation.

Download the update from Kun and restart to install. The bundled runtime and terminal commands update with the desktop application.

[Full changelog](https://github.com/KunAgent/Kun/compare/v0.3.10...v0.3.11)
