import { constants } from 'node:fs'
import { open, stat, type FileHandle } from 'node:fs/promises'
import { dirname } from 'node:path'
import { LocalToolHost } from './local-tool-host-core.js'
import type { LocalTool } from './local-tool-host-types.js'
import {
  applyEditsToNormalizedContent,
  detectLineEnding,
  firstChangedLine,
  generateDisplayDiff,
  generateUnifiedPatch,
  normalizeToLF,
  restoreLineEndings,
  stripBom
} from './edit-diff.js'
import { withFileMutationQueue } from './file-mutation-queue.js'
import type { EditLocalToolOptions, WriteLocalToolOptions } from './builtin-tool-types.js'
import type { ApprovedExternalWriteTarget, ToolHostContext } from '../../ports/tool-host.js'
import { defaultEditLocalToolOperations, defaultWriteLocalToolOperations } from './builtin-tool-operations.js'
import { parseEditInstructions, resolveWorkspacePath, withToolBoundary } from './builtin-tool-utils.js'
import { assertCanWritePath, assertDelegatedWritePathPhysicalScope } from './sandbox-policy.js'
import { resolvePathThroughSymlinks, sameFilesystemPath } from './workspace-path.js'
import { fileWriteChanged } from './file-write-evidence.js'

function approvedExternalTarget(
  absolutePath: string,
  context: Pick<ToolHostContext, 'approvedExternalWriteTargets'>
): ApprovedExternalWriteTarget | undefined {
  return context.approvedExternalWriteTargets?.find((target) =>
    sameFilesystemPath(target.path, absolutePath)
  )
}

async function openVerifiedExternalTarget(
  target: ApprovedExternalWriteTarget,
  access: 'write' | 'edit',
  openFile: (path: string, flags: number) => Promise<FileHandle> = open
): Promise<FileHandle> {
  const noFollow = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0
  const flags = (access === 'edit' ? constants.O_RDWR : constants.O_WRONLY) | noFollow
  const handle = await openFile(target.path, flags)
  try {
    const current = await handle.stat({ bigint: true })
    if (
      !current.isFile() ||
      current.ino === 0n ||
      current.dev !== target.device ||
      current.ino !== target.inode
    ) {
      throw new Error(`approved external file changed before execution: ${target.path}`)
    }
    if (current.nlink !== 1n) {
      throw new Error(`approved external file must have exactly one hard link: ${target.path}`)
    }
    const currentParent = await stat(dirname(target.path), { bigint: true })
    const currentPhysicalPath = await resolvePathThroughSymlinks(target.path)
    if (
      !currentParent.isDirectory() ||
      currentParent.ino === 0n ||
      currentParent.dev !== target.parentDevice ||
      currentParent.ino !== target.parentInode ||
      !sameFilesystemPath(currentPhysicalPath, target.path)
    ) {
      throw new Error(`approved external file parent changed before execution: ${target.path}`)
    }
    return handle
  } catch (error) {
    await handle.close().catch(() => undefined)
    throw error
  }
}

async function writeTextToHandle(
  handle: FileHandle,
  content: string,
  target: ApprovedExternalWriteTarget
): Promise<void> {
  const current = await handle.stat({ bigint: true })
  if (current.nlink !== 1n) {
    throw new Error(`approved external file must have exactly one hard link: ${target.path}`)
  }
  const buffer = Buffer.from(content, 'utf8')
  let offset = 0
  while (offset < buffer.length) {
    const { bytesWritten } = await handle.write(
      buffer,
      offset,
      buffer.length - offset,
      offset
    )
    if (bytesWritten <= 0) throw new Error('external file write made no progress')
    offset += bytesWritten
  }
  await handle.truncate(buffer.length)
}

/**
 * Arguments that failed JSON parsing arrive as `{ __raw: "<partial json>" }`
 * (tool-argument-repair fallback). The dominant cause is the model's output
 * limit truncating an oversized payload mid-string, so answer with guidance
 * the model can act on instead of a generic missing-field error.
 */
function truncatedArgumentsError(raw: unknown): { output: { error: string }; isError: true } | null {
  if (typeof raw !== 'string') return null
  return {
    output: {
      error:
        'tool arguments were not valid JSON — they were likely truncated by your output limit. ' +
        `Received ${raw.length} characters. Retry with a much smaller payload: ` +
        'write a short skeleton first, then extend the file with several small edit calls.'
    },
    isError: true
  }
}

export function createWriteLocalTool(_options: WriteLocalToolOptions = {}): LocalTool {
  const mkdirOp = _options.operations?.mkdir ?? defaultWriteLocalToolOperations.mkdir!
  const writeFileOp = _options.operations?.writeFile ?? defaultWriteLocalToolOperations.writeFile!
  const openExternalOp = _options.operations?.openExternal ?? open
  return LocalToolHost.defineTool({
    name: 'write',
    description: 'Create or overwrite a workspace file with the provided content.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        content: { type: 'string' }
      },
      required: ['path', 'content'],
      additionalProperties: false
    },
    policy: 'on-request',
    toolKind: 'file_change',
    externalWritePathArguments: ['path'],
    execute: async (args, context) => withToolBoundary(async () => {
      const truncated = truncatedArgumentsError(args.__raw)
      if (truncated) return truncated
      const rawPath = typeof args.path === 'string' ? args.path : ''
      const content = typeof args.content === 'string' ? args.content : null
      if (!rawPath.trim() || content == null) {
        return { output: { error: 'path and content are required' }, isError: true }
      }
      const { absolutePath, relativePath } = await resolveWorkspacePath(rawPath, context)
      assertCanWritePath(absolutePath, context)
      await assertDelegatedWritePathPhysicalScope(absolutePath, context)
      return withFileMutationQueue(absolutePath, async () => {
        const externalTarget = approvedExternalTarget(absolutePath, context)
        const changed = externalTarget ? undefined : await fileWriteChanged(absolutePath, content, context)
        if (externalTarget) {
          const handle = await openVerifiedExternalTarget(externalTarget, 'write', openExternalOp)
          try {
            await writeTextToHandle(handle, content, externalTarget)
          } finally {
            await handle.close()
          }
        } else {
          await assertDelegatedWritePathPhysicalScope(absolutePath, context)
          await mkdirOp(dirname(absolutePath))
          await assertDelegatedWritePathPhysicalScope(absolutePath, context)
          await writeFileOp(absolutePath, content)
        }
        return {
          output: {
            path: absolutePath,
            relative_path: relativePath,
            ...(changed === undefined ? {} : { changed }),
            bytes_written: Buffer.byteLength(content, 'utf8')
          }
        }
      })
    })
  })
}

export const createWriteTool = createWriteLocalTool
export const createWriteToolDefinition = createWriteLocalTool

export function createEditLocalTool(_options: EditLocalToolOptions = {}): LocalTool {
  const readFileOp = _options.operations?.readFile ?? defaultEditLocalToolOperations.readFile!
  const writeFileOp = _options.operations?.writeFile ?? defaultEditLocalToolOperations.writeFile!
  const openExternalOp = _options.operations?.openExternal ?? open
  return LocalToolHost.defineTool({
    name: 'edit',
    description: 'Edit a workspace file using exact text replacement. Supports multiple disjoint edits in one call.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        oldText: { type: 'string' },
        newText: { type: 'string' },
        edits: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              oldText: { type: 'string' },
              newText: { type: 'string' }
            },
            required: ['oldText', 'newText'],
            additionalProperties: false
          }
        }
      },
      required: ['path'],
      additionalProperties: false
    },
    policy: 'on-request',
    toolKind: 'file_change',
    externalWritePathArguments: ['path'],
    execute: async (args, context) => withToolBoundary(async () => {
      const truncated = truncatedArgumentsError(args.__raw)
      if (truncated) return truncated
      const rawPath = typeof args.path === 'string' ? args.path : ''
      const edits = parseEditInstructions(args)
      if (!rawPath.trim() || edits.length === 0) {
        return { output: { error: 'path and at least one edit are required' }, isError: true }
      }
      const { absolutePath, relativePath } = await resolveWorkspacePath(rawPath, context)
      assertCanWritePath(absolutePath, context)
      await assertDelegatedWritePathPhysicalScope(absolutePath, context)
      return withFileMutationQueue(absolutePath, async () => {
        const externalTarget = approvedExternalTarget(absolutePath, context)
        const handle = externalTarget
          ? await openVerifiedExternalTarget(externalTarget, 'edit', openExternalOp)
          : undefined
        try {
          if (!externalTarget) await assertDelegatedWritePathPhysicalScope(absolutePath, context)
          const rawSource = handle
            ? await handle.readFile({ encoding: 'utf8' })
            : await readFileOp(absolutePath)
          const { bom, text: source } = stripBom(rawSource)
          const lineEnding = detectLineEnding(source)
          const normalizedSource = normalizeToLF(source)
          const { baseContent, newContent } = applyEditsToNormalizedContent(normalizedSource, edits, relativePath)
          const next = bom + restoreLineEndings(newContent, lineEnding)
          if (handle) {
            if (!externalTarget) throw new Error('external edit handle is missing its approved target')
            await writeTextToHandle(handle, next, externalTarget)
          } else {
            await assertDelegatedWritePathPhysicalScope(absolutePath, context)
            await writeFileOp(absolutePath, next)
          }
          const diff = generateDisplayDiff(baseContent, newContent)
          const patch = generateUnifiedPatch(relativePath, baseContent, newContent)
          return {
            output: {
              path: absolutePath,
              relative_path: relativePath,
              replacements: edits.length,
              bytes_written: Buffer.byteLength(next, 'utf8'),
              diff,
              patch,
              first_changed_line: firstChangedLine(baseContent, newContent)
            }
          }
        } finally {
          await handle?.close()
        }
      })
    })
  })
}

export const createEditTool = createEditLocalTool
export const createEditToolDefinition = createEditLocalTool
