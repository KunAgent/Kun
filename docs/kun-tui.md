# Kun 终端界面（TUI）

安装 Kun 桌面应用后，在新终端中直接运行 `kun` 即可进入 TUI；`kun tui` 是完全
等价的显式别名。TUI 基于 `@earendil-works/pi-tui`，使用内联会话流，不切换
Alternate Screen，因此退出后对话仍保留在终端原生 scrollback 中。

## 安装与发布形态

Kun GUI 安装包内置完整的 TUI 和运行时，安装桌面应用后即可使用 `kun` / `kun tui`。
从 0.3.8 起，Stable 和 Daily 不再构建或发布独立 TUI 压缩包，也不再推进独立
TUI 更新清单。GUI 内置 TUI 随桌面应用统一更新，不需要另外下载 Node.js 或 TUI。

已发布的历史独立包和用户数据不会因此删除；仍使用 0.3.7 独立包的用户需要安装
桌面应用，才能获得 0.3.8 及后续版本。旧包的 `kun update` 不会升级到 GUI 安装包。
GUI 的跨版本升级、签名、产物完整性和公开更新源校验仍是发布门禁。

TUI 和 GUI 使用相同的本机 HTTP/SSE 协议和持久化数据，但默认不再共用一个
长期后台 Runtime。正常 GUI/TUI 各自持有自己启动的 Runtime；同一
`(canonical dataDir, runtime flavor)` 槽位一次只允许一个 owner。owner 退出会
停止对应 Runtime，后续客户端仍可通过 Service Manager 读取相同线程、设置、记忆、
事件序号、用量和模型连接。

## 启动与客户端持有的运行时

```bash
# 自动使用 GUI 配置的 data-dir；没有 GUI 设置时回退到 ~/.kun/data
kun

# 等价别名及常用启动参数
kun tui --workspace "$PWD" --continue
kun tui --thread <thread-id>

# 只连接已由 GUI 等客户端持有的 Runtime
kun --no-start

# 启动完全独立的 TUI Runtime（独立会话、记忆和设置）
KUN_MANAGER_CONTROL_DIR="$HOME/.kun/tui-control" \
KUN_MANAGER_SETTINGS_PATH="$HOME/.kun/tui-settings.json" \
KUN_DATA_DIR="$HOME/.kun/tui-data" \
kun tui
```

默认 TUI 会在 data-dir/flavor 启动锁与 Manager fence 下选主，生成运行时 token、
选择端口并拉起该 TUI 会话持有的 Runtime。发现文件记录实例 ID、PID、owner、版本、
启动时间、loopback URL 和日志路径。若同一 Manager profile/flavor 槽位已有
live/starting GUI、另一 TUI 或前台 `kun serve` owner，默认启动会明确报冲突并
提示关闭 owner；它不会附加、替换或停止外部 owner。默认 Manager profile 只绑定
一个 canonical data-dir，production 与 development flavor 仍是独立槽位。

TUI 在 `/quit`、终端/信号退出、初始化失败或其他命令退出路径中，只关闭并等待自己
持有的精确 Runtime。Service Manager 不随普通 TUI 退出而停止；它继续作为轻量的
选举和持久化数据面存在，但不会自己执行 Agent turn。GUI 也遵循相同归属规则：真实
Quit 会停止 GUI Runtime，隐藏窗口、最小化到托盘或 macOS 应用仍驻留时不会停止，
所以此时默认 TUI 仍会收到同槽位冲突。GUI 顶部重启只重启 GUI 自己的 Runtime。

`--url` 和 `--no-start` 是显式非拥有连接：当 GUI 已持有默认 Runtime 时，运行
`kun tui --no-start` 即可共用其会话和设置；TUI 不启动也不停止目标 Runtime，目标
owner 退出后连接可以随之断开。若要让 GUI 和 TUI 各自持有 Runtime，必须像上例一样
同时隔离 `KUN_MANAGER_CONTROL_DIR`、`KUN_MANAGER_SETTINGS_PATH` 和 `KUN_DATA_DIR`；
仅更换端口或 data-dir 不能建立完整的独立 Manager profile。首次升级时，如果同一
canonical data-dir 中只剩一个已认证、身份精确、无 client-owner 元数据的旧
`launchMode: shared` daemon，当前 launcher 可以优雅退休该精确实例后再启动；身份有
歧义时 fail closed，不扫描或终止其他 data-dir/用户进程。

没有显式 `--data-dir` 或 `KUN_DATA_DIR` 时，CLI 会读取当前平台 Kun GUI 设置中的
`agents.kun.dataDir`，因此仍使用旧 `~/.deepseekgui/kun` 的升级用户不会被错误分流到
一套新的 `~/.kun/data`。CLI 只投影供应商端点和模型列表；API Key、OAuth token 和
headers 不会写入普通配置，而是继续通过该 data-dir 的受保护凭据绑定解析。显式目录
始终优先，也不会导入另一目录的 GUI 模型配置。

查看或请求 Runtime 生命周期：

```bash
kun runtime status
kun runtime restart
kun runtime stop
```

`kun runtime status` 保持只读。`kun runtime stop` / `restart` 不会停止 GUI/TUI
持有的 Runtime，也不会在一次性命令退出后留下无 owner 的 detached replacement；
它们会提示通过持有它的 GUI 操作，或退出并重新打开对应 TUI。Agent 工具中针对承载
自身的 Runtime 执行生命周期命令仍以 `runtime_self_control_forbidden` 拒绝。

`kun serve` 仅用于需要前台日志的调试场景，由启动它的终端前台持有，正常信号退出
会停止其 Runtime。它也会发布 discovery；同一 data-dir/flavor 已有有效 owner 时
会报冲突，不会杀死未知进程。`--url` 可显式连接一个服务；`--no-start` 可确保
TUI 不改变服务状态。

非 TTY stdin/stdout 不会进入交互界面，也不会悄悄启动 client-owned Runtime。脚本应使用
`kun run`、`kun chat` 或 `kun exec`。

### 本地开发试用

在这个仓库中，`npm run dev` 启动的是 Electron GUI。要单独试用 TUI，不需要先开
GUI，也不需要另开一个 `kun serve`，直接运行：

```bash
npm run dev:tui

# 向 TUI 继续传参数
npm run dev:tui -- --workspace "$PWD" --continue
```

该命令会先构建 `kun/`，再启动 TUI，并为这个 TUI 会话拉起一个 client-owned Runtime。
如果同一 Manager profile/flavor 的 GUI 或 TUI owner 已在运行，命令会报 ownership
conflict；请真实退出该 owner（仅最小化到托盘不算退出），或使用显式非拥有连接。
首次进入会显示欢迎页，composer 已经获得焦点：直接输入任务并按 Enter 会自动创建
会话；`/connect` 配置模型，`Ctrl+X L` 打开已有会话，`Ctrl+P` 搜索全部命令。退出
TUI 会停止该会话持有的精确 Runtime，但不会停止 Service Manager 或删除已保存数据。

欢迎页只显示文字 `KUN`、一句用途说明、Workspace/Model/Mode/Version 元数据，以及
“直接输入任务”、`/connect`、`/sessions` 三个起点；不再放大 Logo、运行时诊断、
MCP 数量或整套快捷键。进入会话后，每个 assistant turn 统一收在一个 `Kun` 分组下，
Thinking 默认折叠，工具与 Subagent 使用紧凑的状态/对象/耗时行。composer 只保留
一个输入框、provider/model · effort · mode 元数据和当前上下文真正可用的操作。
窄终端优先保留标题、选择、错误和主操作，次要计数与描述会先隐藏或截短。

按 Enter 后 composer 会立即清空，状态行在服务端确认 turn 前先显示带动画的
`Sending message`。随后它会根据权威事件切换为 Waiting、Thinking、Responding、
工具执行、Subagent、Compacting、Retrying 或 Reconnecting，并显示当前阶段耗时和
整轮耗时。审批或结构化问答等待使用较慢的注意力脉冲；普通通知只占用状态行右侧，
不会遮住正在进行的工作。

这里采用“持续可感知进度”原则，但不伪造百分比：不同阶段使用不同的单格
动画，Responding 使用打印头节奏，工具和 Subagent 使用各自的运动符号。活动栏仅在
发送、等待、推理、输出、工具、子代理、重试或重连等真实阶段出现，空闲时完全隐藏，
所以不会长期占据注意力。运行时提供上下文窗口且已有 usage 时，右侧显示
`已用 / 总量 · 百分比`，而不是把 token 数伪装成生成进度。

工具调用默认显示一行动作、对象和耗时，完成结果以 `└` 收束；按 `Ctrl+O` 后用
`├ input` / `└ output` 展开为树状详情。执行中、完成、失败分别使用动画、实心圆点和
错误标记，颜色只承担状态语义。所有这些展示继续使用内联模式和终端原生 scrollback。

同一阶段连续发生的只读发现调用会聚合成 `Exploring` / `Explored` 摘要。Read、View、
Search、Grep、Find、List、Fetch 和 Web Search 可以跨越中间折叠的 Thinking 进入同一
组；回答、命令、编辑、委派、审批或结构化输入会结束该组。默认显示前 12 个精简动作
和剩余数量，`Ctrl+O` 展开全部动作及各自的 input/output；失败动作留在组内并计入标题。
这个分组只改变 TUI 展示，不改变工具执行顺序、事件记录或导出内容。

## 模型连接

在 composer 输入 `/connect` 可打开共享连接向导：

- 首页第一项始终是 **Add a provider**，即使已经配置了供应商也不会隐藏；Enter
  进入可搜索的供应商目录，**Custom provider** 固定排在最前面，随后按订阅/API
  分组展示内置预设。目录与 GUI Settings 共用同一份数据：当前包含 19 个基础预设，
  并把 Xiaomi、MiniMax、Aliyun、Tencent Cloud 的 Token Plan 展开成独立订阅入口，
  合计 14 个订阅入口和 9 个 API 入口。
- 自定义供应商会依次填写可编辑 ID、显示名称、Base URL、Endpoint format、
  遮罩凭据和模型 ID。Esc/Ctrl+C 每次只返回上一步，最终确认前不会创建供应商。
- 自定义 HTTP 端点先探测 `/models`。如果端点不支持模型发现但已经手工填写模型，
  Kun 会保留当前向导并明确提供 `Ctrl+S`“使用已填写模型保存”，不会伪装成探测成功。
- API Key、Token Plan 和 OpenAI-compatible 自定义端点使用不回显的遮罩输入。
- ChatGPT 使用 device-code OAuth；TUI 会打开浏览器并显示可复制的 URL 和 code。
- Grok 使用浏览器 PKCE 与本机回调；如果浏览器无法自动返回，直接在 TUI 的遮罩输入框
  粘贴完整 callback URL 或单独 authorization code 并按 Enter。该值不会显示、写入
  shell history、普通设置或日志。
- Claude Pro/Max 使用 Agent SDK 连接类型；TUI 会检测并按需下载 Claude Code，再启动官方登录流程。
- 同一预设可建立多个账号，ID 会稳定分配为带序号的稳定账号标识。
- 在已连接账号上按 Enter 可探测模型、重命名、遮罩替换凭据或确认断开；删除默认连接时会明确提示自动回退。

凭据只写入运行时的受保护 credential store；registry 和 HTTP 响应只包含
`configured` 状态及不透明引用。连接、改密钥、删除和切换默认模型都带 revision，
并发写入过期 revision 会返回 `409` 和最新快照。

`/model` 在所有已连接的 provider/account/model 中切换共享默认项。新线程使用
新默认值，已固定 provider/model 的线程保持原选择。GUI 设置页会显示同一 registry，
TUI 的变更无需重新输入凭据即可在 GUI 使用。

模型选择器是独占主内容页，不会透明叠加在欢迎页或会话内容上。打开后只显示
`KUN / Models` 路径、搜索、按 provider/account 分组的模型行和本页操作；欢迎内容、
聊天记录、composer 与全局快捷栏全部暂时隐藏。选择完成或按 Esc 后恢复原页面、
composer 草稿与焦点。页面展示 GUI 配置和共享 registry 中全部已配置供应商的模型。

同样的独占页面规则适用于 Sessions、Commands、Reasoning、Mode、Connect、Subagents、
Timeline、Skills、Help、Status、Context、Queue、MCP、Permissions、Approval 和结构化
问答。选择页统一使用路径、可选搜索、扁平分组列表、青色选择轨和单行上下文操作；
连接流程每次只展示当前步骤；只读检查页按字段与状态组织，不复用笨重的通用弹窗。

如果 `/model` 只显示 DeepSeek，先运行 `kun runtime status` 检查输出的 data-dir 是否
与 GUI 设置一致。升级前遗留的、身份精确且已认证的无 owner shared daemon 可以在
首次 client-owned 启动时被窄范围优雅退休；旧 GUI 私有 runtime 或其他身份无法证明
的进程不会被附加或终止，也不会允许同 data-dir/flavor 的第二个 writer。请先真实
关闭或更新旧 owner。之后 GUI 与 TUI 按顺序各自启动 Runtime，并复用同一持久化数据。
`/connect` 复用 data-dir 中的受保护凭据库和模型 registry，只向 GUI 设置写入无密钥
兼容投影；`/model` 随 registry 刷新。

## 操作

| 按键 | 作用 |
| --- | --- |
| `Enter` | 发送 prompt / steering，或确认当前选项 |
| `Ctrl+J` / `Shift+Enter` | 在 composer 中换行（取决于终端协议） |
| `Ctrl+X` | Leader；2 秒内等待下一键并显示当前可用动作 |
| `Ctrl+P` | 打开可搜索命令面板 |
| `Ctrl+X L` | 打开会话搜索/切换页面 |
| `Ctrl+X N` | 新建并打开会话 |
| `Ctrl+X P` | 进入/退出 Pointer 模式；仅在该模式下由 Kun 接管鼠标点击 |
| `Ctrl+T` | 循环当前模型支持的推理强度 |
| `F2` / `Shift+F2` | 正向/反向切换最近使用模型 |
| `Tab` / `Shift+Tab` | 无补全弹窗时切换 Agent/Plan 模式 |
| `Ctrl+C` | 弹窗/确认/模型或连接页中等同 Esc；composer 有文字或附件时清空整个草稿；空闲且完全为空时连续按两次退出 |
| `Ctrl+D` | composer 非空时向前删除；空闲且输入为空时连续按两次退出；会话列表中打开永久删除确认 |
| `Backspace` / `Delete` | composer 文字为空且有待发送附件时，删除最后加入的附件；有文字时保持正常文字编辑 |
| `Esc` | 依次关闭补全/当前页面，或中止运行中的 turn；空闲时连续按两次安全撤销上一轮 |
| `Ctrl+O` | 展开/折叠 transcript 中的工具调用详情 |
| `Ctrl+G` | 用 `$VISUAL`/`$EDITOR` 编辑当前 composer 草稿 |
| `Ctrl+S` | turn 运行中立即 steer 当前非空草稿 |
| macOS `Cmd+V` / `Ctrl+X V`；Windows/Linux `Ctrl+V` | 从系统剪贴板读取截图并加入当前 composer；也接受 `Alt+V`、终端转发的 `Ctrl+Shift+V` / `Super+V` |
| `Ctrl+L` | 强制重绘 |
| `Shift+PgUp/PgDn` | 使用终端原生 scrollback（应用不会截获） |

默认状态不开启终端鼠标上报：直接拖动即可框选任意 transcript
文本，再使用终端自己的复制快捷键。Codex/VS Code 集成终端通常会在已有选区时让
`Ctrl+C` 复制；macOS Terminal/iTerm2 通常使用 `Cmd+C`，Linux/Windows 终端通常使用
`Ctrl+Shift+C`。没有选区时，`Ctrl+C` 仍执行 Kun 的返回、清空、中止或退出语义。

终端宿主会先于 TUI 处理 `Cmd+V` 等平台粘贴键，而纯图片剪贴板通常不会产生可发送给
进程的文本字节，因此 Kun 无法截获被宿主完全吞掉的按键。macOS 上欢迎区会按平台显示
`Cmd+V`，终端若转发 `Super+V` 或发送空的 bracketed-paste 手势，Kun 会直接读取系统
剪贴板图片；若宿主不转发，则使用一定会由 Kun 处理的 Leader 组合 `Ctrl+X`、再按
`V`。`Ctrl+V`、`Alt+V`、`Ctrl+Shift+V` 只要被终端转发，也会执行同一条图片读取与
上传路径。`/paste` 是等价的键盘无关备用入口。

待发送图片或文件会作为有序的 `Attachment 1/n` 条目显示在 composer 内，而不是游离在
输入框之外。macOS、Windows 和 Linux 上，文字编辑器为空时按 `Backspace` 或物理
`Delete`，都可从最后一项开始逐个移除；输入框中仍有文字时，这两个按键只编辑文字，
不会误删附件。也可使用
`/attach remove <n>` 删除指定项，或 `/attach clear` 清空全部附件。

图片或文件发送后不会只剩提示文字：持久化会话中的 `You` 消息下会显示
`Image/File`、文件名、类型、大小以及可用的图片尺寸。旧运行时暂时无法返回元数据时，
仍显示通用的 `Attachment · attached` 标记，避免用户误以为附件没有随消息发送。

需要单击 Thinking 或 Subagent 时，按 `Ctrl+X P` 或执行 `/mouse on` 进入 Pointer
模式；状态栏会明确显示当前模式。Esc/Ctrl+C 或 `/mouse off` 会立即恢复终端原生
框选。这样不会要求用户长期按住 Shift 才能选择对话文本。

### 会话与内容

| 命令 | 作用 |
| --- | --- |
| `/sessions [search]` | 搜索、固定、切换或确认删除持久化会话 |
| `/new [title]`、`/open <id>`、`/rename <title>`、`/archive` | 创建、打开、改名或归档线程 |
| `/fork [title]` | 从当前完整历史建立分支 |
| `/undo`、`/redo` | 在安全分支中前后导航；源会话和历史不被改写 |
| `/timeline [search]`、`/jump [number\|text]` | 按 turn 浏览/定位历史，并可在选中 turn 处 fork |
| `/subagents` | 浏览当前会话委派出的子代理；Pointer 模式下也可单击可见 Subagent 块，在弹窗中查看实时子会话 |
| `/copy`、`/export [path]` | 复制最后一条 Kun 回复，或以 Markdown 安全导出完整线程；导出不会覆盖已有文件 |
| `/details`、`/thinking` | 切换 tool 详情或 reasoning 文本显示；`/reasoning` 是兼容别名 |
| `/paste` | 从系统剪贴板读取截图并加入 composer；macOS 等价于被转发的 `Cmd+V`，并始终可用 `Ctrl+X V` |
| `/attach <path>`、`/attach list`、`/attach remove <n>`、`/attach clear` | 添加文件、查看待发送附件、删除指定附件或清空附件 |
| `/mouse [on\|off]` | 切换可点击 Pointer 模式；关闭后由终端负责框选和复制 |
| `/variants` | 选择推理强度；与 `Ctrl+T` 使用同一状态，并随 turn 请求发送 |
| `/compact` | 请求当前 Runtime 压缩长上下文 |

### 运行与项目

| 命令 | 作用 |
| --- | --- |
| `/status`、`/context`、`/queue` | 查看连接/线程状态、token 统计和当前 turn 的 steering 队列 |
| `/permission` | 在线程级选择 approval policy 与 sandbox mode，并同步给其他客户端 |
| `/plan [plan\|agent]`、`/goal [objective\|pause\|resume\|clear]` | 查看/切换计划模式并管理持久化目标 |
| `/tasks` | 汇总 plan todos、持久 goal、子代理、后台 shell 和扩展任务 |
| `/mcp` | 查看当前 Runtime 中的 MCP server、连接状态、工具数量及工具名 |
| `/skills [search]`、`/skill:<name> [prompt]` | 浏览当前 workspace 可见 skills，或显式激活一个 skill |
| `/init [guidance]` | 让 Kun 检查仓库并创建或更新根目录 `AGENTS.md` |
| `/add-dir <path>` | 给当前线程添加持久化 workspace root；工具和 sandbox 会识别该根目录 |
| `/editor [draft]` | 用 `$VISUAL`/`$EDITOR` 编辑 composer；Kun 暂停 TUI 后恢复终端和焦点，并保留编辑后的草稿 |
| `/btw <question>` | 在继承当前快照的 side thread 中提问，主线程保持不变 |
| `/connect`、`/model` | 管理共享模型连接或选择共享默认模型 |
| `/update`、`/update yes` | 检查 Stable 独立 TUI 更新，或显式确认下载与安装；GUI 内置版会提示更新 GUI |
| `/help`、`/quit` | 打开帮助或退出 TUI |

兼容别名：`/threads`、`/resume`、`/continue` → `/sessions`，`/clear` → `/new`，
`/title` → `/rename`，`/models` → `/model`，`/provider` → `/connect`，
`/summarize` → `/compact`，`/q` → `/quit`。这些别名也出现在 pi-tui 自动补全中。

assistant 文本使用 pi-tui Markdown，tool call/result 默认显示紧凑摘要。Thinking
默认只显示一行带耗时的折叠摘要，不展示推理正文；执行 `/thinking` 会展开全部低对比度
斜体正文，再次执行会收起。在 Pointer 模式中，也可以单击某一条 Thinking 标题，
只展开或收起该条内容；正文和相邻消息不会响应这个点击。折叠期间仍持续积累
流式片段，重新展开会恢复完整内容。
`Ctrl+T` 优先使用 GUI/registry 中完整的 `modelProfiles`
能力；旧 GUI 未发布能力元数据时，Kun 会按 provider/model 恢复已审核的
DeepSeek、GLM、MiMo、MiniMax M3、Kimi K3、Grok 4.5、Claude Opus/Sonnet、
Qwen、混元、豆包和 ZenMux 兼容能力。Chat Completions、Responses、Anthropic
Messages 与 Claude Agent SDK 都会收到真实的推理参数，不再展示不改变请求的假开关。
未知自定义模型仍不会猜测推理档位；过时的 GLM、Qwen、混元、豆包与 Kimi K3 元数据
会迁移为当前协议。所有模型、工具和服务文本
在渲染前会移除 CSI、OSC、DCS、APC 等控制序列。

父会话中只保留紧凑的 Subagent 摘要。执行 `/subagents` 后会进入独占的子代理列表；
Enter 使用运行时提供的真实 child thread ID 读取持久化快照并订阅顺序 SSE。只读子会话
会展示同样的流式回复、默认折叠 Thinking、工具、错误和嵌套子代理，但不会显示
composer，避免在内部代理仍持有 turn 时从另一个客户端修改它。

支持 SGR mouse 的终端在 Pointer 模式中可以单击可见的 Subagent 块，以居中弹窗打开
同一条实时子会话。弹窗支持滚轮、方向键和 PageUp/PageDown，单击 Thinking 标题可切换单条内容，
`t` 展开/折叠全部 Thinking，
Esc/Ctrl+C 关闭并恢复原生文本框选。鼠标只是快捷入口，`/subagents` + Enter 始终可用。

### 自定义键位

TUI 会读取 `~/.kun/tui.json`。格式兼容 OpenCode，支持单键、逗号分隔候选、数组、
`<leader>`、`"none"`/`false` 禁用，以及带 `event`、`preventDefault`、`fallthrough`
的高级对象：

```json
{
  "leader_timeout": 2000,
  "keybinds": {
    "leader": "ctrl+x",
    "variant_cycle": "ctrl+t",
    "session_list": "<leader>l",
    "input_newline": ["shift+return", "ctrl+j"]
  }
}
```

无效配置不会阻止启动；Kun 使用默认值并在欢迎页与 stderr 中提示。最近模型、收藏
模型和每模型推理强度写入 `<data-dir>/tui/state.json`（POSIX 权限 `0600`），不保存凭据。

## 外部连接、重连与安全

客户端先读取权威 thread snapshot 和 `latestSeq`，再从该游标订阅 SSE。断线后重新
验证 discovery、退避重连并补拉事件；重复或倒序事件不会再次应用。默认 GUI/TUI
owner 在同一 data-dir/flavor 不并发；只有显式 `--url` / `--no-start` 等非拥有连接
可以与 owner 共存。如果另一个显式连接先处理审批或问答，当前决策页面会刷新并
禁止重复提交。owner 退出后，其 Runtime 会停止，外部连接需要等待新的显式目标。

`assistant_text_delta` 与 `assistant_reasoning_delta` 的 `item.text` 是增量片段；TUI
按稳定 item ID 追加，并以 `item_created/updated/completed` 完整快照校正。因此回复会
在 turn 完成前逐段出现，断线补拉也不会重复文本。

- data-dir 权限为 `0700`，discovery/token 文件在 POSIX 上为 `0600`。
- discovery 只接受 loopback HTTP，并校验 instanceId、PID、startedAt 和服务版本。
- `POST /v1/runtime/shutdown` 仅接受带 bearer token 的 loopback 请求，且必须携带
  当前 instanceId，旧客户端不能关闭新实例。
- GUI/TUI-owned Runtime 通过 OS IPC ownership channel 感知异常父进程退出，并进入
  有界优雅关闭；普通退出仍显式关闭并等待精确实例。
- API Key、OAuth token 和订阅凭据不会进入 argv、shell history、日志或普通 settings。

## 安装终端命令

- Windows NSIS 自动安装相对 `$INSTDIR` 的 `bin\\kun.cmd` 并把精确目录加入 PATH。
- macOS 首次启动会提示把 app 内 launcher 链接到 `/usr/local/bin/kun`；设置页可
  安装、修复或卸载，移动 App 后会识别 stale target。
- Linux AppImage 可在设置页把 wrapper 安装到 `~/.local/bin/kun`；必要时会向
  bash/zsh/fish 配置写入带 Kun 标记、可安全删除的 PATH 块。

PATH 变化后请打开一个新终端，再执行 `kun --help` 验证。
