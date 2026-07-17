# Kun 协作工作台改造与验收报告（2026-07-17）

## 1. 本轮结论

基于现有本地 Kun Runtime 的会议/接待数字员工工作台已形成可用闭环，并补齐联网协作中的成员移除、后台同步、失败退避和内置服务启停入口。实现继续遵守“可插拔驱动、组合式扩展”原则：协作功能通过独立协议包、Main 服务、受限 Preload IPC 和 Renderer feature 接入，不改变 Kun 单 Runtime 架构，也没有恢复旧 Agent Provider 或诊断面板。

## 2. 已实现能力

### 2.1 本地会议与数字员工

- 主菜单增加“协作”，左侧分为会议列表与接待数字员工，右侧按选择加载会议或员工详情。
- 支持会议创建/关闭、成员投影、任务创建、接受/拒绝、开始、提交、整改、完成、豁免、进度发布和时间线。
- 数字员工支持发布、权限交集、真实 Kun turn 调用、进度查询、中断、完成/失败状态恢复。

### 2.2 联网、安全与跨设备

- 原生 Rust 密文服务器：TLS 1.3、Bearer 设备鉴权、RBAC、单调序列、幂等命令、Ed25519 签名回执。
- OpenMLS：两阶段加入、KeyPackage、Welcome、ratchet tree、加密状态持久化、Add/Remove commit。
- TLS SPKI 固定、服务器实例固定、签名/序列/哈希链验证；异常进入 `SECURITY_SYNC_REQUIRED` 只读状态。
- 远程数字员工请求、结果、检查和中断均使用 HPKE 成对加密；远端只执行员工所有者设备上的受限 Kun turn。
- 后台同步驱动采用单飞执行和指数退避；普通断网保留已验证 E2EE 状态并自动恢复，安全链异常不会自动绕过。

### 2.3 本轮新增闭环

- 管理员可从会议成员列表移除其他成员。
- 移除顺序为：同步最新状态 -> 生成并发布 MLS Remove commit -> 服务端撤销成员权限 -> 更新本地投影 -> 向剩余成员发布移除事件。
- 内置协作服务可从 UI 启动/停止；首次启动自动初始化证书、SQLite 和一次性操作员令牌，并在 `/health` 就绪后自动填写本地 URL 与令牌。
- 打包路径统一为 `resources/collaboration/kun-collab-crypto.node` 与 `resources/collaboration/kun-collab-server.exe`，开发模式使用对应 `prebuilds/<platform>-<arch>`。

## 3. 可插拔边界

| 边界 | 位置 | 合并影响控制 |
| --- | --- | --- |
| Wire Protocol | `packages/collaboration-protocol/` | 独立 workspace 和 schema drift 门禁 |
| 原生加密/服务器 | `native/kun-collab-crypto/`、`native/kun-collab-server/` | Rust/N-API 独立构建，不进入 Kun agent loop |
| Electron Main | `src/main/collaboration/` | 端口/驱动组合，密钥与明文不进入 Renderer |
| IPC 合约 | `src/shared/collaboration/`、`src/preload/index.ts` | 受限 DTO 与命令，不暴露 access token/私钥 |
| Renderer | `src/renderer/src/collaboration/` | feature/stage 接入，不修改 Code/Write/Design 运行时 |

## 4. 验证证据

- `npm run typecheck`：通过。
- 协作范围 ESLint：通过。
- `npm run test:collaboration`：协议 5 项、协作 TS 49 项、三客户端 OpenMLS/Rust 测试、明文门禁全部通过。
- `npm run build:collaboration-native`：生成 Windows x64 OpenMLS N-API 与 Rust Server release 产物。
- `npm run build`：通过。
- `npm test`：533 个测试文件通过，3954 项通过、2 项跳过、0 失败。期间修正了 Node 24 无法直接 `spawnSync('npm.cmd')` 以及无管理员权限 Windows 文件 symlink 两项跨平台测试问题。
- Electron production build CDP 验收：实际启动/停止内置服务，自动生成令牌；TLS/OpenMLS 安全信息可见；1280x842 下页面和协作舞台无横向溢出；Renderer 无异常。
- 截图：`C:\Users\xuchu\AppData\Local\Temp\kun-collaboration-acceptance.png`。

## 5. 尚未完成与发布门禁

以下项目未在本报告中宣称完成：

1. 网络交付仍缺少“会议加入时交换成员 HPKE 公钥”这一前置合约；当前签名清单、加密分块、断点续传、路径校验和 Delivery Review 已有单元实现，但尚未串成指定收件人的完整网络 IPC。
2. EncryptedOutbox 尚未覆盖所有成员审批后发布及远程控制请求；当前后台同步可以恢复断网后的读取和远程状态检查，但写入重试仍需统一持久化队列。
3. 官方 MLS 测试向量尚未导入；现有测试覆盖三客户端 Add/Remove、密文隔离、持久化和移除后不可读取新纪元。
4. 默认 `npm run dist:win` 在本机构建机被两项环境能力阻断：Visual Studio 缺少 Spectre 缓解库；Windows 未启用 Developer Mode，electron-builder 无法创建 npm workspace symlink。正式 NSIS 验收必须在满足这两项条件的发布机上执行，不能通过关闭正式 `npmRebuild` 规避。

## 6. 下一阶段改造顺序

1. 扩展加入握手与成员投影，交换并轮换每设备 HPKE 公钥。
2. 在 Rust 密文服务器增加按会议授权的密文 chunk 上传、缺块查询、下载和完成记录。
3. 用指定收件人的 HPKE envelope 包装 Delivery Content Key，并通过 MLS 仅发布加密交付元数据。
4. 接通 Main/Preload/Renderer 的交付列表、预览、显式应用与异常恢复 IPC。
5. 将全部联网写操作统一进入持久化 EncryptedOutbox，覆盖重启、纪元变化、重复回执和失败退避。
6. 在正式 Windows 发布机上完成 NSIS、解包资源检查与安装后 CDP 验收。
