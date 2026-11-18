import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceFileResolveResult } from '@shared/workspace-file'
import {
  findFileReferences,
  parseFileReferenceHref,
  rehypeFileReferences
} from './file-references'
import {
  clearFileReferenceValidationCache,
  fileReferenceValidationCacheSize,
  hasCachedFileReferenceValidation,
  MAX_FILE_REFERENCE_VALIDATION_CACHE_ENTRIES,
  validateFileReference
} from './file-reference-validation'

function installResolveWorkspaceFile(
  resolveWorkspaceFile = vi.fn(async ({ path }: { path: string; workspaceRoot?: string }): Promise<WorkspaceFileResolveResult> => ({
    ok: true,
    path: `/resolved/${path}`
  }))
): typeof resolveWorkspaceFile {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      kunGui: {
        resolveWorkspaceFile
      }
    }
  })
  return resolveWorkspaceFile
}

describe('file reference validation cache', () => {
  afterEach(() => {
    clearFileReferenceValidationCache()
    vi.restoreAllMocks()
    Reflect.deleteProperty(globalThis, 'window')
  })

  it('normalizes file references and reuses cached validations', async () => {
    const resolveWorkspaceFile = installResolveWorkspaceFile()

    await expect(validateFileReference({ path: ' src/main.ts ' }, ' /repo ')).resolves.toEqual({
      status: 'valid',
      path: '/resolved/src/main.ts'
    })
    await expect(validateFileReference({ path: 'src/main.ts' }, '/repo')).resolves.toEqual({
      status: 'valid',
      path: '/resolved/src/main.ts'
    })

    expect(resolveWorkspaceFile).toHaveBeenCalledTimes(1)
    expect(resolveWorkspaceFile).toHaveBeenCalledWith({
      path: 'src/main.ts',
      line: undefined,
      column: undefined,
      workspaceRoot: '/repo'
    })
  })

  it('caps cached file reference validations', async () => {
    installResolveWorkspaceFile()

    for (let index = 0; index < MAX_FILE_REFERENCE_VALIDATION_CACHE_ENTRIES + 5; index += 1) {
      await validateFileReference({ path: `file-${index}.ts` }, '/repo')
    }

    expect(fileReferenceValidationCacheSize()).toBe(MAX_FILE_REFERENCE_VALIDATION_CACHE_ENTRIES)
    expect(hasCachedFileReferenceValidation({ path: 'file-0.ts' }, '/repo')).toBe(false)
    expect(hasCachedFileReferenceValidation({ path: 'file-4.ts' }, '/repo')).toBe(false)
    expect(hasCachedFileReferenceValidation({ path: 'file-5.ts' }, '/repo')).toBe(true)
  })

  it('refreshes cached validations when they are reused', async () => {
    const resolveWorkspaceFile = installResolveWorkspaceFile()

    await validateFileReference({ path: 'file-0.ts' }, '/repo')
    for (let index = 1; index < MAX_FILE_REFERENCE_VALIDATION_CACHE_ENTRIES; index += 1) {
      await validateFileReference({ path: `file-${index}.ts` }, '/repo')
    }
    await validateFileReference({ path: 'file-0.ts' }, '/repo')
    await validateFileReference({ path: `file-${MAX_FILE_REFERENCE_VALIDATION_CACHE_ENTRIES}.ts` }, '/repo')

    expect(fileReferenceValidationCacheSize()).toBe(MAX_FILE_REFERENCE_VALIDATION_CACHE_ENTRIES)
    expect(resolveWorkspaceFile).toHaveBeenCalledTimes(MAX_FILE_REFERENCE_VALIDATION_CACHE_ENTRIES + 1)
    expect(hasCachedFileReferenceValidation({ path: 'file-1.ts' }, '/repo')).toBe(false)
    expect(hasCachedFileReferenceValidation({ path: 'file-0.ts' }, '/repo')).toBe(true)
  })

  it('safely treats references as invalid when the bridge is unavailable', async () => {
    Reflect.deleteProperty(globalThis, 'window')

    await expect(validateFileReference({ path: 'src/main.ts' }, '/repo')).resolves.toEqual({ status: 'invalid' })
    expect(fileReferenceValidationCacheSize()).toBe(1)
  })

  it('validates explicit local PNG paths outside the workspace while keeping workspace boundaries for other paths', async () => {
    const resolveWorkspaceFile = installResolveWorkspaceFile(
      vi.fn(async ({ path, workspaceRoot }: { path: string; workspaceRoot?: string }): Promise<WorkspaceFileResolveResult> => {
        if (workspaceRoot && !path.startsWith(workspaceRoot) && path.startsWith('/')) {
          return { ok: false, message: 'Path must stay within the selected workspace.' }
        }
        return { ok: true, path }
      })
    )

    await expect(validateFileReference({ path: '/tmp/colab-kun-sidebar.png' }, '/repo')).resolves.toEqual({
      status: 'valid',
      path: '/tmp/colab-kun-sidebar.png'
    })
    expect(resolveWorkspaceFile).toHaveBeenCalledWith({
      path: '/tmp/colab-kun-sidebar.png',
      line: undefined,
      column: undefined
    })

    await expect(validateFileReference({ path: '/tmp/outside.txt' }, '/repo')).resolves.toEqual({
      status: 'invalid'
    })
    expect(resolveWorkspaceFile).toHaveBeenLastCalledWith({
      path: '/tmp/outside.txt',
      line: undefined,
      column: undefined,
      workspaceRoot: '/repo'
    })
  })

  it('detects PNG file references and converts local file:// links for sidebar preview', () => {
    expect(findFileReferences('Saved screenshot to /tmp/colab-kun-sidebar.png.')).toEqual([
      {
        start: 20,
        end: 46,
        text: '/tmp/colab-kun-sidebar.png',
        target: { path: '/tmp/colab-kun-sidebar.png' }
      }
    ])

    const tree = {
      type: 'root',
      children: [
        {
          type: 'element',
          tagName: 'a',
          properties: { href: 'file:///tmp/colab-kun-sidebar.png' },
          children: [{ type: 'text', value: 'colab-kun-sidebar.png' }]
        }
      ]
    }
    rehypeFileReferences()(tree)
    const href = tree.children[0]?.properties?.href as string | undefined
    expect(parseFileReferenceHref(href)).toEqual({ path: '/tmp/colab-kun-sidebar.png' })
  })
})
