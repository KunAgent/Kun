# 发布、故障排查与 API Changelog

> Extension API：v1
> English: [Release, troubleshooting, and API changelog](./release-troubleshooting-changelog.en.md)
> 相关：[CLI 与测试](./cli-testing-debugging.md) · [版本与迁移](./versioning-and-migrations.md)

本页是发布 `.kunx` 的最后门槛，也是用户/开发者诊断扩展故障的起点。公开 API 变更必须同步更新这里的 Changelog、类型、Schema、兼容矩阵和中英文文档。

## 发布检查表

### 0. Kun 平台公开发布门禁

本节由 Kun 发布负责人执行，不能由某个扩展作者的测试替代。任一项未通过时，Extension Platform 不得作为公开功能发布：

- [ ] 内部平台 gate 已移除；不存在用于隐藏完整 Extension Platform 的 build/env/settings 开关，`kun extension`、`/v1/extensions/*`、Extension Center 和已授权 workbench contribution 在正式构建中可达。
- [ ] Canonical supported-version list、Runtime diagnostics、CLI validator 和 Host admission 使用同一 API/Manifest 版本源；v1 只执行 current major 1（没有 previous major），`N > 1` 时必须同时执行 current `N` 与 retained-SDK previous `N-1` Host adapter conformance。
- [ ] Current/previous negotiation fixture、future/removed major 拒绝、minor capability negotiation、RPC admission、migration crash recovery 和 rollback fixture 全部通过；旧 Manifest 被接受不能替代上一 major 的真实 Host 行为适配。
- [ ] 源码树外的临时 clean project 只从 `.tgz` 安装打包后的 `@kun/extension-api`、React bindings、test harness 与 Kun CLI，不使用 workspace/repo alias；它完成 typecheck、View Manifest、Agent call、tool、streaming Provider 和 CLI validate/pack/install/list/doctor/uninstall。
- [ ] UI 外观包、MCP、Skill 保留自己的目录、配置、Marketplace/设置入口、运行时 Provider 与测试；未被 `.kunx` registry 重解释、迁移或删除。
- [ ] 原有 Kun runtime 的 health、thread/turn、HTTP/SSE replay、approval、user-input、usage、workspace 与 provider behavior 非回归；仍只有一个 `kun serve` Agent runtime。
- [ ] 打包资源包含 Extension Host runner、CLI、SDK runtime、Manifest Schema/compatibility fixtures、全部 scaffolder templates、Extension Webview/protected-surface preload 和所需生产依赖；after-pack 缺一项即失败。
- [ ] Node 22/npm 10 的 clean checkout 在没有 `node_modules`、`packages/extension-api/dist`、`kun/dist` 和 `out` 时可直接完成 `npm ci`；bootstrap 必须先构建 public Extension API，再安装 Kun 的独立依赖树并编译 Kun，lockfile 必须能被 release runner 的 npm 版本重现。
- [ ] macOS、Windows、Linux 的 release job 都运行 `npm run check:extension-release-gate` 并生成可安装 artifact；各平台先完成 packaged Node runtime 的本地 `.kunx` install、Webview Session API、Agent tool、headless tool、custom Provider/account 和 uninstall smoke，再完成真实 Chromium desktop E2E；Linux 还必须在 upload 前直接执行最终 x86_64 AppImage。
- [ ] Daily frontier 预发布和本地 GitHub/R2 release helper 受同一顺序约束；任一 release gate、packaged Node runtime smoke 或 desktop Chromium smoke 失败时，artifact upload、latest promotion 与公开发布都不得继续。
- [ ] Electron/Webview 安全基线已在当前 pinned Electron 上复验：继承的开发/runtime override 已清除；只接受 packaged renderer 与精确 `kun-extension://` Webview target；真实 CDP contribution 点击、body marker、`Reflect.ownKeys` 桥接面、完整 Theme 与 runtime View state round-trip、无 `kunGui`/Electron/Node、Host filter 阻断下 loopback canary 零请求、user-gesture popup 被拒且无新 target，以及 protocol confinement、sender/session binding、protected consent 与 content-script exclusion 均通过。
- [ ] 发布证据记录已填写 commit、CI run、三平台 artifact/smoke、兼容/legacy 回归结果与 reviewer；`Blocked` 或没有链接的项目不能记为完成。

自动化门禁用 `npm run check:extension-release-gate` 执行：它运行门禁自身单测、源码树外 tarball acceptance、current/previous 策略以及选定的 UI Plugin、MCP、Skill、单 runtime 和 legacy Provider 行为测试；静态结构检查与 after-pack 资源断言仍作为补充。v1 的 executable conformance 只有 major 1；首次发布 v2 前，门禁会 fail closed，直到保留的 v1 SDK 位于 `packages/extension-api-compat/v1` 且 `scripts/fixtures/extension-api-conformance/v1.mjs` 能真实执行 v1 Host adapter 行为。

每个平台打包后必须依次运行两层基础 smoke：`npm run smoke:packaged-extensions -- --resources <app-resources>` 从真实 `app.asar.unpacked` 以 packaged Node runtime 完成 `.kunx` lifecycle、Kun Webview Session API、headless/Agent tool、custom Provider/account、doctor 和 uninstall；`npm run smoke:packaged-extension-desktop` 则以隔离 HOME/userData 正常启动 host-native Electron，经 CDP 点击 smoke contribution 并检查真实 Chromium Webview 安全边界。其 fixture 只显式允许动态 canary origin，并对隔离 guest 绕过资源协议的独立 CSP，使 Host request filter 成为被测控制。同步子进程与 process-tree cleanup 各自有硬超时；脚本验证 runtime/CDP 端口关闭，且不会对已退出 launcher 的旧 PID 发信号。Linux 无显示环境使用 `xvfb-run`。两种 Linux desktop smoke 前，CI 只在临时 runner 上启用存在的 user namespace 内核开关，并要求 `unshare --user --map-root-user /bin/true` 通过；这段固定准备不接收 artifact 路径或输入。`afterPack` 把真实 Electron 改名为 `<executable>.electron-bin`，在原名写入固定产品 launcher：普通 GUI 无条件前置 `--disable-setuid-sandbox`，`ELECTRON_RUN_AS_NODE=1` 的 Kun CLI 原样旁路；绝不使用 `--no-sandbox`，现代 user namespace 与 seccomp sandbox 仍然启用。`appImage.executableArgs` 只影响 `.desktop`，不能替代直接启动入口。随后运行 `npm run smoke:packaged-extension-appimage`：唯一原生 x64 产物以自身 `--appimage-extract` 解压到全新空目录，拒绝 `AppRun`、resources、embedded `app.asar`、产品 launcher、ELF payload 和唯一 root desktop entry 的 symlink 或越界，并要求精确的 `Exec=AppRun --disable-setuid-sandbox --no-first-run %U`。验证后的 resources 只来自同一最终产物且不追加外部 `app.asar`；实际 GUI 测试不注入 sandbox flag，而是清除继承的 `APPDIR`/`APPIMAGE`，设置 `APPIMAGE_EXTRACT_AND_RUN=1`，直接启动 AppImage 本体。Node 编排的子进程均使用 `shell: false`；产物 launcher 本身是内容经过精确校验的固定 `/bin/sh` 脚本。提取、同步 CLI、CDP 与 cleanup 阶段各自有界，CI AppImage step 另有 10 分钟总兜底，但本地命令不宣称单一严格总时限。未来 deb/rpm 或 `app.relaunch()` 必须重新进入 launcher 或显式保留 flag，不能默认使用指向 `.electron-bin` 的 `process.execPath`。用户直接运行 AppImage 依赖可用的 unprivileged user namespace；若启动失败，先运行 `unshare --user --map-root-user /bin/true` 诊断，再由管理员调整 userns/AppArmor policy，绝不能建议 `--no-sandbox`。前一层使用 `ELECTRON_RUN_AS_NODE`，不能证明桌面 Chromium；AppImage 层也不替代 headless/runtime flow；`linux-unpacked` 通过也不能替代最终 AppImage。自解压让 CI 不依赖 FUSE，但不证明 FUSE mount 执行或安装器行为。工作流配置和门禁通过都不是 Windows/Linux 原生执行证据；这些层也不能模拟另一个操作系统的安装器、可访问性或系统 Credential Store，因此 artifact 安装与原生平台证据必须由对应 macOS、Windows、Linux CI/实机取得。

PR 检查必须在三种原生 runner 上完成上述 smoke，且只验证、上传临时 artifact，不创建 Release。最后一个 smoke 成功后才可运行 `npm run evidence:extension-native`；生成的三平台 JSON 证据必须绑定完整 commit、GitHub run/attempt、规范 artifact、bytes 和 SHA-256，并随 artifact 上传。证据生成对缺失、多余、错误架构、目录和 symlink fail closed。macOS PR 使用不含发布秘密的 ad-hoc 签名；正式发布记录仍必须来自 Developer ID 签名、公证和 stapled ticket 均通过的受保护工作流。

#### 发布证据记录

| 证据 | 状态（Pass/Blocked/N/A） | Commit、CI run、artifact 或报告链接 | Reviewer/日期 |
| --- | --- | --- | --- |
| Automated release gate、external tarball project 与 current/previous conformance |  |  |  |
| Legacy UI Plugin/MCP/Skill 与 Kun runtime regression |  |  |  |
| macOS package/resource/Node runtime/Chromium desktop smoke |  |  |  |
| Windows package/resource/Node runtime/Chromium desktop smoke |  |  |  |
| Linux package/resource/Node runtime/Chromium desktop/final AppImage smoke |  |  |  |
| Migration、rollback、headless tool 与 custom Provider/account |  |  |  |

### 1. Identity 与版本

- [ ] `publisher.name` 与既有发布身份完全一致；没有把 rename 当普通更新。
- [ ] Package `version` 是新的合法 SemVer，Index 不覆盖已有版本 bytes。
- [ ] `manifestVersion`、`apiVersion`、`engines.kun`、`stateSchemaVersion` 分别准确。
- [ ] 已在目标 Kun current/previous API major 范围测试。
- [ ] 使用已弃用 API 时已有迁移；release note 写 replacement/removal horizon。

### 2. Manifest 与权限

- [ ] `kun extension validate` 无 error，warning 已修复或明确评估。
- [ ] Entry、activation event、contribution/command/tool/provider/auth 引用一致。
- [ ] Headless contribution 有 `main`，browser-only 不声称 headless。
- [ ] 权限最小化；hostname/provider/workspace scope 不使用不必要的宽范围。
- [ ] 新增 permission、Provider input capability、Node/DOM/secret-read 有清晰风险说明并触发 renewed consent。

### 3. 生命周期与可靠性

- [ ] `activate` 在 deadline 内返回，不等待网络/模型/用户。
- [ ] 所有 command/listener/tool/provider/timer/subscription/View registration 都可 dispose。
- [ ] Cancel/dispose 幂等；terminal 后不提交晚到结果。
- [ ] Queue、stream、cache、log 和 response 都有 bytes/items/time 上限。
- [ ] Host crash、timeout、circuit-open 不影响 Kun/其它扩展。
- [ ] 可能有副作用的 unknown outcome 不自动重试。

### 4. UI 与安全

- [ ] 声明式 control 使用宿主组件；复杂 UI 在 Webview，不注入 Kun React tree。
- [ ] Webview 无 Node/custom preload/direct network/remote script/eval，CSP 与 protocol resource confinement 通过。
- [ ] Theme、locale、zoom、keyboard、screen reader、focus restore、高对比/低动画通过。
- [ ] View close/guest crash/workspace switch/disable 清理 session。
- [ ] Direct DOM 只有无法替代时存在；声明 `hostDom`、isolated world、protected surface exclusion、selector failure containment。
- [ ] Credential/permission/approval/secret flow 只用 protected surface 和 Host consent token。

### 5. Agent、工具与 Provider

- [ ] Agent 只访问 own thread，budget clamp、sequence replay、steer/cancel/gate 已测试。
- [ ] Profile 只加 instruction overlay，不改 stable system prefix/policy。
- [ ] Tool 参数/输出/sideEffects/idempotency 准确，ApprovalGate/user input 不可绕过。
- [ ] Tool catalog canonicalization、epoch/drift/progressive discovery 已测试。
- [ ] Provider probe/listModels/所有 stream event/usage/tool-call/cancel/backpressure 通过。
- [ ] Explicit selected Provider/account/model 不可用时无 silent fallback。
- [ ] Provider 完整模型请求数据披露清晰，错误/日志不含 prompt/secret。

### 6. 账号、状态和数据

- [ ] Multiple account、missing/expired/interaction-required、rename/delete 已测试。
- [ ] API key/OAuth PKCE/device/refresh 通过 protected Account Broker；Webview 无 raw secret。
- [ ] Custom signer 的 secret-read 最小范围且审计/清除内存。
- [ ] Global/workspace/View state 不含 secret，遵守 quota。
- [ ] State migration 对所有 namespace 事务化，失败/crash recovery/rollback fixture 通过。
- [ ] Unavailable Provider 保留 binding/account，不删除 credential、不改绑。

### 7. 测试与文档

- [ ] Typecheck、unit/integration、SDK harness、example smoke 通过。
- [ ] GUI 关闭后的 headless tool/Provider/account path 通过。
- [ ] macOS、Windows、Linux 验证 `.kunx` 路径/ZIP/资源。
- [ ] Packaged Electron Webview/Direct DOM security E2E 通过。
- [ ] Manifest/Index JSON snippets、links/anchors、中英文件/heading/snippet 对齐。
- [ ] README/LICENSE/API reference/compatibility matrix/migration/Changelog 与 SDK 一致。
- [ ] 外部 clean project 只用 published SDK/CLI 能 build/test/pack/install。

### 8. 包与发布

- [ ] `.kunx` 包含 Manifest、integrity、README、LICENSE、entries/assets，无 secret/link/无关文件。
- [ ] SHA-256、可选签名、Index entry identity/version/engine/API/permissions 完全一致。
- [ ] 在 isolated profile 完成 install → activate → disable → rollback（如适用）→ uninstall。
- [ ] Index 使用 HTTPS exact-version immutable URL；发布不会触发自动 update 检查。
- [ ] 支持渠道知道如何收集 `doctor --json` 与脱敏 logs。

## 故障排查

先执行：

```bash
kun extension validate /path/to/source-or-package --json
kun extension doctor <publisher.name> --json
kun extension logs <publisher.name> --json
```

按顺序检查 admission → enablement/permission → lifecycle/health → resource/session → business operation。不要用关闭验证、开启 Webview Node、修改 runtime token 或实现 Provider fallback 来“修复”。

### 常见问题表

| 现象 | 重点检查 | 正确处理 |
| --- | --- | --- |
| 包无法安装 | Manifest path、integrity、ZIP path/link/collision/size、source HTTPS | 修复包并重新 pack；不关闭 validator |
| 显示 incompatible | `engines.kun`、`manifestVersion`、`apiVersion` major/capability | 安装 compatible Kun/扩展版本或按 migration guide 迁移 |
| 升级后要求重新确认 | 新 permission/input capability/signature/source 变化 | 审阅差异；不能沿用旧 consent 自动通过 |
| 扩展安装但看不到 View | global/workspace enablement、trust、`when`、`ui.views`/`webview`、entry | 修正 Manifest/grant/context；打开 View 才激活 |
| 命令不存在 | `commands` 声明、activation event、运行时 register/dispose、ID namespace | 对齐 local ID 和 `commands.register` |
| Activation timeout | `activate` 内网络/模型/用户等待、同步重任务 | 快速注册后返回，把工作移到 handler |
| Host repeatedly crashes/circuit-open | last error、memory/protocol limit、process log、restart count | 修崩溃/超限，显式 reload/re-enable；不无限自动重启 |
| Webview 白屏 | `kun-extension://` path、resource root/MIME/CSP、View Session、guest crash | 修 resource/build/CSP；不能开启 Node/remote script |
| Webview fetch 失败 | `connect-src 'none'`、`network:<hostname>`、Broker URL/redirect | 使用 Network Broker 和精确 grant；不要 direct fetch |
| Direct DOM 失效 | Kun UI 变化、private selector、surface match、permission | 容错退出并更新扩展；优先迁移到 stable View/action |
| Account 列表无秘密 | 这是预期行为 | 使用 authenticated fetch；仅 Node custom signer 申请 secret-read |
| Account interaction-required | expired/revoked refresh、需要 login/unlock、headless | 在 protected UI 重新认证；headless 不自动打开 GUI |
| Provider 不可用且没有 fallback | disable/uninstall/circuit/binding/model capability | 修复 exact binding/Provider 后显式重试；这是隐私保证 |
| Provider stream protocol error | sequence、event kind、tool fragment、payload、terminal、backpressure | 使用 SDK types/test harness，保证一个 terminal 和 ack |
| Agent 看不到 foreign thread | 这是 owner isolation | 用 extension-owned thread；没有隐式 adopt API |
| Agent 停在 approval/user input | 等待真实受保护用户交互 | 不能用 steer/Webview/content script 回答/批准 |
| Tool permission denied | invocation-time workspace/network/account/tool grant 被撤销 | 恢复明确 grant 或让工具失败；Catalog membership 不等于授权 |
| Tool unknown outcome | Host 在可能副作用后崩溃 | 人工核查外部系统；非幂等调用不要自动重试 |
| Catalog drift | 已 pinned tool Schema 与 live registry 不一致 | 新 thread 或 idle boundary 新 epoch；不要热改 prefix |
| Migration failed | from/to、namespace、quota、timeout、backup/commit marker | 修 forward migration；旧版本/状态应保持可用 |
| Rollback refused | 无 compatible state snapshot | 保持当前版本；发布向前修复，不能猜 reverse migration |
| Uninstall 后数据仍在 | 默认保留 state/log/account reference | 通过独立数据删除流程确认影响后清理 |
| Linux 打包在 `v8-primitive.h` 的 `V8_EXPORT` 处失败 | Electron native rebuild 命令是否先有 `-DV8_DEPRECATION_WARNINGS=1`、后有 `-UV8_DEPRECATION_WARNINGS` | 必须通过仓库的 `electron-builder.config.cjs` 打包并保留后置 `-U`；不要关闭 `npmRebuild` 或删掉 native module |

### Admission 失败

查看 doctor 中每个版本维度，而不是只看 package version。入口代码未执行是正确的 fail-closed 行为。Future API、过旧 API（当前 major 的 N-2）、unknown Manifest 或 engine range 不匹配必须选择 compatible artifact，不能强制加载。

### Activation/Host 故障

定位 activation cause、deadline、PID、last structured error、memory/message/concurrency/stream limit 与 circuit。模块顶层异常和 `activate` reject 都算不健康启动。修复后显式 `reload`；side-effect call 不会因为重启自动重放。

### Webview/Bridge 故障

确认 resource URL 属于自己的 selected version/resource root，CSP 不含被拒 remote/inline code，sender/session 未 stale，payload 在 Schema/size/rate 内。Workspace switch/disable 后旧 session 消息被拒绝是正常行为。

### Provider/Account 故障

检查 coherent provider + account + model binding、account status、Provider Host health、network grant、模型 capability 和 stream terminal。Authentication error 只需展示 account reference/status；不要输出 credential。Headless interaction-required 应交回可操作 continuation，不挂起。

### State/Rollback 故障

Migration 失败不能手工编辑 committed state 或 package directory。保留 backups/diagnostics，在修复版本中添加 deterministic forward migration。Rollback 只使用 retained compatible snapshot。

## 安全地收集支持信息

建议用户提供：

```bash
kun --version
kun extension doctor <id> --json
kun extension logs <id> --json
```

再附：扩展 `.kunx` SHA-256、source type、复现步骤、workspace trust/enablement（不需要 workspace 内容）、期望/实际 terminal error code。

默认输出会 redact 已知 secret、authorization、runtime/consent token 和完整 prompt，但公开前仍人工检查业务 metadata。不要索要 `.env`、Credential Store、API key、OAuth token、完整聊天/附件或未脱敏 crash dump。

## API Changelog

Changelog 记录公开 Extension API，而不是 Kun 内部重构。每项包含：API version、关联 Kun release line、Added/Changed/Deprecated/Removed/Fixed/Security、迁移动作和最早 removal major（适用时）。

下面的 public surface 快照由文档门禁从 package 入口、公开 export 和可达 `.d.ts` 计算。只有在本节已经解释兼容性影响后才更新快照；不能把更新 hash 当成 Changelog 条目。

<!-- BEGIN GENERATED SDK PUBLIC SURFACE SNAPSHOTS -->
<!-- sdk-surface-snapshot @kun/extension-api@1.0.0 sha256:f0d5ab4b66bce2be3c094f18bdb342ef66d097b057f954ef35a9dbb840567006 -->
<!-- sdk-surface-snapshot @kun/extension-react@1.0.0 sha256:e2099a64dc22c05056dca0c599bafdfb22702b6d57e9b60edd2154b165323322 -->
<!-- sdk-surface-snapshot @kun/extension-test@1.0.0 sha256:6a8a22ddd71ea7b7d88401f6fae3530775e59fdca52c9dc6052b4593950588be -->
<!-- END GENERATED SDK PUBLIC SURFACE SNAPSHOTS -->

### v1.0.0 — Initial stable API

Added:

- `.kunx`、Manifest v1、integrity、registry、local/dev/HTTPS Index v1、atomic install 与 manual rollback。
- `@kun/extension-api` framework-neutral lifecycle、commands、UI、storage、network、Agent、tools、Providers、authentication contracts。
- `@kun/extension-react` 与 `@kun/extension-test`。
- Stable workbench contribution IDs、sandboxed Webviews 和高风险 unsupported Direct DOM。
- Extension-owned Agent Runs/threads、replayable events、budgets、profiles 与 pinned tool catalog epochs。
- Namespaced tools，经 Kun ToolHost/ApprovalGate 执行。
- Complete normalized streaming model Provider、multiple accounts、API key/OAuth PKCE/device flow、Credential Store 与 no-fallback routing。
- Current + previous API major compatibility policy、transactional state migration 和 bilingual developer documentation。
- 独立双语 API Reference，以及对 heading/snippet/link/anchor、公开 export 和 `.d.ts` fingerprint 的机器门禁。
- `kun extension create/validate/pack/install/list/enable/disable/uninstall/rollback/doctor/logs/reload`。
- `validate`/`pack` 的 manifest allowlist 与可重复安全 `--include`/`--ignore` 相对路径规则。
- Host 持久化的声明式 configuration：global/workspace 隔离、optimistic revision、change event、SDK/React API、Schema/quota 校验与 secret-like key 拒绝。
- 受保护账号 rename/API-key replacement、显式 workspace trust、带数据披露的 Provider/model/account 选择，以及分离的跨平台 packaged Node runtime smoke 与真实 Chromium desktop Webview E2E。

Fixed:

- `ui.showNotification()` 现在由受信工作台显示，即使没有 View Session 也不会静默丢失；它等待用户 action/关闭并向原始调用返回 action `id`/`undefined`，同时在取消、45 秒超时、工作台 lease 失效、停用和退出时清理。
- `FakeWebviewService` 可记录通知并用 `respondToNextNotification()` 为测试脚本确定性返回 action 或关闭结果；这是对既有 v1 返回契约的测试支持，不要求迁移。

Security:

- Sender/identity-bound brokers、protected consent windows/tokens、Webview Node-off sandbox/CSP、secret redaction、resource limits 和 per-extension crash containment。
- Network/Account/Index 的生产 fetch 对全部 DNS 答案执行 special-use 地址拒绝，并把获准地址 pin 到单次连接；OAuth device/token/refresh 使用同一策略，redirect 仍逐跳手动重验。
- Pack 默认不遍历 project root，并拒绝选中集合中的 VCS/dependency、dotenv、credential/private-key、nested package、link 和 source-root escape。
- Node Host 明确为 trusted current-user code，不声明为 OS sandbox。
- OAuth/device 交互材料只进入 Main-owned protected surface；Node/Webview session projection 均脱敏，认证材料同时受 network permission、Provider `credentialHosts` 和 manual redirect 检查。
- 通知 action/关闭只接受 Chromium trusted user activation；Direct DOM 合成点击不能伪造另一个扩展的用户选择，通知也不作为特权审批 surface。

Compatibility notes:

- v1 为当前首个 major，只支持 API major 1。
- Raw host DOM/CSS/React selectors 不受 v1 SemVer 保证。
- Appearance packs、MCP 和 Skills 保持独立，未迁移到 Extension API。
- v1 不提供任何自动 extension update check/prompt/download/install。

### 后续条目模板

```markdown
### vX.Y.Z — YYYY-MM-DD

Compatible Kun: <release/range>

Added:
- ...

Changed:
- ... (backwards compatible in a minor)

Deprecated:
- `<symbol>` -> use `<replacement>`; earliest removal: vN

Fixed:
- ...

Security:
- ...

Migration:
- Required developer/user action, or “None”.
```

Breaking type、method、event、permission meaning 或 required behavior 只能进入新 major。任何 Deprecated/Removed 都必须同步 type declaration、validator warning、migration guide、兼容 fixture 和中英文页面。
