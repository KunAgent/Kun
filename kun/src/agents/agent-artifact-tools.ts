import { roomAxToolDescription } from '../rooms/room-ax-surfaces.js'
import { z } from 'zod'
import type { ThreadStore } from '../ports/thread-store.js'
import { LocalToolHost } from '../adapters/tool/local-tool-host.js'
import { AgentArtifactQuery, AgentArtifactVersionQuery } from '../contracts/agent-artifacts.js'
import { advertiseWorkbenchTool, workbenchFail, workbenchToolMeta, workbenchToolScope } from '../workbench-bridge/tool-scope.js'
import { agentArtifactLibraryBinding } from './agent-artifact-library.js'

export { AGENT_ARTIFACT_TOOLS } from '../contracts/agent-work-tools.js'
const Id = z.string().min(1).max(256)
const Read = z.object({ id: Id, version: z.number().int().positive().optional(),
  offset: z.number().int().nonnegative().default(0), length: z.number().int().min(1).max(64000).default(12000) }).strict()
const Versions = AgentArtifactVersionQuery.extend({ id: Id }).strict()
export function agentArtifactTools(threads: ThreadStore) {
  return [
    { name: 'list_agent_artifacts', schema: AgentArtifactQuery,
      description: roomAxToolDescription('list_agent_artifacts') },
    { name: 'list_agent_artifact_versions', schema: Versions, description: roomAxToolDescription('list_agent_artifact_versions') },
    { name: 'read_agent_artifact', schema: Read,
      description: roomAxToolDescription('read_agent_artifact') }
  ].map(({ name, schema, description }) => LocalToolHost.defineTool({ ...workbenchToolMeta, name, description,
    shouldAdvertise: advertiseWorkbenchTool, inputSchema: z.toJSONSchema(schema) as Record<string, unknown>,
    execute: async (args, context) => {
      try {
        const library = agentArtifactLibraryBinding(threads)
        if (!library) throw new Error('artifact library unavailable')
        const scope = await workbenchToolScope(threads, context)
        if (name === 'list_agent_artifacts') return { output: await library.list(scope.agent.agentId, args) }
        if (name === 'list_agent_artifact_versions') {
          const { id, ...page } = Versions.parse(args)
          return { output: await library.versions(scope.agent.agentId, id, page) }
        }
        const input = Read.parse(args)
        const { meta, data } = await library.read(scope.agent.agentId, input.id, input.version)
        if (data.subarray(0, 64000).includes(0) || !/^(text\/|application\/(json|xml))/.test(meta.mimeType)) {
          return { output: { ...meta, binary: true } }
        }
        const text = data.toString('utf8')
        return { output: { ...meta, text: text.slice(input.offset, input.offset + input.length),
          ...(input.offset + input.length < text.length ? { nextOffset: input.offset + input.length } : {}) } }
      } catch (error) { return workbenchFail(error) }
    }
  }))
}
