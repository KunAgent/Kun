import { delegatedCapabilityFingerprint, type DelegatedSessionPreparation } from '../runtime/delegated-session-binding.js'

/** Bootstrap a native session once; resend stable instructions only when they change.
 * Compare the complete snapshot, so a removed mode or changed client surface is
 * not mistaken for an already-delivered instruction. Request-local controls
 * are always delivered separately. No user history lives here.
 */
export function sessionInstructions(
  preparation: DelegatedSessionPreparation | undefined,
  blocks: readonly (string | undefined)[],
  bootstrap = false,
  turnLocalBlocks: readonly string[] = []
): string[] {
  const local = [...new Set(turnLocalBlocks.map((block) => block.trim()).filter(Boolean))]
  const current = [...new Set(blocks
    .map((block) => block?.trim())
    .filter((block): block is string => typeof block === 'string' && block.length > 0 && !local.includes(block)))]
  if (!preparation) return [...current, ...local]
  const digest = delegatedCapabilityFingerprint(current)
  preparation.instructionDigest = digest
  if (!bootstrap && preparation.resumed && preparation.synchronizedInstructionDigest === digest) {
    return local
  }
  if (!bootstrap && preparation.resumed && preparation.synchronizedInstructionDigest) {
    return [`Current Kun session instructions (replace previous Kun instruction context):\n${current.join('\n\n') || 'No additional Kun instructions.'}`, ...local]
  }
  return [...current, ...local]
}
