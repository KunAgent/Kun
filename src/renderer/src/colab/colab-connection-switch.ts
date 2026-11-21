import type { TFunction } from 'i18next'
import type { ColabConnectionView } from '@shared/colab/colab-types'
import {
  isColabSessionRunning,
  selectWorkspaceActiveConnection,
  selectWorkspaceSessions,
  useColabStore
} from './colab-store'

export type ColabSwitchRequestResult = 'switched' | 'confirm' | 'reauth' | 'noop'

export async function performColabConnectionSwitch(
  workspaceRoot: string,
  target: ColabConnectionView,
  t: TFunction
): Promise<void> {
  const store = useColabStore.getState()
  const previousId = selectWorkspaceActiveConnection(store.snapshot, workspaceRoot)?.id ?? null
  store.setPendingSwitchTargetId(null)
  if (previousId === target.id) return
  const res = await window.kunGui.colabSelectWorkspaceConnection({
    workspaceRoot,
    connectionId: target.id
  })
  if (!res.ok) return
  store.showToast(
    t('colab.switchedToast', { name: target.name }),
    previousId
      ? {
          label: t('colab.undoBtn'),
          run: () => {
            void window.kunGui.colabSelectWorkspaceConnection({
              workspaceRoot,
              connectionId: previousId
            })
          }
        }
      : undefined
  )
}

/**
 * Single entry point for every "switch current connection" affordance so the panel list,
 * the composer chip and the account menu all share the same rules: expired accounts go to
 * re-login, and switching while this workspace has running sessions asks for confirmation.
 */
export function requestColabConnectionSwitch(
  workspaceRoot: string,
  target: ColabConnectionView,
  t: TFunction
): ColabSwitchRequestResult {
  const store = useColabStore.getState()
  if (target.status === 'expired') {
    store.openAddAccount(target.id)
    return 'reauth'
  }
  const active = selectWorkspaceActiveConnection(store.snapshot, workspaceRoot)
  if (active?.id === target.id) return 'noop'
  const running = selectWorkspaceSessions(store.snapshot, workspaceRoot).filter(isColabSessionRunning)
  if (active && running.length > 0) {
    store.setConnectionsExpanded(true)
    store.setPendingSwitchTargetId(target.id)
    return 'confirm'
  }
  void performColabConnectionSwitch(workspaceRoot, target, t)
  return 'switched'
}
