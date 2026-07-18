# 打包、侧载与自定义 Index

> Extension API：v1
> English: [Packaging, side-loading, and custom indexes](./packaging-and-index.en.md)
> 相关：[Manifest](./manifest.md) · [CLI](./cli-testing-debugging.md) · [版本与迁移](./versioning-and-migrations.md)

`.kunx` 是不可变、可验证的 ZIP 包。Kun 支持本地 `.kunx`、本地开发目录和用户显式配置的 HTTPS Index。第三方扩展的安装与版本选择都由用户主动发起；v1 不后台检查或下载 Index。产品发行版可以按下述受限规则播种明确列入目录的第一方默认包。

## 包根内容

发布包根必须包含：

```text
kun-extension.json
kun-extension.integrity.json
README.md
LICENSE
<main/browser entrypoints>
<manifest-referenced assets>
```

扩展 ID 为 `publisher.name`，包版本为 Manifest `version` SemVer。入口和所有本地 asset 都必须在完整性清单中；包不能依赖机器上的 repository-relative 路径、未发布 workspace alias 或外部 `node_modules`。

不要包含：

- `.env`、API key、token、私钥或测试账号；
- 用户 state/cache/log；
- source map 中的秘密或绝对私有路径；
- 未声明文件、symbolic/hard link；
- 构建缓存和无关依赖。

官方 pack 默认使用 allowlist，不递归收集整个项目目录。默认选择仅包括：

- 根目录的 `kun-extension.json`、`README.md`、`LICENSE`；
- Manifest 的 `main`、`browser`、View/preview entry、icon、content script/style 等所有直接文件引用；
- Manifest 中每个 `localResourceRoots` 下的文件树。

因此项目根的 `src`、`node_modules`、`.git`、测试输出和其他未声明文件不会因为位于 source directory 就进入包。Node 主入口若还依赖未被 bundler 合并的本地 chunk，必须用下面的显式 include，不能依赖机器上的外部 `node_modules`。

## 完整性清单

`kun-extension.integrity.json` 由官方 pack 工具确定性生成，记录发布文件的 SHA-256。不要手工维护。Validator 要求：

```json
{
  "algorithm": "sha256",
  "files": {
    "kun-extension.json": "0000000000000000000000000000000000000000000000000000000000000000",
    "dist/extension.js": "0000000000000000000000000000000000000000000000000000000000000000"
  }
}
```

Integrity 文件本身不递归列入 `files`；pack/validator 按该约定单独处理它。

- 每个允许文件正好有一条规范路径记录；
- 每个记录的文件存在且摘要相等；
- Manifest、README、LICENSE 和 integrity 自身的处理符合生成 Schema；
- Index 包摘要与下载 bytes、包内文件摘要分别验证。

可选签名 metadata 是来源证据，不是安装前提，也不等同代码审计。状态使用 `valid`、`unsigned`、`invalid` 或 `unknown-key`。v1 未内置发布者公钥信任目录，因此普通侧载包中带有但无法关联到受信公钥的签名会明确显示为 `unknown-key`，绝不会仅因为存在签名字符串就显示为 `valid`；校验失败的签名也不能伪装为已验证。

## 确定性打包

```bash
npm run build
npm test
npm run validate
npm run pack
```

或直接使用：

```bash
kun extension validate .
kun extension pack . --output ./dist
```

需要添加 Manifest 无法直接表达的发布文件时，使用可重复的 package-relative path 规则：

```bash
kun extension pack . \
  --include dist/chunks \
  --include NOTICE.txt \
  --ignore dist/chunks/debug.map \
  --output ./dist
```

- `--include` 接受一个已存在的普通文件或真实目录；目录会递归选择。
- `--ignore` 排除同一路径或其整个子树，并在 include/Manifest 选择之后应用。
- 两者只接受规范、可移植的相对路径；不接受 absolute path、`..`、反斜线、glob 或 `!` re-include。
- `validate` 对 source directory 接受相同的 `--include`/`--ignore`，应与最终 `pack` 使用相同参数。
- Ignore 若移除了 README、LICENSE、Manifest entry 或其他必需引用，validation 仍会因缺失而失败。

Pack 对选中集合还有不可覆盖的敏感路径策略：不会打包 `.git`/`.hg`/`.svn`、`node_modules`、`.ssh`/`.gnupg`/`.aws`，也不会打包 `.env*`、`.npmrc`、`.netrc`、常见 credential/secret config、私钥/证书容器或嵌套 `.kunx`。如果这些内容出现在选中的目录树中，pack 会失败并指出路径；先把它移出发布树，或用精确 `--ignore` 明确排除。文件名检查不能发现任意内容中的秘密，发布者仍须审查 bundle、source map 和生成 asset。

Source root、include target 和被选择目录树中的 symbolic link 都会被拒绝；路径在读取前按 source root 约束，不能通过 link parent 或路径规则越界。Pack 不跟随 link。

相同输入和工具版本应产生相同文件集合、路径顺序与摘要（ZIP container 可重现性以同版本 pack 契约为准）。Pack 输出至少报告：extension ID、version、output path、SHA-256、requested permissions 和兼容结果。

### 选择规则诊断

| 稳定 code | 含义 | 修复 |
| --- | --- | --- |
| `EXTENSION_PACKAGE_RULE_INVALID` | include/ignore 不是规范相对路径 | 改用无 glob、无 `..` 的 package-relative path |
| `EXTENSION_PACKAGE_INCLUDE_MISSING` | 显式 include 或递归 root 不存在 | 先 build，并核对相对 source root 的路径 |
| `EXTENSION_PACKAGE_FORBIDDEN_PATH` | 选中路径命中 secret/VCS/dependency/nested-package 策略 | 移出发布树，或用精确 ignore 排除目录树中的非必需文件 |
| `EXTENSION_PACKAGE_LINK_FORBIDDEN` | Source、parent 或选中成员是 symbolic link | 复制真实 release asset；不要让 pack 跟随 link |
| `EXTENSION_PACKAGE_FILE_MISSING` | 必需文档或 Manifest 引用被漏选/ignore | 恢复文件，或修正 Manifest/ignore |

## 包验证限额

v1 默认安全上限：

| 项目 | 默认上限 |
| --- | --- |
| 压缩 `.kunx` | 100 MiB |
| 展开后总量 | 250 MiB |
| 单个文件 | 25 MiB |
| 文件数量 | 5,000 |

平台 policy 可以收紧。包不应靠接近默认值来保证可安装；用 `validate --json` 获取当前 effective limit。

安装器在 staging 内、执行任何插件代码前拒绝：

- absolute path、path traversal、encoded escape；
- symbolic/hard link 或 link traversal；
- duplicate/normalized/case-folding path collision；
- undeclared、missing 或 hash-mismatch 文件；
- resource-root escape；
- 无效 ID/SemVer/Manifest/entry；
- 不兼容 `engines.kun`、Manifest/API major；
- 压缩/展开/单文件/文件数超限。

验证失败会清理或 quarantine staging，不保留部分 active install。

## 安装布局与原子性

默认包根：

```text
~/.kun/extensions/
  registry.json
  .staging/
  .downloads/
  acme.issue-assistant/
    1.1.0/
    1.2.0/
```

宿主可显式覆盖根目录；不要从扩展代码硬编码读取。Version directory 经验证后不可变。Registry 保存：

- identity、installed versions、selected version；
- source type/locator；
- package SHA-256、signature status；
- accepted permission snapshot；
- global 与 per-workspace enablement。

安装新版本的顺序：inspect → validate staging → 显示 protected permission/source review → 必要的 state migration → 原子移动 version directory → 原子切 selected version。任一步失败都保持旧 selected version、state、permission 和 enablement 可用。

Kun 至少保留刚才的 previous selected version，直到用户显式删除，以支持手动 rollback。

## 产品内置的默认包

Kun 桌面版把 `kun-examples.kun-video-editor` 同时作为默认本地扩展和仓库内完整的 Extension API v1.2 参考示例。它只有一份源码：`examples/extensions/kun-video-editor`；产品代码不会导入其实现，也不会通过私有路径注册 contributions。

产品构建会运行标准 validate/pack CLI，把确定性的 `.kunx` 与 `bundled-extensions/catalog.json` 放在一起。Catalog 固定 ID、version、archive 文件名、SHA-256、engine range、API version 和精确 permissions。新 profile 首次启动时，`kun serve` 校验 catalog，并调用与本地侧载完全相同的 `ExtensionPackageManager.installArchive` 事务；不会把解压目录直接塞进 registry，也不会绕过 compatibility、integrity、migration、permission 或 activation 检查。

默认播种会接受产品随附 package 的 permission snapshot 并全局启用，但不会自动授予 workspace trust、媒体路径或受保护 picker 决策；这些仍由用户控制。单独的 seed ledger 保留所有权语义：

- 首次播种前已经存在的 extension 始终归用户管理；
- 用户禁用默认扩展后，升级不会重新启用；
- 用户卸载后会记录 removal，后续启动或产品升级都不会把它复活；
- 已选择的 development source、手工选择版本或 rollback 版本不会被覆盖；
- 自动更新必须是更高 SemVer、旧 seeded fingerprint 仍存在且 permissions 完全相同；新增权限必须走普通用户 review；
- 同版本不同 bytes、downgrade、无效 catalog 或 hash mismatch 都 fail closed，同时保留最后有效 registry 状态。

Release 中可下载的 `.kunx` 与产品默认包由同一个确定性 packer 生成。因此开发者可以只使用公开接口来阅读、构建、校验、安装、修改和重新打包该示例；开箱即用并不代表存在隐藏的扩展等级。

## 本地 `.kunx` 侧载

```bash
kun extension install ./dist/acme.issue-assistant-1.2.0.kunx
kun extension list
kun extension doctor acme.issue-assistant
```

Protected review 必须显示：本地 source path、ID、version、digest、signature、contributions、permissions，以及 Node/Direct DOM/secret/provider data 风险。用户拒绝任何权限时不执行代码，也不改变原 registry selection/grants。

Unsigned 本地包允许侧载，但始终标记 unsigned。不要建议用户关闭 integrity/permission checks。

## 开发目录

```bash
kun extension install --development /absolute/path/to/extension
kun extension reload acme.issue-assistant
```

开发 source：

- 仍验证 Manifest、engine/API、entry 和适用资源规则；
- 明显标记 mutable development source；
- 不复制、不重写、不打包原目录；
- Kun 启动/文件变化时不会隐式 reload；
- 已注册目录内容发生变化后，新的 activation 会返回 `EXTENSION_DEVELOPMENT_RELOAD_REQUIRED`，直到显式 reload 验证新 generation；
- 只有显式 `reload` 才重新验证并替换 Host；
- reload 验证失败时保留可诊断错误，不运行 invalid entry。

开发目录不可作为发布形式。发布前 pack，并在干净 profile 安装 `.kunx` 测试。

## Custom HTTPS Index v1

Index 是不可信、非可执行 JSON：

```json
{
  "schemaVersion": 1,
  "extensions": [
    {
      "id": "acme.issue-assistant",
      "name": "Issue Assistant",
      "description": "Manage project issues from Kun.",
      "publisher": "acme",
      "versions": [
        {
          "version": "1.2.0",
          "url": "https://extensions.acme.example/acme.issue-assistant-1.2.0.kunx",
          "sha256": "0000000000000000000000000000000000000000000000000000000000000000",
          "engines": { "kun": ">=1.0.0 <2.0.0" },
          "apiVersion": "1.0.0",
          "permissions": [
            "commands.register",
            "ui.views",
            "webview"
          ],
          "signature": {
            "algorithm": "ed25519",
            "keyId": "acme-release-2026",
            "value": "<signature metadata>"
          }
        }
      ]
    }
  ]
}
```

`description` 和 `signature` 可选。Index 的 `signature` 必须与 Manifest 使用完全相同的 `algorithm`、`keyId`、`value` 结构；安装 exact version 时两者必须逐字段匹配。字段级要求以 Index v1 Schema 为准。

### Index 规则

- Index URL 与每个 package URL 必须是 HTTPS。
- Index 只能包含数据，不能包含 script/template to eval。
- Index JSON 默认最多 5 MiB；package download 仍受 100 MiB 默认上限和响应实际 bytes 二次检查。
- Version entry 必须给 exact SemVer，不使用可变 `latest` URL 作为 identity。
- Kun 显示前验证字段、大小、重复 identity/version 和 URL。
- 用户选择一个 exact compatible version 后才下载。
- 下载 SHA-256 必须匹配 Index；包 identity/version/engine/API/permissions 必须与选中 entry 一致；再验证包内 integrity。
- 任何不一致都拒绝且不注册/执行。
- Redirect 目标也必须满足 HTTPS/source policy。

Index owner 不应替换同 URL/version 的 bytes；immutable version + SHA-256 防止静默替换。

## 没有自动更新

v1 明确禁止：

- Kun/GUI 启动时联系 Index；
- 后台轮询本地目录或远程 Index；
- 自动比较版本；
- unsolicited update prompt/badge；
- 自动 download/install/select/rollback。

只有用户点击 refresh/browse 后才获取 catalog metadata；这也不会下载包。用户随后选择 exact version 并完成 permission review 才安装。

## Enable、Disable、Rollback 与 Uninstall

```bash
kun extension enable acme.issue-assistant --workspace /path/to/workspace
kun extension disable acme.issue-assistant --workspace /path/to/workspace
kun extension rollback acme.issue-assistant --version 1.1.0
kun extension uninstall acme.issue-assistant
```

- Workspace enablement 只改 activation eligibility，不复制包。
- Disable 先 fence 新调用、cancel/deactivate Host，再保留 code/data。
- Rollback 仍检查 engine/API 和 state compatibility；没有 compatible snapshot 时拒绝，绝不反向猜迁移。
- Uninstall 先安全 deactivation，再移除 registry/code。
- State、logs、account references 和 secrets 默认保留；永久删除是独立明确确认，并应先展示影响。

## 发布包检查

- ID/版本/engine/API/state 维度正确；
- README/LICENSE/integrity/entries/assets 全部存在；
- 最小权限，新权限有清晰 release note；
- 无 secret、私有路径、未声明文件或 link；
- `validate` 与测试通过；
- `.kunx` 在干净 profile 安装、激活、disable、rollback、uninstall 通过；
- headless tool/Provider 不依赖 GUI/browser；
- Index entry exact match package metadata/digest；
- 中英文文档和 Changelog 同步。
