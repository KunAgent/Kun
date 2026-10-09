# Skill / MCP market sources

The plugin marketplace (MCP and Skill tabs) can browse and install from remote
markets. Each market is a **market source**: a small adapter that fetches the
market's catalog and normalizes it. Caching, install, IPC and the UI are shared,
so adding a market means adding one source.

Shipped sources:

| id       | Label (en / zh)            | Skills | MCP servers |
| -------- | -------------------------- | ------ | ----------- |
| `youdao` | Youdao Market / 有道市场    | yes    | yes         |

Every card that comes from a market carries a badge with the market's name, and
a skill or MCP server installed from a market keeps that badge afterwards.

## Data path

```
renderer (use-market-catalogs) -> preload (market-api) -> main (register-app-market-ipc-handlers)
  -> MarketService -> MarketSource.fetchCatalog -> remote market
                   -> MarketCatalogCache (<userData>/market-cache/<sourceId>.json)
```

- Shared contracts: `src/shared/market/market-types.ts`,
  `src/shared/market/kun-gui-api-market.ts`.
- Main: `src/main/services/market/` (`market-service`, `market-cache`,
  `market-source`, `youdao-market-source`, `market-skill-installer`,
  `market-zip-extract`, `market-mcp-plan`, `market-provenance`).
- IPC channels: `market:list-sources`, `market:get-catalog`,
  `market:install-skill`, `market:plan-mcp-install`. They are desktop only and
  deliberately not in the Remote allowlist; the Remote web build simply shows no
  market chips.
- Renderer: `use-market-catalogs.ts` (state), `plugin-marketplace-market.ts`
  (catalog -> cards), `PluginMarketplaceSourceBar.tsx` (source chips, refresh,
  sync status).

## Catalog caching

- A synced catalog is reused for 6 hours (`MARKET_CATALOG_TTL_MS`).
- The renderer asks for `cache-only` first so the list paints immediately, then
  for `auto`, which only touches the network when the cache is stale.
- When the sync fails the stale cache is still returned together with
  `refreshError`, and the UI says it is showing the cached list. With no cache
  at all the source shows its error instead.
- An empty payload never replaces a good cache.
- Concurrent requests for one source share a single sync.

## Adding a market source

1. Create `src/main/services/market/<name>-market-source.ts` exporting a
   `MarketSource`: `info` (`id`, localized `label`), `allowedDownloadHosts` and
   `fetchCatalog(fetcher, signal)` returning `{ skills, mcpServers, skillTags,
   mcpCategories }`. Use `isSafeMarketId` for every id, because ids become
   folder names and config keys (lowercase slug only).
2. Append it to the `sources` list in `register-app-market-ipc-handlers.ts`.
3. Add a parser test next to it (see `youdao-market-source.test.ts`).

No renderer change is needed: the chips, section titles and badges come from
`MarketSourceInfo.label`.

## Youdao source

The endpoints are the ones the LobsterAI desktop client uses; both answer
anonymously with `{ data: { value } }`:

- Skills: `https://api-overmind.youdao.com/openapi/get/luna/hardware/lobsterai/prod/skill-store`
  - `marketplace[]` entries have a zip `url`; `localSkill[]` entries ship inside
    LobsterAI itself and have no download, so they are ignored.
- MCP: `.../prod/mcp-marketplace` (`servers[]`, `categories[]`). Only `stdio`
  servers and `https` remote servers are imported.

Cards whose id Kun already ships (for example `github`, `context7`,
`playwright`) are hidden so a market never duplicates a built-in card.

## Install safety

Skills:

- The download URL must be `https` and on the source's `allowedDownloadHosts`
  (the redirect target is checked too); archives are capped at 64 MB.
- The zip is unpacked into `<root>/.kun-market-staging/` first and moved into
  `<root>/<skillId>/`, so a failed install leaves nothing behind.
- Unpacking rejects path traversal, skips symlinks and `__MACOSX` / `.DS_Store`
  junk, and caps entry count (2000) and unpacked size (100 MB).
- `.kun-market.json` records `sourceId`, `skillId`, `version`, `downloadUrl` and
  the install time. `skill:list` reports it as `market`, which is what keeps the
  badge on installed skills.
- An existing folder is never replaced unless `overwrite` is set **and** its
  `.kun-market.json` names the same source.

MCP servers:

- Kun refuses `npx` servers without an exact package version, but markets
  publish `@latest`. `market:plan-mcp-install` resolves the version from the npm
  registry (falling back to npmmirror) and pins it, then the renderer writes the
  config through the same audit as every other MCP install. If the version
  cannot be resolved the install fails; it never writes an unpinned server.
- Required environment variables are written as empty placeholders and the user
  is told which ones to fill in.
