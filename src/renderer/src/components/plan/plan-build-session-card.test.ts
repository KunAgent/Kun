import { createElement } from 'react'
import { act, create as createRenderer, type ReactTestRenderer } from 'react-test-renderer'
import { beforeEach, describe, expect, it } from 'vitest'
import i18n from '../../i18n'
import { useChatStore } from '../../store/chat-store'
import { usePlanBuildAgentStore } from '../../plan/plan-build-agent-store'
import { PlanBuildSessionCard } from './PlanBuildSessionCard'

// A plan handoff for the active conversation used to make the card's store
// selector allocate a new object on every snapshot, which React rejects as an
// infinite update loop and the workbench crashed to the app error boundary.
describe('PlanBuildSessionCard', () => {
  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    void i18n.changeLanguage('en')
    usePlanBuildAgentStore.setState({ handoffs: {}, plans: {}, failures: {} })
    useChatStore.setState({ activeThreadId: 'thr_build' })
  })

  it('renders a plan build handed to an Agent', () => {
    usePlanBuildAgentStore.setState({
      handoffs: {
        plan_1: { route: { agentId: 'kun' }, threadId: 'thr_build', planPath: 'plan.md', planTitle: 'Demo plan' }
      }
    })
    let tree: ReactTestRenderer | undefined
    act(() => { tree = createRenderer(createElement(PlanBuildSessionCard)) })
    expect(JSON.stringify(tree?.toJSON())).toContain('data-plan-build-session')
  })
})
