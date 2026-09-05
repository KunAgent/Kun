# 权限、信任、存储、网络、日志与配额

> Extension API：v1
> English: [Permissions, trust, storage, network, logs, and quotas](./security-and-resources.en.md)
> 相关：[Webview 安全](./webview-and-dom.md) · [账号与秘密](./providers-and-accounts.md)

Kun 的安全模型以“身份绑定 + 最小 Broker 权限 + protected consent + 有界资源”为核心。它能限制 SDK/Broker 调用、隔离 Webview 与扩展状态，并包含单扩展故障；它不能把任意 Node `main` 变成恶意代码安全沙箱。

## 信任模型

### 来源信任

安装确认展示 source type/locator、`publisher.name`、版本、SHA-256、签名状态、贡献和权限。签名只是 provenance evidence，不表示 Kun 审计过代码。未签名本地/Index 包可以安装，但必须明确确认且记录 unsigned 状态。

### 执行信任

| 类型 | 信任含义 |
| --- | --- |
| 声明式贡献 | 宿主只渲染验证后的文本、图标、Schema 与命令引用 |
| Webview | Chromium sandbox + context isolation + Node off + 窄 bridge；默认无直连网络 |
| Node `main` | 以当前用户 OS 权限运行；子进程只是可靠性隔离 |
| `hostContentScripts` | 可读写可见工作台 DOM；isolated world 不阻止 UI 欺骗/内容读取 |

安装 Node/Direct DOM 等同于信任该代码拥有相应现实能力。Broker permission 无法阻止 Node 直接使用 `fs`、`net`、`child_process` 等 API；管理中心和文档会持续披露该事实。

### 工作区信任

包全局安装，按 workspace enable。每次操作还受当前 workspace trust/scope 约束。全局 permission grant 不自动允许任意 workspace；workspace 切换会关闭不再合格的 View/content script，取消或拒绝 scope 不符的调用。

### 单次操作信任

写文件、执行命令、外部副作用、secret reveal 等仍可需要 Kun ApprovalGate 或 Host-owned protected consent。扩展不能自我批准，也不能用 Agent 文本、Webview click 或 DOM mutation 代替真实确认。

## 权限生效规则

Manifest 权限是精确字符串，完整列表见 [Manifest](./manifest.md#权限)。通用规则：

1. 安装或新版本新增权限时，在 protected surface 显示并接受。
2. Grant 绑定 exact extension ID、version permission snapshot 和 workspace policy。
3. Host connection 绑定实际身份；payload 中的扩展 ID 不参与授权。
4. 每次 operation 按当前 grant 重新检查，不只在激活/注册时检查。
5. 请求只能缩小 grant，不能扩大。
6. 撤销立即阻止新调用；在途调用按能力规则取消/失败。
7. 一个扩展的 thread、state、account、private command、View Session 和 content-script world 默认不能被另一个扩展访问。

`accounts.secrets.read:<providerId>` 和 `hostDom` 是高风险权限，新增时必须重新确认。`workspace.write`/`tools.register`/`providers.register` 也不能覆盖更严格的 core policy。

## Protected Surfaces

以下交互只能由 Electron Main/核心创建的独立受保护窗口承载：

- 安装、升级、权限变更和 package source review；
- workspace trust；
- credential/secret 输入和 secret reveal；
- OAuth callback completion；
- 外部副作用 approval；
- 其它安全关键 consent。

这些窗口不挂 extension Webview、不注入 content script、不渲染插件 HTML。用户决定后，Main 使用短时、单次、operation-bound token 授权；token 绑定 extension/version、kind、parameter digest、workspace、window session 和 expiry，且不交给插件。伪造、重放、过期或参数变化都会失败。

## 存储类型

| 类型 | Permission | Scope | 用途 |
| --- | --- | --- | --- |
| Global State | `storage.global` | extension ID | 用户跨 workspace 偏好、轻量 cache metadata |
| Workspace State | `storage.workspace` | extension ID + workspace | 项目相关配置/进度 |
| View State | `webview`/View contract | extension + contribution + workspace | UI 展开、筛选、cursor 等 |
| Protected Extension Secrets | `storage.secrets` | profile + extension ID + key | Node Host 自有的服务密钥等短字符串 |
| Credential Store | Account Broker | provider + account + credential reference | API key、OAuth token、secret |

Global、Workspace 和 View state 只能保存 Schema-valid、quota-bounded structured data，不能作为 secret store。Protected Extension Secrets 使用 OS 凭据后端或经过认证的加密回退，并且不会暴露给 Extension View。Binary、大日志、完整 prompt/attachment 和 credential 禁止放入普通 state。

扩展包目录不可写作状态目录。可变数据默认在：

```text
~/.kun/extension-data/<publisher.name>/
  state/
  backups/
  logs/
```

同一 data root 下的 `host-health.json` 保存 restart/circuit 等非秘密 Host health；扩展不能直接编辑它。

宿主可显式覆盖 data root；扩展不要硬编码该路径，也不要直接跨 namespace 读取。使用 SDK API。

## State 写入与迁移

- 写入经过 Schema、size/quota 和 scope 验证；
- Host 采用安全/原子持久化，不暴露部分 commit；
- `stateSchemaVersion` 升级前备份所有 global/workspace namespaces；
- 迁移全成才原子切换，新旧不能混合；
- rollback 只使用 compatible retained snapshot，不推断 reverse migration；
- uninstall 默认保留 state，数据清除必须单独确认。

不要把时间戳/随机字段塞进频繁写入的状态而造成无意义 churn；大型 cache 应有上限、TTL 和清理策略。

## Network Broker

优先声明精确 `network:<hostname>`，确需多个子域时可以显式声明 `network:*.example.com`。例如：

```json
{
  "permissions": [
    "network:api.example.com"
  ]
}
```

Broker 检查：

- HTTPS scheme 和目标 hostname；
- 生产直连中每次请求的全部 DNS 结果和实际 socket 目标；
- redirect 后的每个目标；
- extension/workspace/account scope；
- method、header/body Schema；
- timeout、response bytes、并发、rate；
- cancellation 与 audit/redaction。

生产默认 transport 对 remote HTTPS 只接受 public-unicast 地址。一次解析中只要出现任意 loopback、private、link-local、unique-local、multicast、reserved、IPv4-mapped special-use 或其它非 public-unicast 地址，整次请求就 fail closed；不能从“同时存在一个公网地址”推断安全。Broker 把校验过的地址集合直接交给该请求的 socket lookup，连接阶段不再次采用变化后的 DNS 答案；下一次请求会重新解析和校验。显式 `http://localhost`、`http://127.0.0.1` 和 `http://[::1]` 只在所有解析结果都是 loopback 时允许。

Redirect 始终使用 manual/error 模式；调用方接受 `Location` 后必须发起新的 Broker 请求，使 scheme、permission、DNS 和 account/credential host 在下一跳全部重验。生产 Network/Account Broker 不继承 ambient HTTP(S) proxy，因为代理端解析无法满足这个 direct-connection pinning 契约；未来若接入显式代理，代理本身必须提供等价校验。测试中显式注入的 fake `fetch` 不代表该生产保障。

精确 hostname grant 不允许子域；`network:*.example.com` 只匹配该域的子域，不自动匹配 apex `example.com`，两者需要分别声明。Wildcard 不会放宽上述地址分类，但同一 hostname 在不同请求间解析到不同 public-unicast 地址仍是正常 DNS 行为。不要把 token 放 URL/query。Webview 直接 `fetch`/WebSocket 仍被 CSP 阻止；Node direct network 可绕过 Broker，因此这些措施不是 Node 代码的 OS sandbox，也不能保证公网服务自身不会代理到其它目标。

## Authenticated Fetch

使用账号时只传 account reference。Account Broker refresh 并注入认证，拒绝/移除插件提供的冲突 credential header；响应返回前移除 authorization/cookie 等 credential material。Secret-read 只用于获批 Node custom signer，详见[Provider 与账号](./providers-and-accounts.md#authenticated-fetch-与-secret-read)。

## Workspace 访问

`workspace.read`/`workspace.write` 只授权 Broker 对已授予 root 的操作。所有 path 要规范化并防止 traversal/symlink escape。写入可能继续触发 sandbox/ApprovalGate；权限并不表示“无需用户确认”。

扩展创建 Agent Run/工具时 requested workspace 只能收窄现有 grant。Workspace trust/permission 被撤销后，下一次文件操作必须失败，即使 Run 或 tool catalog 更早创建。

## 默认 Runtime 限额

v1 Host 基线默认值如下；用户/平台政策可以收紧，扩展必须从 diagnostics/capabilities 读取 effective value，不能依赖硬编码：

| 资源 | 默认 |
| --- | --- |
| 单 IPC 消息 | 1 MiB |
| Activation deadline | 15 秒 |
| 一般 operation deadline | 60 秒 |
| Cancellation grace | 2 秒 |
| Shutdown deadline | 5 秒 |
| 每扩展并发 operation | 16 |
| Stream window | 32 个未 ack event 或 4 MiB |
| Host event rate | 200 events/秒 |
| Node Host memory ceiling | 256 MiB |
| 连续 crash 开路阈值 | 3 |
| 日志轮转 | 5 MiB × 3 个文件/stream policy |
| Extension state document | 10 MiB |
| State migration deadline | 30 秒 |
| Network/authenticated request body | 8 MiB |

状态、网络响应、Agent event/tool output 等有各自更细的 public Schema/policy 限额。达到限额返回 stable structured error；不得用无限 queue/retry 规避。

`.kunx` 默认包限额见[打包指南](./packaging-and-index.md#包验证限额)。

## 背压和资源释放

- Producer 等待 stream acknowledgement，不预先缓存完整结果。
- Queue 必须有 item/bytes 双上限。
- Lagging subscriber 用 cursor 重连持久化事件源。
- Cancel/terminal 后释放 buffer、timer、listener 和 correlation。
- Extension disable/uninstall 先 fence 新调用，再 cancel/deactivate。
- 内存/协议超限只终止或熔断所属扩展，不影响 Kun/其它扩展。

## 日志

Kun 捕获扩展 stdout、stderr 和 Host lifecycle log，按 extension ID、version 和 process instance 归因并轮转。使用：

```bash
kun extension logs acme.issue-assistant
kun extension logs acme.issue-assistant --json
```

日志应记录：operation/request/invocation ID、状态变化、耗时、bounded error code、retryability 和 resource limit。不要记录：

- API key、access/refresh token、OAuth/device code、client secret；
- cookie/authorization header；
- runtime/consent token；
- 完整 prompt、附件、文件内容；
- 任意大 request/response body。

Provider 返回的 secret-bearing error 也会由核心 redact，但扩展自身仍应在写 stdout 前脱敏。Secret-read 后 Host crash 的 crash report 不得包含秘密。

## Diagnostics 与审计

```bash
kun extension doctor acme.issue-assistant
```

应显示而不泄密：selected/installed version、source/digest/signature、enablement、permission snapshot、Manifest/API/Kun/RPC negotiation、state schema、Host PID（活动时）、activation cause、restart/circuit、limit failures、last structured error 和 log location。

审计对 Agent/工具/Provider/account/secret/network/consent 操作记录 extension、version、workspace、非秘密 resource reference、operation 和 outcome。输出默认可安全附到 bug report；仍应人工检查业务数据后再公开。

## 扩展作者安全清单

- 默认 browser-only；只有确实需要后台能力才添加 Node `main`。
- 只声明最小 hostname/account/workspace/UI 权限。
- 不在 state/settings/logs/messages 中存 secret。
- 不读取/导入 Kun 私有路径、IPC 或 bearer token。
- 使用 Host account/network/file APIs，而不是在 Webview 自行实现。
- 所有 stream/queue/cache 都有 bytes/items/time limit。
- cancellation/disposal 幂等，terminal 后丢弃晚到结果。
- 外部副作用声明准确；不自动重试 unknown outcome。
- Provider 明示完整请求数据披露并禁止 fallback。
- Direct DOM 可替代时一律使用稳定贡献/Webview。
- 发布前用 `doctor`、测试 harness 和 release checklist 验证 redaction、denial 与 crash path。
