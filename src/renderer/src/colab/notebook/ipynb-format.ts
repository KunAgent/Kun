import type { ColabNotebookOutput } from '@shared/colab/colab-notebook-types'

export type NotebookCellKind = 'code' | 'markdown'

export type NotebookCell = {
  id: string
  kind: NotebookCellKind
  source: string
  outputs: ColabNotebookOutput[]
  executionCount: number | null
}

type IpynbOutput = {
  output_type: string
  name?: string
  text?: string | string[]
  data?: Record<string, string | string[]>
  ename?: string
  evalue?: string
  traceback?: string[]
}

type IpynbCell = {
  cell_type: string
  source?: string | string[]
  outputs?: IpynbOutput[]
  execution_count?: number | null
}

let cellSeq = 0
export function newCellId(): string {
  cellSeq += 1
  return `cell-${Date.now().toString(36)}-${cellSeq}`
}

export function createCell(kind: NotebookCellKind, source = ''): NotebookCell {
  return { id: newCellId(), kind, source, outputs: [], executionCount: null }
}

const joinText = (value: string | string[] | undefined): string =>
  Array.isArray(value) ? value.join('') : (value ?? '')

/** nbformat stores multi-line strings as arrays of lines that keep their "\n". */
const splitLines = (text: string): string[] => {
  if (!text) return []
  const lines = text.split('\n')
  return lines.map((line, index) => (index < lines.length - 1 ? line + '\n' : line)).filter((line) => line !== '')
}

// Terminal colour codes in tracebacks are noise in a plain-text view.
// eslint-disable-next-line no-control-regex
const stripAnsi = (text: string): string => text.replace(/\u001b\[[0-9;]*m/g, '')

function parseOutput(raw: IpynbOutput): ColabNotebookOutput | null {
  if (raw.output_type === 'stream') {
    return { type: 'stream', name: raw.name === 'stderr' ? 'stderr' : 'stdout', text: joinText(raw.text) }
  }
  if (raw.output_type === 'error') {
    return {
      type: 'error',
      ename: raw.ename ?? 'Error',
      evalue: raw.evalue ?? '',
      traceback: stripAnsi((raw.traceback ?? []).join('\n'))
    }
  }
  if (raw.output_type === 'execute_result' || raw.output_type === 'display_data') {
    const png = raw.data?.['image/png']
    if (png) return { type: 'image', mime: 'image/png', data: joinText(png).replace(/\s+/g, '') }
    const text = raw.data?.['text/plain']
    if (text) return { type: 'stream', name: 'stdout', text: joinText(text) }
  }
  return null
}

export function parseIpynb(content: string): NotebookCell[] {
  const parsed = JSON.parse(content) as { cells?: IpynbCell[] }
  if (!parsed || !Array.isArray(parsed.cells)) throw new Error('Not a Jupyter notebook')
  return parsed.cells
    .filter((cell) => cell.cell_type === 'code' || cell.cell_type === 'markdown' || cell.cell_type === 'raw')
    .map((cell) => ({
      id: newCellId(),
      kind: cell.cell_type === 'code' ? 'code' : 'markdown',
      source: joinText(cell.source),
      outputs: (cell.outputs ?? []).map(parseOutput).filter((o): o is ColabNotebookOutput => o !== null),
      executionCount: typeof cell.execution_count === 'number' ? cell.execution_count : null
    }))
}

function serializeOutput(output: ColabNotebookOutput): IpynbOutput {
  if (output.type === 'stream') return { output_type: 'stream', name: output.name, text: splitLines(output.text) }
  if (output.type === 'image') return { output_type: 'display_data', data: { 'image/png': output.data } }
  return { output_type: 'error', ename: output.ename, evalue: output.evalue, traceback: output.traceback.split('\n') }
}

export function serializeIpynb(cells: NotebookCell[], accelerator?: string): string {
  const notebook = {
    cells: cells.map((cell) =>
      cell.kind === 'code'
        ? {
            cell_type: 'code',
            execution_count: cell.executionCount,
            metadata: {},
            outputs: cell.outputs.map(serializeOutput),
            source: splitLines(cell.source)
          }
        : { cell_type: 'markdown', metadata: {}, source: splitLines(cell.source) }
    ),
    metadata: {
      accelerator: accelerator && accelerator !== 'CPU' ? 'GPU' : undefined,
      colab: { provenance: [] },
      kernelspec: { display_name: 'Python 3', name: 'python3' },
      language_info: { name: 'python' }
    },
    nbformat: 4,
    nbformat_minor: 0
  }
  return JSON.stringify(notebook, null, 1) + '\n'
}

/** Applies carriage-return overwrites the way a terminal renders progress bars. */
export function renderStreamText(text: string): string {
  return text
    .split('\n')
    .map((line) => {
      const trimmed = line.endsWith('\r') ? line.slice(0, -1) : line
      const index = trimmed.lastIndexOf('\r')
      return index >= 0 ? trimmed.slice(index + 1) : trimmed
    })
    .join('\n')
}

/** Appends an output, merging consecutive chunks of the same stream. */
export function appendOutput(outputs: ColabNotebookOutput[], next: ColabNotebookOutput): ColabNotebookOutput[] {
  const last = outputs[outputs.length - 1]
  if (next.type === 'stream' && last?.type === 'stream' && last.name === next.name) {
    return [...outputs.slice(0, -1), { ...last, text: last.text + next.text }]
  }
  return [...outputs, next]
}

export const DEFAULT_NOTEBOOK_CELLS = (): NotebookCell[] => [
  createCell('markdown', '# Untitled notebook'),
  createCell('code', 'import torch\nprint(torch.cuda.is_available())')
]
