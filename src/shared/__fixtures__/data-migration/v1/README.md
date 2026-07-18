# Data migration v1 compatibility fixture

Files in this directory are immutable compatibility evidence for `.kunpack`
format version 1. Never regenerate or rewrite a committed v1 fixture to match a
new implementation. Add a new named fixture or a new version directory instead.

- `manifest.json` is the minimal valid unencrypted v1 manifest.
- `expected-report.json` is the stable empty export report associated with the
  fixture package used by container tests.
