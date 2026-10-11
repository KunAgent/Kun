const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
type Effort = (typeof EFFORTS)[number]

const isEffort = (value: string): value is Effort => (EFFORTS as readonly string[]).includes(value)

function nearestEffort(requested: string | undefined, available: readonly Effort[]): Effort {
  const rank = (effort: string | undefined): number => {
    const index = EFFORTS.findIndex((entry) => entry === effort)
    return index < 0 ? EFFORTS.indexOf('medium') : index
  }
  const target = rank(requested)
  // Ties resolve upward: a model that skips the requested tier is better served
  // by the stronger neighbour than by silently thinning the answer.
  return [...available].sort((a, b) =>
    Math.abs(rank(a) - target) - Math.abs(rank(b) - target) || rank(b) - rank(a))[0]!
}

/**
 * `agy` 1.3 validates `--effort` against the selected model before it starts
 * a turn: some models accept only a subset of the tiers (`gemini-3.1-pro` has
 * low and high, `gpt-oss-120b` only medium) and others take no `--effort` at
 * all (the Claude models). The supported tiers are not static, so repair the
 * selection from the CLI's own rejection. Returns the adjusted argv, or
 * undefined when the failure is anything else or the repair changes nothing.
 */
export function adaptAntigravityModelSelectionArgs(
  args: readonly string[],
  message: string
): string[] | undefined {
  if (!/invalid model selection/i.test(message)) return undefined
  const at = args.indexOf('--effort')
  if (/--effort is not supported for model/i.test(message)) {
    return at < 0 ? undefined : args.filter((_, index) => index !== at && index !== at + 1)
  }
  const listed = message.match(/\(available:\s*([^)]*)\)/i)?.[1] ?? ''
  const available = [...listed.matchAll(/[a-z]+/gi)].map((match) => match[0].toLowerCase()).filter(isEffort)
  if (!available.length) return undefined
  const requested = at >= 0 ? args[at + 1] : undefined
  const chosen = nearestEffort(requested, available)
  if (chosen === requested) return undefined
  if (at < 0) return [...args, '--effort', chosen]
  const next = [...args]
  next[at + 1] = chosen
  return next
}
