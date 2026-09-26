# Kun 0.3.11

0.3.11 引入 Rooms 多智能体协作空间与远程移动端访问，Write 模式重构为无损 Markdown 单视图编辑器，并在记忆反馈、上下文导入与全链路性能上大幅改进。

## ✨ 新功能

- **Rooms 多智能体协作**：新增持久化 Agent 协作空间，支持私聊与群组讨论、内置五人初始团队、持久 Agent 身份与作用域记忆；统一的紧凑侧边栏整合 Agent 与群聊，右侧 IM 气泡为标准布局，支持 @ 提及成员选择器、已送达/输入中回执、行内重命名与自定义群头像；只读 Run 检查面板可查看 Agent 会话时间线 (#1333)。
- **Excalidraw 白板**：Rooms 支持 Excalidraw 画板与 PNG 投递，Agent 可直接在打开的画布上绘图，并提供可选的 Excalidraw 引擎。
- **远程访问与移动端**：新增远程访问设置面板，支持二维码、密码可见性切换与 Tailscale 检测；手机尺寸视口下提供完整移动端布局——远程 App 外壳、Rooms/Work 界面、可搜索的分组模型选择器、触屏友好的侧边抽屉与会话隔离。
- **Write 单视图编辑器**：Write 模式重构为无损 Markdown 编解码器驱动的单视图界面，支持块级编辑（悬停意图块菜单、子菜单与图标）、块级差异审阅、数学编辑、Mermaid、代码高亮与链接，以及共享导出渲染管线；新增论文阅读模式，支持 arXiv / papers.cool 导入与 Agent 解读；格式工具栏新增下划线与查找选项。
- **Agent 上下文导入**：新增 `/import` 命令与导入引擎，支持 Cursor、Gemini、Copilot、Windsurf、Cline、Zed、OpenCode、Kiro、Roo Code、Kilo Code、Continue、Amp、Goose 等来源的规则导入，保留作用域条件与围栏代码块，并在覆盖手改导入块前警告 (#1316, #1319)。
- **记忆反馈进化**：新增显式记忆反馈操作（确认/纠正）、持久化反馈账本与离线反馈排序评估器，反馈诊断独立隔离，预注册评估门槛 (#1324, #1325, #1326)。
- **StepFun 供应商**：新增 StepFun 预设，支持 API 与 Step Plan 订阅，含品牌图标与 Step Plan 模型目录。
- **其他**：远程桥接脚本与传输增强；图表渲染组件与工具提示；Work 界面未读会话活动提示；X 文章图片处理与标题复制；Code 项目可附加额外文件夹；语音朗读替换为按需加载的 sanoTTS。

## 🐛 修复与改进

- **性能**：事件总线去除尾部保留并去重序列化；JSONL 线程日志增量读取与折叠；事件高水位批量提交；游标检查点改为内存态；渲染层按事件批次合并 store 提交、时间线回合引用稳定、流式打字动画期间跳过 Shiki 高亮；安装包通过压缩与载荷裁剪减小体积。
- **会话与运行时**：修复会话恢复锁序死锁 (#1335, #1336)；共享模式 serve 可附加而不抢占应用会话；应用进程生命周期绑定 GUI；Windows 启动器失败正确暴露；响应被 max output tokens 截断时自动续写；Responses 推理项重放与 wire 级 400 恢复；orphan dev 会话回退到最近的内置渲染器。
- **Rooms 可靠性**：私有响应流式渲染、无轮询与历史重绘；侧边栏置顶即时生效；缓冲文本快照在 context_window 事件后保持类型；失败终态回合的已受理提交被消费；协调器租约围栏提交。
- **供应商与模型**：OpenCode 免费层请求携带会话头；StepFun API 域名更新；registry 凭证处理新增 OAuth 刷新控制；模型连接状态监测。
- **Write/编辑器**：修复块菜单布局、缩放位置与列表复制；保留文件边缘、frontmatter 原位修补；空段落显示块手柄；恢复 Notion 风格块 UI。
- **其他**：修复首见客户端清空共享业务状态；移动端 Sheet 内容折叠修复；设置补丁接受规范化定时任务字段；bot 通知可关闭；Rooms 成员面板可切换模型；拆分超限 i18n 资源文件。

## 更新方式

通过应用内更新入口下载更新，完成后重启 Kun 安装。此更新沿用桌面应用的稳定更新通道，Kun Runtime 和终端命令随桌面应用一同更新。

---

## English

Kun 0.3.11 adds the Rooms multi-agent collaboration space and remote mobile access, rebuilds Write mode as a lossless-Markdown single-view editor, and delivers major improvements to memory feedback, context import, and end-to-end performance.

- **Rooms**: persistent agent collaboration workspace with private and group chats, a five-member starter team, durable agent identities and scoped memory; a compact unified sidebar for agents and group chats, right-aligned IM bubbles, @-mention picker with avatars, delivered/typing receipts, inline rename, custom group avatars, and a read-only run inspector showing agent session timelines (#1333).
- **Excalidraw whiteboard**: boards and PNG delivery in private chats, agents can draw into open canvases, optional Excalidraw engine beside the Kun canvas.
- **Remote & mobile**: remote access settings panel with QR code, password visibility toggle, and Tailscale detection; a full mobile layout for phone-sized viewports including the remote app shell, Rooms/Work surfaces, a searchable grouped model picker, touch-friendly drawers, and isolated sessions.
- **Write single-view editor**: lossless Markdown codec driving a single-view surface with block-level editing (hover-intent block menu with submenus and icons), block-level diff review, math editing, Mermaid, code highlight, links, and a shared export render pipeline; new paper reading mode with arXiv / papers.cool import and agent interpretation; underline and find options in the format toolbar.
- **Context import**: new `/import` command and engine with adapters for Cursor, Gemini, Copilot, Windsurf, Cline, Zed, OpenCode, Kiro, Roo Code, Kilo Code, Continue, Amp, and Goose; preserves scoped-rule conditions and fenced code blocks, and warns before overwriting hand-edited import blocks (#1316, #1319).
- **Memory feedback**: explicit feedback actions (confirm/correct), a persisted feedback ledger, an offline feedback ranking evaluator, isolated diagnostics, and preregistered evaluation gates (#1324, #1325, #1326).
- **StepFun provider**: preset with API and Step Plan subscription support, brand icon, and expanded Step Plan model catalog.
- **More**: remote bridge script and transport enhancements, chart rendering components, unread activity in Work, X article image/title copy, extra folder attach for Code projects, and sanoTTS replacing Kokoro for on-demand speech.

### Fixes and improvements

- **Performance**: event-bus tail retention removed with deduped serialization; incremental JSONL tail reads for thread documents; batched event high-water commits; in-memory cursor checkpoints; renderer store commits batched per inbound event batch with referentially stable timeline turns; Shiki re-highlight skipped during streaming typewriter; smaller installers via minification and payload trimming.
- **Sessions & runtime**: session recovery lock-order deadlock fixed (#1335, #1336); shared-mode serve attaches without seizing the app session; application processes bound to GUI lifetime; Windows launcher failures surfaced; auto-continue when responses are truncated by max output tokens; Responses reasoning items replayed with wire-level 400 recovery; orphaned dev sessions fall back to the last bundled renderer.
- **Rooms reliability**: streaming private responses without polling or history redraws; immediate sidebar pinning; buffered text snapshots stay typed after context_window events; accepted submissions consumed from failed terminal turns; coordinator-lease fenced commits.
- **Providers & models**: OpenCode free-tier session headers; updated StepFun API domain; OAuth refresh controls for registry credentials; model connection watch.
- **Write/editor**: block menu layout, zoom placement, and list copy fixes; preserved file edges with in-place frontmatter patching; block handle on empty paragraphs; restored Notion-style block UI.
- **Misc**: first-seen clients no longer wipe shared business state; mobile sheet collapse fix; normalized scheduled-task fields accepted in settings patches; dismissible bot notices; model switching from the room members panel; oversized i18n locale files split.

Download the update from Kun and restart to install. The bundled runtime and terminal commands update with the desktop application.

[Full changelog](https://github.com/KunAgent/Kun/compare/v0.3.10...v0.3.11)
