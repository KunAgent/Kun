# Kun Extension Examples

These examples exercise the stable `@kun/extension-api` surface without importing
Kun runtime, renderer, Electron, or private HTTP/IPC modules.

| Example | What it demonstrates | Entry shape |
| --- | --- | --- |
| [`hello-sidebar`](./hello-sidebar) | Sandboxed right-sidebar View, theme, locale, and persisted View state | Browser/Webview |
| [`workspace-dashboard`](./workspace-dashboard) | Editor dashboard, namespaced command, workspace reads, storage, and Host messages | Node + Webview |
| [`agent-assistant`](./agent-assistant) | Extension-owned Agent run, replayable events, cancellation, and owned thread history | Node + Webview |
| [`presentation-studio`](./presentation-studio) | Revisioned standalone HTML slides, visual editing, typed Agent operations, and safe projection | Node + Webview |
| [`social-media-sidebar`](./social-media-sidebar) | Stateful desktop/mobile browser pages for Douyin, Bilibili, and Xiaohongshu | Browser/WebContentsView |
| [`tool-provider`](./tool-provider) | Namespaced typed tool, progress, cancellation, and workspace access | Node/headless |
| [`streaming-model-provider`](./streaming-model-provider) | API-key and OAuth account bindings, normalized model streaming, usage, cancellation, and no-fallback errors | Node/headless |
| [`direct-dom`](./direct-dom) | High-risk isolated-world content script with bounded, failure-tolerant DOM changes | Node + content script |
| [`kun-video-editor`](./kun-video-editor) | Reference v1.1 right-sidebar View, protected media, Agent tools, jobs, and generated artifacts | Node + Webview |

## Repository checkout

Install and build from the repository root, then build and validate an example:

```bash
npm ci
npm run build --workspace @kun/extension-api
npm run build:kun
npm --prefix examples/extensions/hello-sidebar run typecheck
npm --prefix examples/extensions/hello-sidebar run build
node examples/extensions/validate-manifest.mjs \
  examples/extensions/hello-sidebar/kun-extension.json
```

Once the Kun extension CLI is available, every package also follows the normal
scaffolder workflow:

```bash
npm --prefix examples/extensions/hello-sidebar run validate
npm --prefix examples/extensions/hello-sidebar run pack
```

The `validate` and `pack` scripts deliberately use
`run-repository-kun-cli.mjs`. It resolves `kun/dist/cli/serve-entry.js` from
the helper's own location, so repository validation never depends on the
caller's working directory or an unrelated executable on `PATH`. Build Kun
first; these repository scripts are not the standalone distribution path.

The Webview examples use Vite to bundle the public API client into
confined relative assets. `check:extension-examples` inspects the generated
HTML and JavaScript so a bare npm import cannot accidentally ship to Chromium.

## Standalone and public-registry setup

A standalone extension uses the Kun CLI shipped with a Kun installation and
published SDK packages by their package names. Before running a scaffolder or
`npm install`, verify that the packages required by the chosen template exist in
the configured registry:

```bash
kun extension --help
npm view create-kun-extension version
npm view @kun/extension-api version
npm view @kun/extension-react version
npm view @kun/extension-test version
```

Continue only when the required commands return versions. `E404` means that
registry cannot currently provide the standalone artifacts; use the repository
workflow above instead. Do not replace public dependencies with repository
`file:` paths in a project meant to be portable. The unscoped npm package named
`kun` is unrelated to the Kun Agent CLI and must not be used as a substitute.

## Security notes

- Webviews receive only `window.kunExtension`; they do not use `window.kunGui`.
- The Tool and Provider examples also run under `kun serve` or supported CLI flows
  without Electron.
- The Provider example never receives a credential value. It checks an account
  reference and leaves credential collection to Kun-owned protected UI.
- `direct-dom` is intentionally high risk and unsupported by Extension API SemVer.
  Prefer a stable View contribution whenever possible.
