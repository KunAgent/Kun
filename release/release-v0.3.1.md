# Kun v0.3.1

v0.3.1 是 Windows 启动稳定性修复版本，解决升级到 v0.3.0 后部分 Windows 11 设备可能无法正常启动 Kun 的问题。启动阶段清理历史 `kun serve` 进程时，现在会先筛选可能属于 Kun 的进程，再查询进程所有者，避免遍历全部系统进程导致 PowerShell/CIM 检查超时。

### Windows 启动修复

- 修复部分 Windows 11 设备升级 v0.3.0 后，Kun 可能在主窗口打开前因历史进程扫描超时而启动失败的问题（[#1163](https://github.com/KunAgent/Kun/issues/1163)）。
- Windows 进程扫描通过 WQL 预筛选，仅对 `node.exe`、`electron.exe` 和 `kun*.exe` 候选进程查询所有者，减少启动阶段的系统开销。
- 保留当前用户 SID 验证和 PID 二次校验，避免影响其他用户或无关进程。
- 增加回归测试，确保进程清理逻辑不会退回到遍历全部 `Win32_Process` 的实现（[#1164](https://github.com/KunAgent/Kun/pull/1164)）。

### 升级说明

- 建议受 Windows 启动问题影响的用户直接升级到 v0.3.1。
- 从 v0.3.0 升级无需迁移会话、工作区或 Provider 配置。
- macOS、Linux 和独立 TUI 无需额外操作。

### 完整变更

https://github.com/KunAgent/Kun/compare/v0.3.0...v0.3.1
