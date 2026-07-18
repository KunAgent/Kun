# create-kun-extension

Create an atomic, least-privilege Kun extension project:

```sh
npm view create-kun-extension version
```

Only use the public-registry command below when that preflight returns a
version. `E404` means the configured registry does not publish the scaffolder;
use the repository examples until it is available.

```sh
npx create-kun-extension my-extension \
  --template react \
  --publisher acme \
  --name issue-assistant
```

Templates: `node`, `webview`, and `react`. Every generated project includes
build, test, `kun extension validate`, and `kun extension pack` scripts.
Those standalone projects install published `@kun/extension-api`, optional
`@kun/extension-react`, and `@kun/extension-test` packages by name. The `kun`
CLI comes from the Kun installation; the unscoped npm package with that name is
unrelated.

Repository maintainers can exercise the scaffolder implementation without
claiming public-registry availability:

```sh
npm ci
node ./packages/create-kun-extension/src/cli.mjs my-extension \
  --template react \
  --publisher acme \
  --name issue-assistant
```

Installing dependencies in the generated directory still requires the SDK
packages to be published to the configured registry.
