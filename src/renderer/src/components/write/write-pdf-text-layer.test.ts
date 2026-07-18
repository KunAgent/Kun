import { describe, expect, it } from 'vitest'
import {
  applyPdfTextLayerScale,
  startPdfTextLayerRenderWithoutUiZoom
} from './write-pdf-text-layer'

function captureScaleProperties(scale: number, userUnit: number): Map<string, string> {
  const properties = new Map<string, string>()
  applyPdfTextLayerScale({
    setProperty: (name, value) => {
      properties.set(name, value ?? '')
    }
  }, { scale, userUnit })
  return properties
}

describe('Write PDF text layer', () => {
  it('matches the text layer to the regular PDF viewport scale', () => {
    expect(captureScaleProperties(1.15, 1)).toEqual(new Map([
      ['--scale-factor', '1.15'],
      ['--user-unit', '1'],
      ['--total-scale-factor', '1.15'],
      ['--scale-round-x', '1px'],
      ['--scale-round-y', '1px']
    ]))
  })

  it('includes a PDF custom user unit in the effective scale', () => {
    expect(captureScaleProperties(0.85, 2).get('--total-scale-factor')).toBe('1.7')
  })

  it('starts PDF.js font measurement without the app UI zoom', () => {
    const bodyStyle = { zoom: 'var(--ds-ui-scale)' }
    const renderResult = Promise.resolve('rendered')
    let zoomDuringRender = ''

    const result = startPdfTextLayerRenderWithoutUiZoom(() => {
      zoomDuringRender = bodyStyle.zoom
      return renderResult
    }, bodyStyle)

    expect(result).toBe(renderResult)
    expect(zoomDuringRender).toBe('1')
    expect(bodyStyle.zoom).toBe('var(--ds-ui-scale)')
  })

  it('restores the UI zoom when PDF.js render startup throws', () => {
    const bodyStyle = { zoom: '0.82' }

    expect(() => startPdfTextLayerRenderWithoutUiZoom(() => {
      throw new Error('render failed')
    }, bodyStyle)).toThrow('render failed')
    expect(bodyStyle.zoom).toBe('0.82')
  })
})
