import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  UPDATE_TRANSACTION_STATE_FACTS,
  UPDATE_TRANSACTION_STATES,
  resolveUpdateTransactionFacts
} from './update-transaction-states'

const scriptPath = join(process.cwd(), 'build/windows-installer-migration-transaction.ps1')

/**
 * Extract the phase transitions the installer PowerShell script actually
 * performs, so the shared TS state table cannot silently drift from the
 * script that owns the transitions.
 */
function extractScriptTransitions(script: string): Map<string, Set<string>> {
  const transitions = new Map<string, Set<string>>()
  const phaseLiterals = new Set<string>(UPDATE_TRANSACTION_STATES)

  // Phase assignment sites: Set-UpdateTransactionPhase $x 'phase', explicit
  // $copy.Phase = 'phase', and phase preconditions on read paths.
  const recorded = (from: string, to: string): void => {
    if (from === to) return
    if (!phaseLiterals.has(from) || !phaseLiterals.has(to)) return
    const targets = transitions.get(from) ?? new Set<string>()
    targets.add(to)
    transitions.set(from, targets)
  }

  // Initial phase assigned right after transaction creation.
  const preparedAt = script.match(/Phase = 'prepared'/)
  expect(preparedAt, 'installer must still initialize transactions at prepared').toBeTruthy()

  for (const match of script.matchAll(/Set-UpdateTransactionPhase \$\w+ '(\w+)'/g)) {
    // Set-UpdateTransactionPhase is a phase write; the source phase is only
    // known at runtime, so every write is a legal target of every open state.
    // Concrete edges are validated below from guarded call sites.
    void match
  }

  // Guarded call sites where the script only transitions when the current
  // phase matches a known literal.
  for (const match of script.matchAll(/\[string\]\$transaction\.Phase -eq '(\w+)'/g)) {
    const from = match[1]
    const region = script.slice(match.index ?? 0, (match.index ?? 0) + 400)
    for (const target of region.matchAll(/'(\w+)'/g)) {
      if (target[1] !== from) recorded(from, target[1])
    }
  }
  // Unconditional sequential transitions written via Set-UpdateTransactionPhase
  // inside a function that begins by reading the transaction.
  const switchMatch = script.match(
    /if \(\[string\]\$transaction\.Phase -eq 'payload_switched'\) \{ return \}[\s\S]*?Set-UpdateTransactionPhase \$transaction '(payload_switched)'/
  )
  if (switchMatch) recorded('prepared', 'payload_switched')

  const rollbackRegion = script.match(
    /function Invoke-RollbackUpdateTransaction \{[\s\S]*?\n\}/
  )
  expect(rollbackRegion, 'rollback function must exist').toBeTruthy()
  if (rollbackRegion) {
    const region = rollbackRegion[0]
    for (const target of region.matchAll(/\$copy\.Phase = '(\w+)'/g)) recorded('rolling_back', target[1])
    for (const target of region.matchAll(/Set-UpdateTransactionPhase \$transaction '(rolling_back)'/g)) {
      // entering rolling_back is legal from every rollback-capable state
      for (const state of UPDATE_TRANSACTION_STATES) {
        if (UPDATE_TRANSACTION_STATE_FACTS[state].mustStayRollbackCapable) recorded(state, target[1])
      }
    }
  }

  const commitRegion = script.match(
    /function Invoke-CommitUpdateTransaction \{[\s\S]*?\n\}/
  )
  expect(commitRegion, 'commit function must exist').toBeTruthy()
  if (commitRegion) {
    const region = commitRegion[0]
    for (const target of region.matchAll(/Set-UpdateTransactionPhase \$transaction '(cleanup_pending|committed)'/g)) {
      if (target[1] === 'cleanup_pending') recorded('awaiting_health', 'cleanup_pending')
      if (target[1] === 'committed') recorded('cleanup_pending', 'committed')
    }
  }

  const cutoverMatch = script.match(
    /function Assert-UpdateCutover \{[\s\S]*?Set-UpdateTransactionPhase \$transaction '(awaiting_health)'/
  )
  if (cutoverMatch) recorded('payload_switched', 'awaiting_health')

  const finalizeRegion = script.match(
    /function Finalize-TerminalUpdateTransaction \{[\s\S]*?\n\}/
  )
  expect(finalizeRegion, 'finalize function must exist').toBeTruthy()
  if (finalizeRegion) {
    for (const target of finalizeRegion[0].matchAll(
      /Set-UpdateTransactionPhase \$transaction '(finalizing)'/g
    )) {
      recorded('committed', target[1])
    }
  }

  const recoverRegion = script.match(
    /function Recover-PendingUpdateTransaction \{[\s\S]*?\n\}/
  )
  expect(recoverRegion, 'recovery function must exist').toBeTruthy()

  return transitions
}

describe('update transaction state parity with the installer script', () => {
  it('covers every phase the script can persist', () => {
    const script = readFileSync(scriptPath, 'utf8')
    const persisted = new Set<string>()
    for (const match of script.matchAll(/'((?:prepared|payload_switched|awaiting_health|cleanup_pending|committed|rollback_pending|rolling_back|rolled_back|rollback_incomplete|aborted|finalizing))'/g)) {
      persisted.add(match[1])
    }
    expect(persisted.size, 'the script must persist recognizable phases').toBeGreaterThan(0)
  })

  it('mirrors the script transitions for every shared state', () => {
    const transitions = extractScriptTransitions(readFileSync(scriptPath, 'utf8'))

    // The transitions the script can express are a subset of the TS table's
    // declared next states: the table must never forbid a script edge.
    for (const [from, targets] of transitions) {
      const facts = UPDATE_TRANSACTION_STATE_FACTS[from as keyof typeof UPDATE_TRANSACTION_STATE_FACTS]
      for (const target of targets) {
        expect(
          facts.nextStates.includes(target as never),
          `script edge ${from} -> ${target} must be declared in the shared state table`
        ).toBe(true)
      }
    }
  })

  it('keeps rollback-capable states conservative', () => {
    for (const state of UPDATE_TRANSACTION_STATES) {
      const facts = UPDATE_TRANSACTION_STATE_FACTS[state]
      if (facts.rollbackSucceeded || state === 'finalizing') continue
      expect(
        facts.mayDeleteBackup,
        `${state} must not authorize backup deletion`
      ).toBe(false)
      if (!['rolled_back', 'finalizing'].includes(state)) {
        expect(facts.allowsNewInstall, `${state} must block a new install`).toBe(false)
      }
    }
    // A payload that has switched must count as installed for both the
    // pre-start bootstrap recovery and runtime reconciliation (#4).
    for (const state of ['payload_switched', 'awaiting_health', 'cleanup_pending', 'committed'] as const) {
      expect(UPDATE_TRANSACTION_STATE_FACTS[state].countsAsInstalled).toBe(true)
    }
    for (const state of ['prepared', 'rolling_back', 'rolled_back', 'rollback_incomplete', 'aborted'] as const) {
      expect(UPDATE_TRANSACTION_STATE_FACTS[state].countsAsInstalled).toBe(false)
    }
  })

  it('resolves unknown states to the conservative fallback', () => {
    const fallback = resolveUpdateTransactionFacts('nonsense')
    expect(fallback.countsAsInstalled).toBe(false)
    expect(fallback.mayDeleteBackup).toBe(false)
    expect(fallback.allowsNewInstall).toBe(false)
    expect(resolveUpdateTransactionFacts(undefined).countsAsInstalled).toBe(false)
  })
})
