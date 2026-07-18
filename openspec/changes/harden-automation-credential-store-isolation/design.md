## Context

Kun encrypts extension and migrated provider credentials with an AES key. The key provider prefers macOS Keychain, Windows DPAPI, or Linux Secret Service and otherwise persists an owner-only key file. The macOS implementation shells out to `security`; isolated desktop smoke tests replace `HOME`, so the helper cannot find a default Keychain and opens a blocking system dialog while trying to store the account named `kun`.

The same key-provider composition is used by GUI settings migration and `kun serve`. Automated runs therefore need one shared, inherited isolation signal that covers both processes without changing normal application behavior or weakening ciphertext-at-rest guarantees.

## Goals / Non-Goals

**Goals:**

- Guarantee that official unit and desktop automation never invokes a real OS credential helper.
- Reuse the existing authenticated encrypted key-file fallback in isolated test data directories.
- Keep OS-backed credential storage as the default for normal production and development launches.
- Keep OS-specific key-provider behavior testable through injected command runners.

**Non-Goals:**

- Changing credential document formats, account references, or migration journals.
- Adding a user-facing credential-storage setting.
- Treating generic `CI` or `NODE_ENV` values as permission to disable OS protection.
- Replacing the existing degraded-protection status or fallback implementation.

## Decisions

### Use one explicit environment contract at the key-provider boundary

`createSecretEncryptor` will recognize `KUN_DISABLE_OS_CREDENTIAL_STORE=1`. When active, it will skip macOS Keychain, Linux Secret Service, and Windows DPAPI command paths and use the existing `0600` key-file fallback. Centralizing the decision prevents GUI migration and `kun serve` from drifting into different behavior.

The key-provider options will accept an injectable environment for deterministic tests. An explicit `disableOsKeychain` boolean takes precedence over the environment so OS-path unit tests can opt back in while the surrounding Vitest process remains isolated.

Alternative considered: check `CI`, `NODE_ENV=test`, or the packaged-smoke marker. Those signals are too broad or unrelated to credential policy and could silently weaken a non-test launch.

### Set the contract in every official automation boundary

The root and Kun Vitest configurations will set the override for their workers. The shared desktop smoke environment factory will also set it after inherited `KUN_*` values are scrubbed; all current packaged and development desktop smokes reuse that factory, and managed child processes inherit the result.

Alternative considered: create and unlock a temporary macOS Keychain for every test. That adds platform-specific lifecycle and cleanup complexity, still exercises host security UI failure modes, and is unnecessary for tests whose purpose is not credential-store integration.

### Preserve encrypted fallback semantics

Isolation changes only the AES key location. Credential payloads remain AES-256-GCM envelopes and the generated key file retains owner-only permissions. The key-provider result continues to report `osKeychain: false` and a degraded-protection reason.

Dedicated secret-store tests will exercise OS integrations with injected runners and explicit OS enablement; general unit and desktop tests will never use the host credential facility.

## Risks / Trade-offs

- [The override leaks into a real launch] → Require the exact value `1`, scrub inherited `KUN_*` values before smoke setup, and only set the override in test configuration or isolated smoke environments.
- [Disabling OS storage reduces integration coverage] → Keep focused, injected OS-path unit tests and leave signed/notarized credential-store validation as a separate release check.
- [A child process drops the override] → Set it on the shared launch environment inherited by Electron Main and the managed Kun runtime, and assert propagation in the smoke contract test.

## Migration Plan

No persisted-data migration is required. Existing automated temporary profiles can be deleted normally; production profiles and Keychain items are untouched. Rollback consists of removing the explicit test environment settings and key-provider environment resolution.

## Open Questions

None.
