import assert from 'node:assert/strict'

/** Read actual browser-computed surfaces, including color-mix; never infer from classes. */
export async function assertWorkAssistantPalette(page, { batch = false } = {}) {
  const colors = await page.getByTestId('work-assistant-panel').evaluate((panel, inspectBatch) => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1
    const context = canvas.getContext('2d')
    const rgb = value => {
      context.clearRect(0, 0, 1, 1)
      context.fillStyle = value
      context.fillRect(0, 0, 1, 1)
      return Array.from(context.getImageData(0, 0, 1, 1).data)
    }
    const color = (element, property) => rgb(getComputedStyle(element)[property])
    const luminance = value => value.slice(0, 3).map(channel => {
      const linear = channel / 255
      return linear <= .04045 ? linear / 12.92 : ((linear + .055) / 1.055) ** 2.4
    }).reduce((sum, channel, index) => sum + channel * [.2126, .7152, .0722][index], 0)
    const contrast = (first, second) => (Math.max(luminance(first), luminance(second)) + .05) / (Math.min(luminance(first), luminance(second)) + .05)
    const reference = document.createElement('span')
    reference.style.background = 'var(--ds-bg-main)'
    panel.appendChild(reference)
    const codeCanvas = color(reference, 'backgroundColor')
    reference.remove()
    const selectors = ['.write-assistant-header', '.write-assistant-body', '.write-assistant-footer']
    const surfaces = selectors.map(selector => {
      const element = panel.querySelector(selector)
      return { name: selector, background: color(element, 'backgroundColor'), image: getComputedStyle(element).backgroundImage }
    })
    const primaryText = panel.querySelector('.write-assistant-ready h3, .paper-batch-assistant header h3') || panel
    const subtitle = panel.querySelector('.write-assistant-action-row .text-ds-faint')
    const result = { codeCanvas, surfaces, primaryContrast: contrast(color(primaryText, 'color'), codeCanvas),
      subtitleContrast: subtitle ? contrast(color(subtitle, 'color'), codeCanvas) : null, batch: null }
    if (inspectBatch) {
      const card = panel.querySelector('[data-testid="paper-batch-assistant"]')
      const field = card.querySelector('select')
      const label = card.querySelector('label > span')
      const sourceMetadata = card.querySelector('.paper-batch-sources p.text-ds-faint')
      const background = color(card, 'backgroundColor')
      const fieldBackground = color(field, 'backgroundColor')
      result.batch = { background, border: color(card, 'borderTopColor'), fieldBackground,
        fieldContrast: contrast(color(field, 'color'), fieldBackground), labelContrast: contrast(color(label, 'color'), background),
        sourceContrast: contrast(color(sourceMetadata, 'color'), background) }
    }
    return result
  }, batch)
  const delta = (a, b) => Math.max(...a.slice(0, 3).map((channel, index) => Math.abs(channel - b[index])))
  for (const surface of colors.surfaces) {
    assert.ok(delta(surface.background, colors.codeCanvas) <= 1, `${surface.name} must share the Code canvas instead of a contrasting panel band`)
    assert.equal(surface.image, 'none', `${surface.name} must not add a gradient`)
  }
  assert.ok(colors.primaryContrast >= 4.5, 'primary text must remain readable')
  if (!batch) assert.ok(colors.subtitleContrast >= 4.5, 'small action subtitles must remain readable')
  if (colors.batch) {
    assert.ok(delta(colors.batch.background, colors.codeCanvas) <= 1, 'batch must share the main canvas')
    assert.ok(delta(colors.batch.fieldBackground, colors.codeCanvas) <= 12, 'fields should be a subtle surface step')
    assert.ok(delta(colors.batch.border, colors.codeCanvas) <= 48, 'batch must not fall back to a bright currentColor border')
    assert.ok(colors.batch.fieldContrast >= 4.5, 'field text contrast must remain readable')
    assert.ok(colors.batch.labelContrast >= 4.5, 'form labels must remain readable')
    assert.ok(colors.batch.sourceContrast >= 4.5, 'small source metadata must remain readable')
  }
  return colors
}
