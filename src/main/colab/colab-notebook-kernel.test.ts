import { describe, expect, it } from 'vitest'
import { COLAB_NOTEBOOK_MARKER, type ColabNotebookOutput } from '../../shared/colab/colab-notebook-types'
import { extractNotebookAssistCell } from './colab-notebook-assist'
import {
  buildNotebookCellPython,
  buildRemoteListPython,
  createNotebookOutputParser,
  parseRemoteListOutput
} from './colab-notebook-kernel'

describe('colab notebook kernel protocol', () => {
  it('splits stream text from image and error markers across chunk boundaries', () => {
    const outputs: ColabNotebookOutput[] = []
    const parser = createNotebookOutputParser((o) => outputs.push(o))
    parser.push('hello\n' + COLAB_NOTEBOOK_MARKER.slice(0, 3), 'stdout')
    parser.push(COLAB_NOTEBOOK_MARKER.slice(3) + 'IMG:QUJD\n', 'stdout')
    parser.push(COLAB_NOTEBOOK_MARKER + 'ERR:{"ename":"KeyError","evalue":"x","traceback":"tb"}\n', 'stdout')
    parser.push('warn', 'stderr')
    parser.flush()
    expect(outputs).toEqual([
      { type: 'stream', name: 'stdout', text: 'hello\n' },
      { type: 'image', mime: 'image/png', data: 'QUJD' },
      { type: 'error', ename: 'KeyError', evalue: 'x', traceback: 'tb' },
      { type: 'stream', name: 'stderr', text: 'warn' }
    ])
  })

  it('emits progress-bar partial lines immediately', () => {
    const outputs: ColabNotebookOutput[] = []
    const parser = createNotebookOutputParser((o) => outputs.push(o))
    parser.push('step 1\r', 'stdout')
    expect(outputs).toEqual([{ type: 'stream', name: 'stdout', text: 'step 1\r' }])
  })

  it('embeds user code as base64 so quotes and newlines cannot break the wrapper', () => {
    const source = 'print("a\'b")\n"""x"""'
    const py = buildNotebookCellPython(source)
    expect(py).toContain(Buffer.from(source, 'utf8').toString('base64'))
    expect(py).not.toContain(source)
    expect(buildRemoteListPython("/content/it's")).toContain(Buffer.from("/content/it's").toString('base64'))
  })

  it('parses remote listings and listing errors', () => {
    const entries = [{ name: 'a', path: '/content/a', isDir: true, size: 0 }]
    expect(parseRemoteListOutput(`noise\n${COLAB_NOTEBOOK_MARKER}LS:${JSON.stringify(entries)}\n`)).toEqual(entries)
    expect(parseRemoteListOutput(`${COLAB_NOTEBOOK_MARKER}LSERR:"No such file"`)).toEqual({ error: 'No such file' })
    expect(parseRemoteListOutput('nothing')).toBeNull()
  })

  it('extracts python and markdown cells from fenced or raw model outputs', () => {
    expect(extractNotebookAssistCell('```python\nimport torch\nprint(1)\n```')).toEqual({
      kind: 'code',
      source: 'import torch\nprint(1)'
    })
    expect(extractNotebookAssistCell('```markdown\n## Summary\nDone.\n```')).toEqual({
      kind: 'markdown',
      source: '## Summary\nDone.'
    })
    expect(extractNotebookAssistCell('x = 42')).toEqual({ kind: 'code', source: 'x = 42' })
    expect(extractNotebookAssistCell('   ')).toBeNull()
  })
})
