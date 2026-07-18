# @kun/extension-api

Framework-neutral, stable public contracts and Host client for Kun extensions.
The package has no React or Electron dependency. `ExtensionManifestSchema` is the
canonical runtime source for `schema/kun-extension.schema.json`.

## Installation modes

Inside this repository, install from the root and use the npm workspace:

```sh
npm ci
npm run build --workspace @kun/extension-api
```

For a standalone project, first require a real public-registry result, then
install the package by name:

```sh
npm view @kun/extension-api@1.2.0 version
npm install @kun/extension-api@^1.2.0
```

Only run the install when the first command returns a version. `E404` means the
configured registry does not have the artifact; use the repository workflow
instead of adding a repository-relative `file:` dependency to a portable
extension.

```ts
import type { ExtensionContext } from '@kun/extension-api'

export async function activate(context: ExtensionContext) {
  context.subscriptions.add(
    await context.commands.registerCommand('hello', async () => ({ ok: true }))
  )
}
```

Declared non-secret settings are available from `context.configuration`; Provider
credentials must use `context.authentication` and the Host-owned protected account
flow. Node and Webview clients receive the same scoped configuration API.

References: [English Extension API reference](../../docs/extensions/api-reference.en.md) ·
[中文 Extension API 参考](../../docs/extensions/api-reference.md) ·
[Manifest JSON Schema](./schema/kun-extension.schema.json)
