import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

// Give the single locale/theme operation a page-owned lifetime across lazy
// imports, then observe its explicit completion without a pending CDP promise.
// A replaced document or rejected operation is a failure, never a retry.
export async function setSmokeAppearance(page, language, theme, diagnostics = []) {
  const id = randomUUID()
  const record = { id, language, theme, status: 'pending', started: new Date().toISOString() }
  diagnostics.push(record)
  try {
    await page.evaluate(({ id, language, theme }) => {
      const operation = { id, document, status: 'pending', error: null, promise: null }
      window.agentEnablementAppearanceOperation = operation
      operation.promise = (async () => {
        await window.agentEnablementFixture.language(language)
        if (operation.document !== document || window.agentEnablementAppearanceOperation !== operation) {
          throw new Error('Appearance operation document was replaced')
        }
        window.agentEnablementFixture.theme(theme)
      })().then(() => { operation.status = 'fulfilled' }, error => {
        operation.error = error?.stack || String(error)
        operation.status = 'rejected'
      })
    }, { id, language, theme })
    await page.waitForFunction(id => {
      const operation = window.agentEnablementAppearanceOperation
      if (operation?.id !== id || operation.document !== document) {
        throw new Error('Appearance operation document was replaced')
      }
      return operation.status !== 'pending'
    }, id)
    const result = await page.evaluate(id => {
      const operation = window.agentEnablementAppearanceOperation
      if (operation?.id !== id || operation.document !== document) {
        throw new Error('Appearance operation document was replaced')
      }
      const result = { status: operation.status, error: operation.error }
      delete window.agentEnablementAppearanceOperation
      return result
    }, id)
    Object.assign(record, result)
    assert.equal(result.status, 'fulfilled', result.error || 'Appearance operation did not finish')
  } catch (error) {
    if (record.status === 'pending') record.status = 'boundary-failed'
    record.error ||= error?.stack || String(error)
    throw error
  } finally {
    record.finished = new Date().toISOString()
  }
}
