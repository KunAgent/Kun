import { realpath, stat } from 'node:fs/promises'
import { basename, isAbsolute, relative, resolve, sep } from 'node:path'
import type { LocalTool } from './local-tool-host.js'
import { withToolBoundary, workspaceRoot } from './builtin-tool-utils.js'

export const MAX_IM_ATTACHMENT_BYTES = 50 * 1024 * 1024
const MAX_IM_ATTACHMENTS = 3

function rawPaths(args: Record<string, unknown>): string[] {
  if (Array.isArray(args.paths)) {
    return args.paths.filter((entry): entry is string => typeof entry === 'string')
  }
  return typeof args.path === 'string' ? [args.path] : []
}

function fileNameFor(args: Record<string, unknown>, index: number, fallback: string): string {
  if (typeof args.fileName === 'string' && index === 0 && args.fileName.trim()) {
    return args.fileName.trim()
  }
  if (Array.isArray(args.fileNames)) {
    const value = args.fileNames[index]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return fallback
}

export async function resolveImAttachmentPath(
  inputPath: string,
  contextWorkspace: string
): Promise<{
  absolutePath: string
  relativePath: string
  fileName: string
  bytes: number
}> {
  const root = workspaceRoot(contextWorkspace)
  const lexicalPath = isAbsolute(inputPath) ? resolve(inputPath) : resolve(root, inputPath)
  const [realRoot, realFile] = await Promise.all([
    realpath(root),
    realpath(lexicalPath)
  ])
  const nativeRelativePath = relative(realRoot, realFile)
  if (nativeRelativePath === '..' || nativeRelativePath.startsWith(`..${sep}`) || isAbsolute(nativeRelativePath)) {
    throw new Error(`path escapes the workspace root: ${inputPath}`)
  }
  const fileStat = await stat(realFile)
  if (!fileStat.isFile()) {
    throw new Error(`attachment path is not a file: ${inputPath}`)
  }
  if (fileStat.size > MAX_IM_ATTACHMENT_BYTES) {
    throw new Error(`attachment file is too large: ${inputPath}`)
  }
  return {
    absolutePath: realFile,
    relativePath: nativeRelativePath.replaceAll(sep, '/'),
    fileName: basename(realFile),
    bytes: fileStat.size
  }
}

export function createSendImAttachmentLocalTool(): LocalTool {
  return {
    name: 'send_im_attachment',
    description:
      'Queue one or more existing workspace files to be sent back to the active IM chat as attachments. Use only when the user asks to receive a file, image, audio, video, or document through IM.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Single workspace-relative or absolute path to send.'
        },
        paths: {
          type: 'array',
          items: { type: 'string' },
          maxItems: MAX_IM_ATTACHMENTS,
          description: 'Multiple workspace-relative or absolute paths to send.'
        },
        fileName: {
          type: 'string',
          description: 'Optional display file name for a single attachment.'
        },
        fileNames: {
          type: 'array',
          items: { type: 'string' },
          maxItems: MAX_IM_ATTACHMENTS,
          description: 'Optional display file names matching paths.'
        },
        message: {
          type: 'string',
          description: 'Optional short text to include in the final reply.'
        }
      },
      additionalProperties: false
    },
    // This result is consumed by the IM bridge and uploads workspace bytes to
    // an external chat. It must never be silently allowed by a thread's
    // general auto policy.
    policy: 'on-request',
    // The tool reads an already-authorized workspace file and returns a
    // delivery descriptor to the IM bridge; it does not spawn a host process.
    // Its external effect is governed by requiresExplicitApproval.
    toolKind: 'tool_call',
    effects: {
      network: true,
      externalWrite: false,
      processExecution: false,
      guiAutomation: false
    },
    requiresExplicitApproval: true,
    execute: async (args, context) => withToolBoundary(async () => {
      if (context.imContext !== true) {
        return {
          output: { error: 'send_im_attachment is only available for IM turns' },
          isError: true
        }
      }
      const paths = rawPaths(args).map((entry) => entry.trim()).filter(Boolean)
      if (paths.length === 0) {
        return { output: { error: 'path or paths is required' }, isError: true }
      }
      if (paths.length > MAX_IM_ATTACHMENTS) {
        return {
          output: { error: `at most ${MAX_IM_ATTACHMENTS} attachments can be sent at once` },
          isError: true
        }
      }
      const files = []
      const seen = new Set<string>()
      for (let index = 0; index < paths.length; index += 1) {
        const inputPath = paths[index]
        if (!inputPath) continue
        const resolved = await resolveImAttachmentPath(inputPath, context.workspace)
        if (seen.has(resolved.absolutePath)) continue
        seen.add(resolved.absolutePath)
        files.push({
          path: resolved.absolutePath,
          absolutePath: resolved.absolutePath,
          relativePath: resolved.relativePath,
          fileName: fileNameFor(args, index, resolved.fileName),
          bytes: resolved.bytes
        })
      }
      return {
        output: {
          files,
          message: typeof args.message === 'string' ? args.message.trim() : '',
          status: 'queued_for_im_attachment_delivery'
        }
      }
    })
  }
}
