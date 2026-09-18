import { describe, expect, it } from 'vitest'
import { readStylesheetBundle } from '../testing/stylesheet-bundle'

describe('Excalidraw host styles', () => {
  it('cancels the body UI-scale zoom so canvas measurements match layout', async () => {
    const css = await readStylesheetBundle(new URL('./excalidraw-host.css', import.meta.url))

    expect(css).toMatch(
      /\.kun-excalidraw-host,\s*\.excalidraw-tooltip\s*{[^}]*zoom: calc\(1 \/ var\(--ds-ui-scale, 1\)\);/
    )
  })
})
