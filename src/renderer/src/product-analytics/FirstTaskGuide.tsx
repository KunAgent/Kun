import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useChatStore } from '../store/chat-store'
import { openAgentChatDialog } from '../components/rooms/agent-chat-picker'
import { queueFirstTaskPrompt, useFirstRoomTask } from './first-task-prompt'
import { isDefaultWorkspacePath } from '../lib/workspace-label'
import { trackProduct } from './client'

/** Explicit entry only; never resets onboarding/tour completion or sends a prompt. */
export function FirstTaskGuide({ beforeNavigate }: { beforeNavigate?: () => void }) {
  const { i18n } = useTranslation(); const zh = i18n.language.startsWith('zh')
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [unavailable, setUnavailable] = useState(false)
  const navigating = useRef(false)
  const [mode, setMode] = useState<'code' | 'room' | null>(null)
  if (window.kunGui?.isRemoteWeb || !window.kunGui?.productAnalytics) return null
  const show = async () => {
    setBusy(true); setUnavailable(false)
    try {
      if (!await window.kunGui.productAnalytics!.guidance()) { setUnavailable(true); return }
      setOpen(true)
      trackProduct({ name: 'onboarding_step', properties: { step: 'first_task', action: 'entered' } })
    } catch { setUnavailable(true) } finally { setBusy(false) }
  }
  const start = async (selected: 'code' | 'room') => {
    if (navigating.current) return
    navigating.current = true; setBusy(true)
    try {
      const state = useChatStore.getState()
      if (state.busy) return
      trackProduct({ name: 'onboarding_step', properties: { step: 'first_task', action: 'selected', mode: selected } })
      if (selected === 'code') {
        await state.chooseWorkspace({ createThreadAfter: false, selectThreadAfter: false })
        const root = useChatStore.getState().workspaceRoot
        if (!root || isDefaultWorkspacePath(root)) return
        setMode('code')
      } else {
        // Existing picker owns idempotent creation and model availability. No new agents are auto-created.
        useFirstRoomTask.setState({ requested: true })
        setMode('room')
        beforeNavigate?.()
        openAgentChatDialog('picker')
      }
    } catch { setUnavailable(true) } finally { navigating.current = false; setBusy(false) }
  }
  return <section className="rounded-xl border border-ds-border p-4" data-first-task-guide>
    {!open ? <>
      <button type="button" disabled={busy} className="text-accent" onClick={() => void show()}>{zh ? '试着完成第一个任务' : 'Try your first task'}</button>
      {unavailable && <p className="mt-2 text-sm text-ds-muted">{zh ? '新引导暂未开放，现有功能可以正常使用。' : 'The new guide is not available yet. Existing features remain available.'}</p>}
    </> : <>
      <p className="mb-3 text-sm text-ds-muted">{zh ? '选择用途。我们只帮助准备输入，发送前你可以修改，当前权限保持不变。' : 'Choose a goal. Prepare an editable prompt, then send it yourself using your existing permissions.'}</p>
      <div className="flex flex-wrap gap-4">
        <button type="button" disabled={busy} onClick={() => void start('code')}>{zh ? 'Code：理解项目' : 'Code: understand a project'}</button>
        <button type="button" disabled={busy} onClick={() => void start('room')}>{zh ? 'Room：和助手拆解目标' : 'Room: break down a goal'}</button>
        <button type="button" onClick={() => { setOpen(false); trackProduct({ name: 'onboarding_step', properties: { step: 'first_task', action: 'skipped' } }) }}>{zh ? '暂时跳过' : 'Skip for now'}</button>
      </div>
      {mode === 'code' && <button type="button" disabled={busy} className="mt-3 text-accent" onClick={async () => {
        const state = useChatStore.getState(); if (state.busy || navigating.current) return
        navigating.current = true; setBusy(true)
        try {
        beforeNavigate?.()
        await state.openCode(); await useChatStore.getState().createThread({ forceNew: true })
        const threadId = useChatStore.getState().activeThreadId
        if (!threadId) return
        queueFirstTaskPrompt(threadId, zh
          ? '请只读分析这个项目的目录结构、主要模块和启动方式。不要修改文件或安装依赖；不确定的信息请说明。'
          : 'Explain this project’s structure, main modules and how to run it using read-only inspection. Do not modify files or install dependencies; state what is uncertain.')
        trackProduct({ name: 'onboarding_step', properties: { step: 'first_task', action: 'completed', mode: 'code' } })
        setOpen(false)
        } catch { setUnavailable(true) } finally { navigating.current = false; setBusy(false) }
      }}>{zh ? '准备项目解释问题' : 'Prepare a project explanation prompt'}</button>}
      {mode === 'room' && <p className="mt-3 text-sm text-ds-muted">{zh ? '选择一个已有助手，然后点击它的示例问题，或输入：请把我的目标拆成三个可执行步骤，先向我确认缺少的信息。' : 'Choose an existing assistant and use its example prompt, or ask: Break my goal into three actionable steps and clarify missing information first.'}</p>}
    </>}
  </section>
}
