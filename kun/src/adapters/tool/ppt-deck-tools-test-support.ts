import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { ToolHostContext } from '../../ports/tool-host.js'
import type { LocalTool } from './local-tool-host.js'
import { buildPptDeckTools, type PptDeckToolOptions } from './ppt-deck-tools.js'

/** Fixtures shared by the slides-skill PPT tool tests. */

export const PPT_TOOLCHAIN = resolve(process.cwd(), '..', 'resources', 'ppt-toolchain')

const roots: string[] = []

export async function pptWorkspace(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix))
  roots.push(root)
  return root
}

export async function cleanupPptWorkspaces(): Promise<void> {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
}

export function pptToolContext(workspace: string, overrides: Partial<ToolHostContext> = {}): ToolHostContext {
  return {
    threadId: 'thr_slides',
    turnId: 'turn_slides',
    workspace,
    sandboxMode: 'workspace-write',
    approvalPolicy: 'never',
    abortSignal: new AbortController().signal,
    awaitApproval: async () => 'allow',
    ...overrides
  }
}

export function pptTool(name: string, options: PptDeckToolOptions = {}): LocalTool {
  const tool = buildPptDeckTools({ toolchainDirectory: () => PPT_TOOLCHAIN, ...options })
    .find((candidate) => candidate.name === name)
  if (!tool) throw new Error(`missing ${name}`)
  return tool
}

export type PptTestPage = { file: string; title: string; fontSize?: number; extra?: string[] }

/** Write a small PPTD deck: one title text per page plus optional raw element YAML. */
export async function writePptDeck(
  folder: string,
  pages: PptTestPage[],
  options: { title?: string; colors?: Record<string, string>; fonts?: [string, string] } = {}
): Promise<void> {
  await mkdir(join(folder, 'pages'), { recursive: true })
  const colors = options.colors ?? { primary: '#18202A', accent: '#C54A2C', muted: '#66717D', surface: '#F7F8FA' }
  const [display, body] = options.fonts ?? ['Inter', 'Source Serif 4']
  await writeFile(join(folder, 'deck.pptd'), [
    'version: v2',
    `title: ${options.title ?? 'Test deck'}`,
    'size: [960, 540]',
    'theme:',
    '  colors:',
    ...Object.entries(colors).map(([name, value]) => `    ${name}: "${value}"`),
    '  textStyles:',
    '    title:',
    `      fontFamily: ${display}`,
    '      fontSize: 40',
    '    body:',
    `      fontFamily: ${body}`,
    '      fontSize: 18',
    'pages:',
    ...pages.map((page) => `  - ${page.file}`),
    ''
  ].join('\n'))
  for (const page of pages) {
    await writeFile(join(folder, page.file), [
      'pageType: content',
      'background:',
      '  type: solid',
      '  color: "#F7F8FA"',
      'elements:',
      '  - elementId: title',
      '    elementType: text',
      '    bounds: [80, 120, 800, 240]',
      '    content:',
      `      fontSize: ${page.fontSize ?? 32}`,
      '      color: "#18202A"',
      '      wrap: false',
      '      align: [left, top]',
      `      text: "${page.title}"`,
      ...(page.extra ?? []),
      ''
    ].join('\n'))
  }
}
