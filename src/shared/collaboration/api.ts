import type {
  CollaborationNetworkCommand,
  CollaborationNetworkStatus,
  HumanCollaborationCommand,
  LocalCollaborationSnapshot
} from './contracts'

export const humanCollaborationApi = {
  async snapshot(): Promise<LocalCollaborationSnapshot> {
    if (typeof window === 'undefined' || !window.kunGui?.getCollaborationSnapshot) {
      throw new Error('Local collaboration API is unavailable')
    }
    return window.kunGui.getCollaborationSnapshot()
  },
  async dispatch(command: HumanCollaborationCommand): Promise<unknown> {
    if (typeof window === 'undefined' || !window.kunGui?.dispatchCollaborationCommand) {
      throw new Error('Local collaboration API is unavailable')
    }
    return window.kunGui.dispatchCollaborationCommand(command)
  }
}

export const collaborationNetworkApi = {
  async status(): Promise<CollaborationNetworkStatus> {
    if (typeof window === 'undefined' || !window.kunGui?.getCollaborationNetworkStatus) {
      throw new Error('Network collaboration API is unavailable')
    }
    return window.kunGui.getCollaborationNetworkStatus()
  },
  async dispatch(command: CollaborationNetworkCommand): Promise<unknown> {
    if (typeof window === 'undefined' || !window.kunGui?.dispatchCollaborationNetworkCommand) {
      throw new Error('Network collaboration API is unavailable')
    }
    return window.kunGui.dispatchCollaborationNetworkCommand(command)
  }
}
