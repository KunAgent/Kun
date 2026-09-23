import { afterEach, expect, it, vi } from 'vitest'
import type { ChatState, ChatStoreSet } from './chat-store-types'
import type { ChatBlock } from '../agent/types'
const provider = vi.hoisted(() => ({ submitUserInputResponse: vi.fn(), cancelUserInput: vi.fn() }))
vi.mock('../agent/registry', () => ({getProvider: () => provider}))
import { createMaintenanceInteractionActions } from './chat-store-maintenance-interaction-actions'

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks() })
it('rejects failed live answers to the mobile controller and preserves the request for retry', async () => {
  vi.stubGlobal('window', {kunGui: {logError: vi.fn(async () => undefined)}})
  let state = { blocks: [{kind:'user_input', id:'block', requestId:'request', status:'pending', live:true,
    questions:[{id:'q',header:'',question:'Question',options:[]}]} as ChatBlock], busy:false } as ChatState
  const set: ChatStoreSet = (patch) => {
    state = {...state, ...(typeof patch === 'function' ? patch(state) : patch)}
  }
  const actions = createMaintenanceInteractionActions({set, get: () => state, sseAbortRef:{current:null}})
  const failure = new Error('Network offline')
  provider.submitUserInputResponse.mockRejectedValueOnce(failure).mockResolvedValueOnce(undefined)
  const answers = [{id:'q',label:'Answer',value:'Draft answer'}]
  await expect(actions.resolveUserInput('block', {kind:'submit',answers})).rejects.toBe(failure)
  expect(state.blocks[0]).toMatchObject({status:'pending', answers, errorMessage:expect.any(String)})
  await actions.resolveUserInput('block', {kind:'submit',answers})
  expect(state.blocks[0]).toMatchObject({status:'submitted',answers})
})
it('keeps non-live history errors read-only rather than reopening them', async () => {
  vi.stubGlobal('window', {kunGui:{logError:vi.fn(async () => undefined)}})
  let state = {blocks:[{kind:'user_input',id:'history',requestId:'old',status:'pending',live:false,questions:[]} as ChatBlock]} as ChatState
  const set: ChatStoreSet = (patch) => {state = {...state,...(typeof patch === 'function' ? patch(state) : patch)}}
  const actions = createMaintenanceInteractionActions({set,get:()=>state,sseAbortRef:{current:null}})
  provider.cancelUserInput.mockRejectedValueOnce(new Error('Expired'))
  await expect(actions.resolveUserInput('history',{kind:'cancel'})).rejects.toThrow('Expired')
  expect(state.blocks[0]).toMatchObject({status:'error',live:false})
})
