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

The completed Gate A run
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

Successful publication still leaves `registryReady: false`. Gate B must then
install the exact registry versions on all five targets and both required Node
versions, verify digests and run the registry acceptance cases. Stable-tag
promotion remains a later explicitly authorized step. Creating an account,
preparing a workflow or publishing only one package does not complete Gate B.
