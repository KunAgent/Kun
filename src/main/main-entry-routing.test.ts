import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('main entry routing', () => {
  it('keeps update health ahead of the full desktop module graph', () => {
    const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8')

    expect(source).toContain("import('./main-desktop-entry')")
    expect(source).toContain("import('./update-health-check')")
    expect(source).toContain("app.on('window-all-closed'")
    expect(source).not.toContain("from './main-app-context'")
    expect(source.indexOf("app.on('window-all-closed'")).toBeGreaterThan(
      source.indexOf('if (bootstrapHealthRequest.resultPath)')
    )
    expect(source.indexOf("app.on('window-all-closed'")).toBeLessThan(
      source.indexOf("import('./update-health-check')")
    )
    expect(source.indexOf('bootstrapHealthRequest.resultPath')).toBeLessThan(
      source.indexOf("import('./main-desktop-entry')")
    )
  })
})
