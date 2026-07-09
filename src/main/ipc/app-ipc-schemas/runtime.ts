import { z } from 'zod'
import {
  KUN_APPROVAL_TEMPLATE,
  KUN_ATTACHMENT_CONTENT_TEMPLATE,
  KUN_ATTACHMENT_DIAGNOSTICS_TEMPLATE,
  KUN_ATTACHMENTS_TEMPLATE,
  KUN_ATTACHMENT_TEMPLATE,
  KUN_HEALTH_TEMPLATE,
  KUN_MEMORY_DIAGNOSTICS_TEMPLATE,
  KUN_MEMORY_RECORD_TEMPLATE,
  KUN_MEMORY_TEMPLATE,
  KUN_MCP_OAUTH_SERVER_TEMPLATE,
  KUN_MCP_OAUTH_TEMPLATE,
  KUN_RUNTIME_INFO_TEMPLATE,
  KUN_RUNTIME_TOOLS_TEMPLATE,
  KUN_SUPPLY_CHAIN_AUDIT_TEMPLATE,
  KUN_SUPPLY_CHAIN_UPDATE_CHECK_TEMPLATE,
  KUN_SESSION_RESUME_TEMPLATE,
  KUN_SKILLS_TEMPLATE,
  KUN_THREADS_TEMPLATE,
  KUN_THREAD_COMPACT_TEMPLATE,
  KUN_THREAD_FORK_TEMPLATE,
  KUN_THREAD_GOAL_TEMPLATE,
  KUN_THREAD_REVIEW_TEMPLATE,
  KUN_THREAD_REWIND_TEMPLATE,
  KUN_THREAD_TODOS_TEMPLATE,
  KUN_THREAD_TURNS_TEMPLATE,
  KUN_THREAD_INTERRUPT_TEMPLATE,
  KUN_THREAD_STEER_TEMPLATE,
  KUN_THREAD_TEMPLATE,
  KUN_USER_INPUT_TEMPLATE,
  KUN_USAGE_TEMPLATE,
  KUN_DEBUG_LLM_ROUNDS_TEMPLATE,
  KUN_BACKGROUND_SHELLS_TEMPLATE,
  KUN_BACKGROUND_SHELL_TEMPLATE
} from '../../../shared/kun-endpoints'
import { MODEL_ENDPOINT_FORMATS } from '../../../shared/app-settings'
import { MAX_BODY_BYTES, MAX_URL_LENGTH, trimmedString } from './common'
export const providerProbePayloadSchema = z
  .object({
    baseUrl: trimmedString(MAX_URL_LENGTH),
    apiKey: z.string().max(8_192),
    endpointFormat: z.enum(MODEL_ENDPOINT_FORMATS)
  })
  .strict()

export const promptOptimizationPayloadSchema = z
  .object({
    text: trimmedString(100_000)
  })
  .strict()

interface EndpointTemplate {
  /** Compiled path matcher. */
  match(path: string): boolean
  allowedMethods: readonly string[]
}

function compileEndpoint(
  template: string,
  allowedMethods: readonly string[]
): EndpointTemplate {
  // Build a regex from the template by escaping the literal parts and
  // substituting the `{id}` / `{turn}` placeholders with `[^/]+`. The
  // template fragments are URL-encoded by the path helpers, so they
  // contain only characters that are safe to escape directly.
  const pattern = template.replace(/[.+*?^$()|[\]\\]/g, '\\$&').replace(/\{(?:id|turn)\}/g, '[^/]+')
  const regex = new RegExp(`^${pattern}$`)
  return {
    match: (path: string) => regex.test(path),
    allowedMethods
  }
}

const ENDPOINTS: readonly EndpointTemplate[] = [
  compileEndpoint(KUN_HEALTH_TEMPLATE, ['GET']),
  compileEndpoint(KUN_RUNTIME_INFO_TEMPLATE, ['GET']),
  compileEndpoint(KUN_RUNTIME_TOOLS_TEMPLATE, ['GET']),
  compileEndpoint(KUN_SUPPLY_CHAIN_AUDIT_TEMPLATE, ['POST']),
  compileEndpoint(KUN_SUPPLY_CHAIN_UPDATE_CHECK_TEMPLATE, ['POST']),
  compileEndpoint(KUN_SKILLS_TEMPLATE, ['GET']),
  compileEndpoint(KUN_ATTACHMENTS_TEMPLATE, ['POST']),
  compileEndpoint(KUN_ATTACHMENT_DIAGNOSTICS_TEMPLATE, ['GET']),
  compileEndpoint(KUN_ATTACHMENT_TEMPLATE, ['GET']),
  compileEndpoint(KUN_ATTACHMENT_CONTENT_TEMPLATE, ['GET']),
  compileEndpoint(KUN_MEMORY_TEMPLATE, ['GET', 'POST']),
  compileEndpoint(KUN_MEMORY_DIAGNOSTICS_TEMPLATE, ['GET']),
  compileEndpoint(KUN_MEMORY_RECORD_TEMPLATE, ['PATCH', 'DELETE']),
  compileEndpoint(KUN_MCP_OAUTH_TEMPLATE, ['GET', 'DELETE']),
  compileEndpoint(KUN_MCP_OAUTH_SERVER_TEMPLATE, ['DELETE']),
  compileEndpoint(KUN_THREADS_TEMPLATE, ['GET', 'POST']),
  compileEndpoint(KUN_THREAD_TEMPLATE, ['GET', 'PATCH', 'DELETE']),
  compileEndpoint(KUN_THREAD_FORK_TEMPLATE, ['POST']),
  compileEndpoint(KUN_THREAD_GOAL_TEMPLATE, ['GET', 'POST', 'DELETE']),
  compileEndpoint(KUN_THREAD_TODOS_TEMPLATE, ['GET', 'POST', 'DELETE']),
  compileEndpoint(KUN_THREAD_COMPACT_TEMPLATE, ['POST']),
  compileEndpoint(KUN_THREAD_REVIEW_TEMPLATE, ['POST']),
  compileEndpoint(KUN_THREAD_REWIND_TEMPLATE, ['POST']),
  compileEndpoint(KUN_THREAD_TURNS_TEMPLATE, ['POST']),
  compileEndpoint(KUN_THREAD_STEER_TEMPLATE, ['POST']),
  compileEndpoint(KUN_THREAD_INTERRUPT_TEMPLATE, ['POST']),
  compileEndpoint(KUN_APPROVAL_TEMPLATE, ['POST']),
  compileEndpoint(KUN_USER_INPUT_TEMPLATE, ['POST']),
  compileEndpoint(KUN_SESSION_RESUME_TEMPLATE, ['POST']),
  compileEndpoint(KUN_USAGE_TEMPLATE, ['GET']),
  compileEndpoint(KUN_DEBUG_LLM_ROUNDS_TEMPLATE, ['GET']),
  compileEndpoint(KUN_BACKGROUND_SHELLS_TEMPLATE, ['GET']),
  compileEndpoint(KUN_BACKGROUND_SHELL_TEMPLATE, ['GET']),
  compileEndpoint(`${KUN_BACKGROUND_SHELL_TEMPLATE}/stop`, ['POST'])
]

function isAllowedRuntimeRequest(value: { path: string; method?: string }): boolean {
  try {
    const url = new URL(value.path, 'http://localhost')
    const path = url.pathname
    const method = value.method ?? 'GET'
    for (const endpoint of ENDPOINTS) {
      if (endpoint.match(path)) {
        return endpoint.allowedMethods.includes(method)
      }
    }
    return false
  } catch {
    return false
  }
}

export const runtimeRequestPayloadSchema = z
  .object({
    path: trimmedString(MAX_URL_LENGTH).transform((value) =>
      value.startsWith('/') ? value : `/${value}`
    ),
    method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).optional(),
    body: z.string().max(MAX_BODY_BYTES).optional()
  })
  .refine((payload) => isAllowedRuntimeRequest(payload), {
    message: 'runtime request path is not allowed'
  })
  .strict()
