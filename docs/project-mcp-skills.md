# Project-level MCP and Skills

Kun supports a repository-owned project policy at:

```text
<workspace>/.kun/project.json
```

The file can declare MCP servers needed by the project and control which project Skills are visible. Kun reads only this exact path for the active workspace; it does not search parent directories or inherit another repository's file.

The complete example is [`docs/examples/kun-project.json`](./examples/kun-project.json).

## File format

The top-level object is strict and must contain `"version": 1`. Unknown fields, unsupported versions, oversized files, and excessive server/root collections are rejected.

```json
{
  "version": 1,
  "mcp": {
    "servers": {
      "project-docs": {
        "transport": "stdio",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-filesystem", "."],
        "cwd": "."
      }
    }
  },
  "skills": {
    "enabled": true,
    "includeConventional": true,
    "roots": [".kun/skills", "tools/agent-skills"],
    "disabledIds": ["legacy-deploy"]
  }
}
```

### MCP server fields

- `enabled`: optional; defaults to `true`.
- `transport`: `stdio`, `streamable-http`, or `sse`.
- `command` and `args`: required command plus optional arguments for `stdio`.
- `cwd`: optional workspace-relative directory for `stdio`. It defaults to the workspace root.
- `url`: required HTTP(S) URL for `streamable-http` and `sse`.
- `headers`, `env`, `oauth`, and `timeoutMs`: use the same meanings as user-level MCP configuration.

A project cannot declare `trustScope`, `trustedWorkspaceRoots`, or `workspaceRoots`. Kun owns those fields and always restricts an approved project server to its real workspace.

### Skill fields

- `enabled`: controls project-local Skills only. Setting it to `false` does not disable user-global Skills.
- `includeConventional`: defaults to `true`. When enabled, Kun also scans the existing project conventions `.agents/skills`, `.claude/skills`, `.codex/skills`, `.kun/skills`, and `skills`.
- `roots`: additional workspace-relative Skill roots.
- `disabledIds`: removes matching IDs from the complete Skill set visible in this workspace, including global roots.

Precedence is:

1. Explicit `skills.roots` from `.kun/project.json`.
2. Conventional project roots, when enabled.
3. GUI-configured workspace roots.
4. User-global roots and installed plugin Skill roots.

The first Skill with a duplicate normalized ID wins. User-global disabled Skill IDs remain authoritative everywhere.

## Path security

Every Skill root and stdio `cwd` must be relative to the workspace and must already resolve to a directory inside the real workspace. Kun rejects:

- absolute paths;
- `..` traversal outside the workspace;
- missing or non-directory targets;
- symlinks whose real target leaves the workspace;
- a `.kun` directory or `project.json` symlink that would make writes leave the workspace.

These checks happen before Skill files are read or MCP commands are materialized.

## MCP trust lifecycle

A repository file cannot approve itself. Opening or cloning a project never starts its MCP commands.

1. Open **Settings -> Agents -> Project MCP & Skills**.
2. Select/open the workspace and review the resolved path, validation status, server targets, and JSON.
3. Save if needed. Saving validates and reapplies the file but does not approve MCP.
4. Choose **Approve project MCP** and confirm the workspace, redacted targets, and validated SHA-256 digest in the main-process native prompt.
5. Kun stores `{ workspaceRoot, configDigest }` under the local `agents.kun.projectConfig.grants` settings. Nothing is written into the repository to record trust.

Approval is bound to the digest shown in the confirmation. If the file changes before the main process records the grant, Kun rejects the operation and asks you to refresh and review it again.
The ordinary Settings save API preserves this grant list but cannot add to or replace it; approval and revocation must use the dedicated project-config action.

The digest is calculated from normalized JSON. Whitespace and object-key reordering do not change it; a semantic value change does. A moved workspace, edited configuration, invalid file, or deleted file makes the grant stale. Review and approve the new digest before the changed MCP configuration can be imported. **Revoke project MCP** removes the local grant and the next runtime apply closes/removes the generated providers.

Several projects can be approved at once. Kun gives each declared server a stable internal workspace namespace and forces workspace-only visibility/trust, so identical declared IDs in different projects do not collide or leak tools between threads.

Server IDs beginning with `__kun_project_` are reserved for these generated entries and are ignored in user-level MCP imports.

## Secrets

Do not commit tokens, API keys, passwords, authenticated URLs, or sensitive command arguments in `.kun/project.json`. Prefer user-level `~/.kun/mcp.json` for secret-bearing configuration and scope those servers with trusted workspace roots. The project settings summary deliberately hides MCP arguments, environment values, and headers and removes URL credentials/query strings, but that display redaction does not make committed literals safe.

## User-level compatibility and reload behavior

Project configuration is additive. Existing `~/.kun/mcp.json`, GUI-managed Skill folders, installed plugin Skills, and conventional project Skill discovery continue to work when a project file is absent.

Kun rebuilds project-generated MCP entries during settings/config synchronization. The following operations trigger revalidation and runtime apply:

- saving project JSON in Settings;
- approving or revoking project MCP;
- applying regular Settings changes;
- restarting Kun or the app.

Hand-editing `.kun/project.json` outside the app does not execute changed commands automatically. Use **Refresh** to see the new validation/digest state, then save or reapprove as appropriate. Until reapplication, a running provider continues to represent the previously approved runtime configuration, not newly edited disk content.
