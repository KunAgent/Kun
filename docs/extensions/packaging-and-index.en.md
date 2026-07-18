# Packaging, Side-loading, and Custom Indexes

> Extension API: v1
> 中文：[打包、侧载与自定义 Index](./packaging-and-index.md)
> Related: [Manifest](./manifest.en.md) · [CLI](./cli-testing-debugging.en.md) · [Versioning](./versioning-and-migrations.en.md)

A `.kunx` is an immutable verifiable ZIP package. Kun supports a local `.kunx`, a local development directory, and an explicitly configured HTTPS Index. Third-party installation and version selection are user initiated; v1 performs no background Index checking or downloading. A product distribution may seed an explicitly catalogued first-party default package under the constrained rules below.

## Package root contents

A release package root contains:

```text
kun-extension.json
kun-extension.integrity.json
README.md
LICENSE
<main/browser entrypoints>
<manifest-referenced assets>
```

Extension ID is `publisher.name`, and package version is Manifest `version` SemVer. Entries and every local asset must appear in the integrity file. A package cannot depend on repository-relative machine paths, unpublished workspace aliases, or external `node_modules`.

Do not include:

- `.env`, API keys, tokens, private keys, or test accounts;
- user state, caches, or logs;
- secrets or private absolute paths in source maps;
- undeclared files or symbolic/hard links;
- build caches and unrelated dependencies.

The official packer uses an allowlist by default; it does not recursively collect the whole project directory. The default selection contains only:

- root `kun-extension.json`, `README.md`, and `LICENSE`;
- every direct Manifest file reference, including `main`, `browser`, View/preview entries, icons, and content scripts/styles;
- the file tree under each Manifest `localResourceRoots` entry.

Consequently, root `src`, `node_modules`, `.git`, test output, and other undeclared files do not enter the package merely because they are under the source directory. If a Node entry needs local chunks that the bundler did not combine, add them with an explicit include below; never depend on machine-external `node_modules`.

## Integrity manifest

The official pack tool deterministically generates `kun-extension.integrity.json` with SHA-256 for release files. Do not maintain it manually. The validator requires:

```json
{
  "algorithm": "sha256",
  "files": {
    "kun-extension.json": "0000000000000000000000000000000000000000000000000000000000000000",
    "dist/extension.js": "0000000000000000000000000000000000000000000000000000000000000000"
  }
}
```

The integrity file itself is not recursively listed in `files`; pack and validation handle it separately by contract.

- exactly one canonical path record per allowed file;
- each recorded file exists and has the declared digest;
- Manifest, README, LICENSE, and integrity self-handling follow the generated Schema;
- the downloaded byte digest from an Index and package-internal file digests are verified separately.

Optional signature metadata is provenance evidence, not an installation prerequisite or code audit. Status is `valid`, `unsigned`, `invalid`, or `unknown-key`. v1 does not bundle a publisher-key trust directory, so a side-loaded signature that cannot be associated with a trusted public key is explicitly shown as `unknown-key`; the mere presence of signature text never makes it `valid`, and a failed signature cannot be presented as verified.

## Deterministic packaging

```bash
npm run build
npm test
npm run validate
npm run pack
```

Or use the CLI directly:

```bash
kun extension validate .
kun extension pack . --output ./dist
```

Use repeatable package-relative path rules for release files that the Manifest cannot reference directly:

```bash
kun extension pack . \
  --include dist/chunks \
  --include NOTICE.txt \
  --ignore dist/chunks/debug.map \
  --output ./dist
```

- `--include` accepts an existing regular file or real directory; a directory is selected recursively.
- `--ignore` excludes that path and its whole subtree after Manifest/include selection.
- Both accept canonical portable relative paths only. Absolute paths, `..`, backslashes, globs, and `!` re-includes are rejected.
- Source-directory `validate` accepts the same `--include`/`--ignore` options; use the same values for final `pack`.
- Ignoring README, LICENSE, a Manifest entry, or another required reference still fails validation as missing.

The packer also applies a non-overridable sensitive-path policy to the selected set. It never packages `.git`/`.hg`/`.svn`, `node_modules`, `.ssh`/`.gnupg`/`.aws`, `.env*`, `.npmrc`, `.netrc`, common credential/secret configuration, private-key/certificate containers, or a nested `.kunx`. If one appears under a selected tree, packing fails with its path; move it out of the release tree or exclude it with an exact `--ignore`. Filename checks cannot discover secrets in arbitrary content, so publishers must still audit bundles, source maps, and generated assets.

The source root, include targets, and every selected directory tree reject symbolic links. Paths are confined to the source root before reading and cannot escape through a link parent or path rule. The packer never follows links.

The same input and tool version should produce the same file set, path order, and digests (ZIP-container reproducibility follows the same-version pack contract). Pack output reports at least extension ID, version, output path, SHA-256, requested permissions, and compatibility result.

### Selection-rule diagnostics

| Stable code | Meaning | Remediation |
| --- | --- | --- |
| `EXTENSION_PACKAGE_RULE_INVALID` | An include/ignore is not a canonical relative path | Use a package-relative path with no glob or `..` |
| `EXTENSION_PACKAGE_INCLUDE_MISSING` | An explicit include or recursive root does not exist | Build first and verify the path relative to the source root |
| `EXTENSION_PACKAGE_FORBIDDEN_PATH` | A selected path hits the secret/VCS/dependency/nested-package policy | Move it out of the release tree, or exactly ignore a non-required file under the selected tree |
| `EXTENSION_PACKAGE_LINK_FORBIDDEN` | The source, a parent, or a selected member is a symbolic link | Copy a real release asset; never make the packer follow a link |
| `EXTENSION_PACKAGE_FILE_MISSING` | A required document or Manifest reference was omitted/ignored | Restore the file or correct the Manifest/ignore rule |

## Package validation limits

v1 safety defaults:

| Item | Default maximum |
| --- | --- |
| Compressed `.kunx` | 100 MiB |
| Total expanded bytes | 250 MiB |
| One file | 25 MiB |
| File count | 5,000 |

Platform policy may tighten them. Do not rely on approaching defaults. Use `validate --json` to inspect effective limits.

Before any extension code runs, staging validation rejects:

- absolute paths, traversal, encoded escape;
- symbolic/hard links or link traversal;
- duplicate, normalized, or case-folding collisions;
- undeclared, missing, or hash-mismatched files;
- resource-root escape;
- invalid ID/SemVer/Manifest/entry;
- incompatible `engines.kun`, Manifest/API major;
- compressed/expanded/per-file/file-count limit breaches.

Failure cleans or quarantines staging and never leaves a partial active install.

## Installation layout and atomicity

Default package root:

```text
~/.kun/extensions/
  registry.json
  .staging/
  .downloads/
  acme.issue-assistant/
    1.1.0/
    1.2.0/
```

The host may explicitly override the root; extension code must not hard-code it. A validated version directory is immutable. Registry stores:

- identity, installed versions, selected version;
- source type/locator;
- package SHA-256 and signature status;
- accepted permission snapshot;
- global and per-workspace enablement.

New-version installation flows through inspect → staging validation → protected source/permission review → required state migration → atomic version-directory move → atomic selected-version switch. Any failure retains the old selected version, state, grants, and enablement.

Kun retains at least the immediately previous selected version until explicit removal for manual rollback.

## Product-bundled default packages

Kun desktop ships `kun-examples.kun-video-editor` as both a default local extension and the repository's complete Extension API v1.2 reference example. Its only source tree is `examples/extensions/kun-video-editor`; product code does not import that implementation or register its contributions privately.

The product build runs the normal validate/pack CLI and places the resulting deterministic `.kunx` beside `bundled-extensions/catalog.json`. The catalog pins ID, version, archive name, SHA-256, engine range, API version, and exact permissions. On a fresh profile, `kun serve` verifies that catalog and calls the same `ExtensionPackageManager.installArchive` transaction used for local side-loading. It does not copy an extracted tree into the registry or bypass compatibility, integrity, migration, permission, or activation checks.

Default seeding grants the product-shipped package permission snapshot and enables it globally, but it does not grant workspace trust, media paths, or protected picker decisions. Those remain user-controlled. A separate seed ledger preserves ownership:

- an extension that existed before the seed pass remains user-managed;
- disabling the default extension remains disabled across upgrades;
- uninstalling it records removal and it is never recreated by a later launch or product update;
- a selected development source or manually selected/rolled-back version is never overridden;
- an automatic bundled update requires a newer SemVer, the prior seeded fingerprint, and the exact same permission set; added permissions require the ordinary user review flow;
- identical versions with different bytes, downgrades, invalid catalogs, and hash mismatches fail closed while the last valid registry state remains usable.

The downloadable release `.kunx` and the bundled default are produced by the same deterministic packer. Authors can therefore inspect, build, validate, install, modify, and repack the example using only documented surfaces; the out-of-box behavior is not a hidden extension tier.

## Side-load a local `.kunx`

```bash
kun extension install ./dist/acme.issue-assistant-1.2.0.kunx
kun extension list
kun extension doctor acme.issue-assistant
```

Protected review shows local source path, ID, version, digest, signature, contributions, permissions, and Node/Direct DOM/secret/Provider-data risks. Declining any permission executes no code and leaves registry selection/grants unchanged.

Unsigned local packages may be side-loaded but remain marked unsigned. Never advise users to disable integrity or permission checks.

## Development directory

```bash
kun extension install --development /absolute/path/to/extension
kun extension reload acme.issue-assistant
```

A development source:

- still validates Manifest, engine/API, entry, and applicable resources;
- is visibly marked mutable;
- is not copied, rewritten, or packaged by Kun;
- is not implicitly reloaded at startup or on file change;
- after registered directory content changes, new activation returns `EXTENSION_DEVELOPMENT_RELOAD_REQUIRED` until explicit reload validates a new generation;
- reloads/replaces the Host only after explicit `reload`;
- reports an actionable error and does not run an invalid entry after failed reload validation.

A development directory is not a release artifact. Pack and test the `.kunx` in a clean profile before publication.

## Custom HTTPS Index v1

An Index is untrusted non-executable JSON:

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

`description` and `signature` are optional. The Index `signature` must use the exact same `algorithm`, `keyId`, and `value` shape as the Manifest, and every field must match when installing an exact version. Use the Index v1 Schema for field-level requirements.

### Index rules

- Index URL and every package URL are HTTPS.
- Index content is data only; no script/template evaluation.
- Index JSON is limited to 5 MiB by default. Package download remains under the 100 MiB default and is checked again against actual response bytes.
- A version entry is exact SemVer; a mutable `latest` URL is not identity.
- Kun validates fields, size, duplicate identity/version, and URLs before display.
- Download occurs only after the user selects one exact compatible version.
- Download SHA-256 must match Index. Package identity/version/engine/API/permissions must match the selected entry, then internal integrity is verified.
- Any disagreement is rejected with no registration/execution.
- Redirect targets must also satisfy HTTPS/source policy.

Index owners must not replace bytes for an existing URL/version. Immutable version + SHA-256 prevents silent replacement.

## No automatic updates

v1 explicitly prohibits:

- contacting an Index at Kun/GUI startup;
- background polling of local directories or Indexes;
- automatic version comparison;
- unsolicited update prompts/badges;
- automatic download/install/select/rollback.

Only an explicit user refresh/browse fetches catalog metadata, and it downloads no package. The user then selects an exact version and completes permission review.

## Enable, disable, rollback, and uninstall

```bash
kun extension enable acme.issue-assistant --workspace /path/to/workspace
kun extension disable acme.issue-assistant --workspace /path/to/workspace
kun extension rollback acme.issue-assistant --version 1.1.0
kun extension uninstall acme.issue-assistant
```

- Workspace enablement changes activation eligibility without copying a package.
- Disable fences new calls, cancels/deactivates Host, and preserves code/data.
- Rollback still checks engine/API/state compatibility. Without a compatible snapshot it fails and never guesses a reverse migration.
- Uninstall safely deactivates before removing registry/code.
- State, logs, account references, and secrets remain by default. Permanent deletion is separately confirmed after showing impact.

## Release package checks

- Correct ID/package/engine/API/state versions.
- README, LICENSE, integrity, entries, and assets present.
- Least permissions; added permissions have clear release notes.
- No secrets, private paths, undeclared files, or links.
- Validation and tests pass.
- `.kunx` installs, activates, disables, rolls back, and uninstalls in a clean profile.
- Headless tool/Provider does not depend on GUI/browser.
- Index entry exactly matches package metadata/digest.
- Chinese/English docs and Changelog are synchronized.
