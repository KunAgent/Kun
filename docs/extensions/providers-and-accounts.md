# 模型 Provider、账号与认证

See [the provider configuration and gateway contract](../provider-configuration-and-gateway.md)
for the built-in descriptor schema and v2 account Registry. Extension executable
adapters keep their existing permission boundary; registering an extension
provider does not automatically grant public gateway export or an Agent login.


> Extension API：v1
> English: [Model Providers, accounts, and authentication](./providers-and-accounts.en.md)
> 相关：[权限与秘密](./security-and-resources.md) · [版本与迁移](./versioning-and-migrations.md)

扩展可以实现完整自定义模型传输，但不会创建新的 Agent runtime。Kun 把模型请求归一化，通过 `RemoteModelClient` 路由到扩展 Node Host，再把规范化 stream 写回既有 AgentLoop、工具和用量路径。

## 三个独立概念

| 记录 | 描述 | 是否含秘密 |
| --- | --- | --- |
| Provider Definition | transport、模型/能力、认证方式、拥有者 | 否 |
| Account | 用户在该 Provider 的一个命名账号、认证类型、状态、credential reference | 否；秘密在 Credential Store |
| Provider Binding | 一次 thread/profile/role 使用的 provider + account + model | 否 |

Binding 必须三者一致。Provider A 不能绑定 Provider B 的 account/model；缺失账号返回 account-required，不会自动选择另一个账号。

## 权限与入口

- Provider 贡献必须有 Node `main`，需要 `providers.register`。
- 查看脱敏账号元数据需要 `accounts.read`。
- 使用账号需要 `accounts.use:<providerId>`。
- 请求创建/更新/删除账号流程需要 `accounts.manage:<providerId>`。
- 自定义签名确实需要原始秘密时，需要 `accounts.secrets.read:<providerId>`，仅 Node 可用并单独高风险确认。
- Brokered upstream 请求还要 `network:<hostname>`。

模型 Provider、认证 handler 和动态模型发现必须在没有 browser/Webview 时可运行。`browser` 不能作为 headless fallback。

## 声明 Provider

Manifest 最小示例：

```json
{
  "main": "dist/extension.js",
  "activationEvents": [
    "onProvider:acme-models",
    "onAuthentication:acme-auth"
  ],
  "contributes": {
    "modelProviders": [
      {
        "id": "acme-models",
        "displayName": "Acme Models",
        "authenticationProviderId": "acme-auth",
        "credentialHosts": ["api.acme.example"],
        "models": [
          {
            "id": "reasoning-small",
            "displayName": "Reasoning Small",
            "capabilities": {
              "input": ["text"],
              "output": ["text"],
              "reasoning": true,
              "tools": true,
              "parallelTools": true,
              "streaming": true
            }
          }
        ]
      }
    ],
    "authentication": [
      {
        "id": "acme-auth",
        "displayName": "Acme Account",
        "type": "api-key",
        "apiKey": {
          "header": "Authorization",
          "prefix": "Bearer "
        }
      }
    ]
  },
  "permissions": [
    "providers.register",
    "accounts.read",
    "accounts.use:acme-models",
    "accounts.manage:acme-models",
    "network:api.acme.example"
  ]
}
```

具体 capability/auth metadata 以 Manifest Schema 为准。Provider/local model ID 必须稳定；注册时与扩展身份形成 namespaced identity，不能占用 built-in 或其它扩展 ID。

`credentialHosts` 是认证材料可附加目标的独立 allowlist，不能用 `network:*` 代替。`authenticatedFetch` 需要 URL 同时匹配 `network:<hostname>` grant 和该 Provider 的 `credentialHosts`；远程目标必须使用 HTTPS，只有显式 loopback 目标可以使用 HTTP 且所有解析结果必须仍为 loopback。Redirect 由 Broker 以 manual 模式返回并在下一跳重新检查，响应中的 credential/cookie header 会被移除。生产 transport 还会解析全部地址、拒绝任何 special-use/mixed DNS 结果，并把获准地址 pin 到实际连接；Kun 发起的 OAuth device、token exchange 和 refresh 请求使用同一策略。测试 fake fetch 可注入，但不代表生产 SSRF/DNS-rebinding 保障。

Manifest 静态模型和 `listModels` 动态结果会合成 Provider-owned catalog。动态条目不能逃离 Provider namespace；invalid/duplicate model 被确定性拒绝或去重。Discovery 失败时可保留合法静态模型，但不能借用另一个 Provider 的模型。

## Provider Adapter 生命周期

Provider adapter 实现：

- `probe(binding)`：验证连接/账号，返回规范成功或 provider error，不启动 Agent turn；
- `listModels(binding)`：返回规范化动态模型；
- `stream(request, context)`：作为 `AsyncIterable` 处理完整规范请求并 yield 有序事件；
- `cancel(requestId)`：取消指定请求；
- `countTokens(request)`：可选；缺失时 Kun 使用核心估算，不算 adapter failure。

通过 `context.modelProviders` 注册并把返回 `Disposable` 放入 `context.subscriptions`。Disable、Host exit 或 disposal 会 cancel/fail 所有在途请求并释放 correlation state。

## 规范化请求

Provider 收到公开、版本化对象，包含：

- opaque request ID；
- effective provider/account/model；
- system/mode instructions；
- stable prefix 与模型可见 history items；
- text/image/其它模型支持的 attachment 表示；
- advertised tool schemas；
- reasoning/sampling/生成控制；
- account handle，而不是默认的原始 credential。

它不会包含 Kun 内部 class、`TurnItem` 对象身份、runtime token、文件系统 credential 或 JavaScript `AbortSignal`。取消是对同一 request ID 的独立 operation。

模型在 Manifest/catalog 中没声明的 input modality、tool mode 或 generation control 会在发送前以 capability error 拒绝。

## Stream 事件

v1 只接受以下有序、版本化事件：

- `textDelta`
- `reasoningDelta`
- `toolCallDelta`
- `toolCallComplete`
- `usage`
- `completed`
- `error`

规则：

1. 每 request sequence 单调递增，Host/Kun 按序验证。
2. fragmented tool call 按 call ID 独立组装；并行 call 保留 first-seen 顺序。
3. 完整工具参数必须通过相应 Schema，才能写入 history。
4. 最多一个 terminal：`completed` 或 `error`。
5. 成功的 `completed` 必须在 terminal 前或随 terminal 提供至少一个已知 `usage` 字段；缺失/空 usage 是 protocol error。独立 usage 与 completed 内联 usage 只按最后一个累计快照记账一次，未知字段不编造；reasoning/cache-write 和任意三字母币种成本会保留。
6. unknown event、invalid order、oversized payload/event count、第二 terminal 或 malformed call 会终止 protocol，并且不提交无效 assistant/tool history。
7. terminal/cancel 之后的 event 被丢弃。

Kun 按 call ID 组装并行 `toolCallDelta`，以 first-seen 顺序提交；最终参数必须是 JSON object、匹配已广告工具及其 input Schema，fragment 与显式 completion 不一致时 fail closed。成功 terminal 在确认没有 late/duplicate event 后才提交。持续有 RPC stream event 的长请求会刷新 idle watchdog；只有超过 idle limit 没有活动才超时，而不是固定 60 秒总时限。

Manifest Provider 声明是权限、credential host 和模型能力的审查上限；Host 注册必须逐字段一致。动态 `listModels` 失败或返回无效/重复项时，Kun 保留 Manifest 模型、忽略问题项并写入不含上游 body/credential 的归属诊断。Adapter 自报的 probe/stream 错误不会把原始 message、details、code 或已知凭证写入 history、日志或 UI。

示意：

```ts
async function* stream(request) {
  yield {
    type: 'textDelta',
    requestId: request.requestId,
    sequence: 0,
    delta: 'Hello'
  }
  yield {
    type: 'usage',
    requestId: request.requestId,
    sequence: 1,
    usage: { inputTokens: 12, outputTokens: 1 }
  }
  yield {
    type: 'completed',
    requestId: request.requestId,
    sequence: 2,
    finishReason: 'stop'
  }
}
```

准确字段以同版本 SDK 类型为准。Async iterator 的消费/ack 必须遵守 backpressure；不要把上游流先无限缓存。

## 取消、超时和背压

用户 interrupt 或 model timeout 后，Kun 调用 `cancel(requestId)`，停止向 UI/Agent history 投影晚到 event，并在 cancellation grace 后释放状态。Adapter 应同时中止 upstream HTTP、读取循环和计时器。

默认每 Host stream window 为 32 个未确认事件或 4 MiB（以先达到者为准）；平台 policy 可以收紧。消费者落后时暂停上游读取，不能继续堆积。超过 queue/payload/idle limit 会以 provider protocol/limit error 失败，仅影响该扩展。

## 用量与工具调用

只报告上游确实返回的 usage。Kun 归一化已有字段进入主 usage/accounting path，保留 Provider/model/account/run attribution。不要用估算值冒充 Provider 原生 cache hit/miss 或 cost；估算应标记为 estimate 或留空。

Tool call delta 必须具有稳定 call ID。多个 call 的片段可交错，但不能把不同 call 的名称/参数混合。Provider 只生成 call；真正执行仍经 Kun ToolHost、pinned catalog、permission、approval、budget 和 cancellation。

## 绝不静默 Fallback

显式 binding 的 Provider、account 或 model 发生以下情况时，Kun 在不向其它 transport 发送对话的前提下失败：

- unknown/uninstalled/disabled/incompatible；
- circuit-open 或 Host crash；
- account missing/expired/interaction-required；
- model 属于另一个 Provider；
- capability 不足；
- stream/protocol failure。

不能切到默认 Provider、另一个账号或另一个 Provider 的同名模型。修复 binding 或恢复原 Provider 后再由用户/调用者显式重试。

## 数据披露

扩展 Provider 会收到完整的模型可见请求：对话历史、系统/模式指令、附件和工具 Schema。安装权限确认和首次选择 Provider 时，Kun 显示 Provider owner 与数据类别。新版本扩大 permission 或 input capability 时，保持禁用直到重新确认。

Adapter error/log 默认只能保留 extension、Provider、model、account ID、request ID、operation、规范化 category、retryability 和脱敏摘要；不要记录完整 prompt、attachment body、authorization header、原始 adapter error payload 或 secret。Kun 将常见 authentication、authorization、rate-limit、invalid-request、unavailable 和 adapter-failure 归一为固定错误码；原始 `code`/`message`/`details` 不进入 history 或持久诊断。

## 用户选择与持久 Binding

Extension Center 的 Provider 账号卡片是核心拥有的选择入口。用户先连接账号，再选择该账号实际可用的模型，最后点击“审阅并保存绑定”。Kun 会在 Main-owned protected window 中显示扩展 owner、精确扩展版本、Provider、模型、opaque account reference，以及 Provider 可收到的四类数据：完整对话历史、system/mode 指令、附件和工具 Schema。确认前不会持久化或发送模型内容。

确认后，Kun 在 `extensions/provider-bindings.json` 写入一个原子记录：`providerId + accountId + modelId + ownerExtensionId + ownerExtensionVersion + dataAccessDigest`。账号字段只是 opaque reference；API key、access/refresh token、OAuth code 和授权 header 不进入 Binding。Binding 默认按当前 workspace 隔离；未选择 workspace 时写 global scope。

只有同时满足以下条件的 Binding 才会出现在 Kun 的模型选择器中：

- 扩展仍是已确认的同一版本，并在该 workspace enabled/trusted；
- `providers.register`、`accounts.read` 和 `accounts.use:<providerId>` 仍有效；
- Provider Host 已注册且账号为 `connected`；
- 选中模型仍属于该 Provider；
- 当前 permission/model capability 计算出的 disclosure digest 与用户确认一致。

版本、权限或输入能力改变会使旧确认失效，必须重新审阅。账号删除、Provider disable/crash、模型移除或 workspace grant 撤销会让 Binding 显式 unavailable；Kun 不会修复成默认 Provider、另一个账号或同名模型。主聊天创建 thread/turn 时会携带该 opaque account reference。扩展 Agent profile 声明相同 Provider/model 但省略 account 时，会在相同 workspace scope 解析用户确认的账号；没有有效 Binding 时在创建 Agent run 前返回 account-required，而不是 fallback。

模型选择器不会把扩展 Provider 写进旧的 built-in Provider credential settings。它只读取上述核心 Binding，因此 GUI 重启、headless `kun serve` 和扩展 Agent 使用同一 provider/account/model 所有权规则。

## 账号状态与列表

一个 Provider 可有多个命名账号。公开账号对象只含：

- stable account ID/reference；
- Provider ID；
- 用户 label；
- auth type；
- `connected`、`expired`、`interaction-required`、`error` 或 `unavailable` status；
- 安全的非秘密 metadata。

改 label 不改变 reference 或既有 binding。列表永不含 API key、access/refresh token、client secret、cookie 或 credential blob。

## 账号创建与认证

扩展请求账号流程，但 credential 只在 Host-owned protected surface 收集；该窗口不加载 extension Webview/content script。成功后扩展只得到 account reference。

公开 `context.authentication` 提供 `listAccounts`、`createSession`、`getSession`、`cancelSession`、`deleteAccount`、`authenticatedFetch` 和高风险 `revealSecret`。账号 flow 用 session ID 轮询/订阅 `pending`、`completed`、`cancelled`、`expired` 或 `failed`；Webview 不能直接提交 raw credential。Node Host 的 session 结果也不会取得 authorization URL、device user code 或 protected form 内容；pending session 返回可操作说明，由 Kun 自己的账号管理界面继续。只有 Main-owned protected surface 会拿到并显示短期交互材料。

用户可在 Extension Center 的受保护账号管理中重命名账号、原子替换 API key 或删除账号。重命名与换 key 都保留 stable account ID 和既有 Binding；扩展 SDK 不接收新 key。每次受保护操作绑定 extension/provider/account/operation digest，并写入不含秘密的审计记录。

### API Key

用户在 protected form 输入。Kun 保存到 Credential Store，并仅在普通设置中写 reference；Provider 随后可用该 account reference 执行脱敏 probe。更新 key 时原子替换 credential、保持 account ID 并清除旧内存副本。Probe 失败不能把 key 写进日志、state 或事件。

### OAuth 2.0 Authorization Code + PKCE

Account Broker 生成并验证 state/PKCE，callback 只匹配发起 transaction。缺失、过期、重放或不匹配 callback 被拒绝且不存 secret。Code exchange、access/refresh token 存储都在核心完成。用户取消返回 cancelled，不创建账号。

### Device Authorization

Protected surface 显示 verification URL 和 user code。Broker 遵守 Provider 的 interval、slow-down 和 expiry，保持一个有界 transaction，并支持 cancel。成功后清除 transient code 并存 credential；过期/取消不创建账号。

## Refresh 与 Credential Store

同一账号的并发 refresh 会合并为一次，并原子替换 token。Refresh token 被拒绝时账号变为 `interaction-required`/`expired`，依赖请求明确失败，不切换账号。上游 refresh 成功但安全持久化失败时 fail closed，不提交部分 token。

Credential Store 优先使用 OS credential facility；不可用时仅使用 authenticated encrypted fallback，并显示非秘密 degraded-protection 状态。两者都不可用时拒绝保存新 secret，不使用 plaintext-at-rest fallback。

普通 settings、thread、extension state、IPC、logs 只能含 opaque reference。

## Authenticated Fetch 与 Secret Read

推荐使用 Brokered authenticated fetch：

1. 扩展提供获准 account handle 和允许的 URL/request；
2. Broker 检查 extension/provider/account/network scope；
3. 必要时 refresh；
4. Broker 注入认证；
5. 返回移除 credential header 的有界响应。

扩展提供冲突 `Authorization`/credential 字段时会被删除或拒绝，不能与存储秘密合并。

每个手动 redirect hop 和每次 token/refresh 请求都会重新执行 DNS/address policy；不会沿用上一次 hostname 校验去连接新的解析结果。该策略只覆盖 Broker 发起的 direct connection，不约束 Node adapter 自己的 `fetch`/socket，也不声称阻止一个合法公网服务在应用层代转请求。

只有 Node adapter 因自定义签名确实需要原始秘密时，才申请 `accounts.secrets.read:<providerId>`。每次成功/拒绝都产生脱敏审计；Webview/content script 永远不能读取。Secret 只在最小 operation scope 内使用，不缓存、不记录、不回传 UI。

## 隔离、删除和缺失 Provider

Broker 从 Host channel 推导调用者身份，执行 Provider ownership 和 account scope。一个扩展不能枚举/使用另一个扩展的 private Provider account，除非核心明确提供 shared-provider permission。

Provider 扩展 disable/uninstall 后：

- account 和 binding 变 `unavailable`；
- secret 不自动删除；
- thread/profile binding 保留用于恢复/诊断；
- 不会改绑其它 Provider。

用户显式删除账号时，Kun 删除 credential、invalidates sessions，并把依赖项置为 account-required；删除前应展示影响范围。

## Headless

有效 stored account 可在 GUI 关闭时由 `kun serve`、scheduled task 或 CLI 使用/refresh。需要 login、consent 或 secret unlock interaction 时返回稳定 interaction-required 和可操作 continuation；不挂起、不隐式打开 renderer。

## 旧 Credential 迁移

GUI 首次读取旧 `kun-settings.json`（或兼容的旧文件名）时，会对每个 Provider profile 和 Kun runtime override 建立独立的稳定 source ID。迁移顺序是：

1. 在设置文件旁创建权限收紧的 `*.pre-extension-credential-migration.json` 一次性回滚备份；
2. 先把 secret 写入 protected Credential Store；
3. 创建或复用 `kun.core` account，并在 `provider-bindings.json` 写入 `providerId + accountId + modelId`；
4. 在 `legacy-credential-migrations.json` 写入仅含 salted digest、opaque reference 和 `secure-committed` phase 的恢复记录；
5. 原子写回普通 settings，并从 Provider profile/runtime override 移除 plaintext；GUI 管理的 Kun `config.json` 也只写 `credentialSourceId`，不会写 key 或 credential-derived header；
6. 设置落盘成功后把恢复记录推进到 `settings-committed`。下一次启动按 account reference 从安全存储解析请求凭据。

同一 Provider 的相同 legacy secret 会复用一个账号；不同 secret（例如 Provider profile 与 runtime override 不同）保留为不同账号和 Binding。Provider 暂时缺失时账号与 Binding 保留为 `unavailable`，Provider 恢复后重新解析，不会删除或改绑。已完成迁移后又出现的旧备份 plaintext 不会覆盖安全存储中的较新 credential；用户通过受保护的更新流程替换 key 时保留稳定 account ID。

普通 settings 写入失败时，Kun 回滚本次 pending account/credential/binding 更新，原文件仍可读且没有 completed marker。进程在安全提交后中断时，下次启动依据 phase 重试或回滚；进程在 settings 原子写入后、marker 完成前中断时，则以已存在的安全 account/binding 完成 marker。Marker、account、binding 和日志均不包含 secret。

为兼容现有同步的核心 Provider 调用，本 release cycle 的 Main 进程会把 account credential 临时投影到内存中的 legacy settings shape；该投影不会写回普通文件，也不是 Extension API。扩展始终只能看到 account reference/redacted metadata。下一个不再支持该 legacy shape 的 major 会移除这条兼容读路径。详见[状态与兼容迁移](./versioning-and-migrations.md)。

## 测试清单

- probe/listModels/static + dynamic catalog；
- text/reasoning/parallel fragmented tool calls/usage/terminal；
- malformed order/payload、timeout、backpressure、cancel/late event；
- Host crash/circuit 与 explicit no-fallback；
- multimodal capability rejection；
- multiple accounts、rename/delete/missing binding；
- API key rejection、PKCE state/replay、device interval/expiry/cancel；
- concurrent refresh 和 secure-store failure；
- authenticated fetch header handling、secret-read audit/redaction；
- headless success 与 interaction-required；
- migration idempotence/backup/unavailable Provider preservation。
