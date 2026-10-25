/**
 * Shell integration for the built-in terminal.
 *
 * Kun loads small hooks into zsh, bash and fish that report each command over
 * OSC 633 (the sequence family VS Code-compatible terminals understand):
 *   A            prompt shown
 *   E;<command>  command line about to run (\\ ; and newline escaped)
 *   C            command output starts
 *   D;<code>     command finished with exit code
 *   P;Cwd=<dir>  current directory
 * The user's own startup files always load first and nothing is written into
 * them; the hooks live in Kun's data directory.
 */
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { TerminalShellOption } from '../../shared/terminal'

const ZSH_ENV = `# Kun terminal: load the user's zsh files first, then Kun's command marks.
KUN_ZSH_DIR="$ZDOTDIR"
ZDOTDIR="\${KUN_USER_ZDOTDIR:-$HOME}"
[[ -r "$ZDOTDIR/.zshenv" ]] && builtin source "$ZDOTDIR/.zshenv"
KUN_USER_ZDOTDIR="$ZDOTDIR"
ZDOTDIR="$KUN_ZSH_DIR"
`

const ZSH_PROFILE = `ZDOTDIR="$KUN_USER_ZDOTDIR"
[[ -r "$ZDOTDIR/.zprofile" ]] && builtin source "$ZDOTDIR/.zprofile"
ZDOTDIR="$KUN_ZSH_DIR"
`

// ZDOTDIR stays the user's after .zshrc, so .zlogin and nested shells behave
// exactly as they would outside Kun.
const ZSH_RC = `ZDOTDIR="$KUN_USER_ZDOTDIR"
[[ -r "$ZDOTDIR/.zshrc" ]] && builtin source "$ZDOTDIR/.zshrc"
[[ -r "$KUN_ZSH_DIR/kun.zsh" ]] && builtin source "$KUN_ZSH_DIR/kun.zsh"
`

const ZSH_HOOKS = `if [[ -n "\${KUN_SHELL_INTEGRATION_LOADED-}" ]]; then return; fi
typeset -g KUN_SHELL_INTEGRATION_LOADED=1
autoload -Uz add-zsh-hook
typeset -g __kun_command_active=0

__kun_osc() { builtin printf '\\e]633;%s\\a' "$1" }

__kun_escape() {
  builtin emulate -L zsh
  builtin local LC_ALL=C value="$1" index char out=''
  for (( index = 0; index < \${#value}; ++index )); do
    char="\${value:$index:1}"
    if [[ "$char" == "\\\\" ]]; then out+="\\\\\\\\"
    elif [[ "$char" == ";" ]]; then out+="\\\\x3b"
    elif [[ "$char" == $'\\n' ]]; then out+="\\\\x0a"
    elif [[ "$char" == $'\\e' || "$char" == $'\\a' ]]; then :
    else out+="$char"
    fi
  done
  builtin print -rn -- "$out"
}

__kun_precmd() {
  builtin local code=$?
  if [[ "$__kun_command_active" == 1 ]]; then
    __kun_osc "D;$code"
    __kun_command_active=0
  fi
  __kun_osc "P;Cwd=$(__kun_escape "$PWD")"
  __kun_osc "A"
}

__kun_preexec() {
  __kun_command_active=1
  __kun_osc "E;$(__kun_escape "$1")"
  __kun_osc "C"
}

add-zsh-hook precmd __kun_precmd
add-zsh-hook preexec __kun_preexec
`

// bash: --init-file replaces ~/.bashrc, so source it ourselves. The DEBUG trap
// fires for every simple command, including PROMPT_COMMAND entries; a flag set
// by the first PROMPT_COMMAND entry keeps those from counting as commands.
const BASH_HOOKS = `# Kun terminal: the user's bashrc first, then Kun's command marks.
if [ -r "$HOME/.bashrc" ]; then builtin source "$HOME/.bashrc"; fi
if [ -n "\${KUN_SHELL_INTEGRATION_LOADED-}" ]; then builtin return 0 2>/dev/null; fi
KUN_SHELL_INTEGRATION_LOADED=1
__kun_command_active=0
__kun_in_prompt=0
__kun_last_status=0

__kun_osc() { builtin printf '\\e]633;%s\\a' "$1"; }

__kun_escape() {
  builtin local LC_ALL=C value="$1" index char out=''
  for (( index = 0; index < \${#value}; index++ )); do
    char="\${value:$index:1}"
    case "$char" in
      '\\') out+='\\\\' ;;
      ';') out+='\\x3b' ;;
      $'\\n') out+='\\x0a' ;;
      $'\\e'|$'\\a') ;;
      *) out+="$char" ;;
    esac
  done
  builtin printf '%s' "$out"
}

__kun_prompt_start() { __kun_last_status=$?; __kun_in_prompt=1; }

__kun_prompt_end() {
  if [ "$__kun_command_active" = 1 ]; then
    __kun_osc "D;$__kun_last_status"
    __kun_command_active=0
  fi
  __kun_osc "P;Cwd=$(__kun_escape "$PWD")"
  __kun_osc "A"
  __kun_in_prompt=0
}

__kun_preexec() {
  [ "$__kun_in_prompt" = 1 ] && return
  [ "$__kun_command_active" = 1 ] && return
  case "$BASH_COMMAND" in __kun_*) return ;; esac
  __kun_command_active=1
  builtin local line
  line="$(HISTTIMEFORMAT= builtin history 1 2>/dev/null)"
  line="\${line#*[0-9]  }"
  [ -n "$line" ] || line="$BASH_COMMAND"
  __kun_osc "E;$(__kun_escape "$line")"
  __kun_osc "C"
}

PROMPT_COMMAND="__kun_prompt_start\${PROMPT_COMMAND:+;$PROMPT_COMMAND};__kun_prompt_end"
# Last line: the trap must not see the rest of this file as user commands.
trap '__kun_preexec' DEBUG
`

const FISH_HOOKS = `if set -q KUN_SHELL_INTEGRATION_LOADED; exit; end
set -g KUN_SHELL_INTEGRATION_LOADED 1
set -g __kun_command_active 0
set -g __kun_last_status 0

function __kun_osc; printf '\\e]633;%s\\a' $argv[1]; end

function __kun_escape
  string replace -a -- '\\\\' '\\\\\\\\' $argv[1] | string replace -a -- ';' '\\\\x3b' | string join '\\x0a'
end

function __kun_preexec --on-event fish_preexec
  set -g __kun_command_active 1
  __kun_osc "E;"(__kun_escape $argv[1])
  __kun_osc C
end

function __kun_postexec --on-event fish_postexec
  set -g __kun_last_status $status
end

function __kun_prompt --on-event fish_prompt
  if test "$__kun_command_active" = 1
    __kun_osc "D;$__kun_last_status"
    set -g __kun_command_active 0
  end
  __kun_osc "P;Cwd="(__kun_escape $PWD)
  __kun_osc A
end
`

export type ShellIntegrationKind = 'zsh' | 'bash' | 'fish'

export function shellIntegrationKind(shellFile: string): ShellIntegrationKind | null {
  const name = (shellFile.split(/[\\/]/).pop() ?? '').replace(/\.exe$/i, '').toLowerCase()
  return name === 'zsh' || name === 'bash' || name === 'fish' ? name : null
}

async function writeIfChanged(path: string, content: string): Promise<void> {
  try {
    if (await readFile(path, 'utf8') === content) return
  } catch { /* Missing file: write it below. */ }
  await writeFile(path, content, { encoding: 'utf8', mode: 0o644 })
}

export type ShellIntegrationLaunch = { args: string[]; env: Record<string, string> }

/**
 * Prepare argv/env so the shell loads Kun's hooks. Returns null for shells
 * without hooks, on Windows, or when the hook files cannot be written; the
 * caller then starts the shell exactly as before.
 */
export async function applyShellIntegration(
  shellFile: string,
  baseDir: string | undefined,
  inherited: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform
): Promise<ShellIntegrationLaunch | null> {
  const kind = shellIntegrationKind(shellFile)
  if (!kind || !baseDir || platform === 'win32') return null
  const env: Record<string, string> = { KUN_SHELL_INTEGRATION: '1', TERM_PROGRAM: 'Kun' }
  try {
    if (kind === 'zsh') {
      const dir = join(baseDir, 'zsh')
      await mkdir(dir, { recursive: true })
      await Promise.all([
        writeIfChanged(join(dir, '.zshenv'), ZSH_ENV),
        writeIfChanged(join(dir, '.zprofile'), ZSH_PROFILE),
        writeIfChanged(join(dir, '.zshrc'), ZSH_RC),
        writeIfChanged(join(dir, 'kun.zsh'), ZSH_HOOKS)
      ])
      env.KUN_USER_ZDOTDIR = inherited.ZDOTDIR || inherited.HOME || ''
      env.ZDOTDIR = dir
      return { args: [], env }
    }
    await mkdir(baseDir, { recursive: true })
    if (kind === 'bash') {
      const file = join(baseDir, 'kun.bash')
      await writeIfChanged(file, BASH_HOOKS)
      return { args: ['--init-file', file], env }
    }
    const file = join(baseDir, 'kun.fish')
    await writeIfChanged(file, FISH_HOOKS)
    return { args: ['--init-command', `source '${file.replace(/'/g, "\\'")}'`], env }
  } catch {
    return null
  }
}

const KNOWN_SHELL_PATHS = ['/bin/zsh', '/bin/bash', '/usr/bin/zsh', '/usr/bin/bash', '/usr/local/bin/fish', '/opt/homebrew/bin/fish', '/usr/bin/fish']

/** Shells listed in /etc/shells (plus $SHELL) that exist on disk. */
export function detectTerminalShells(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  fileExists: (path: string) => boolean = existsSync,
  readShellsFile: () => string = () => readFileSync('/etc/shells', 'utf8')
): TerminalShellOption[] {
  if (platform === 'win32') return []
  let listed: string[] = []
  try {
    listed = readShellsFile().split('\n').map((line) => line.trim()).filter((line) => line.startsWith('/'))
  } catch { /* No /etc/shells: fall back to the well-known paths. */ }
  const candidates = [...(env.SHELL ? [env.SHELL] : []), ...listed, ...KNOWN_SHELL_PATHS]
  const seen = new Set<string>()
  const shells: TerminalShellOption[] = []
  for (const path of candidates) {
    if (seen.has(path) || !fileExists(path)) continue
    seen.add(path)
    const name = basename(path)
    if (name === 'nologin' || name === 'false') continue
    shells.push({ path, name, supportsIntegration: shellIntegrationKind(path) !== null })
  }
  return shells
}
