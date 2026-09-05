# Kun 稳定版发版交验清单与故障排查

本文供 Kun 稳定版发布负责人使用，重点覆盖 Graph、Linux AppImage、Windows NSIS、打包后的 Electron/Extension，以及自动 Release 与 R2 推广。每次从 `develop` 发布到 `master` 前，都应按本文逐项核验；任一必需项失败时停止发布，不得用其他平台结果、旧 SHA 结果或本地模拟结果替代。

## 发布原则

- 稳定版只通过同仓库的 `develop -> master` 发布 PR 触发。
- 不手工创建 tag 或 GitHub Release；不要绕过受保护分支、必需检查或人工审批。
- PR 检查必须对应待合入的最新完整 SHA。旧提交的成功结果只能用于排查，不能替代最新提交的必需检查。
- Linux、Windows 和 macOS 的安装器、桌面进程、系统注册及权限行为必须由对应的原生 runner 或真机验证。
- 如果 release workflow 计算出的版本不是本次预期版本，立即停止合并并重新确认 tag、版本和分支状态。
- 只有 GitHub Release、全部跨平台资产和 R2 `stable/latest` 都确认成功后，才算发版完成。

## v0.2.34 交验事故摘要

v0.2.34 并非被单一缺陷阻断。流水线在前置失败修复后继续向下运行，依次暴露了测试时序、AppImage 门禁、Windows 安装迁移和桌面 smoke 隔离等多层问题。

| 表现 | 根因 | 判定 |
| --- | --- | --- |
| `expected 'timed_out' not to be 'timed_out'` | shutdown-recovery 测试只允许 500 ms 完成持久化停机；Ubuntu runner 的文件 I/O 和清理偶尔超过该时间 | 测试时序误报，不是 GraphScheduler 死锁 |
| 日志出现 `deterministic synthesis fixture failure` | 测试刻意注入合成失败，用于验证恢复路径 | 预期日志，不是失败根因 |
| `ERR_INVALID_ARG_TYPE: paths[0] ... Received undefined` | AppImage release-gate fixture 调用 smoke helper 时漏传提取后的 `appRoot`/`appRun`，最终执行 `path.resolve(undefined)` | 真实门禁调用缺陷 |
| Windows 安装器无法恢复旧安装源 | NSIS 依赖子进程返回的临时状态，但结果没有可靠回到父进程；引号解析函数在特定 `customHeader` 展开上下文也不可用 | 真实安装迁移缺陷 |
| current-user 升级到 all-users 后残留旧项 | 旧 HKCU 卸载注册、桌面和开始菜单快捷方式未被完整、精确地清理 | 真实升级缺陷 |
| Windows PowerShell/文件系统测试随机超过 5 秒 | 多个真实子进程沿用 Vitest 默认 5 秒预算；Graph liveness 的外层预算也小于内部多阶段等待总量 | 测试时序误报 |
| Electron 报 `Failed to get 'appData' path`，随后 Playwright 启动超时 | 安装迁移后的 runner `APPDATA` 不可解析；smoke 虽创建了隔离目录，却没有在首次读取前绑定 Electron `appData` | 测试环境隔离缺陷 |

这些问题看起来像连续回归，是因为 PR workflow 具有前后依赖：最初 Graph 失败时，后面的 AppImage、NSIS 和桌面 smoke 没有机会运行。清除一个前置阻塞后，下一个既有假设才被验证。排查时必须从最早失败的真实步骤开始，不能只追逐日志中最醒目的字符串。

对应修复保持以下边界：

- GraphScheduler 生产语义未改变；shutdown 完成断言使用 5 秒上限，测试级死锁上限仍然有界。
- AppImage smoke 显式接收并校验同一制品提取出的路径。
- NSIS 在进程内恢复并解析已注册安装源，后续清理继续 fail-closed。
- 跨安装范围迁移只清理经过验证的源、固定注册位置和明确的旧快捷方式。
- 桌面 smoke 仅在专用环境标记下绑定预创建的隔离 `appData`；普通应用启动行为不变。

历史证据：PR [#1059](https://github.com/KunAgent/Kun/pull/1059) 的提交 `cca569244d4b1edad028316f3b827c97bc9f5e76` 在 [PR Checks 30753798985](https://github.com/KunAgent/Kun/actions/runs/30753798985) 完成过一轮常规测试、CodeQL 和 Linux、Windows、macOS、Intel macOS 原生验证。

## 发版前本地检查

先确认分支、基线和工作树：

```bash
git status --short --branch
git fetch origin
git log --oneline --decorate -n 10
```

功能分支应基于最新 `origin/develop`，工作树不得包含构建产物、提取后的应用、临时日志或调查笔记。至少运行：

```bash
npm run test:graph:platform
npm run build:kun
npm run typecheck
npm run lint
npm run test
npm run build
git diff --check
```

涉及打包、Extension、迁移或发布门禁时，还应运行对应的聚焦测试，例如：

```bash
npm run check:extension-release-gate
npm run smoke:development-graph-workbench
```

本机不支持的安装器行为必须在 PR 原生 CI 验证。不得因 macOS 本地测试通过就推断 Windows NSIS 或 Linux AppImage 通过。

## PR 原生 CI 必查项

### 通用检查

- [ ] root 与 Kun runtime 依赖安装成功。
- [ ] root/Kun typecheck、lint、unit tests、Extension schema/docs/packages/examples 和依赖审计通过。
- [ ] CodeQL 通过。
- [ ] 所有检查绑定最新 PR SHA，没有被新 push、重新标记 ready 或基线更新取代。

### Linux

- [ ] Ubuntu/Node 22 Graph 平台测试通过。
- [ ] `dist:linux` 成功产生唯一、正确架构的 deb 与 AppImage。
- [ ] 打包后的 CLI、OCR、Extension Node runtime、FFmpeg fail-closed 和 runtime migration 通过。
- [ ] 打包后的 Extension Chromium desktop smoke 通过。
- [ ] 最终 x86_64 AppImage 被直接执行并通过 Chromium smoke；`linux-unpacked` 成功不能替代此项。
- [ ] AppImage fixture 使用同一制品提取出的显式 `appRoot`、`appRun` 和 resources，不接受 `undefined`、仓库外路径或其他构建产物。
- [ ] Linux native evidence 在最终 smoke 之后生成并随制品上传。

### Windows

- [ ] 原生 Graph、Extension public release gate 和 GUI 内置终端命令 smoke 通过。
- [ ] NSIS 安装器构建成功。
- [ ] 安装路径迁移 smoke 覆盖 current-user、all-users、旧产品名、带引号卸载命令和无未知内容的安装目录。
- [ ] 迁移后旧 HKCU 卸载注册、旧用户桌面/开始菜单快捷方式和旧 PATH 项被精确清理。
- [ ] 新安装范围的注册、快捷方式、PATH 和 `bin\\kun.cmd` 正确。
- [ ] 打包后的 CLI 和 Graph workbench 指针交互 smoke 通过。
- [ ] Extension Node/Chromium、FFmpeg fail-closed 和 runtime migration 通过。
- [ ] Windows native evidence 在最终 smoke 后生成并上传。

### macOS

- [ ] host-native Graph 和 Extension public release gate 通过。
- [ ] arm64/x64 包均成功构建，资源、终端命令、Graph workbench 和 Extension runtime/desktop smoke 通过。
- [ ] Intel macOS 独立 job 使用最终 x64 产物完成验证。
- [ ] 正式 release workflow 完成 Developer ID 签名、公证和 stapled-ticket 验证；PR 的 ad-hoc 签名不能替代正式验证。
- [ ] macOS native evidence 与最终制品一起上传。

## 容易复发的设计问题

### 测试超时

- 不要仅因为 CI 变慢就无限放大超时或添加盲目重试。
- 区分“内部状态等待上限”“清理上限”和“测试外层死锁上限”。外层预算必须覆盖所有串行阶段及合理清理余量。
- 优先等待可观察状态或进程退出，避免依赖固定的短 `setTimeout`。
- 多个 PowerShell、文件系统或 Electron 子进程必须使用符合真实工作量的平台预算。
- 修改超时时保留业务断言；不得通过移除 durable-state、次数或中断断言来换取绿灯。

### 脚本与 helper 参数

- CJS/MJS 和 shell/PowerShell 边界需要运行时参数校验，不能只依赖 TypeScript 调用方。
- 路径参数在调用处显式命名并校验为非空字符串，再执行 `resolve`、`join` 或 containment 检查。
- 报错应指出缺失的业务字段，例如 `appRoot is required`，不要只留下 Node 的 `paths[0]` 异常。
- smoke 必须绑定唯一制品，禁止从工作区或其他构建目录补齐缺失资源。

### Windows 安装迁移

- 不依赖跨 NSIS/PowerShell 进程的隐式变量或临时寄存器状态；需要的数据应在同一进程恢复，或通过明确、验证过的序列化通道传递。
- 所有删除操作先规范化和验证源路径，再执行精确目标清理；无法验证时 fail-closed。
- current-user/all-users 的注册表、快捷方式和 PATH 必须成组验证，不能只检查程序目录是否存在。
- 对固定兼容位置和历史产品名使用表驱动测试，新增旧版本兼容项时同步扩展迁移矩阵。

### Electron 和桌面 smoke 隔离

- 显式创建并绑定 smoke 的 HOME、`APPDATA`、Electron `appData`/`userData`、临时目录和端口。
- `app.setPath(...)` 必须发生在第一次 `app.getPath(...)` 之前。
- 隔离覆盖只允许在明确的 smoke 环境标记下启用，避免改变普通开发和生产启动。
- 启动失败时同时检查 Electron 主进程错误、Playwright/CDP 超时、真实进程路径和端口；不要把后续超时误认为首个根因。

### Workflow 状态

- `ready_for_review`、push 或基线更新可能对同一 SHA 重新触发完整平台矩阵。标记 ready 前应完成最后一次代码和 PR 文案检查，减少重复运行。
- 不要取消最新的 required run 并用旧 run 代替。可在 workflow 层增加同 SHA 并发去重，但分支保护所引用的最新检查仍必须成功。
- 旧失败 run 留下的机器人 `changes requested` 只能在确认其对应旧 SHA、最新必需检查全绿且没有人工意见后 dismiss。
- 作者不得自批。必须取得分支保护要求的有效维护者审批。

## 合并与自动发布

- [ ] 热修复 PR 面向 `develop`，最新 SHA 的全部必需检查通过并取得审批。
- [ ] 热修复合入后，`develop -> master` 发布 PR 已刷新到包含该 merge commit 的最新 `develop` SHA。
- [ ] 发布 PR 计算出的版本与预期一致；不一致时停止发布。
- [ ] 发布 PR 的通用、Linux、Windows、macOS、Intel macOS、安全和审批门禁全部通过。
- [ ] 合并发布 PR 后，由自动 Release workflow 创建 tag 和 Release；不手工补 tag。

## 发布后验证

- [ ] `vX.Y.Z` tag 指向预期的 `master` merge commit。
- [ ] GitHub Release 已发布且不是 draft；版本、commit 和 release channel 一致。
- [ ] macOS arm64/x64、Windows x64、Linux x64 AppImage/deb、更新元数据及要求的 native evidence 齐全。
- [ ] Release 资产架构、文件名、大小和 SHA-256 与 evidence 一致，没有额外版本、错误大小写或重复架构资产。
- [ ] R2 三平台 manifest 与 Release 一致。
- [ ] R2 `stable/latest` 只在全部平台上传和验证成功后完成推广。
- [ ] 从 GitHub Release 和 R2 各抽查至少一个最终用户下载入口，确认不是旧版本或旧缓存。

## 失败时的排查顺序

1. 确认失败 run、attempt、job 和完整 SHA，排除旧 run 或已被新 push 取代的检查。
2. 找到最早一个失败步骤和第一条真实异常；后续 Playwright timeout、进程退出或 artifact 缺失往往只是连锁结果。
3. 判断它属于生产行为、安装/打包行为、门禁脚本契约、测试时序还是 runner 环境。
4. 在本地运行最小聚焦用例；需要原生操作系统时，以对应 runner 日志和制品为证据。
5. 修复后先跑聚焦测试，再跑完整本地检查和最新 SHA 的原生矩阵。
6. 不把预期故障注入日志、旧机器人 review 或其他平台的成功结果误当成当前失败根因或通过证据。

## 发版记录模板

每次发布可复制下面内容到发布 PR、issue 或值班记录：

```text
预期版本：
develop SHA：
热修复/功能 PR：
PR Checks run：
CodeQL run：
有效审批人：
develop merge commit：
发布 PR：
master merge commit：
Release workflow run：
实际 tag：
GitHub Release：
跨平台资产/evidence：
R2 stable manifest：
R2 stable/latest：
已知但确认无关的警告：
最终确认人和时间：
```
