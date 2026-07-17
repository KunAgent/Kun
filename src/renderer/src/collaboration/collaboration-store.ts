import { create } from 'zustand'
import { randomCommandId } from './collaboration-utils'
import { collaborationNetworkApi, humanCollaborationApi } from '@shared/collaboration/api'
import type {
  CollaborationNetworkCommand,
  CollaborationNetworkStatus,
  HumanCollaborationCommand,
  LocalCollaborationSnapshot
} from '@shared/collaboration/contracts'

export type CollaborationSelection = { kind: 'meeting' | 'employee'; id: string } | null
type CollaborationCommandInput = HumanCollaborationCommand extends infer Command
  ? Command extends HumanCollaborationCommand
    ? Omit<Command, 'commandId'> & { commandId?: string }
    : never
  : never

type CollaborationState = {
  snapshot: LocalCollaborationSnapshot
  selection: CollaborationSelection
  loading: boolean
  error: string | null
  networkStatus: CollaborationNetworkStatus
  networkLoading: boolean
  load: () => Promise<void>
  select: (selection: CollaborationSelection) => void
  dispatch: (command: CollaborationCommandInput) => Promise<unknown>
  dispatchNetwork: (command: CollaborationNetworkCommand) => Promise<unknown>
}

const EMPTY: LocalCollaborationSnapshot = { version: 1, meetings: [], employees: [], invocations: [], commandResults: {} }
const NETWORK_DISABLED: CollaborationNetworkStatus = {
  state: 'disabled', e2eeState: 'setup_required', protocol: 1,
  transport: 'tls13-spki', encryption: 'rfc9420-openmls'
}

export const useCollaborationStore = create<CollaborationState>((set, get) => ({
  snapshot: EMPTY,
  selection: null,
  loading: false,
  error: null,
  networkStatus: NETWORK_DISABLED,
  networkLoading: false,
  load: async () => {
    set({ loading: true })
    try {
      const [snapshot, networkStatus] = await Promise.all([
        humanCollaborationApi.snapshot(),
        collaborationNetworkApi.status()
      ])
      const selection = get().selection ?? (snapshot.meetings[0]
        ? { kind: 'meeting' as const, id: snapshot.meetings[0].id }
        : snapshot.employees[0]
          ? { kind: 'employee' as const, id: snapshot.employees[0].id }
          : null)
      set({ snapshot, selection, networkStatus, error: null })
    } catch (cause) {
      set({ error: cause instanceof Error ? cause.message : String(cause) })
    } finally {
      set({ loading: false })
    }
  },
  select: (selection) => set({ selection }),
  dispatch: async (input) => {
    try {
      const command = { ...input, commandId: input.commandId ?? randomCommandId() } as HumanCollaborationCommand
      const result = await humanCollaborationApi.dispatch(command)
      await get().load()
      return result
    } catch (cause) {
      const error = cause instanceof Error ? cause.message : String(cause)
      set({ error })
      throw cause
    }
  },
  dispatchNetwork: async (command) => {
    set({ networkLoading: true })
    try {
      const result = await collaborationNetworkApi.dispatch(command)
      const networkStatus = await collaborationNetworkApi.status()
      set({ networkStatus, error: null })
      return result
    } catch (cause) {
      const error = cause instanceof Error ? cause.message : String(cause)
      set({ error })
      throw cause
    } finally {
      set({ networkLoading: false })
    }
  }
}))
