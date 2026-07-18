## 1. Credential-store isolation

- [x] 1.1 Add explicit environment-aware OS credential-store suppression to the shared Kun key provider with option precedence and encrypted fallback preservation
- [x] 1.2 Enable credential-store isolation in root and Kun Vitest worker environments
- [x] 1.3 Propagate credential-store isolation from the shared desktop smoke environment to Electron and managed Kun child processes

## 2. Regression coverage and validation

- [x] 2.1 Add secret-store tests for environment suppression, zero helper calls, owner-only key persistence, reload decryption, and explicit OS-path opt-in
- [x] 2.2 Extend desktop smoke environment contract coverage for inherited-value scrubbing and the forced isolation value
- [x] 2.3 Run targeted root/Kun tests, typechecks, OpenSpec validation, and diff checks
