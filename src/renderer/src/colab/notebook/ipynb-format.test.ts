import { describe, expect, it } from 'vitest'
import { appendOutput, parseIpynb, renderStreamText, serializeIpynb, createCell } from './ipynb-format'

describe('ipynb-format', () => {
  it('round-trips code and markdown cells with outputs', () => {
    const code = createCell('code', 'x = 1\nprint(x)')
    code.executionCount = 3
    code.outputs = [
      { type: 'stream', name: 'stdout', text: '1\n' },
      { type: 'image', mime: 'image/png', data: 'AAAA' },
      { type: 'error', ename: 'ValueError', evalue: 'bad', traceback: 'Traceback\nValueError: bad' }
    ]
    const md = createCell('markdown', '# Title\ntext')
    const parsed = parseIpynb(serializeIpynb([md, code], 'T4'))
    expect(parsed.map((c) => [c.kind, c.source, c.executionCount])).toEqual([
      ['markdown', '# Title\ntext', null],
      ['code', 'x = 1\nprint(x)', 3]
    ])
    expect(parsed[1].outputs).toEqual(code.outputs)
  })

  it('reads Colab-style notebooks with line arrays, execute_result and ANSI tracebacks', () => {
    const content = JSON.stringify({
      nbformat: 4,
      cells: [
        {
          cell_type: 'code',
          execution_count: 1,
          source: ['a = 2\n', 'a'],
          outputs: [
            { output_type: 'execute_result', data: { 'text/plain': ['2'] } },
            { output_type: 'error', ename: 'E', evalue: 'v', traceback: ['\u001b[0;31mE\u001b[0m: v'] }
          ]
        },
        { cell_type: 'raw', source: 'raw text' }
      ]
    })
    const cells = parseIpynb(content)
    expect(cells[0].source).toBe('a = 2\na')
    expect(cells[0].outputs).toEqual([
      { type: 'stream', name: 'stdout', text: '2' },
      { type: 'error', ename: 'E', evalue: 'v', traceback: 'E: v' }
    ])
    expect(cells[1].kind).toBe('markdown')
  })

  it('rejects non-notebook JSON', () => {
    expect(() => parseIpynb('{"foo":1}')).toThrow()
  })

  it('merges consecutive stream chunks and renders carriage returns', () => {
    let outputs = appendOutput([], { type: 'stream', name: 'stdout', text: '10%\r' })
    outputs = appendOutput(outputs, { type: 'stream', name: 'stdout', text: '50%\r100%\ndone' })
    expect(outputs).toHaveLength(1)
    expect(renderStreamText(outputs[0].type === 'stream' ? outputs[0].text : '')).toBe('100%\ndone')
  })
})
