import { describe, expect, it } from 'vitest'
import { registerHtmlElementValidation, validateHtmlElementReference } from './html-element-reference-validation'
import type { DesignHtmlElementContext } from './design-composer-context'

const context = (token: string): DesignHtmlElementContext => ({
  artifactId: 'page', artifactTitle: 'Page', artifactRelativePath: 'page.html',
  selector: '#take', tagName: 'button', text: 'Take', html: '<button id="take">Take</button>',
  validationToken: token
})

describe('live HTML reference validation', () => {
  it('admits an unchanged live target and rejects an unmounted target', async () => {
    const registration = registerHtmlElementValidation(async () => true)
    await expect(validateHtmlElementReference(context(registration.token))).resolves.toBeUndefined()
    registration.release()
    await expect(validateHtmlElementReference(context(registration.token))).rejects.toThrow('Select it again')
  })
  it('rejects changed or unreadable targets without running a send', async () => {
    for (const validator of [async () => false, async () => { throw new Error('not ready') }]) {
      const registration = registerHtmlElementValidation(validator)
      try {
        await expect(validateHtmlElementReference(context(registration.token))).rejects.toThrow('Select it again')
      } finally { registration.release() }
    }
  })
})
