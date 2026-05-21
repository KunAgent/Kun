import type { ClawImAgentProfileV1, ClawImChannelV1, ClawImPlatformCredentialV1, ClawImProvider, ClawImSettingsV1, ClawModel } from '@shared/app-settings'
import type { ChatState, ChatStoreGet, ChatStoreSet } from './chat-store-types'
import type { AgentProviderId, NormalizedThread } from '../agent/types'

type CreateClawActionsOptions = {
  set: ChatStoreSet
  get: ChatStoreGet
  i18n: { t: (key: string, options?: Record<string, unknown>) => string }
  getProvider: (providerId: AgentProviderId) => {
    createThread: (input: { workspace: string; title: string; mode: 'agent' | 'plan' }) => Promise<NormalizedThread>
    deleteThread: (threadId: string) => Promise<void>
  }
  newClawChannel: (
    provider: ClawImProvider,
    agentProfile?: Partial<ClawImAgentProfileV1>,
    platformCredential?: ClawImPlatformCredentialV1
  ) => ClawImChannelV1
  normalizeClawComposerModel: (raw: string) => ClawModel
  activeClawChannel: (state: Pick<ChatState, 'clawChannels' | 'activeClawChannelId'>) => ClawImChannelV1 | null
  normalizeWorkspaceRoot: (workspaceRoot?: string | null) => string
  formatRuntimeError: (error: unknown) => string
  shouldOpenSettingsForError: (error: unknown) => boolean
  clearedThreadSelection: () => Pick<
    ChatState,
    | 'activeThreadId'
    | 'blocks'
    | 'liveReasoning'
    | 'liveAssistant'
    | 'busy'
    | 'lastSeq'
    | 'currentTurnId'
    | 'currentTurnUserId'
    | 'inspectorSelectedId'
  >
  sseAbortRef: { current: AbortController | null }
  clearBusyWatchdog: () => void
}

export function createClawActions(options: CreateClawActionsOptions): Pick<
  ChatState,
  | 'appendLocalClawTurn'
  | 'refreshClawChannels'
  | 'addClawChannel'
  | 'selectClawChannel'
  | 'selectClawConversation'
  | 'deleteClawChannel'
  | 'resetClawChannelSession'
  | 'setClawChannelModel'
> {
  const {
    set,
    get,
    i18n,
    getProvider,
    newClawChannel,
    normalizeClawComposerModel,
    activeClawChannel,
    normalizeWorkspaceRoot,
    formatRuntimeError,
    shouldOpenSettingsForError,
    clearedThreadSelection,
    sseAbortRef,
    clearBusyWatchdog
  } = options

  return {
    appendLocalClawTurn: (userText, replyText) =>
      set((state) => {
        const now = Date.now()
        return {
          blocks: [
            ...state.blocks,
            {
              kind: 'user',
              id: `local-user-${now}`,
              createdAt: new Date(now).toISOString(),
              text: userText
            },
            {
              kind: 'assistant',
              id: `local-assistant-${now}`,
              createdAt: new Date(now + 1).toISOString(),
              text: replyText
            }
          ],
          liveReasoning: '',
          liveAssistant: '',
          error: null
        }
      }),

    refreshClawChannels: async () => {
      if (typeof window.dsGui === 'undefined') return
      const settings = await window.dsGui.getSettings()
      const channels = settings.claw.channels
      const current = get().activeClawChannelId
      const activeId = current && channels.some((channel) => channel.id === current)
        ? current
        : channels.find((channel) => channel.enabled)?.id ?? channels[0]?.id ?? ''
      set({ clawChannels: channels, activeClawChannelId: activeId })
      if (get().route === 'claw' && !activeId) {
        sseAbortRef.current?.abort()
        sseAbortRef.current = null
        clearBusyWatchdog()
        set({ ...clearedThreadSelection(), route: 'claw', clawChannels: channels, activeClawChannelId: '' })
        return
      }
      if (get().route === 'claw' && activeId) {
        void get().selectClawChannel(activeId)
      }
    },

    addClawChannel: async (provider, agentProfile, platformCredential, optionsArg) => {
      if (typeof window.dsGui === 'undefined') return
      const settings = await window.dsGui.getSettings()
      const targetChannelId = optionsArg?.channelId?.trim() ?? ''
      const existing = targetChannelId
        ? settings.claw.channels.find((channel) => channel.id === targetChannelId)
        : null
      if (existing) {
        const now = new Date().toISOString()
        const profileName = agentProfile?.name?.trim() ?? ''
        const updatedChannel: ClawImChannelV1 = {
          ...existing,
          label: profileName || existing.label,
          model: optionsArg?.model ?? existing.model,
          workspaceRoot: optionsArg?.workspaceRoot?.trim() ?? existing.workspaceRoot,
          enabled: optionsArg?.enabled ?? existing.enabled,
          agentProfile: {
            name: profileName,
            description: agentProfile?.description?.trim() ?? '',
            identity: agentProfile?.identity ?? '',
            personality: agentProfile?.personality ?? '',
            userContext: agentProfile?.userContext ?? '',
            replyRules: agentProfile?.replyRules ?? ''
          },
          platformCredential: platformCredential ?? existing.platformCredential,
          updatedAt: now
        }
        const channels = settings.claw.channels.map((channel) =>
          channel.id === existing.id ? updatedChannel : channel
        )
        const saved = await window.dsGui.setSettings({
          claw: {
            enabled: true,
            im: {
              enabled: true,
              provider,
              ...(optionsArg?.im ?? {})
            },
            channels
          }
        })
        set({ clawChannels: saved.claw.channels, activeClawChannelId: existing.id, route: 'claw' })
        await get().selectClawChannel(existing.id)
        return
      }

      const channel = newClawChannel(provider, agentProfile, platformCredential)
      const nextChannel: ClawImChannelV1 = {
        ...channel,
        model: optionsArg?.model ?? channel.model,
        workspaceRoot: optionsArg?.workspaceRoot?.trim() ?? channel.workspaceRoot,
        enabled: optionsArg?.enabled ?? channel.enabled
      }
      const channels = [...settings.claw.channels, nextChannel]
      const saved = await window.dsGui.setSettings({
        claw: {
          enabled: true,
          im: {
            enabled: true,
            provider,
            ...(optionsArg?.im ?? {})
          },
          channels
        }
      })
      set({ clawChannels: saved.claw.channels, activeClawChannelId: nextChannel.id, route: 'claw' })
      await get().selectClawChannel(nextChannel.id)
    },

    selectClawChannel: async (channelId) => {
      if (get().runtimeConnection !== 'ready') {
        set({ activeClawChannelId: channelId, error: i18n.t('common:runtimeActionNeedsConnection') })
        return
      }
      if (typeof window.dsGui === 'undefined') return
      const settings = await window.dsGui.getSettings()
      const channels = settings.claw.channels
      const channel = channels.find((item) => item.id === channelId)
      if (!channel) {
        set({ clawChannels: channels, activeClawChannelId: '' })
        return
      }
      set({ route: 'claw', clawChannels: channels, activeClawChannelId: channel.id, composerModel: channel.model })
      const provider = getProvider(get().providerId)
      const latestConversation =
        [...channel.conversations]
          .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0] ?? null
      const desiredWorkspaceRoot = normalizeWorkspaceRoot(
        channel.workspaceRoot
        || latestConversation?.workspaceRoot
        || settings.claw.im.workspaceRoot
        || settings.workspaceRoot
      )
      let threadId = channel.threadId.trim() || latestConversation?.localThreadId.trim()
      const existingThread =
        threadId ? get().threads.find((thread) => thread.id === threadId) ?? null : null
      const needsWorkspaceReset =
        !!threadId &&
        !!desiredWorkspaceRoot &&
        !!existingThread?.workspace &&
        normalizeWorkspaceRoot(existingThread.workspace) !== desiredWorkspaceRoot
      if (needsWorkspaceReset) {
        threadId = ''
      }
      if (!threadId) {
        try {
          const thread = await provider.createThread({
            workspace: desiredWorkspaceRoot,
            title: `[Claw:${channel.label}]`,
            mode: 'agent'
          })
          threadId = thread.id
          const now = new Date().toISOString()
          const nextChannels = channels.map((item) =>
            item.id === channel.id
              ? {
                  ...item,
                  threadId,
                  conversations: item.conversations.map((conversation) => ({
                    ...conversation,
                    localThreadId: threadId,
                    updatedAt: now
                  })),
                  updatedAt: now
                }
              : item
          )
          const saved = await window.dsGui.setSettings({ claw: { channels: nextChannels } })
          set((state) => ({
            clawChannels: saved.claw.channels,
            threads: state.threads.some((item) => item.id === thread.id)
              ? state.threads
              : [thread, ...state.threads]
          }))
        } catch (error) {
          set({
            error: formatRuntimeError(error),
            ...(shouldOpenSettingsForError(error)
              ? { route: 'settings' as const, settingsSection: 'agents' as const }
              : {})
          })
          return
        }
      }
      await get().selectThread(threadId)
      set({ route: 'claw', activeClawChannelId: channel.id })
    },

    selectClawConversation: async (channelId, threadId) => {
      if (get().runtimeConnection !== 'ready') {
        set({ activeClawChannelId: channelId, error: i18n.t('common:runtimeActionNeedsConnection') })
        return
      }
      if (typeof window.dsGui === 'undefined') return
      const settings = await window.dsGui.getSettings()
      const channels = settings.claw.channels
      const channel = channels.find((item) => item.id === channelId)
      if (!channel) {
        set({ clawChannels: channels, activeClawChannelId: '' })
        return
      }
      const targetThreadId = threadId.trim()
      const conversation = channel.conversations.find((item) => item.localThreadId.trim() === targetThreadId)
      if (!conversation) {
        await get().selectClawChannel(channelId)
        return
      }
      set({
        route: 'claw',
        clawChannels: channels,
        activeClawChannelId: channel.id,
        composerModel: channel.model
      })
      await get().selectThread(targetThreadId)
      set({ route: 'claw', activeClawChannelId: channel.id })
    },

    deleteClawChannel: async (channelId) => {
      if (typeof window.dsGui === 'undefined') return
      const settings = await window.dsGui.getSettings()
      const channel = settings.claw.channels.find((item) => item.id === channelId)
      const channels = settings.claw.channels.filter((item) => item.id !== channelId)
      const saved = await window.dsGui.setSettings({ claw: { channels } })
      set({
        clawChannels: saved.claw.channels,
        activeClawChannelId: saved.claw.channels[0]?.id ?? ''
      })
      if (channel?.threadId && get().runtimeConnection === 'ready') {
        const provider = getProvider(get().providerId)
        await provider.deleteThread(channel.threadId).catch(() => undefined)
      }
      if (saved.claw.channels[0]) {
        await get().selectClawChannel(saved.claw.channels[0].id)
      } else {
        sseAbortRef.current?.abort()
        sseAbortRef.current = null
        clearBusyWatchdog()
        set({ ...clearedThreadSelection(), route: 'claw' })
      }
    },

    resetClawChannelSession: async (channelId) => {
      if (get().runtimeConnection !== 'ready') {
        set({ error: i18n.t('common:runtimeActionNeedsConnection') })
        return
      }
      if (typeof window.dsGui === 'undefined') return
      const settings = await window.dsGui.getSettings()
      const channel = settings.claw.channels.find((item) => item.id === channelId)
      if (!channel) return
      const provider = getProvider(get().providerId)
      const oldThreadId = channel.threadId.trim()
      try {
        const thread = await provider.createThread({
          workspace: normalizeWorkspaceRoot(
            channel.workspaceRoot || settings.claw.im.workspaceRoot || settings.workspaceRoot
          ),
          title: `[Claw:${channel.label}]`,
          mode: 'agent'
        })
        const now = new Date().toISOString()
        const channels = settings.claw.channels.map((item) =>
          item.id === channel.id
            ? {
                ...item,
                threadId: thread.id,
                conversations: item.conversations.map((conversation) => ({
                  ...conversation,
                  localThreadId: thread.id,
                  updatedAt: now
                })),
                updatedAt: now
              }
            : item
        )
        const saved = await window.dsGui.setSettings({ claw: { channels } })
        set((state) => ({
          route: 'claw',
          activeClawChannelId: channel.id,
          clawChannels: saved.claw.channels,
          threads: state.threads.some((item) => item.id === thread.id)
            ? state.threads
            : [thread, ...state.threads]
        }))
        await get().selectThread(thread.id)
        if (oldThreadId && oldThreadId !== thread.id) {
          await provider.deleteThread(oldThreadId).catch(() => undefined)
          await get().refreshThreads()
        }
        set({ error: i18n.t('common:clawSessionCleared') })
      } catch (error) {
        set({
          error: formatRuntimeError(error),
          ...(shouldOpenSettingsForError(error)
            ? { route: 'settings' as const, settingsSection: 'agents' as const }
            : {})
        })
      }
    },

    setClawChannelModel: async (channelId, model) => {
      if (typeof window.dsGui === 'undefined') return
      const normalized = normalizeClawComposerModel(model)
      const settings = await window.dsGui.getSettings()
      const now = new Date().toISOString()
      const channels = settings.claw.channels.map((channel) =>
        channel.id === channelId ? { ...channel, model: normalized, updatedAt: now } : channel
      )
      const saved = await window.dsGui.setSettings({ claw: { channels } })
      set({
        clawChannels: saved.claw.channels,
        composerModel: normalized,
        error: i18n.t('common:clawModelChanged', { model: normalized })
      })
    }
  }
}
