/**
 * Remote command risk classification (Issue #647, safety guard).
 *
 * Pure, dependency-free heuristics that categorize a remote shell command by
 * the kind of change it makes and how reversible it is. The run-mode policy
 * (remote-run-mode.ts) and the approval card consume this to decide allow /
 * confirm / deny. Classification is conservative: ambiguous commands fall back
 * to a safe category rather than being treated as harmless.
 */

export type RemoteCommandCategory =
  | 'read-only'
  | 'project-write'
  | 'dependency-install'
  | 'test-run'
  | 'network-write'
  | 'service-control'
  | 'filesystem-destructive'
  | 'db-migration'
  | 'network-security'
  | 'container-destructive'
  | 'k8s-mutation'
  | 'secrets'
  | 'privilege-escalation'
  | 'standard'

export type RemoteRiskLevel = 'low' | 'medium' | 'high' | 'critical'

export type RemoteCommandClassification = {
  category: RemoteCommandCategory
  level: RemoteRiskLevel
  /** True when the command mutates remote state (never auto-replayed on reconnect). */
  writes: boolean
  /** Human-readable reason the category was assigned. */
  reason: string
}

type Rule = {
  category: RemoteCommandCategory
  level: RemoteRiskLevel
  writes: boolean
  reason: string
  test: RegExp
}

// Ordered by precedence: the first matching rule wins, so the most dangerous
// patterns are listed first. Patterns match the raw command string.
const RULES: readonly Rule[] = [
  { category: 'privilege-escalation', level: 'critical', writes: true, reason: 'runs with elevated privileges (sudo/su/doas)', test: /(^|[;&|]\s*)(sudo|su|doas)\b/ },
  { category: 'secrets', level: 'critical', writes: true, reason: 'reads or modifies secrets / credentials / env files', test: /(\.env\b|id_rsa|id_ed25519|\/etc\/shadow|\/etc\/passwd|\bsecrets?\b|\bcredentials?\b|\.pem\b)/i },
  { category: 'network-security', level: 'critical', writes: true, reason: 'changes firewall or SSH configuration', test: /\b(iptables|nft|ufw|firewall-cmd|sshd_config|authorized_keys)\b/i },
  { category: 'db-migration', level: 'high', writes: true, reason: 'runs a database migration', test: /\b(migrat\w*|alembic|flyway|liquibase|prisma\s+migrate|knex\s+migrate|rails\s+db:migrate)\b/i },
  { category: 'k8s-mutation', level: 'high', writes: true, reason: 'mutates Kubernetes resources', test: /\bkubectl\s+(apply|delete|replace|patch|scale|drain|cordon)\b/i },
  { category: 'container-destructive', level: 'high', writes: true, reason: 'destroys container volumes or images', test: /\bdocker\b.*\b(volume\s+rm|system\s+prune|rmi|rm\s+-\w*f)\b|\bdocker-compose\s+down\b.*-v/i },
  { category: 'filesystem-destructive', level: 'high', writes: true, reason: 'irreversibly deletes or repermissions files', test: /(^|[;&|]\s*)(rm\s+-\w*[rf]|rmdir|chmod|chown|mkfs|dd\s+if=|truncate)\b/ },
  { category: 'service-control', level: 'high', writes: true, reason: 'restarts or stops a system service', test: /\b(systemctl\s+(restart|stop|disable|mask)|service\s+\S+\s+(restart|stop)|kill(all)?\b|pm2\s+(restart|stop|delete))\b/i },
  // curl/wget with a mutating method, body, or upload is a side-effecting
  // network call (e.g. `curl -X DELETE`), NOT a read. Listed before the
  // read-only rule so it is never auto-allowed as a harmless fetch. A pipe to a
  // shell (`curl ... | sh`) is treated the same way.
  { category: 'network-write', level: 'high', writes: true, reason: 'network request with a mutating method, body, upload, or pipe-to-shell', test: /\b(curl|wget)\b[^\n]*(-X\s*(POST|PUT|DELETE|PATCH)|--request\s+(POST|PUT|DELETE|PATCH)|\s-d\b|--data\b|\s-T\b|--upload-file\b|--upload\b|\|\s*(sudo\s+)?(ba)?sh\b)/i },
  { category: 'dependency-install', level: 'medium', writes: true, reason: 'installs or changes dependencies', test: /\b(npm|pnpm|yarn|bun)\s+(i|install|add|remove|ci)\b|\bpip\s+install\b|\bapt(-get)?\s+install\b|\bbrew\s+install\b/i },
  { category: 'test-run', level: 'low', writes: true, reason: 'runs tests (may touch a database or external systems, so not auto-replayed)', test: /\b(npm|pnpm|yarn|bun)\s+(test|run\s+test)\b|\bvitest\b|\bjest\b|\bpytest\b|\bgo\s+test\b/i },
  { category: 'project-write', level: 'medium', writes: true, reason: 'writes or moves project files', test: /(^|[;&|]\s*)(tee|cp|mv|mkdir|touch|sed\s+-i|git\s+(commit|reset|checkout|clean|push))\b|>\s*\S/ },
  { category: 'read-only', level: 'low', writes: false, reason: 'reads files, logs, or status', test: /^(\s*)(cat|less|tail|head|grep|rg|ls|find|pwd|uname|stat|git\s+(status|log|diff|show|rev-parse|branch)|systemctl\s+status|journalctl|docker\s+(ps|logs|inspect)|kubectl\s+(get|describe|logs)|curl|wget|echo|df|free|ps|top|env|printenv|which|command\s+-v)\b/ }
]

export function classifyRemoteCommand(command: string): RemoteCommandClassification {
  const trimmed = command.trim()
  for (const rule of RULES) {
    if (rule.test.test(trimmed)) {
      return { category: rule.category, level: rule.level, writes: rule.writes, reason: rule.reason }
    }
  }
  // Unknown command: assume it may mutate state (medium) so the guard errs safe.
  return {
    category: 'standard',
    level: 'medium',
    writes: true,
    reason: 'unrecognized command; treated as potentially state-changing'
  }
}

/**
 * Irreversible / high-blast-radius categories that must be confirmed even when
 * the user granted full permissions — especially on production targets.
 */
export function isIrreversibleCategory(category: RemoteCommandCategory): boolean {
  return (
    category === 'filesystem-destructive' ||
    category === 'db-migration' ||
    category === 'network-security' ||
    category === 'container-destructive' ||
    category === 'k8s-mutation' ||
    category === 'secrets' ||
    category === 'privilege-escalation'
  )
}
