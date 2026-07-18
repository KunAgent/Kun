## 1. Main Renderer Cache Coherence

- [x] 1.1 Add testable main-process helpers that disable Chromium HTTP caching only for a configured development renderer and select development-aware reload behavior.
- [x] 1.2 Apply the cache policy before Electron readiness and use cache-bypassing reloads for development window commands, load recovery, and the renderer error boundary.

## 2. Auxiliary Vite Isolation

- [x] 2.1 Require an explicit auxiliary Vite cache directory and pass a unique temporary cache path from the development renderer smoke launcher.

## 3. Verification

- [x] 3.1 Add focused tests for development versus packaged cache/reload behavior and auxiliary Vite cache isolation.
- [x] 3.2 Run the focused tests, TypeScript checks, and repository diff validation.
