import type { HarnessDefinition } from '../contracts/harness.js'
import { unsupported } from '../contracts/harness-capabilities.js'

/**
 * CodeMaker is an OpenCode fork. Its ACP server, permission modes,
 * `opencode.json` config names and OPENCODE_* variables match OpenCode; the
 * command and XDG app name are `codemaker` (~/.config/codemaker,
 * ~/.local/share/codemaker). It differs where Kun must not assume OpenCode:
 * - Login is required. ACP `authenticate` is a no-op, so credentials come
 *   from `codemaker auth login` or the CODEMAKER_* variables.
 * - Its restricted-file policy (C/C++ sources, .codemakerignore) runs in its
 *   own filesystem layer, so Kun does not offer client-side file writes.
 */
export function codeMakerDefinition(opencode: HarnessDefinition): HarnessDefinition {
  // OpenCode's history reader, installers and free-model login exemption
  // target OpenCode itself.
  const { historySource: _history, setup: _setup, loginOptional: _login, ...shared } = opencode
  return {
    ...shared,
    id: 'codemaker',
    displayName: 'CodeMaker',
    detect: { command: 'codemaker', aliases: [], versionArgs: ['--version'] },
    launch: { command: 'codemaker', args: ['acp'], env: {} },
    acpClientWrites: false,
    capabilities: {
      ...opencode.capabilities,
      statuses: {
        ...opencode.capabilities.statuses,
        fsMediated: unsupported('upstream', { message: 'CodeMaker writes files through its own restricted-file policy' })
      }
    },
    // CodeMaker has no public installer: the organization distributes the
    // executable, and the fork keeps OpenCode's documentation links.
    setup: {
      login: { command: 'codemaker', args: ['auth', 'login'],
        note: 'CodeMaker is distributed by your organization; set its command path in Kun if it is not on PATH' },
      docsUrl: 'https://opencode.ai/docs'
    }
  }
}

/** OpenCode followed by its CodeMaker fork, so the fork inherits every OpenCode fix. */
export function withCodeMaker(opencode: HarnessDefinition): HarnessDefinition[] {
  return [opencode, codeMakerDefinition(opencode)]
}
