import type { DelegationRuntime } from '../../delegation/delegation-runtime.js'
import { LocalToolHost } from './local-tool-host.js'
import type { AgentRosterLaneStatus } from '../../contracts/agent-roster.js'
import { rosterFactTags } from '../../delegation/agent-roster-lanes.js'

const DEFAULT_PROFILE_PAGE_LIMIT = 50
const MAX_PROFILE_PAGE_LIMIT = 50
const MAX_PROFILE_NAME_LENGTH = 256
const MAX_PROFILE_DESCRIPTION_LENGTH = 1_000

/** Read-only listing of the effective reusable profiles (or the custom-agent capability). */
export function buildListSubagentProfilesTool(
  runtime: DelegationRuntime,
  useExistingAgents: boolean
) {
  return LocalToolHost.defineTool({
    name: 'list_subagent_profiles',
    description: buildListSubagentProfilesDescription(runtime),
    inputSchema: {
      type: 'object',
      properties: {
        offset: {
          type: 'integer',
          minimum: 0,
          description: 'Zero-based reusable-profile offset.'
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: MAX_PROFILE_PAGE_LIMIT,
          description: `Reusable profiles to return, from 1 to ${MAX_PROFILE_PAGE_LIMIT}.`
        }
      },
      additionalProperties: false
    },
    policy: 'auto',
    sideEffect: 'read-only',
    execute: async (args, context) => {
      const offset = nonnegativeInteger(args.offset, 0)
      const limit = boundedPositiveInteger(
        args.limit,
        DEFAULT_PROFILE_PAGE_LIMIT,
        MAX_PROFILE_PAGE_LIMIT
      )
      const agentSurface = context.agentSurface ?? 'code'
      const listings = useExistingAgents
        ? await profileListings(runtime, context.workspace, agentSurface)
        : []
      const page = listings.slice(offset, offset + limit)
      const nextOffset = offset + page.length < listings.length
        ? offset + page.length
        : null
      return {
        output: {
          mode: useExistingAgents ? 'profiles-only' : 'custom-only',
          surface: agentSurface,
          ...(!useExistingAgents ? { customAgent: customAgentCapability() } : {}),
          profileCount: listings.length,
          offset,
          limit,
          nextOffset,
          profiles: page,
          guidance: useExistingAgents
            ? 'Pass an exact id as delegate_task.profile, worker_create.profile, or a Graph task profile; omit it for automatic routing. ' +
              'engine names who runs the role; lanes say where it can run now (ok, unchecked, or the reason it cannot).'
            : 'Reusable profiles are disabled. Define a one-run role with delegate_task.custom_agent.'
        }
      }
    }
  })
}

function customAgentCapability(): Record<string, unknown> {
  return {
    id: 'custom',
    name: 'Custom Subagent',
    description: 'Define a focused one-run child role directly in delegate_task.custom_agent when no reusable profile is the right fit.',
    argument: 'custom_agent',
    lifetime: 'one-run',
    requiredFields: ['name', 'description', 'system_prompt'],
    optionalFields: ['tool_policy', 'blocked_tools'],
    toolPolicyOptions: [
      {
        value: 'readOnly',
        description: 'Restrict the child to host-approved read-only investigation tools.'
      },
      {
        value: 'inherit',
        description: 'Allow only the subset of parent-authorized tools that remains inside the child security boundary.'
      }
    ],
    hostControlled: [
      'model',
      'provider',
      'reasoning',
      'approval',
      'sandbox',
      'concurrency',
      'budget',
      'timeout'
    ]
  }
}

function buildListSubagentProfilesDescription(runtime: DelegationRuntime): string {
  return runtime.useExistingAgents !== false
    ? 'List the effective reusable subagent profiles for the current workspace and product surface.'
    : 'Describe the one-run custom subagent capability available while reusable profiles are disabled.'
}

function nonnegativeInteger(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(0, Math.floor(value))
}

function boundedPositiveInteger(value: unknown, fallback: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(1, Math.floor(value)))
}

function boundedText(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`
}

type ProfileListing = Record<string, unknown> & { id: string }

/** Roster entries a delegation can target, shaped for the model; falls back to the plain catalog. */
async function profileListings(
  runtime: DelegationRuntime,
  workspace: string,
  surface: 'code' | 'write' | 'design'
): Promise<ProfileListing[]> {
  const roster = runtime.roster
  if (!roster) {
    return (await runtime.listRoutingProfiles(workspace, surface)).map((document) => ({
      ...baseListing(document.id, document.profile.name, document.profile.description, document.profile.toolPolicy)
    }))
  }
  return (await roster.list({ workspace, surface }))
    .filter((entry) => entry.mode !== 'primary')
    .map((entry) => ({
      ...baseListing(entry.id, entry.name, entry.description, entry.toolPolicy),
      ...(entry.owns ? { owns: entry.owns } : {}),
      engine: entry.engine.kind === 'bound'
        ? `${entry.engine.harnessId}${entry.engine.model ? ` · ${entry.engine.model}` : ''}`
        : 'inherits main route',
      tags: rosterFactTags(entry.facts),
      lanes: {
        delegate: laneText(entry.lanes.delegate),
        worker: laneText(entry.lanes.worker),
        graph: laneText(entry.lanes.graph)
      },
      ...(entry.source === 'learned' ? { source: 'learned' } : {})
    }))
}

function baseListing(
  id: string,
  name: string | undefined,
  description: string | undefined,
  toolPolicy: 'readOnly' | 'inherit'
): ProfileListing {
  return {
    id,
    name: boundedText(name || id, MAX_PROFILE_NAME_LENGTH),
    description: boundedText(description || 'No description provided.', MAX_PROFILE_DESCRIPTION_LENGTH),
    toolPolicy,
    access: toolPolicy === 'readOnly'
      ? 'Read-only investigation; cannot modify the workspace.'
      : 'May use only tools allowed by the parent capability and approval boundary.'
  }
}

function laneText(status: AgentRosterLaneStatus): string {
  return status.state === 'blocked' ? `${status.code}: ${status.message}` : status.state
}
