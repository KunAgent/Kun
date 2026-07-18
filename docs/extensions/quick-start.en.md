# Five-minute Quick Start

> Extension API: v1
> 中文：[五分钟快速开始](./quick-start.md)
> Reference: [Manifest](./manifest.en.md) · [Lifecycle](./lifecycle.en.md) · [CLI](./cli-testing-debugging.en.md)

This guide creates a React Webview extension in the right sidebar. You do not need the Kun source tree and do not use Electron or private Kun IPC.

## 1. Prepare the environment

You need:

- a Kun installation that supports Extension API v1;
- the `kun` CLI;
- a currently supported Node.js LTS and npm;
- a Manifest publisher such as `acme`.

Check the tools first:

```bash
kun --version
kun extension --help
node --version
```

## 2. Create a project

The commands below are the standalone public-registry path. First verify that
the scaffolder and template dependencies are actually published:

```bash
npm view create-kun-extension version
npm view @kun/extension-api version
npm view @kun/extension-react version
npm view @kun/extension-test version
```

Continue only when the packages required by the chosen template return
versions. `E404` means the configured registry does not yet provide the
standalone artifacts; use the repository
[extension examples](../../examples/extensions/README.md) instead of adding
repository-relative `file:` dependencies to a portable project. The `kun` CLI
comes from the Kun installation; the unscoped npm package with that name is not
the Kun Agent CLI.

```bash
npx create-kun-extension hello-sidebar \
  --template react \
  --publisher acme \
  --name hello-sidebar
cd hello-sidebar
npm install
```

Available templates are `node`, `webview`, and `react`. Scaffolding supplies a least-privilege Manifest, separate Node/Webview entries when needed, build/test/validate/pack scripts, and links to the matching documentation version.

The generated project has a layout similar to:

```text
hello-sidebar/
  kun-extension.json
  README.md
  LICENSE
  src/host/extension.ts
  src/webview/index.html
  src/webview/main.tsx
  package.json
  tsconfig.host.json
  tsconfig.webview.json
  vite.config.ts
```

The packaging script generates build output and the integrity file. Do not edit the final `.kunx` manually.

## 3. Understand the minimal Manifest

The React template declares a Node entry and Webview document. This shortened example shows the important fields; use the scaffolded file and same-version JSON Schema as authoritative:

```json
{
  "$schema": "https://kun.dev/schemas/extensions/manifest/v1.json",
  "manifestVersion": 1,
  "apiVersion": "1.0.0",
  "publisher": "acme",
  "name": "hello-sidebar",
  "version": "0.1.0",
  "displayName": "Hello Sidebar",
  "engines": { "kun": ">=0.1.0" },
  "main": "dist/extension.js",
  "browser": "dist/webview/index.html",
  "activationEvents": [
    "onView:hello"
  ],
  "contributes": {
    "commands": [
      { "id": "refresh", "title": "Refresh greeting" }
    ],
    "views.rightSidebar": [
      {
        "id": "hello",
        "title": "Hello",
        "entry": "dist/webview/index.html",
        "localResourceRoots": ["dist/webview"]
      }
    ]
  },
  "permissions": [
    "commands.register",
    "ui.views",
    "webview"
  ],
  "stateSchemaVersion": 1
}
```

The immutable full extension ID is `publisher.name`, here `acme.hello-sidebar`. The host resolves the contribution as `extension:acme.hello-sidebar/hello`. Commands and other registrations are also bound to the extension namespace; never self-assert a different extension ID in a payload.

## 4. Implement and dispose resources

The scaffolded `src/host/extension.ts` exports `activate(context)` and adds each returned `Disposable` to `context.subscriptions`:

```ts
import type { ExtensionContext } from '@kun/extension-api'

export async function activate(context: ExtensionContext): Promise<void> {
  context.subscriptions.add(
    await context.commands.registerCommand('refresh', async () => {
      await context.ui.postMessage({
        channel: 'hello',
        payload: {
          type: 'greeting',
          text: 'Hello from the Kun Extension Host'
        }
      })
      return { accepted: true }
    })
  )
}

export async function deactivate(): Promise<void> {
  // context.subscriptions is disposed by the Host.
}
```

Do not import Kun source, Electron, `window.kunGui`, or private HTTP/RPC. A View uses the framework-neutral bridge; the React template receives theme, locale, state, and messages through `ExtensionViewProvider` and public hooks.

## 5. Build and test

```bash
npm run build
npm test
npm run validate
```

`validate` checks the same generated Schema, entry files, contribution references, permissions, engine/API compatibility, and local resources. Fix every error. Warnings, such as deprecations or Direct DOM risk, should also be resolved or explicitly accepted before release.

Development testing does not require packaging:

```bash
kun extension install --development .
kun extension reload acme.hello-sidebar
kun extension doctor acme.hello-sidebar
```

The development directory remains in place: Kun neither copies nor automatically reloads it. Run `reload` explicitly after rebuilding. If the CLI syntax differs in your installed build, use the same-version syntax printed by `kun extension <command> --help`.

## 6. Package and side-load

```bash
npm run pack
kun extension install ./dist/acme.hello-sidebar-0.1.0.kunx
kun extension list
kun extension doctor acme.hello-sidebar
```

Before installation, a protected Kun window shows source, ID, version, SHA-256, signature status, contributions, and permissions. Node or Direct DOM capabilities receive additional high-risk disclosure. Kun installs and selects the version atomically only after confirmation.

Open Kun, choose **Hello** from Code mode's vertical right rail, and Kun opens it as an independent right-workspace tab. Rendering its icon and title does not activate Node code. Opening the View triggers `onView:hello` and creates an identity-bound View Session.

## 7. Inspect logs and clean up

```bash
kun extension logs acme.hello-sidebar
kun extension disable acme.hello-sidebar
kun extension uninstall acme.hello-sidebar
```

Uninstall removes package registration and code but retains extension state, logs, and account references by default. Deleting that data is a separate explicitly confirmed action.

## Next steps

- Add workbench commands and settings: [Workbench contributions](./workbench.en.md)
- Persist View state or use the network: [Permissions and resources](./security-and-resources.en.md)
- Start a Kun Agent from the sidebar: [Agent Runs and tools](./agent-and-tools.en.md)
- Publish a `.kunx`: [Packaging and indexes](./packaging-and-index.en.md)
