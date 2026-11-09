# Kun 0.4.5

0.4.5 把 Kun 带到桌面和更多设备：桌面伙伴随时陪你对话，远程访问统一管理手机与电脑，PDF 有了独立标签页和论文助手。同时改进计划任务批量管理、浏览器浮窗预览与扩展手机视图，并修复响应中断、图片保留和跨版本更新问题。

## ✨ 新功能

- **桌面伙伴**：小坤、ikun 和鲸鱼娘来到桌面，支持快捷对话、语音输入和任务气泡。可导入 Codex 宠物包，也可邀请伙伴短暂来访、调整来访频率或暂停来访；默认不显示，需要在“设置 → 宠物”选择并唤醒。自动陪伴感知打字、录音等活动状态，不读取输入文字，也不采集音频；跟随其他软件的录音状态默认关闭。
- **手机与桌面远控**：一个远程访问主开关，集中管理手机、桌面远控和浏览器入口。逐设备设置“仅查看”或“查看与控制”，随时撤销授权，并分别提示缺少的屏幕录制或键鼠权限。手机远控需要 Kun 账号与 Plus 及以上权益；电脑之间远控首版支持同账号的 Apple Silicon Mac（macOS 13 及以上）。
- **PDF 标签页与论文助手**：PDF 使用独立的 Work 标签页，每篇论文都有自己的助手会话。切换标签保留阅读位置和工作文件夹，引文可点回对应页面，选中的原文先进入草稿，由你确认后发送。
- **计划任务批量管理**：在可搜索、可筛选的列表中浏览计划任务，通过详情面板查看内容。支持批量启用、停用和删除，删除前确认，并避免误启用已经过期的一次性任务。
- **远控组件与手机直连**：远控组件按需下载、独立更新，后台校验后等待空闲启用，失败时回退。手机可通过局域网、Tailscale 或自建隧道直连电脑，用 5 分钟内有效、仅能使用一次的配对信息建立独立授权的加密连接，会话和附件不经过官方中继。手机终端由电脑托管，桌面顶部显示可随时结束的提示。
- **浏览器浮窗预览**：浏览器预览支持拖动、方向键移动、缩放和吸附回侧栏。你开始手动操作时 AI 会暂停；空间不足、会话停止或需要清理临时数据时都有明确提示，清理前需要确认。
- **扩展手机视图**：扩展 API 可声明轻量的只读原生手机视图，用于展示文本、指标和选项状态。不运行网页脚本或远程动作；未声明手机视图的扩展会标为仅桌面可用。
- **Design 预览与缩略图**：HTML 画板保留有数量上限的预览与缩略图，按优先级分配预览资源。多画板场景不再同时启动全部预览，减少资源占用。

## 🐛 修复与改进

- **响应中断**：保留已经收到的内容，不再重放请求并拼接第二次生成。模型流中断时明确标为“响应中断”，只在可确认时说明保留了部分内容。
- **外部 Agent 模型列表**：Agent 升级或启动路径变化后重新探测模型与模式列表，避免刷新后只剩默认模型。
- **委托与团队提示**：及时显示容量不足和启动前失败，重启后恢复失败通知。改善批量分派结果与旧拒绝提示的对应关系，避免静默挂起或重复打扰。
- **更新与安装**：改善 Windows 跨版本更新的待处理状态保留和中止安装后的旧版重启。更新状态核对等待运行时就绪，减少新旧实例切换冲突。
- **图片与预览**：大工具结果转存为产物时，保留有大小上限的图片内容，避免图片丢失。深色主题下 HTML 预览保持原有对比度。
- **界面与模型选择**：文件操作不再遮住长文件名，专注模式下不再弹出瓶子掉落提示。恢复 gpt-6.1-terra 的推理档位选项。

## 兼容与隐私提示

桌面伙伴仅在桌面应用中可用。系统级打字联动仅支持 macOS 且需要输入监控权限；跟随其他软件录音状态需要 macOS 14.2 及以上，默认关闭。Linux 若不支持点击穿透，会退回有边界的伙伴窗口。

电脑之间远控首版仅支持同账号的 Apple Silicon Mac（macOS 13 及以上），需要屏幕录制与辅助功能权限；桌面授权不自动包含聊天、终端或文件权限。远控组件首次使用需要联网下载。

浏览器入口使用明文 HTTP，仅适合可信网络。手机中继使用 TLS，但目前不提供端到端加密，附件临时经过云存储；直连会话与附件不经过官方中继，仍需先登录 Kun 并允许访问系统安全存储。

---

## English

Kun 0.4.5 brings Kun to your desktop and more devices: desktop companions for quick chats, unified remote access, and PDF tabs with a per-paper assistant. This release also improves scheduled-task management, floating browser previews, and extension mobile views, with fixes for interrupted responses, image retention, and cross-version updates.

### Features

- **Desktop companions**: Meet Xiao Kun, ikun, and Whale Girl, with quick chats, voice input, and task bubbles. Import Codex pet packages, invite friends for short visits, adjust visit frequency, or pause visits. Companions stay hidden until you choose and wake one under Settings → Pets. Automatic reactions observe typing and recording activity states, not typed text or audio; following recording in other apps is off by default.
- **Phone and desktop control**: One remote-access switch manages phone, desktop control, and browser access. Give each device view-only or view-and-control access, revoke it at any time, and see which screen-recording or input permission is missing. Phone control requires a Kun account with Plus or above; computer-to-computer control initially supports same-account Apple Silicon Macs on macOS 13 or later.
- **PDF tabs and paper assistant**: PDFs get separate Work tabs, each with an assistant conversation scoped to that paper. Switching tabs preserves your reading position and working folder, citations link back to their page, and selected text enters a draft for you to review before sending.
- **Scheduled-task bulk management**: Browse scheduled tasks in a searchable, filterable list with a detail panel. Enable, disable, or delete tasks in bulk, confirm before deletion, and avoid re-enabling expired one-time tasks.
- **Control package and direct phone connections**: Download the control component on demand and update it independently, with background verification, activation when idle, and rollback on failure. Phones can connect over the LAN, Tailscale, or your own tunnel using single-use pairing information that expires after five minutes. The separately authorized encrypted connection keeps sessions and attachments off the official relay. Phone terminals run on the computer, with a desktop strip offering an explicit end action.
- **Floating browser preview**: Drag, move with arrow keys, zoom, or dock the browser preview back into the sidebar. Your manual input pauses the AI. Low space, stopped sessions, and temporary-data cleanup have explicit notices, with confirmation before cleanup.
- **Extension mobile views**: The extension API can declare lightweight, read-only native mobile views for text, metrics, and option states. They do not run web scripts or remote actions; extensions without a mobile view are marked desktop-only.
- **Design previews and thumbnails**: HTML boards retain a bounded set of previews and thumbnails, prioritizing preview resources. Multi-board canvases no longer start every preview at once, reducing resource use.

### Fixes and improvements

- **Interrupted responses**: Keep delivered content without replaying the request and stitching on a second generation. Broken streams are labelled as interrupted, and preserved partial content is mentioned only when confirmed.
- **External Agent model lists**: Re-probe model and mode lists after Agent upgrades or launch-path changes, instead of falling back to the default model alone.
- **Delegation and team notices**: Report capacity limits and pre-launch failures promptly and recover failure notices after restarting. Reconcile batch results with older refusal notices, avoiding silent stalls and duplicate alerts.
- **Updates and installation**: Improve pending-state retention during Windows cross-version updates and relaunch the previous app after aborting an install. Wait for runtime readiness before reconciling update state to reduce conflicts during cutover.
- **Images and previews**: Preserve bounded image content when large tool results are offloaded to artifacts. HTML previews retain their original contrast in dark themes.
- **Interface and model choice**: File actions no longer cover long names, and bottle-drop prompts stay out of focus mode. Restore reasoning-level options for gpt-6.1-terra.

### Compatibility and privacy notes

Companions are desktop-only. System-wide typing reactions require macOS and Input Monitoring permission. Following recording in other apps requires macOS 14.2 or later and is off by default. Linux systems without click-through support use a bounded companion window instead.

Computer-to-computer control initially supports same-account Apple Silicon Macs on macOS 13 or later, with Screen Recording and Accessibility permissions. Desktop grants do not automatically include chat, terminal, or file access. The control component requires an initial online download.

The browser entry uses plain HTTP and is intended only for trusted networks. The phone relay uses TLS but is not currently end-to-end encrypted, and attachments pass through temporary cloud storage. Direct sessions and attachments bypass the official relay but still require signing in to Kun and allowing access to system secure storage.

[Full changelog](https://github.com/KunAgent/Kun/compare/v0.4.4...v0.4.5)
