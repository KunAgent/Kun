import type { RequestAutoPlanBuild } from '../../plan/use-auto-plan-build-controller'
import type { PlanTurnOverrides } from './workbench-composer-submit-types'

export async function submitWorkbenchPlanIntent(input: {
  mode: 'plan' | 'auto'
  text: string
  overrides: PlanTurnOverrides
  sendPlanTurn: (text: string, overrides?: PlanTurnOverrides) => Promise<boolean>
  requestAutoPlanBuild: RequestAutoPlanBuild
  consumeComposer: () => void
  restoreComposer: () => void
}): Promise<void> {
  if (input.mode === 'plan') {
    input.consumeComposer()
    void input.sendPlanTurn(input.text, input.overrides)
    return
  }
  await input.requestAutoPlanBuild({
    text: input.text,
    overrides: input.overrides,
    onStarted: () => {},
    onSubmitting: input.consumeComposer,
    onRejected: input.restoreComposer
  })
}
