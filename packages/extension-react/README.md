# @kun/extension-react

Optional React bindings for sandboxed Kun extension Webviews. The package layers
on `@kun/extension-api` and never exposes Electron or `window.kunGui`.

In this repository, use `npm ci` at the root and build the
`@kun/extension-react` workspace. In a standalone project, verify both published
packages before installing by name:

```sh
npm view @kun/extension-api@1.2.0 version
npm view @kun/extension-react@1.2.0 version
npm install @kun/extension-api@^1.2.0 @kun/extension-react@^1.2.0
```

Do not continue after `E404`; use the repository workflow until the configured
registry contains the required artifacts.

Use `ExtensionViewProvider` at the Webview root, then consume `useTheme`,
`useLocale`, `useViewState`, `useHostMessage`, `useAgentRun`, `useAccounts`, and
`useProviderStatus`. Use `useCommand` for schema-validated command invocation
with result, loading, and error state, and `useConfiguration` for declared,
host-persisted global or workspace settings.
