export type MoaModality = 'text' | 'image' | 'video'
export type MoaModalityPolicy = 'native' | 'derived_text' | 'skip'

export function planMoaContext(input: {
  latestUserMessage: string
  referenceOutputs: readonly string[]
  maxContextTokens: number
  reservedOutputTokens: number
}): {
  latestUserMessage: string
  referenceOutputs: string[]
  estimatedInjectedTokens: number
} {
  const latestTokens = estimateTokens(input.latestUserMessage)
  let remainingChars = Math.max(
    0,
    input.maxContextTokens - input.reservedOutputTokens - latestTokens
  ) * 4
  const outputs: string[] = []
  for (let index = 0; index < input.referenceOutputs.length; index += 1) {
    const remainingSlots = input.referenceOutputs.length - index
    const allowance = Math.floor(remainingChars / remainingSlots)
    const normalized = input.referenceOutputs[index].trim()
    const clipped = normalized.length <= allowance
      ? normalized
      : `${normalized.slice(0, Math.max(0, allowance - 20))}\n[reference clipped]`
    outputs.push(clipped)
    remainingChars -= clipped.length
  }
  return {
    latestUserMessage: input.latestUserMessage,
    referenceOutputs: outputs,
    estimatedInjectedTokens: outputs.reduce((total, value) => total + estimateTokens(value), 0)
  }
}

export function planMoaModalities(input: {
  attachmentKinds: readonly Exclude<MoaModality, 'text'>[]
  slots: ReadonlyArray<{
    slotId: string
    input: readonly MoaModality[]
    policy: MoaModalityPolicy
  }>
}): Array<{ slotId: string; action: MoaModalityPolicy; unsupported: MoaModality[] }> {
  return input.slots.map((slot) => {
    const unsupported = input.attachmentKinds.filter((kind) => !slot.input.includes(kind))
    if (slot.policy === 'skip') return { slotId: slot.slotId, action: 'skip', unsupported }
    if (unsupported.length === 0 && slot.policy === 'native') {
      return { slotId: slot.slotId, action: 'native', unsupported: [] }
    }
    return { slotId: slot.slotId, action: 'derived_text', unsupported }
  })
}

function estimateTokens(value: string): number {
  return Math.ceil(value.length / 4)
}
