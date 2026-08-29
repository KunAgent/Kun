import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import enCommon from './en/common'
import enSettings from './en/settings'

const RENDERER_ROOT = resolve(import.meta.dirname, '..')
const REPOSITORY_ROOT = resolve(RENDERER_ROOT, '../../..')
const REGISTERED_NAMESPACES = new Set(['common', 'settings'])

type LocaleTree = Record<string, unknown>

function flattenKeys(tree: LocaleTree, prefix = '', keys = new Set<string>()): Set<string> {
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (typeof value === 'string') keys.add(path)
    else if (value && typeof value === 'object' && !Array.isArray(value)) {
      flattenKeys(value as LocaleTree, path, keys)
    }
  }
  return keys
}

const STRICT_RESOURCE_FILES = new Set([
  'src/renderer/src/components/workbench/WorkbenchChatStage.tsx',
  'src/renderer/src/components/chat/BackgroundShellOverlay.tsx',
  'src/renderer/src/components/chat/FloatingComposerAgentPicker.tsx',
  'src/renderer/src/components/chat/StreamdownCode.tsx',
  'src/renderer/src/components/DiffView.tsx',
  'src/renderer/src/components/WorkspaceDocxPreview.tsx',
  'src/renderer/src/components/WorkspaceOfficePreviewToolbar.tsx',
  'src/renderer/src/components/WorkspacePptxPreview.tsx',
  'src/renderer/src/components/WorkspacePptxThumbnailRail.tsx',
  'src/renderer/src/components/WorkspaceSpreadsheetPreview.tsx',
  'src/renderer/src/components/design/canvas/CanvasMotionKeyframeInspector.tsx',
  'src/renderer/src/components/design/canvas/SvgFrameOverlay.tsx',
  'src/renderer/src/extensions/ControlledContributionSurfaces.tsx'
])

const resourceKeys = {
  common: flattenKeys(enCommon as LocaleTree),
  settings: flattenKeys(enSettings as LocaleTree)
}

function productionRendererFiles(): string[] {
  return execFileSync('git', ['ls-files', 'src/renderer/src/**/*.ts', 'src/renderer/src/**/*.tsx'], {
    cwd: REPOSITORY_ROOT,
    encoding: 'utf8'
  })
    .trim()
    .split('\n')
    .filter(Boolean)
    .filter((file) => !file.includes('.test.') && !file.includes('/testing/'))
}

function stringLiteral(node: ts.Node | undefined): string | null {
  return node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    ? node.text
    : null
}

function lineOf(source: ts.SourceFile, node: ts.Node): number {
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1
}

function inspectFile(file: string): string[] {
  const absolute = resolve(REPOSITORY_ROOT, file)
  const source = ts.createSourceFile(
    file,
    readFileSync(absolute, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  )
  const findings: string[] = []
  const report = (node: ts.Node, message: string): void => {
    findings.push(`${file}:${lineOf(source, node)} ${message}`)
  }

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const expression = node.expression
      if (ts.isIdentifier(expression) && expression.text === 'useTranslation') {
        const argument = node.arguments[0]
        const values = argument && ts.isArrayLiteralExpression(argument)
          ? argument.elements.map(stringLiteral).filter((value): value is string => value !== null)
          : [stringLiteral(argument)].filter((value): value is string => value !== null)
        for (const namespace of values) {
          if (!REGISTERED_NAMESPACES.has(namespace)) {
            report(node, `uses unregistered i18n namespace "${namespace}"`)
          }
        }
      }

      const isTranslationCall =
        (ts.isIdentifier(expression) && expression.text === 't') ||
        (ts.isPropertyAccessExpression(expression) && expression.name.text === 't')
      if (isTranslationCall) {
        const rawKey = stringLiteral(node.arguments[0])
        if (rawKey) {
          const separator = rawKey.indexOf(':')
          const explicitNamespace = separator > 0 ? rawKey.slice(0, separator) : null
          const key = explicitNamespace ? rawKey.slice(separator + 1) : rawKey
          if (explicitNamespace && !REGISTERED_NAMESPACES.has(explicitNamespace)) {
            report(node, `uses unregistered i18n namespace "${explicitNamespace}"`)
          } else {
            const namespace = explicitNamespace ?? 'common'
            if (
              STRICT_RESOURCE_FILES.has(file) &&
              !resourceKeys[namespace as keyof typeof resourceKeys].has(key)
            ) {
              report(node, `uses missing English resource "${namespace}:${key}"`)
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return findings
}

describe('renderer i18n usage contract', () => {
  it('uses only registered namespaces and validates migrated English resources', () => {
    const findings = productionRendererFiles().flatMap(inspectFile)
    expect(findings).toEqual([])
  })
})
