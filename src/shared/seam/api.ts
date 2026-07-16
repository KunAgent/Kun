/**
 * EXT-SEAM: Shared API clients for extension features.
 *
 * Provides typed API clients that wrap window.kunGui.runtimeRequest for each domain.
 */
import type { KunGuiApi } from '../kun-gui-api'

declare global {
  interface Window {
    kunGui: KunGuiApi
  }
}

interface RuntimeResponse {
  [key: string]: unknown
}

async function runtimeRequest(path: string, method: string, body?: unknown): Promise<RuntimeResponse> {
  if (typeof window === 'undefined' || !window.kunGui?.runtimeRequest) {
    throw new Error('Runtime API not available')
  }
  const response = body === undefined
    ? await window.kunGui.runtimeRequest(path, method)
    : await window.kunGui.runtimeRequest(path, method, JSON.stringify(body))
  const payload = parseRuntimeBody(response.body)
  if (!response.ok) {
    const message = typeof payload.error === 'string'
      ? payload.error
      : typeof payload.message === 'string'
        ? payload.message
        : `Runtime request failed with HTTP ${response.status}`
    throw new Error(message)
  }
  return payload
}

function parseRuntimeBody(body: string): RuntimeResponse {
  if (!body.trim()) return {}
  try {
    const parsed: unknown = JSON.parse(body)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as RuntimeResponse
    }
  } catch {
    // Fall through to an actionable protocol error.
  }
  throw new Error('Runtime returned an invalid JSON response')
}

// Experts API
export const expertsApi = {
  async list(): Promise<RuntimeResponse> {
    return runtimeRequest('/v1/experts', 'GET')
  },

  async listExperts(): Promise<RuntimeResponse> {
    return runtimeRequest('/v1/experts', 'GET')
  },

  async listTeams(): Promise<RuntimeResponse> {
    return runtimeRequest('/v1/experts/teams', 'GET')
  },

  async getExpert(id: string): Promise<RuntimeResponse> {
    return runtimeRequest(`/v1/experts/${id}`, 'GET')
  },

  async getExecutionProfile(id: string): Promise<RuntimeResponse> {
    return runtimeRequest(`/v1/experts/${id}/execution-profile`, 'GET')
  },

  async createExpert(data: unknown): Promise<RuntimeResponse> {
    return runtimeRequest('/v1/experts', 'POST', data)
  },

  async createTeam(data: unknown): Promise<RuntimeResponse> {
    return runtimeRequest('/v1/experts/teams', 'POST', data)
  },

  async deleteExpert(id: string): Promise<RuntimeResponse> {
    return runtimeRequest(`/v1/experts/${id}`, 'DELETE')
  },

  async enable(id: string): Promise<RuntimeResponse> {
    return runtimeRequest(`/v1/experts/${id}/enable`, 'POST')
  },

  async disable(id: string): Promise<RuntimeResponse> {
    return runtimeRequest(`/v1/experts/${id}/disable`, 'POST')
  },

  async activate(id: string): Promise<RuntimeResponse> {
    return runtimeRequest(`/v1/experts/${id}/activate`, 'POST')
  },

  async deactivate(id: string): Promise<RuntimeResponse> {
    return runtimeRequest(`/v1/experts/${id}/deactivate`, 'POST')
  },

  async refresh(): Promise<RuntimeResponse> {
    return runtimeRequest('/v1/experts/refresh', 'POST')
  }
}

// Collaboration API
export const collaborationApi = {
  async listPlans(): Promise<RuntimeResponse> {
    return runtimeRequest('/v1/collaboration/plans', 'GET')
  },

  async createPlan(data: unknown): Promise<RuntimeResponse> {
    return runtimeRequest('/v1/collaboration/plans', 'POST', data)
  },

  async confirmPlan(id: string): Promise<RuntimeResponse> {
    return runtimeRequest(`/v1/collaboration/plans/${id}/confirm`, 'POST')
  },

  async startPlan(id: string): Promise<RuntimeResponse> {
    return runtimeRequest(`/v1/collaboration/plans/${id}/start`, 'POST')
  },

  async cancelPlan(id: string, reason?: string): Promise<RuntimeResponse> {
    return runtimeRequest(`/v1/collaboration/plans/${id}/cancel`, 'POST', { planId: id, reason })
  },

  async listTasks(planId: string): Promise<RuntimeResponse> {
    return runtimeRequest(`/v1/collaboration/plans/${planId}/tasks`, 'GET')
  },

  async getPlan(id: string): Promise<RuntimeResponse> {
    return runtimeRequest(`/v1/collaboration/plans/${encodeURIComponent(id)}`, 'GET')
  },

  async getState(id: string): Promise<RuntimeResponse> {
    return runtimeRequest(`/v1/collaboration/plans/${encodeURIComponent(id)}/state`, 'GET')
  },

  async getTask(taskId: string, planId: string): Promise<RuntimeResponse> {
    return runtimeRequest(
      `/v1/collaboration/tasks/${encodeURIComponent(taskId)}?planId=${encodeURIComponent(planId)}`,
      'GET'
    )
  },

  async interruptTask(taskId: string, planId: string): Promise<RuntimeResponse> {
    return runtimeRequest(
      `/v1/collaboration/tasks/${encodeURIComponent(taskId)}/interrupt?planId=${encodeURIComponent(planId)}`,
      'POST'
    )
  },

  async retryTask(taskId: string, planId: string): Promise<RuntimeResponse> {
    return runtimeRequest(
      `/v1/collaboration/tasks/${encodeURIComponent(taskId)}/retry?planId=${encodeURIComponent(planId)}`,
      'POST'
    )
  }
}

// MoA API
export const moaApi = {
  async listPresets(): Promise<RuntimeResponse> {
    return runtimeRequest('/v1/moa/presets', 'GET')
  },

  async getPreset(id: string): Promise<RuntimeResponse> {
    return runtimeRequest(`/v1/moa/presets/${id}`, 'GET')
  }
}

// Automation API
export const automationApi = {
  async listTasks(): Promise<RuntimeResponse> {
    return runtimeRequest('/v1/automation/tasks', 'GET')
  },

  async getTask(id: string): Promise<RuntimeResponse> {
    return runtimeRequest(`/v1/automation/tasks/${id}`, 'GET')
  },

  async createTask(data: unknown): Promise<RuntimeResponse> {
    return runtimeRequest('/v1/automation/tasks', 'POST', data)
  },

  async listApprovals(): Promise<RuntimeResponse> {
    return runtimeRequest('/v1/automation/approvals', 'GET')
  },

  async approve(id: string): Promise<RuntimeResponse> {
    return runtimeRequest(`/v1/automation/approvals/${id}/approve`, 'POST')
  },

  async reject(id: string): Promise<RuntimeResponse> {
    return runtimeRequest(`/v1/automation/approvals/${id}/reject`, 'POST')
  }
}

// Design API
export const designApi = {
  async listLibraries(): Promise<RuntimeResponse> {
    return runtimeRequest('/v1/design/libraries', 'GET')
  },

  async getLibrary(id: string): Promise<RuntimeResponse> {
    return runtimeRequest(`/v1/design/libraries/${id}`, 'GET')
  },

  async searchComponents(query: unknown): Promise<RuntimeResponse> {
    return runtimeRequest('/v1/design/components/search', 'POST', query)
  },

  async listSkills(): Promise<RuntimeResponse> {
    return runtimeRequest('/v1/design/skills', 'GET')
  },

  async getSkill(id: string): Promise<RuntimeResponse> {
    return runtimeRequest(`/v1/design/skills/${encodeURIComponent(id)}`, 'GET')
  }
}
