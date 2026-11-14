# Kun npm publication preparation

The selected names are `@kunagent/agent` and
`@kunagent/agent-win32-x64`. `kun/npm/release.json` is the naming descriptor;
`kun/npm/publish.json` records the maintainer, reviewed artifact identity and
publication policy. Preparation never creates a package or changes a dist-tag.

## Account and namespace

An npm account and GitHub account are separate identities. Create a personal
account at [npm signup](https://www.npmjs.com/signup), verify its email and enable
2FA in Account settings. A personal account owns its own scope; an organization
can hold project packages independently of individual maintainers. The npm
website's Add an Organization flow offers a free public-package plan. See the
[account guide](https://docs.npmjs.com/creating-a-new-npm-user-account/),
[organization guide](https://docs.npmjs.com/creating-an-organization/) and
[2FA guide](https://docs.npmjs.com/configuring-two-factor-authentication/).

After signing in locally, run only these read operations to inspect authority:

```sh
npm whoami --registry=https://registry.npmjs.org --json
npm org ls kunagent --registry=https://registry.npmjs.org --json
npm run check:kun:npm-namespace -- --output /absolute/path/to/namespace.json
```

The audit requires an authenticated npm identity and checks its relationship to
the selected scope and both packages. A public organization roster does not
authenticate the caller. A public registry 404 neither reserves a name nor
proves that a hidden package does not exist. The report stores public identity,
roles and metadata only, not tokens or configuration contents. Account authority
is separate from credential restrictions and trusted-publisher configuration.

## Preserve accepted candidates

The earlier completed Gate A run
[43575785241](https://github.com/KunAgent/Kun/actions/runs/43575785241) accepted
the earlier `@kun/agent@0.4.5` candidate. Its bytes, source commit and receipts
remain unchanged. That ordinary version and old namespace are not the selected
prerelease. Do not edit its tarball, rename it in a receipt or change version
metadata at publication time.

Choose the final prerelease version in a separate candidate preparation step,
using a SemVer prerelease such as `VERSION-rc.N`. Build both selected package
names from the same committed source/version, and run complete Gate A on that
new immutable set. Update `publish.json.acceptedCandidate` only from its real
candidate manifest and complete Gate A receipt. The policy pins the receipt's
SHA-256 and the exact main/Windows tarball digests, names, version and buildId.

The plan verifies original file bytes and every native receipt against that
approved complete Gate A proof. Changing the selected scope does not turn an
old candidate into an accepted artifact under the new name.

## Read-only preparation

```sh
npm run prepare:kun:npm-publish -- --candidate /candidate/directory --gate-a /evidence/artifact-readiness.json --receipts /evidence/native --audit /evidence/namespace.json --output /evidence/publish-plan.json
npm run test:kun:npm-publish
```

Preparation may return a valid plan with `publishable: false` and concrete
blockers. It performs file verification and registry reads only. It does not
call `npm publish`, `npm stage publish`, access-grant commands or dist-tag writes.
An audit older than 24 hours, a different identity, an unconfirmed scope, a
stable version or a changed artifact prevents publication.

The manual `.github/workflows/kun-npm-publish.yml` workflow accepts the exact
approved Gate A JSON and a recent namespace-audit JSON as inputs. Neither input
should contain credentials. It downloads the original candidate and native
receipts from the pinned successful run, checks their identities, and uploads
`kun-npm-release-inputs` with 90-day retention. `prepared_run_id` can reuse that
archive without rebuilding candidates when the original short-lived artifacts
are no longer available. Evidence and namespace checks are repeated on reuse.

## First publication and OIDC setup

The publisher job is prepared but disabled. The checked-in `enabled` flag is
false, `execute_publish` defaults to false, and the repository enable variable
is not set by preparation. Actual publication also requires the configured
repository/release ref, npm environment, exact plan confirmation and an
authenticated namespace audit. These flags are for a separately authorized
release task; do not enable them merely to test preparation.

npm currently requires a package to exist before adding a trusted publisher.
The initial bootstrap therefore needs an explicitly authorized maintainer
session, after the newly named prerelease has passed Gate A. The same executor
supports an `interactive-bootstrap` mode using the maintainer's normal npm/2FA
session; it is never selected automatically or used as a CI token fallback.
No bootstrap is performed by the preparation workflow. See
[npm trust prerequisites](https://docs.npmjs.com/cli/v11/commands/npm-trust/).

Once both packages exist, their maintainer can configure GitHub trusted
publishing with these exact values:

| Field | Value |
| --- | --- |
| GitHub owner | `KunAgent` |
| Repository | `Kun` |
| Workflow filename | `kun-npm-publish.yml` |
| Environment | `npm-prerelease` |
| Direct publication | Allow for the explicitly authorized prerelease job |
| Dist-tag management | Leave disabled |

The job uses GitHub-hosted runners with Node 26.12.0 and npm >=11.5.1. OIDC
permission is confined to the publisher job; preparation has repository read
permissions only. It does not install dependencies, rebuild or run candidate
scripts while holding publication credentials. No npm write token is stored in
the workflow. Configure trust close to the first authorized use: npm documents
expiry for a new trust configuration that has not completed its first publish
within two days. See [trusted publishing](https://docs.npmjs.com/trusted-publishers/).

OIDC authenticates the publishing workflow. This job reuses tarballs from a
different build run, so it explicitly disables automatic npm build-provenance
generation for the publisher revision. The original build source/run and
digests remain pinned in Gate A evidence. Producer-signed build attestations
would need a separate implementation; this publication job is not the original
compilation run.

`npm stage publish` is a separate registry-writing feature, not a local dry run.
It is not used by this flow. Its approval/trust requirements must not be confused
with assigning a SemVer prerelease to the explicit `next` distribution tag.

## Publication order and recovery

Only a separately authorized execution can publish the original Windows
tarball, then the original main tarball, with public access, scripts disabled
and the explicit `next` tag. No stable-tag promotion command exists here.
Before any write, all existing exact versions must have matching integrity;
different bytes or tag drift stop the entire plan without overwrite or repair.

After partial failure, record the outcome and retry the same immutable set.
Matching versions already present are skipped; no existing tarball is rebuilt,
replaced or retagged. A lost npm response is recorded as uncertain, since a
failed client request may already have changed registry state. Re-query rather
than rolling back tags or deleting packages. The executor checks that `latest`
stays unchanged after each operation. See [npm publish semantics](https://docs.npmjs.com/cli/v11/commands/npm-publish/).

New-package bootstrap has an additional registry constraint: npm assigns
`latest` on the first publication even when another tag is requested, and
rejects deleting `latest` with HTTP 400. This behavior is documented in
[npm/cli issue 8490](https://github.com/npm/cli/issues/8490). A strict next-only
plan now blocks a missing package before uploading it. An explicit
`initialLatestAcknowledgement` must name the exact version and both package
names before bootstrap may accept this registry behavior. The acknowledgement
is part of the confirmed plan identity and does not authorize stable-tag
promotion for later versions. Do not publish another placeholder or claim that
an automatically created stable tag stayed unchanged.

Successful publication still leaves `registryReady: false`. Gate B must then
install the exact registry versions on all five targets and both required Node
versions, verify digests and run the registry acceptance cases. Stable-tag
promotion remains a later explicitly authorized step. Creating an account,
preparing a workflow or publishing only one package does not complete Gate B.

The selected `@kunagent` 0.4.5-rc.1 pair has now completed its independent
Gate A. `publish.json` pins its exact native-matrix run, receipt and tarball
digests. This advances artifact acceptance only: `enabled` remains false,
trusted publishing remains unconfigured and no registry package or tag was
created by the candidate acceptance.

## Gate B checkpoint: first publication blocked by registry tags

On 2026-11-14 the explicitly authorized bootstrap uploaded the accepted
Windows `0.4.5-rc.1` tarball with `--tag=next`, public access and scripts disabled.
The public tarball SHA-256 and SHA-512 match the original Gate A candidate.
npm initially acknowledged processing before exposing the version; the executor
now waits for visibility without retrying publication or accepting changed bytes.

The public Windows metadata subsequently exposed both `next` and `latest` at
`0.4.5-rc.1`. The sequence stopped before the main package. An authenticated
attempt to remove the unexpected `latest` tag returned HTTP 400; it remains
present. At the 2026-11-15 checkpoint the main package is still unpublished,
`registryReady` is false and Gate B is incomplete. The local publication and
registry observations are preserved under `.cache/kun-npm/registry-release/`.
The accepted candidate, Gate A receipts and disabled checked-in policy retain
their original identities. This flow did not build or upload a replacement
candidate. Registry metadata also contains npm's `0.0.0-stage` placeholder;
this flow did not invoke staged publishing or manually create that version.

The maintainer subsequently explicitly accepted initial automatic `latest`
creation for these two `0.4.5-rc.1` packages and requested continuation with the
original main candidate and registry matrix. That scoped acknowledgement is
now recorded in policy. Publication still passes only `--tag=next`; it does
not run a stable-tag promotion command. Registry acceptance checks the
acknowledged initial tag baseline and records that acknowledgement separately
from unchanged-tag evidence.

The read-only `registry_only` mode of `kun-npm-artifact.yml` is prepared for the
subsequent registry matrix. It selects the accepted original manifest, removes
the source checkout and Git history, and installs the exact registry version
into fresh project/global prefixes and caches on five native targets with
Node 26.4.0 and 26.12.0. Each receipt includes real npm HTTP download evidence,
project lock integrity, downloaded tarball digests, native SQLite, CLI/TUI,
HTTP/SSE and shutdown checks. Windows additionally requires the registry helper
download, native helper failure cases and real ConPTY. The aggregator refuses
local-install receipts, missing combinations, changed bytes/build identity or
an unacknowledged `latest` tag. This matrix has not run against the absent main
package; passing driver tests do not constitute registry acceptance.
