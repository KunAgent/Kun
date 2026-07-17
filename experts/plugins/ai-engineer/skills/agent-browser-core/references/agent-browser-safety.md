# Safety and Risk Controls

## High-risk capabilities
- `eval` (arbitrary JavaScript)
- `--allow-file-access` (local file access)
- `--executable-path`, `--args`, `--cdp` (custom runtime control)
- `network route` / `set headers` / `--proxy` (traffic manipulation)
- `set credentials`, cookies, storage, and state files (secret handling)

## Safe mode checklist
1. Allowlist target domains; block localhost and private networks.
2. Disallow `eval` unless explicitly required.
3. Disallow local file access unless explicitly required.
4. Avoid downloads and filesystem writes by default.
5. Use ephemeral sessions; avoid persistent profiles when possible.
6. Redact tokens in logs and outputs.

## Escalation policy
- Require explicit human approval before using any high-risk capability.
- Record the reason and scope of the approval (which URLs, which action).

## Supply-chain hygiene
- Pin CLI version and review upgrades.
- Install in a dedicated environment.
- Avoid running with elevated OS privileges.
