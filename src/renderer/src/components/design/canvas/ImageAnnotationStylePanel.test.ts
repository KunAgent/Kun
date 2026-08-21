import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ImageAnnotationStylePanel } from './ImageAnnotationStylePanel'

describe('ImageAnnotationStylePanel', () => {
  it('shows line, dash, and arrowhead controls for arrows', () => {
    const html = renderToStaticMarkup(createElement(ImageAnnotationStylePanel, {
      target: 'arrow',
      selected: true,
      style: { color: '#ef4444', opacity: 1, width: 4, dash: 'solid', arrowhead: 'arrow' },
      onChange: () => undefined
    }))

    expect(html).toContain('所选标注')
    expect(html).toContain('线宽')
    expect(html).toContain('线型')
    expect(html).toContain('箭头')
    expect(html).toContain('开放')
    expect(html).not.toContain('字号')
  })

  it('shows typography controls for text', () => {
    const html = renderToStaticMarkup(createElement(ImageAnnotationStylePanel, {
      target: 'text',
      selected: false,
      style: { color: '#111827', opacity: 0.75, fontFamily: 'serif', fontSize: 48, fontWeight: 700 },
      onChange: () => undefined
    }))

    expect(html).toContain('绘制样式')
    expect(html).toContain('字体')
    expect(html).toContain('字号')
    expect(html).toContain('字重')
    expect(html).toContain('value="48"')
    expect(html).not.toContain('线型')
  })

  it('guides selection mode when no annotation is selected', () => {
    const html = renderToStaticMarkup(createElement(ImageAnnotationStylePanel, {
      target: null,
      selected: false,
      style: {},
      onChange: () => undefined
    }))

    expect(html).toContain('选择一个标注后可调整样式')
  })
})
