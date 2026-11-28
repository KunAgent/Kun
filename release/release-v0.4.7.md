# Kun 0.4.7

0.4.7 把每日待办、生成式小应用与远程协作连成日常入口：新增每日待办与笔记小窗和分栏，会话中的交互组件可安装为桌面应用；手机直连支持免登录使用，Mac 远控增加锁屏手动解锁与全屏查看。Colab 训练支持 Google Drive 持久化、更多 GPU/TPU 与资源趋势，输入区进展胶囊可直接引用任务和协作者，桌面伙伴迎来黑猫 Kuro。

## ✨ 新功能

- **每日待办与笔记**：从 Code 或 Work 侧栏、系统托盘，或通过 macOS `Cmd+Shift+D`、其他平台 `Ctrl+Shift+D` 呼出独立小窗，也可以停靠在主窗口分栏。按天保存为本地 Markdown，提供页面、四象限与月历视图，支持子笔记、下钻聚焦和未完成待办顺延；待办可交给小Kun安排、选择项目直接启动会话，或关联已有会话并同步进度与完成状态。
- **交互组件安装为应用**：会话中的交互组件可安装为桌面应用，创建系统启动入口并以独立窗口打开。应用保留自己的本地状态，原会话修订组件后会更新已安装副本；应用内发起追问会附带当前状态，并在确认后回到原会话。安装创建启动器需要明确授权，卸载前有确认提示，也可在“插件与扩展”中停用或恢复。
- **免登录手机直连**：手机可选择“免登录直接使用”，通过局域网、Tailscale 或自建隧道与电脑建立加密直连；Code、Work 和远程桌面共用这条连接，会话与附件不经过官方中继。配对码 5 分钟内有效且只能使用一次，默认权限可按设备收窄、随时撤销，登录或退出账号时会隔离原有直连授权。
- **Mac 锁屏解锁与远控全屏**：获得桌面控制与解锁授权的设备，可在 Mac 锁屏时手动输入登录密码解锁；密码只通过一次性加密挑战提交，不保存、不写入日志。电脑远控查看器支持全屏、F11/Esc 与沉浸式工具条；在线状态未知的电脑可尝试连接，配对唤醒、授权等待与重连恢复更及时。
- **Colab 云盘持久化与更多算力**：Notebook 与训练会话可挂载 Google Drive 到 `/content/drive`，将大模型权重、数据集和 Checkpoint 保存在云盘中直接持久化，停止前自动刷写；训练会话默认启用挂载。新增 G4、H100 GPU 与 v5e/v6e TPU、高内存机型选项，并根据账号订阅和 CU 额度提示不可用加速器。
- **Colab 资源趋势与文件管理**：训练卡片补充 GPU 利用率、显存或内存摘要及紧凑趋势线；Notebook 运行时新增 GPU、显存、系统内存与磁盘采样的近时段趋势，并标记采样暂停，加速器选择会提示订阅或额度限制。文件页支持按文件夹上传、复制路径、浏览已挂载云盘并将 Notebook 保存回 Google Drive。
- **输入区进展胶囊与任务引用**：任务清单、协作者、目标、编排和后台命令收起为输入区上方的进展胶囊，展开后可直接回复对应上下文；点击“引用”可把某个步骤或协作者放入输入框成为上下文芯片，连续补充指令更准确。
- **黑猫 Kuro 与桌面伙伴**：新增内置黑猫 Kuro，采用实时程序化小猫引擎，眼神跟随光标，敲键盘、鼠标点击、滚轮和摸头都有反应；可自动导入 KuroCat 自定义猫、插件与偏好，并继续使用 Codex 宠物包。桌面伙伴仍默认不显示，需要在“设置 → 宠物”选择并唤醒。

## 🐛 修复与改进

- **远程活动状态同步**：减少手机与电脑配对目录的重复读取，按需唤醒配对主机，并在活动队列容量已满时退避重试；响应丢失后按运行 ID 对账，避免远程状态长时间卡住。
- **手机工作台完成提醒**：已完成或失败的会话可把桌面未读状态同步到手机工作台，已读后不再标记未读，减少漏看和重复提醒。
- **直连账号隔离**：游客模式与登录账号分别保存直连授权、会话和回执；账号状态变化时先结束活动连接，避免旧授权跨账号继续使用。
- **数据迁移与历史保留**：会话迁移清单改为分页读取全部归档和分支会话，并校验游标完整性；启动后核对保留历史，避免大账号迁移时漏检或误判历史不完整。
- **Antigravity 凭据与模型档位**：每小时刷新的 OAuth 访问令牌不再被误认为凭据替换；Neon 等 Orchestrator 变体不再显示不适用的推理档位。
- **小应用启动与托盘恢复**：系统启动器唤起已安装小应用时不再被误判为第二个 Kun 实例；托盘会话菜单刷新失败时仍回退到最近可用菜单。

## 兼容与隐私提示

每日待办按日期保存为本地 Markdown，可由其他编辑器修改并自动同步；独立小窗仅在桌面应用可用，Linux Wayland 不支持窗口置顶。默认快捷键可在“设置 → 键盘快捷键”中修改。

免登录直连不会创建 Kun 账号，也不经过官方中继；授权和运行回执只保存在本机。默认直连权限包含桌面查看、控制和手动解锁，生成配对码前请确认高级访问范围，已配对设备可随时撤销。

Mac 锁屏解锁仅支持具备辅助功能（输入控制）权限的 macOS 主机，且需要主机开启“允许锁屏时手动输密码解锁”和设备获得 `desktop.unlock` 权限。密码由你在受信任设备上手动输入，一次性使用且不保存；关闭主机开关或撤销设备权限会立即失效。

交互组件应用会在本机保存状态，并可请求把追问发回原会话；安装、追问和卸载均有确认或授权提示。请只为信任的会话内容创建系统启动入口。

Google Drive 挂载使用当前运行时绑定的 Google 账号授权，云盘内容按该账号存储；`/content` 中的临时文件仍会在运行时回收后清除。G4、H100、TPU 和高内存机型的可用性取决于 Colab 订阅、地区与 CU 余额。

桌面伙伴的系统级键盘与鼠标动作联动在 macOS 需要输入监控权限；动作联动只使用粗粒度物理按键区域和按钮、滚轮状态，眼神跟随使用本机光标位置，不读取输入文字、点击目标内容或音频。

---

## English

Kun 0.4.7 connects daily planning, generated mini-apps, and remote collaboration in one everyday workflow: a new daily notes and to-dos window or docked column, and installable desktop apps created from interactive widgets. Phone direct connections can now be used without signing in, while Mac remote control adds manual lock-screen unlocking and fullscreen viewing. Colab gains Google Drive persistence, more GPU/TPU options, and resource trends, the composer activity capsule can reference tasks and workers, and Kuro the black cat joins the desktop companions.

### Features

- **Daily notes and to-dos**: Open a standalone window from the Code or Work sidebar, the system tray, or with `Cmd+Shift+D` on macOS and `Ctrl+Shift+D` on other platforms, or dock it beside the main window. Notes are saved per day as local Markdown, with page, four-quadrant, and calendar views, subnotes, focused drill-down, and rollover for unfinished tasks. Hand tasks to Kun for planning, start a session in a chosen project, or link them to an existing conversation with progress and completion sync.
- **Install widgets as apps**: Interactive widgets from a conversation can become desktop apps with a system launcher and an independent window. Apps keep their own local state, follow later revisions of the widget in the original conversation, and attach their current state when asking a follow-up there after confirmation. Launcher creation requires explicit authorization, removal is confirmed first, and apps can be disabled or restored under Plugins & extensions.
- **Phone direct connections without sign-in**: Phones can choose Continue without signing in and connect over LAN, Tailscale, or your own tunnel through an encrypted direct connection. Code, Work, and remote desktop share that connection, and sessions and attachments bypass the official relay. Pairing links expire after five minutes and work once; default permissions can be narrowed per device and revoked at any time, while signing in or out isolates existing direct grants.
- **Mac unlock and fullscreen remote control**: Devices with desktop control and unlock permission can manually enter the Mac login password when the host is locked. Passwords are submitted through a single-use encrypted challenge, never saved, and never written to logs. The computer viewer adds fullscreen, F11/Esc, and an immersive toolbar; computers with unknown presence can be tried directly, with faster pairing wake-up, authorization waiting, and reconnection recovery.
- **Colab Drive persistence and more compute**: Mount Google Drive at `/content/drive` in notebooks and training sessions so large model weights, datasets, and checkpoints can be persisted there, with automatic flushing before shutdown; training enables mounting by default. Added G4 and H100 GPUs, v5e/v6e TPUs, and high-memory shapes, with eligibility notices based on the account subscription and CU balance.
- **Colab resource trends and file management**: Training cards add GPU utilization, VRAM or memory summaries, and a compact trend line. Notebook runtimes add recent-window trends for GPU, VRAM, system memory, and disk sampling, mark stale samples, and explain accelerator subscription or quota limits. The Files tab supports folder-scoped uploads, copying paths, browsing mounted Drive, and saving notebooks back to Google Drive.
- **Composer activity capsule and references**: Task lists, workers, goals, orchestration, and background commands collapse into an activity capsule above the composer. Open a sheet to reply in its context, or click Reference to place a step or worker in the composer as a context chip for more precise follow-up instructions.
- **Kuro and desktop companions**: Meet Kuro the black cat, a built-in companion rendered by a live procedural cat engine. Kuro follows the cursor visually and reacts to typing, mouse clicks, scrolling, and head pats. Kun can automatically import KuroCat custom cats, plugins, and preferences while continuing to support Codex pet packages. Companions remain hidden until selected and awakened under Settings → Pets.

### Fixes and improvements

- **Remote activity synchronization**: Reduced repeated phone and computer pairing-directory reads, wake pairing hosts only when needed, and back off when activity queues are full. Lost responses are reconciled by run ID so remote state does not remain stuck.
- **Mobile workboard completion reminders**: Completed or failed sessions can carry their desktop unread state to the mobile workboard and stop being marked unread after you read them, reducing missed outcomes and duplicate reminders.
- **Direct-connection account isolation**: Guest mode and signed-in accounts keep separate direct grants, sessions, and receipts. Account changes end the active connection first so old grants cannot carry across identities.
- **Data migration and history preservation**: Migration inventories now page through every archived and side conversation and validate continuation cursors. Preserved history is checked after startup, avoiding missed inventory or false incomplete-history results for large accounts.
- **Antigravity credentials and model efforts**: Hourly OAuth access-token refreshes no longer look like credential replacement. Neon and other Orchestrator variants no longer offer inapplicable reasoning levels.
- **App launching and tray recovery**: Opening an installed mini-app from its system launcher is no longer mistaken for a second Kun instance. If tray session refresh fails, Kun falls back to the most recent usable menu.

### Compatibility and privacy notes

Daily notes are stored as local Markdown by date. They can be edited in other editors and synchronized back automatically; the standalone window is desktop-only, and Linux Wayland does not support always-on-top. Change the default shortcut under Settings → Keyboard shortcuts.

Direct connections without sign-in do not create a Kun account and do not use the official relay; grants and runtime receipts remain on the computer. Their default permissions include desktop viewing, control, and manual unlock, so review advanced access before creating a pairing code. Paired devices can be revoked at any time.

Mac lock-screen unlock requires a macOS host with Accessibility input-control permission, the host's "Allow manual password unlock" switch, and the device's `desktop.unlock` scope. You type the password manually on a trusted device; it is used once and never saved. Turning off the host switch or revoking the device disables it immediately.

Installed widget apps can save state on this computer and ask to send follow-ups back to their original conversation. Installation, follow-ups, and removal include confirmation or authorization prompts. Create system launchers only for conversation content you trust.

Google Drive mounting uses the Google account bound to the active runtime, and Drive content belongs to that account. Temporary files under `/content` are still erased when the runtime is recycled. G4, H100, TPU, and high-memory availability depends on the Colab subscription, region, and CU balance.

System-wide keyboard and mouse action reactions for companions require Input Monitoring on macOS. Action reactions use only coarse physical key zones and button or scroll state; eye following uses the local cursor position. They do not read typed text, click-target content, or audio.

[Full changelog](https://github.com/KunAgent/Kun/compare/v0.4.6...v0.4.7)
