# CLI、测试与调试

> Extension API：v1
> English: [CLI, testing, and debugging](./cli-testing-debugging.en.md)
> 相关：[快速开始](./quick-start.md) · [打包](./packaging-and-index.md) · [故障排查](./release-troubleshooting-changelog.md#故障排查)

Kun CLI 覆盖外部开发者从脚手架、验证、开发加载到打包、安装、诊断和清理的完整流程。除需要真实 protected consent 的步骤外，它不依赖桌面 GUI。

## 命令总览

```text
kun extension create
kun extension validate
kun extension pack
kun extension install
kun extension list
kun extension enable
kun extension disable
kun extension uninstall
kun extension rollback
kun extension doctor
kun extension logs
kun extension reload
```

始终用安装版本的帮助确认参数：

```bash
kun extension --help
kun extension <command> --help
```

公开命令名、稳定结构化输出和诊断代码受 Extension API/CLI 兼容政策保护；human-readable 排版不应作为自动化解析接口。

## Create

推荐 npm scaffolder：

```bash
npx create-kun-extension my-extension \
  --template node \
  --publisher acme \
  --name my-extension
```

模板：

- `node`：Node/TypeScript 后台扩展；
- `webview`：framework-neutral Webview；
- `react`：React Webview + 官方 Hooks。

也可使用 `kun extension create` 的等价交互。Scaffolder 在写文件前验证 publisher/name/reserved ID，生成 least-privilege Manifest、build/test/validate/pack 脚本和文档链接。无效 identity 不能留下半个项目。

## Validate

```bash
kun extension validate .
kun extension validate ./dist/acme.my-extension-1.0.0.kunx
kun extension validate . --json
kun extension validate . --include dist/chunks --ignore dist/chunks/debug.map
```

同一 canonical Schema 被编辑器、CLI、pack、installer 和 Host 使用。Validate 检查：

- Manifest 和贡献 wire Schema；
- ID、SemVer、entry、resource/integrity；
- permission/contribution/activation reference；
- `engines.kun`、Manifest/API/current capability；
- headless contribution 是否有 `main`；
- package attack/size/path policy；
- deprecation 和 Direct DOM risk warning。

Failure 使用非零 exit code。每条 machine diagnostic 含 stable code、severity、JSON path/operation、扩展身份、说明、remediation 和文档链接，且默认脱敏。

## Pack

```bash
kun extension pack . --include dist/chunks --ignore dist/chunks/debug.map --output ./dist
```

Pack 先 validate，再按 allowlist 确定性收集 Manifest 引用、resource roots 和显式 include，生成 `kun-extension.integrity.json` 与 `.kunx`。`--include`/`--ignore` 可重复，只接受 package-relative 普通文件/目录路径；目录递归，ignore 优先于选择。不要使用 glob、absolute path、`..` 或 link。输出 ID、version、path、SHA-256、compatibility 与 permissions。

Pack 不遍历整个 project root，默认不会包含 `node_modules`、`.git`、source/test/cache 或其他未声明文件；敏感 `.env`、credential/secret config、private key、嵌套 `.kunx` 和选中树内 symbolic link 会被安全策略拒绝。文件名过滤不能替代发布前的 secret/source-map 审查。完整规则与示例见[打包指南](./packaging-and-index.md#确定性打包)。

## Install 与开发加载

Release package：

```bash
kun extension install ./dist/acme.my-extension-1.0.0.kunx
```

开发目录：

```bash
kun extension install --development /absolute/path/to/my-extension
kun extension reload acme.my-extension
```

Release install 需要 source/permission protected review。纯 headless/non-interactive 调用如果遇到新的 consent，不会假装批准；返回 interaction-required 和 continuation guidance。开发目录不复制、不自动 watch/reload。

Custom Index 的 exact-version install 参数以 `kun extension install --help` 为准；无论入口如何，都必须走 HTTPS + Index SHA-256 + 包 integrity + protected consent 的相同流程。

## List 与 Enablement

```bash
kun extension list
kun extension list --json
kun extension enable acme.my-extension
kun extension enable acme.my-extension --workspace /work/project
kun extension disable acme.my-extension --workspace /work/project
```

List 的结构化投影包含 installed/selected version、source、signature、compatibility、global/workspace enablement 和 health，不含 secret。Workspace enablement 不复制包，也不影响其它 workspace。

## Rollback 与 Uninstall

```bash
kun extension rollback acme.my-extension --version 0.9.0
kun extension uninstall acme.my-extension
```

Rollback 需要 retained compatible package 和 state snapshot；失败保持当前 version/state。Uninstall deactivates 并移除 code/registry，但默认保留 state/log/account reference；永久数据删除需要另一个明确确认，不能隐藏在普通 uninstall flag 中。

## Doctor

```bash
kun extension doctor acme.my-extension
kun extension doctor acme.my-extension --json
```

Doctor 验证并报告：

- package integrity、source、version selection；
- Manifest/API/Kun engine/RPC negotiation；
- state schema/migration/rollback snapshot；
- permissions、workspace enablement/trust；
- entries、contributions、Host activation；
- PID、restart、circuit、limits、last error；
- Provider/account binding（仅 reference/status）；
- log location。

它不会输出 secret、authorization、runtime token 或完整 prompt。Automation 应使用 stable code/JSON fields，不解析 human text。

## Logs

```bash
kun extension logs acme.my-extension
kun extension logs acme.my-extension --json
```

Logs 合并扩展 scoped stdout/stderr/Host lifecycle 诊断并轮转。默认脱敏不代表你可以在扩展里先打印 secret；作者必须在写 log 前就清除 credential/prompt body。

## Structured Output 约定

支持 `--json` 的命令：

- stdout 只输出版本化 JSON result；
- human diagnostic 走文档化 diagnostic channel（通常 stderr）；
- success exit `0`，validation/operation failure 非零；
- error 有 stable code + bounded details + remediation；
- interactive-needed 用结构化状态，不挂起 CI。

Machine consumer 必须容忍同一 API major 的 minor 新增 optional fields，不能因未知可选字段失败。

## 稳定 Extension API Error Codes

公开 `ExtensionApiError` 含 `code`、`message`、可选 `operation`/`extensionId`/`details`/`documentation` 和 `retryable`。v1 code：

| 类别 | Codes |
| --- | --- |
| 参数/验证 | `INVALID_ARGUMENT`, `VALIDATION_FAILED` |
| 授权/查找/冲突 | `PERMISSION_DENIED`, `NOT_FOUND`, `CONFLICT` |
| 能力/兼容 | `UNSUPPORTED_CAPABILITY`, `INCOMPATIBLE_API`, `INCOMPATIBLE_MANIFEST`, `INCOMPATIBLE_ENGINE`, `INCOMPATIBLE_RPC` |
| 激活/Host | `ACTIVATION_FAILED`, `ACTIVATION_TIMEOUT`, `HOST_UNAVAILABLE` |
| 取消/预算/资源 | `CANCELLED`, `BUDGET_EXHAUSTED`, `RESOURCE_LIMIT` |
| 交互/Provider/账号 | `INTERACTION_REQUIRED`, `PROVIDER_UNAVAILABLE`, `ACCOUNT_REQUIRED` |
| 协议/未知核心故障 | `PROTOCOL_ERROR`, `INTERNAL_ERROR` |

不要用 message 文案做分支；使用 `code`、`retryable` 和 operation-specific details。只有明确幂等且政策允许时才根据 retryable 重试。

## 单元测试：`@kun/extension-test`

Test 包默认不使用真实 credential、model 或 Electron，提供 deterministic fakes/harness：

- activation/deactivation/time/cancellation；
- permission/workspace policy；
- commands/storage/network；
- Webview message/state/theme；
- Agent event/replay/budget；
- tool invocation/approval/error；
- Provider normalized request/stream/backpressure；
- account metadata/status；
- Host crash/timeout/limit。

示意：

```ts
import { createExtensionTestHarness } from '@kun/extension-test'
import { activate } from '../src/extension'

test('denies a network call outside the grant', async () => {
  const harness = createExtensionTestHarness({
    permissions: ['network:api.example.com']
  })

  await harness.activate(activate)
  await expect(
    harness.context.network.fetch({
      url: 'https://other.example.com/data',
      method: 'GET'
    })
  ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' })
  await harness.dispose()
})
```

示例使用 v1 的公开 harness 和 error code；其它 fake service 的准确字段以同版本 types/fixtures 为准。

## 应测试的最小集合

### 所有扩展

- activate 快速完成，所有 Disposable 被释放；
- required/denied/revoked permission；
- invalid input/output Schema；
- cancellation、timeout、late result；
- state quota 与 migration；
- errors/logs redaction；
- current + previous API major fixture（发布者支持时）。

### Webview

- host message/order/disposal；
- View state restore 与跨 extension/workspace isolation；
- theme/locale/accessibility updates；
- oversized/malformed message rejection；
- browser direct network/navigation/popup denied；
- guest crash 和 stale session。

### Agent/工具

- owned/foreign thread；sequence replay；budget；steer/cancel race；
- argument/result limit、approval/user-input gate、unknown outcome；
- tool catalog canonicalization/drift；headless path。

### Provider/账号

- probe/listModels、所有 stream event、usage/tool fragments/terminal；
- malformed/duplicate terminal、backpressure、cancel、Host crash；
- no fallback；multiple/missing/expired accounts；
- OAuth/device/refresh fake；secret redaction；headless interaction-required。

### Direct DOM

- isolated world 无 `window.kunGui`/Node/Electron；
- 只注入声明 surface/resource；
- protected surfaces 排除；
- disable/revoke cleanup 或 safe reload；
- selector 缺失不影响 Kun。

Direct DOM/Electron security baseline 需要 packaged desktop E2E，不能只靠 jsdom 单元测试。

## 开发调试循环

```bash
npm run build
npm test
npm run validate
kun extension reload acme.my-extension
kun extension doctor acme.my-extension
kun extension logs acme.my-extension
```

推荐：

- 为每次 command/tool/provider call 记录 non-secret correlation ID；
- 使用 fake time/stream，而不是 flaky real network；
- 先看 doctor 的 admission/permission/circuit，再看业务日志；
- Webview 白屏先查 CSP/resource/session，不要开启 Node/关闭 sandbox；
- Provider failure 先修 selected binding，不要实现 silent fallback；
- Catalog drift 用新 thread/explicit epoch，不热改 pinned Schema。

## 集成与发布 CI

CI 至少执行：

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run validate
npm run pack
```

再在 isolated Kun profile：安装 → 激活 smoke → disable → rollback（适用时）→ uninstall。代表性 `.kunx` 在 macOS、Windows、Linux 验证路径大小写、ZIP、权限和 package resources。Provider/tool headless smoke 在没有 Electron 时运行。

Kun 的 packaged 发布有两层不可互相替代的 smoke：

```bash
npm run smoke:packaged-extensions -- --resources /path/to/app/resources
npm run smoke:packaged-extension-desktop
```

Linux release runner 还必须直接执行最终 AppImage：

```bash
npm run smoke:packaged-extension-appimage
```

- `smoke:packaged-extensions` 是 packaged Node runtime smoke。它用 packaged Electron 的 `ELECTRON_RUN_AS_NODE` 模式执行 `.kunx` install、Kun Webview Session API、headless tool、Agent/tool、custom Provider/account、doctor 和 uninstall，但不启动 Chromium 桌面。
- `smoke:packaged-extension-desktop` 正常启动 host-native packaged Electron，使用隔离的 HOME/userData，移除继承的开发 renderer 与 Kun/模型 runtime override，并且只接受 packaged `file:.../app.asar/out/renderer/index.html` target。经 CDP 真实点击 contribution 后，它检查精确的 `kun-extension://` Webview target/body、窄桥的 `Reflect.ownKeys`、完整 Theme 响应、runtime-backed View state set/get round-trip，以及 Node/Electron/`kunGui` 隔离。Fixture CSP 只声明动态 loopback canary；CDP 仅对这个隔离 guest 绕过资源协议响应中独立的 CSP，因此 canary 零请求能证明 Host `webRequest` filter 阻断了直连。`window.open` 以 user gesture 执行，必须同时返回 denied 且不创建 CDP target。同步 CLI 子进程和 process-tree cleanup 均有硬边界，并验证 runtime/CDP 端口关闭。Linux 无显示环境时脚本通过 `xvfb-run` 启动。
- `smoke:packaged-extension-appimage` 只在原生 Linux x64 runner 执行。它要求 `dist` 中恰好一个规范命名的 x86_64 AppImage，拒绝目录、symlink、错误架构和 stale 多产物，并调用该 AppImage 自身的 `--appimage-extract` 模式解压到全新空目录。它拒绝 `AppRun`、`resources`、`app.asar`、同名产品 launcher、改名后的 ELF payload 和 root desktop entry 的越界或 symlink，要求精确启动行 `Exec=AppRun --disable-setuid-sandbox --no-first-run %U`。Linux workflow 与 artifact 内容无关，只在临时 runner 上启用存在的 user namespace 内核开关，并要求 `unshare --user --map-root-user /bin/true` 在两种 desktop smoke 前通过。`afterPack` 会把真实 Electron 改名为 `<executable>.electron-bin`，在原名写入固定 launcher：普通 GUI 无条件前置 `--disable-setuid-sandbox`，`ELECTRON_RUN_AS_NODE=1` 的 Kun CLI 则原样旁路；绝不使用 `--no-sandbox`，因此现代 user namespace 与 seccomp sandbox 仍保持启用。`appImage.executableArgs` 只保障 `.desktop` 行，不能替代这个直接 AppImage 入口。验证后的 resources 只来自最终产物且不追加外部 `app.asar`；桌面测试自身不注入 sandbox flag，而是清除继承的 `APPDIR`/`APPIMAGE`、设置 `APPIMAGE_EXTRACT_AND_RUN=1` 并直接启动 AppImage 本体。Node 编排的子进程均使用 `shell: false`；产物 launcher 本身则是内容经过精确校验的固定 `/bin/sh` 脚本。提取、同步 CLI 和 CDP 等阶段分别有超时，CI AppImage step 另有 10 分钟总兜底，但本地整条命令不宣称单一严格总时限。未来增加 deb/rpm 或 `app.relaunch()` 时必须重新进入 launcher 或明确保留该 flag，不能直接依赖指向 `.electron-bin` 的 `process.execPath`。自解压让 CI 不依赖 FUSE，但不证明 FUSE mount 执行或发行版安装器行为。

只有对应操作系统 runner 上两层都通过，才能记录该平台 packaged Extension smoke 证据；Linux 还必须通过最终 AppImage 本体 smoke。静态脚本测试、Node runtime smoke 或 `linux-unpacked` desktop 不能替代最终 artifact 的 Chromium E2E。

插件平台相关 PR 会在 `macos-latest`、`windows-latest` 和 `ubuntu-latest` 分别构建最终包并运行这些 smoke；它不发布 Release。全部 smoke 通过后，`npm run evidence:extension-native` 才会生成 `extension-native-evidence-darwin.json`、`extension-native-evidence-win32.json` 或 `extension-native-evidence-linux.json`。证据文件绑定完整 commit SHA、GitHub run/attempt、规范产物名、字节数和 SHA-256，并对缺失、多产物、错误架构、目录或 symlink fail closed。PR 的 macOS 包是用于原生行为验证的 ad-hoc 产物；Developer ID、notarization 和 stapled ticket 仍由受保护的稳定发布工作流验证。

文档/示例 CI 还需校验 JSON snippets 可解析、TypeScript snippets 可编译、links/anchors、中英文件/heading 与代码块结构对齐、公开 SDK exports/`.d.ts` fingerprint 与 Changelog。`npm run check:extension-release-gate` 会把 acceptance fixture 复制到系统临时目录，在 Kun repo 外仅从新生成的 `.tgz` 安装 SDK、React bindings、test harness 和 CLI；lockfile 不得引用源码树或 workspace alias。它随后 typecheck 并真实执行 Agent command、tool、streaming Provider，以及 CLI validate → pack → install → list → doctor → uninstall。这个 clean-project gate 证明开发者 artifact 自洽，但不替代三平台 packaged Electron 的原生 smoke 证据。
