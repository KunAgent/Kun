// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import '../../i18n'
import { AssistantTaskCenter } from './AssistantTaskCenter'

it('searches tasks, displays details, and enables continuation only after a user click', async () => {
 const task={id:'12345678-1234-1234-1234-123456789012',assistantId:'12345678-1234-1234-1234-123456789013',assistantName:'Helper',title:'Important',body:'Inspect the result',createdAt:'2026-10-27T00:00:00Z',updatedAt:'2026-10-27T00:00:00Z',status:'done',updates:[],source:{threadId:'thread',turnId:'turn',callId:'call'},continuation:{enabled:false,state:'disabled'}}
 const listTasks=vi.fn(async()=>({tasks:[task],hasMore:false})),setContinuation=vi.fn(async()=>task)
 Object.assign(window,{kunGui:{assistantMailbox:{listTasks,taskDetails:async()=>({task,notes:[],retryable:[]}),setContinuation}}})
 const host=document.createElement('div'),root=createRoot(host)
 try {
  await act(async()=>{root.render(createElement(AssistantTaskCenter,{assistants:[{id:task.assistantId,name:'Helper'}] as never,initialAssistantId:task.assistantId,onClose:()=>{}}))})
  const row=[...host.querySelectorAll('button')].find(button=>button.textContent?.includes('Important'))!
  await act(async()=>{row.click()})
  expect(host.textContent).toContain('Inspect the result')
  const checkbox=host.querySelectorAll('input[type=checkbox]')[1] as HTMLInputElement
  expect(checkbox.checked).toBe(false);expect(setContinuation).not.toHaveBeenCalled()
  await act(async()=>{checkbox.click()})
  expect(setContinuation).toHaveBeenCalledWith(task.id,true)
 }finally{act(()=>root.unmount())}
})
