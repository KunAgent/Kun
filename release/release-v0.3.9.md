# Kun 0.3.9

0.3.9 是针对 0.3.8 的维护更新，重点修复 Windows 小窗、供应商管理和会话用量展示。

## 修复与改进

- **Windows 小窗可正常操作**：移除覆盖整个窗口的悬停拖拽遮罩，改为独立的顶部拖拽栏。输入、点击和滚动不再被遮挡，恢复窗口按钮始终可见。
- **小窗布局与恢复**：隐藏侧栏和右侧面板的占位，保留原有工作台布局；修复从最大化窗口切换时的尺寸竞态，并在显示器断开或可用区域缩小时将窗口限制在屏幕内。
- **供应商删除**：在详情顶部提供删除入口，支持删除预置供应商、确认影响、删除中防重复操作和失败反馈。删除后不再自动补回预置项或旧凭据，并支持重新添加供应商。
- **会话用量**：修复输入框底部一直显示“暂无用量”的问题，恢复历史用量、实时 token 和缓存命中率展示，以及回合完成后的刷新（#1286）。

## 更新方式

通过应用内更新入口下载更新，完成后重启 Kun 安装。此更新沿用桌面应用的稳定更新通道，Kun Runtime 和终端命令随桌面应用一同更新。

---

## English

Kun 0.3.9 is a maintenance update for 0.3.8.

- Keep Windows mini windows interactive with a dedicated drag bar and an always-visible restore button.
- Collapse sidebar containers in mini mode, preserve the workbench layout, and fix maximized-window transitions and off-screen restoration.
- Restore provider deletion, including built-in providers, with confirmation, pending state, error recovery, and persistent removal. Deleted providers can be added again.
- Restore the composer usage summary, including persisted usage, live token and cache metrics, and refresh after a turn completes (#1286).

Download the update from Kun and restart to install. The bundled runtime and terminal commands update with the desktop application.

[Full changelog](https://github.com/KunAgent/Kun/compare/v0.3.8...v0.3.9)
