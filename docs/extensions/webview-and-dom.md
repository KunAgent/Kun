# Webview 与 Direct DOM

> Extension API：v1
> English: [Webviews and Direct DOM](./webview-and-dom.en.md)
> 相关：[工作台 UX](./workbench.md) · [权限与信任](./security-and-resources.md)

复杂扩展 UI 必须使用宿主创建的沙箱 Webview。只有稳定贡献点无法表达、且你愿意承担每个 Kun patch/minor 都可能修复选择器的成本时，才使用 Direct DOM (`hostContentScripts`)。

## 选择方式

| 需求 | 选择 | 兼容承诺 |
| --- | --- | --- |
| 一个按钮、菜单、设置 field 或通知 | 声明式贡献 | 稳定 API |
| 自定义列表、图表、表单、仪表盘 | Webview | 稳定 bridge/主题/状态契约 |
| 必须读取/改写宿主已有可见 DOM | Direct DOM | 不稳定、高风险；选择器无 SemVer 保证 |
| 要在 Kun React tree 内挂第三方组件 | 不支持 | 使用 Webview |
| 要在 renderer main world 执行脚本 | 不支持 | 使用 isolated Webview/content script |

## Webview 创建与身份

每个复杂 View 由 Kun 建立独立 View Session，并绑定：

- extension ID 与 selected version；
- contribution ID；
- workspace scope；
- WebContents 身份；
- 不可猜、生命周期有界的 session nonce。

即使 guest payload 包含其它 `extensionId`、View ID 或 nonce，Electron Main 仍使用 sender-bound principal；跨扩展/跨 View 请求会被拒绝。允许多实例的贡献会得到多个独立 session。

## 强制沙箱基线

扩展不能覆盖以下设置：

- `nodeIntegration: false`；
- `contextIsolation: true`；
- Chromium `sandbox: true`；
- 只能使用 Kun-owned preload；
- 独立于其它扩展的 session partition，默认不持久化；
- permission requests 默认拒绝；
- navigation、popup、任意 download 默认拒绝。

Guest 不会获得 Node global、Electron module、Extension Host IPC handle、Kun runtime token、账号秘密或完整 `window.kunGui`。Manifest 请求 custom preload、开启 Node 或关闭 sandbox/context isolation 会验证失败或被拒绝。

## 本地资源协议

Webview 文档和资源通过：

```text
kun-extension://<publisher.name>/<package-relative-path>
```

协议 handler 将 URL 绑定到当前 selected installed version，并检查规范化路径、完整性清单和 local resource roots。它拒绝：

- `..`/encoded traversal 和绝对路径；
- link escape；
- 未声明/不存在文件；
- 跨扩展读取；
- remote redirect；
- 不安全 MIME/type confusion。

不要拼接用户输入形成资源 URL。构建时为静态 asset 生成已知路径，动态数据通过 bridge 传递。

## Content Security Policy

最低策略意图为：

```text
default-src 'none';
script-src 'self';
style-src 'self';
img-src 'self' data:;
font-src 'self';
connect-src 'none';
```

最终 CSP 由宿主和同版本 Schema 控制。不要使用远程 script、`eval`、不受控 inline code 或从 CDN 加载框架。即使有 `network:<hostname>`，browser `fetch`、WebSocket 和其它直连仍由 `connect-src 'none'` 阻止；权限只允许通过 Kun Network Broker 发请求。

Webview 构建必须把 npm 依赖打进包内的浏览器资源。Chromium 不会像 Node 一样解析 `@kun/extension-api` 这类裸模块说明符；仅运行 `tsc` 会保留该 import，页面因而无法启动。官方脚手架使用 Vite 打包依赖，其中 framework-neutral `webview` 模板和本文示例以相对 `base` 生成受 local resource roots 约束的 URL。发布前检查最终 HTML/JavaScript，而不是只检查 TypeScript 源码。

## 窄 View Bridge

Kun-owned preload 只公开协商版本的：

- request/response 和 host message；
- command invocation；
- event subscription/disposal；
- theme、locale、zoom、accessibility preference；
- schema-versioned View state；
- 已获准的 Agent/account/provider 等高层 API。

每次调用验证 method、contribution、payload Schema/大小、call rate、outstanding request、lifecycle 和权限。不要依赖 preload global 的实现名字；使用 `@kun/extension-api` 的 framework-neutral client 或 `@kun/extension-react`。

React View 使用：

- `ExtensionViewProvider`；
- `useTheme`、`useLocale`；
- `useViewState`、`useHostMessage`、`usePostHostMessage`；
- `useAgentRun`；
- `useAccounts`、`useProviderStatus`。

模板只把 Kun-owned preload 暴露的 `window.kunExtension: HostTransport` 交给公开 client，然后由 Provider 注入 Hooks：

```tsx
import { ExtensionHostClient, type HostTransport } from '@kun/extension-api'
import { ExtensionViewProvider } from '@kun/extension-react'
import { createRoot } from 'react-dom/client'

declare global {
  interface Window {
    readonly kunExtension: HostTransport
  }
}

const client = new ExtensionHostClient(window.kunExtension)
createRoot(document.getElementById('root')!).render(
  <ExtensionViewProvider client={client}>
    <App />
  </ExtensionViewProvider>
)
```

`window.kunExtension` 是 View 专用的窄 transport，不是 `window.kunGui`。业务组件应使用 client/Hooks，不直接发私有 method；View teardown 时 dispose client。

组件 unmount 时，Hooks 必须释放 subscription 和 pending work。非 React 应用使用同一 framework-neutral bridge，不需要 Electron。

## View State

浏览器 local/session storage 不应承担持久数据；partition 默认非持久，且清理/recreate View 时可丢失。持久 View state 通过公开 API：

- scope 固定为 extension + contribution + workspace（适用时）；
- 保存结构化、Schema-versioned、quota-bounded 数据；
- 不能包含 credential、token、cookie、secret 或私有 prompt；
- 不接受任意 binary；大数据应使用扩展 Storage API 或文件型公开能力；
- 版本变化使用明确迁移，不把 incompatible state 直接交给旧 View。

不同扩展即使使用相同 key 也不能互读。一个扩展不能以另一个 fully-qualified View ID 请求状态。

## 主题、locale、焦点和可访问性

使用公开 theme tokens，不引用 Kun 私有 CSS variable/DOM class。Host 更改主题、locale、zoom 或 accessibility preference 时，bridge 发送更新。

`ui.getTheme()` 返回已解析的工作台主题、实际 zoom、reduced-motion 状态和以下稳定公开 token：`background`、`sidebarBackground`、`surface`、`foreground`、`mutedForeground`、`border`、`accent`、`focusRing`、`success`、`danger`。`ui.getLocale()` 返回当前 Kun 语言和文字方向。React View 可使用 `useTheme()` / `useLocale()` 订阅同一组实时更新。

桌面工作台会把同一份环境快照同步给 Kun Extension Host，因此 Node entry 在桌面连接期间按请求读取到的值与 View 一致；纯 headless 运行没有工作台偏好时使用文档化的确定性默认值。

View 应：

- 保持 keyboard reachable 和逻辑 tab order；
- 提供语义 label、表单 error 和 live status；
- 遵守 reduced motion/high contrast；
- 在关闭/崩溃后让宿主把焦点恢复到来源 control；
- 不拦截宿主保留快捷键；
- 对 streaming/long operation 提供 cancel/reconnect UI。

## 导航、外部打开、下载和设备

Webview 不能离开自己的 `kun-extension://` origin，不能创建未批准窗口，也不能直接下载文件。camera、microphone、geolocation、MIDI、USB、serial、Bluetooth、screen capture 和 Chromium notification 默认全部拒绝。

需要打开外部 HTTPS 页面或导出文件时，调用文档化 Host command，让宿主校验 URL/path、权限和必要的用户确认。不要用 `window.open` 或隐藏导航模拟。

### 经授权的外部网站 View

确实需要在侧栏中运行完整远程网站时，扩展必须同时声明 `webview.external`、普通 `webview` 和每个允许顶层导航的 `network:<hostname>`（wildcard 不包含 apex hostname）。宿主只为经过工作区权限审核、声明了 `externalBrowser` 的 View 创建 Main-owned `WebContentsView`，并强制：

- 远程 guest 不加载 Kun preload，不能访问 `window.kunExtension`、Node、Electron 或本地扩展资源；
- 顶层初始 URL、导航、redirect 和 popup 必须是 HTTPS 且匹配授权 hostname，popup 复用当前 guest；
- permission/device requests 和 downloads 全部拒绝；
- cookie/session data 只进入按 extension ID 隔离的持久 partition，不与默认会话或其它扩展共享；
- HTTPS/WSS/data/blob 子资源可用于网站自身的 CDN、登录和媒体依赖，但不能把顶层页面带到未授权站点。

`externalBrowser.presentation` 可设为 `desktop` 或 `mobile`。宿主可为固定目标提供模式选择、缩放和工作区全屏，并按目标/模式保留独立页面；这些页面共享同一个 extension-ID 隔离的登录会话，但不会与其它扩展共享。横向溢出的网页在整页导航后可执行一次有下限的自动适宽，手机页面进入登录、passport、account 或 self-profile 路由时还可临时扩展到可用工作区宽度；之后用户手动选择的缩放保持优先。页面隐藏时会静音并暂停媒体，返回时复用原页面状态。远程页面始终拿不到扩展 bridge。

这是高风险浏览能力，不是给普通 View 绕过 `connect-src 'none'` 的通用网络开关。不要用它加载用户输入的任意 URL；优先提供固定、可审查的目标列表。产品随附的 [`social-media-sidebar`](../../examples/extensions/social-media-sidebar/) 是参考实现。

## Network Broker

View 发网络请求时：

1. Manifest 优先声明精确的 `network:<hostname>`，必要时显式声明子域 wildcard；
2. 用户接受权限；
3. View 调用 framework-neutral network API；
4. Broker 使用 sender-bound identity 检查 scheme、hostname、account scope、大小、redirect、timeout 和 quota；
5. 返回有界、脱敏响应。

需要账号时使用 authenticated fetch；View 只传 account reference，Broker 注入认证并移除响应中的 credential header。详见[Provider 与账号](./providers-and-accounts.md)。

## Webview 失败与清理

Guest crash 只销毁该 View Session并显示扩展归因 recovery placeholder，不影响主 renderer 或其它 View。View close、disable/uninstall、workspace switch 或 guest termination 会取消 pending call、event subscription 和 Host resources。旧 guest 的晚到消息会被拒绝。

## Direct DOM：明确的高风险能力

Direct DOM 必须同时：

- 在 `contributes.hostContentScripts` 静态声明 script/style、host surface target 和 activation condition；
- 在包完整性清单中包含所有资源；
- 请求 `hostDom`；
- 通过该扩展版本和工作区的受保护权限确认。

运行时不能请求注入未声明文件或新 surface。安装器必须说明它能读取并修改可见 Kun 工作台内容。

### `runAt` 的精确定义

- `documentStart`：Kun Main 先把已复验、已读取的声明资源缓存为本次工作台文档的启动计划；sandboxed preload 在 renderer 页面脚本执行前同步取得计划、建立 isolated world 并立即执行。若贡献是在当前文档已经启动后才变为 eligible，Kun 会安排一次工作台 reload，让它在下一份文档真正以 `documentStart` 运行；不会偷偷降级成晚注入。
- `documentEnd`：只会在 `DOMContentLoaded` 之后执行。它可以在已加载工作台中按需启用，但绝不会提前到 DOM 尚未就绪时运行。

样式遵守同一 `runAt`，由 Host 写入带 `data-kun-extension-style="<extension>/<contribution>"` 的元素。脚本和样式单文件最多 2 MiB、一次计划总计最多 8 MiB；只能读取 Manifest 静态声明且经 `kun-extension://` confinement 复验的文件。

## Isolated world 不是 DOM 隔离

每个 content-script contribution 在独立的 Electron isolated world 中执行：

- 可以 `querySelector`、读取文字并修改可见 DOM；
- 不进入 renderer main JavaScript world；
- 没有 Node、Electron、`window.kunGui`、React object、runtime credential；
- 不能访问另一个扩展的 isolated world；
- 与 Host 通信只能走更窄、sender-bound content-script bridge。

Preload 还会在该 world 中封闭 `require`、`process`、`module`、`window.open`、`fetch`、XHR、WebSocket、EventSource、Worker 和 `sendBeacon`。工作台自身 CSP 同时阻止远程/inline main-world script、远程样式与远程资源注入。`network:<hostname>` 不会开放 Direct DOM 的浏览器网络；需要网络的业务应移到 Node entry 并使用 Network Broker，或改用 Webview。

Isolated world 降低 JS object/bridge 暴露，却不会阻止脚本钓鱼式修改 UI、读取可见敏感内容或破坏布局。因此 `hostDom` 仍是高风险 trusted-code 权限。

## 窄 Content-script Bridge

`@kun/extension-api` 导出 `KunHostContentScriptApi`。content script 只会看到 `window.kunHost` 的三个方法：

- `getContext()`：返回 Host 派生并冻结的 extension ID/version、contribution、surface、`runAt`、哈希化 workspace scope、DOM marker 和 `rawDomCompatibility: "unsupported"`；
- `reportDiagnostic()`：向 Main 发送最多 2,000 字符、受 Schema 和速率限制的诊断；
- `dispose()`：关闭本页桥并发出一次 `kun-extension-deactivate` 事件。

```ts
import type { KunHostContentScriptApi } from '@kun/extension-api'

declare global {
  interface Window {
    readonly kunHost: KunHostContentScriptApi
  }
}

const context = window.kunHost.getContext()
const target = document.querySelector('[data-kun-surface="workbench-topbar"]')
if (!target) {
  await window.kunHost.reportDiagnostic({
    code: 'SELECTOR_MISSING',
    message: 'Unsupported top-bar selector was not found.',
    level: 'warning'
  })
}
```

Bridge 不接受 extension ID、version、workspace 或 permission 作为调用参数。Preload 闭包附加 Main 生成的 binding ID/nonce；Main 再校验发送 WebContents/main frame、binding、extension、version、contribution、workspace scope 和当前生命周期。因此一个 world 不能借 payload 冒充另一个扩展。Bridge 不提供 command、Agent、account、secret、文件、shell、任意 IPC、任意 Host message 或网络能力。

## Protected Surfaces 与 Consent Token

以下 Host-owned 窗口不加载任何 extension Webview/content script：

- 安装/升级和权限确认；
- workspace trust；
- 整个 Settings 与初始设置流程，以及账号/秘密输入、OAuth completion、secret reveal；
- Agent 工具审批的原生确认框（审批待处理期间，工作台也会撤销 Direct DOM）；
- 其它安全关键 consent。

用户在 protected surface 真实确认后，Main 生成短时、单次 consent token，绑定 extension/version、operation kind、parameter digest、workspace、window session 和 expiry。Token 留在可信宿主内部。

普通 DOM 的合成 click、相似按钮或 payload 不能创建 token；token replay、过期或参数改变会失败。扩展提供的 consent 文案只作为不可信纯文本与宿主风险说明一起显示。

Agent 工具审批还有一条独立的纵深防线：出现 `pending`/`submitting` 审批时，Kun 会撤销当前工作台的 content-script binding，并通过一次干净 reload 清除任意遗留 listener、observer 和 DOM 改写。审批按钮只接受 Chromium 标记为 `isTrusted` 的真实用户事件；`HTMLElement.click()` 或脚本派发的事件会被忽略。真实点击只会进入专用 preload IPC，通用 `runtimeRequest` bridge 不允许访问 `/v1/approvals/*`。

对交互式审批，Electron Main 会再显示扩展无法控制的原生 modal。用户确认后，Main 才创建 30 秒、单次使用的 HMAC consent，精确绑定 `approvalId`、`allow|deny`、expiry 和随机 nonce；`kun serve` 在触碰 `ApprovalGate` 前验证并消费它。缺失、伪造、重放、过期、换审批 ID 或换 decision 都会 fail closed。显式 `auto`/`never` policy 也走同一专用 Main 通道和 action-bound token，但不伪装成一次用户点击。

Settings 中的 `approvalPolicy`/`sandboxMode` 也不是普通表单授权：任意实际变化都由 Main 比对当前持久值，显示原生确认，再生成只留在 Main 内、绑定旧值/新值/发送 frame 的 30 秒单次 action token；token 消费成功后才允许落盘。Composer 权限选择器同样拒绝合成事件，并经过这条 Main gate。因此 Direct DOM 既读不到 Settings 的 API key/secret input，也不能通过普通或合成 click 把后续执行改成 `auto + danger-full-access`。

## Direct DOM 兼容性与生命周期

宿主元素、selector、CSS class、React ownership 和 layout 不属于 Extension API。Kun 可以在 patch/minor 更改它们而不提供 adapter。选择器失效属于扩展的不受支持依赖，不是稳定 API 回归。

Content script 应：

- 只匹配公开支持的 host surface target；
- 对 selector 缺失无害退出并记录 bounded diagnostic；
- 从 `getContext().marker` 取得标记，并为自己创建的 root 使用 `data-kun-extension-root`；Host 管理的 style 会自动使用同一 marker；
- 保持 mutation observer、listener 和 timer 有界；
- 不覆盖安全/账号/审批 UI；
- 在 deactivation 消息中主动清理。

Kun 会在 deactivation 前发送 `kun-extension-deactivate`，尝试移除匹配 marker 的 Host-managed style/root。任意脚本还可能留下 listener、timer、observer 或修改过的 Host node，不能证明这些副作用已完全逆转；因此 disable、uninstall、workspace switch/deactivation、permission change/revocation、version switch/rollback/reload 或 contribution/surface 变化会撤销旧 binding，并 reload 当前工作台文档恢复干净表面。Main 还会每 2 秒重新验证当前 package/version/workspace/grant/declaration，以捕获由 CLI 或其它客户端完成的外部撤销；过期 world 的晚到 bridge 调用会失败。

Main 记录 extension/version/contribution/workspace-scope 与稳定诊断码，不记录脚本源码、binding nonce 或不受限 payload。扩展自报诊断限制为每个 binding 每 10 秒 20 条；执行、资源复验、bridge、deactivation 或 reload 失败均只归因到该扩展，不阻止 Kun 启动或其它扩展运行。

## 发布前检查

- 能否改用 stable action/View/Webview？如果能，删除 `hostDom`。
- Webview 无 Node、无 custom preload、无 direct network、无 remote code。
- 所有资源仅从 `kun-extension://` 和声明 roots 加载。
- 消息/状态有 Schema、size/rate limit 和 disposal。
- 主题、locale、keyboard、focus 和 error/reconnect 已测试。
- Direct DOM 对缺失 selector 容错，并标注不稳定。
- 账号、审批和秘密只使用 protected surface/Broker。
