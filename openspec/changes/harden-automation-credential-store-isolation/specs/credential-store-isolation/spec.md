## ADDED Requirements

### Requirement: Explicit credential-store isolation
Kun SHALL support an explicit non-interactive credential-store isolation override. When enabled, the key provider MUST NOT invoke an operating-system credential helper and MUST use the authenticated encrypted key-file fallback with owner-only permissions.

#### Scenario: Isolation override is enabled
- **WHEN** `KUN_DISABLE_OS_CREDENTIAL_STORE` is exactly `1`
- **THEN** credential-store initialization executes no Keychain, Secret Service, or DPAPI helper and returns an encrypted key-file provider marked as non-OS-backed

#### Scenario: Explicit option overrides the environment
- **WHEN** a caller supplies an explicit credential-store option and the environment contains a conflicting isolation value
- **THEN** the explicit option determines whether the injected operating-system credential path is used

### Requirement: Automated runs are host-credential hermetic
Official Kun unit-test and desktop-smoke environments SHALL enable credential-store isolation before application or runtime initialization, and child processes MUST inherit the isolation setting.

#### Scenario: Unit tests initialize credential migration
- **WHEN** a root or Kun Vitest worker initializes a credential store
- **THEN** the worker uses only its test data directory and does not read or write the host user's credential facility

#### Scenario: Desktop smoke launches an isolated application
- **WHEN** a packaged or development desktop smoke replaces `HOME` and launches Electron plus its managed Kun runtime
- **THEN** both processes inherit credential-store isolation and no system credential dialog is opened

### Requirement: Production OS-store preference is preserved
Kun SHALL continue to prefer the operating-system credential facility when no explicit isolation override is enabled, and fallback selection MUST NOT store credential payloads as plaintext.

#### Scenario: Normal launch has an available OS credential facility
- **WHEN** Kun starts without the isolation override and the supported OS credential facility is available
- **THEN** Kun resolves or stores the AES key through that facility

#### Scenario: Isolated fallback persists credentials
- **WHEN** isolation is enabled and Kun encrypts then reloads a credential from the same test data directory
- **THEN** the credential remains decryptable and neither the credential document nor key-provider metadata contains the plaintext secret
