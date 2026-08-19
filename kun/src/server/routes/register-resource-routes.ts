import type { Router } from '../router.js'
import { buildWorkspaceStatusResponse } from './workspace.js'
import { refreshSkills, setSkillsEnabled } from './skills.js'
import { setLocalRuntimeCapability } from './runtime-capabilities.js'
import {
  attachmentDiagnostics,
  getAttachmentContent,
  getAttachmentMetadata,
  releaseAttachment,
  uploadAttachment
} from './attachments.js'
import {
  createMemory,
  deleteMemory,
  listMemories,
  memoryDiagnostics,
  updateMemory
} from './memory.js'
import {
  delegationAbort,
  delegationDetach,
  delegationDiagnostics,
  delegationProfiles
} from './delegation.js'
import {
  backgroundShellGet,
  backgroundShellList,
  backgroundShellStop
} from './background-shells.js'
import { auditSupplyChainPackage, checkSupplyChainUpdate } from './supply-chain.js'
import { getNodeGraph, getNodeGraphFolder } from './node-graph.js'
import { ERRORS } from './runtime-error.js'
import type { ServerRuntime } from './server-runtime.js'
import { authorize } from './route-auth.js'

export function registerResourceRoutes(router: Router, runtime: ServerRuntime): void {
  router.add('POST', '/v1/skills/refresh', async (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return refreshSkills(runtime)
  })
  router.add('PATCH', '/v1/skills/config', async (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return setSkillsEnabled(runtime, request)
  })
  router.add('PATCH', '/v1/runtime/capabilities/:id', async (request, context) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return setLocalRuntimeCapability(runtime, context.params.id, request)
  })
  router.add('POST', '/v1/supply-chain/audit', async (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return auditSupplyChainPackage(runtime, request)
  })
  router.add('POST', '/v1/supply-chain/update-check', async (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return checkSupplyChainUpdate(request)
  })
  router.add('POST', '/v1/attachments', async (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return uploadAttachment(runtime.attachmentStore, request)
  })
  router.add('DELETE', '/v1/attachments/:id', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return releaseAttachment(runtime, ctx.params.id, request)
  })
  router.add('GET', '/v1/attachments/diagnostics', async (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return attachmentDiagnostics(runtime.attachmentStore)
  })
  router.add('GET', '/v1/attachments/:id', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return getAttachmentMetadata(runtime.attachmentStore, ctx.params.id)
  })
  router.add('GET', '/v1/attachments/:id/content', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return getAttachmentContent(runtime.attachmentStore, ctx.params.id, request)
  })
  router.add('GET', '/v1/memory', async (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return listMemories(runtime.memoryStore, request)
  })
  router.add('POST', '/v1/memory', async (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return createMemory(runtime.memoryStore, request)
  })
  router.add('GET', '/v1/memory/diagnostics', async (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return memoryDiagnostics(runtime.memoryStore)
  })
  router.add('PATCH', '/v1/memory/:id', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return updateMemory(runtime.memoryStore, ctx.params.id, request)
  })
  router.add('DELETE', '/v1/memory/:id', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return deleteMemory(runtime.memoryStore, ctx.params.id, request)
  })
  router.add('GET', '/v1/delegation/diagnostics', async (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return delegationDiagnostics(runtime.delegationRuntime, request)
  })
  router.add('GET', '/v1/delegation/profiles', async (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return delegationProfiles(runtime.delegationRuntime, request)
  })
  router.add('POST', '/v1/delegation/abort/:childId', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return delegationAbort(runtime.delegationRuntime, ctx.params.childId)
  })
  router.add('POST', '/v1/delegation/detach/:childId', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return delegationDetach(runtime.delegationRuntime, ctx.params.childId)
  })
  router.add('GET', '/v1/background-shells', async (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return backgroundShellList(runtime.backgroundShellRuntime, request)
  })
  router.add('GET', '/v1/background-shells/:sessionId', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return backgroundShellGet(runtime.backgroundShellRuntime, ctx.params.sessionId)
  })
  router.add('POST', '/v1/background-shells/:sessionId/stop', async (request, ctx) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return backgroundShellStop(runtime.backgroundShellRuntime, ctx.params.sessionId)
  })
  router.add('GET', '/v1/node-graph/folder', async (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return getNodeGraphFolder(runtime.nodeGraphService, request)
  })
  router.add('GET', '/v1/node-graph', async (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    return getNodeGraph(runtime.nodeGraphService, request)
  })
  router.add('GET', '/v1/workspace/status', async (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    const url = new URL(request.url)
    const path = url.searchParams.get('path')
    return buildWorkspaceStatusResponse({ inspector: runtime.workspaceInspector, path })
  })
}
