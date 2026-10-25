import type { DesignHtmlElementContext } from './design-composer-context'

type Validator = () => Promise<boolean>
const validators = new Map<string, Validator>()
let nextId = 0

/** Live, renderer-only validation; never serialize executable callbacks into a prompt. */
export function registerHtmlElementValidation(validate: Validator): { token: string; release: () => void } {
  const token = `html-pick-${++nextId}`
  validators.set(token, validate)
  return { token, release: () => { validators.delete(token) } }
}

export async function validateHtmlElementReference(context: DesignHtmlElementContext | null | undefined): Promise<void> {
  if (!context?.validationToken) return
  const validate = validators.get(context.validationToken)
  let valid = false
  try { valid = Boolean(validate && await validate()) } catch { valid = false }
  if (!valid) throw new Error('The selected component changed or is unavailable. Select it again before sending.')
}
