import type { ApprovalChoice, ApprovalPermissionOption } from '@shared/approval-choice'

type Translate = (key: string, options?: Record<string, unknown>) => string

/** Request family the option copy is written for ('edit' phrases scopes as paths). */
export type ApprovalOptionFamily = 'email' | 'command' | 'edit' | 'other'

/**
 * Inline description next to an option label. `code` renders as a code chip
 * between `before` and `after` ("Don't ask again for `npx vitest ...` this session").
 */
export type ApprovalOptionDescription =
  | { text: string }
  | { before: string; code: string; after: string }

export type ApprovalOptionRow = {
  label: string
  description?: ApprovalOptionDescription
  decision: 'allow' | 'deny'
  choice?: ApprovalChoice
}

/** Placeholder swapped for the scope chip after translation. */
const SCOPE_TOKEN = '\uE000'
const SCOPE_MAX_CHARS = 36

/*
 * Runtime option names that only restate the option kind ("Allow",
 * "Always Allow", "Reject"). Those get the localized description; anything
 * more specific is the agent's own wording of the scope and is shown as is.
 */
const GENERIC_OPTION_NAME = /^(?:yes|no|ok(?:ay)?|allow|deny|reject|skip|cancel|approve|accept|decline|run|always|once|(?:allow|reject|deny|run) (?:once|always)|always (?:allow|reject|deny)|allow (?:for )?this (?:time|once))$/i

function isGenericOptionName(name: string | undefined): boolean {
  const text = name?.trim().replace(/[.!\u3002\uFF01]+$/, '') ?? ''
  return !text || GENERIC_OPTION_NAME.test(text)
}

/**
 * Prefix or path an "always" option is scoped to, when the runtime name
 * carries one: `npm test:*`, Bash(npx vitest:*), "src/main/". Wildcard tails
 * become an ellipsis and long scopes are shortened for the inline chip.
 */
export function approvalOptionScope(name: string | undefined): string | null {
  if (!name) return null
  const raw = /`([^`]+)`/.exec(name)?.[1] ??
    /\b[A-Z][A-Za-z]*\(([^()]+)\)/.exec(name)?.[1] ??
    /["\u201C]([^"\u201D]+)["\u201D]/.exec(name)?.[1]
  const scope = raw?.replace(/\s+/g, ' ').trim().replace(/\s*:?\s*\*+$/, ' \u2026').trim()
  if (!scope || scope === '\u2026') return null
  if (scope.length <= SCOPE_MAX_CHARS) return scope
  return `${scope.slice(0, SCOPE_MAX_CHARS - 2).trimEnd()} \u2026`
}

function scopedDescription(key: string, scope: string, t: Translate): ApprovalOptionDescription {
  const text = t(key, { scope: SCOPE_TOKEN })
  const at = text.indexOf(SCOPE_TOKEN)
  if (at < 0) return { text }
  return { before: text.slice(0, at), code: scope, after: text.slice(at + SCOPE_TOKEN.length) }
}

function optionLabel(kind: ApprovalPermissionOption['kind'], family: ApprovalOptionFamily, t: Translate): string {
  if (kind === 'allow_always') return t('composerApproval.option.allowAlways')
  if (kind === 'reject_always') return t('composerApproval.option.denyAlways')
  if (kind === 'reject_once') return family === 'email' ? t('approvalEmailDontSend') : t('composerApproval.option.deny')
  return family === 'email' ? t('approvalEmailSend') : t('composerApproval.option.allow')
}

function optionDescription(
  kind: ApprovalPermissionOption['kind'],
  name: string | undefined,
  family: ApprovalOptionFamily,
  t: Translate
): ApprovalOptionDescription | undefined {
  const scope = kind === 'allow_always' ? approvalOptionScope(name) : null
  if (scope) {
    return scopedDescription(
      family === 'edit' ? 'composerApproval.option.alwaysScopedEdit' : 'composerApproval.option.alwaysScoped',
      scope,
      t
    )
  }
  if (!isGenericOptionName(name)) return { text: name!.trim() }
  // Mail rows read as a sentence already ("Send" / "Don't send").
  if (family === 'email' && (kind === 'allow_once' || kind === 'reject_once')) return undefined
  if (kind === 'allow_always') return { text: t('composerApproval.option.alwaysSession') }
  if (kind === 'reject_always') return { text: t('composerApproval.option.denyAlwaysSession') }
  if (kind === 'reject_once') return { text: t('composerApproval.option.denyOnce') }
  return { text: t('composerApproval.option.once') }
}

/*
 * Row order by how much a decision grants: the first row is pre-selected, so
 * Enter or Confirm on an untouched card must never pick a broader scope than
 * "allow once", whatever order the runtime listed its options in.
 */
const OPTION_RANK: Record<ApprovalPermissionOption['kind'], number> = {
  allow_once: 0,
  allow_always: 1,
  reject_always: 2,
  reject_once: 3
}

/**
 * Numbered decision rows: allow once, then the runtime's broader scopes
 * (allow always, deny always), each kind in the runtime's own order. `deny`
 * (the runtime's reject-once option, or a plain cancel) is always the last
 * numbered row and is the decision that carries the optional note for the agent.
 */
export function approvalOptionRows(
  family: ApprovalOptionFamily,
  options: ApprovalPermissionOption[] | undefined,
  t: Translate
): { rows: ApprovalOptionRow[]; deny: ApprovalOptionRow } {
  if (!options?.length) {
    const allowDescription = optionDescription('allow_once', undefined, family, t)
    const denyDescription = optionDescription('reject_once', undefined, family, t)
    return {
      rows: [{ label: optionLabel('allow_once', family, t), ...(allowDescription ? { description: allowDescription } : {}), decision: 'allow' }],
      deny: { label: optionLabel('reject_once', family, t), ...(denyDescription ? { description: denyDescription } : {}), decision: 'deny' }
    }
  }
  const rejectOnce = options.find((option) => option.kind === 'reject_once')
  const rows = options
    .filter((option) => option !== rejectOnce)
    .sort((a, b) => OPTION_RANK[a.kind] - OPTION_RANK[b.kind])
    .map((option): ApprovalOptionRow => {
      const description = optionDescription(option.kind, option.name, family, t)
      return {
        label: optionLabel(option.kind, family, t),
        ...(description ? { description } : {}),
        decision: option.kind.startsWith('allow') ? 'allow' : 'deny',
        choice: { optionId: option.optionId }
      }
    })
  const denyDescription = optionDescription('reject_once', rejectOnce?.name, family, t)
  return {
    rows,
    deny: {
      label: optionLabel('reject_once', family, t),
      ...(denyDescription ? { description: denyDescription } : {}),
      decision: 'deny',
      choice: rejectOnce ? { optionId: rejectOnce.optionId } : { cancelled: true }
    }
  }
}
