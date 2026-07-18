import { ipcRenderer } from 'electron'

const SESSION_ARGUMENT = '--kun-protected-surface-session='
const sessionId =
  process.argv.find((argument) => argument.startsWith(SESSION_ARGUMENT))?.slice(SESSION_ARGUMENT.length) ?? ''

window.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('credential-form') as HTMLFormElement | null
  const input = document.getElementById('credential-value') as HTMLInputElement | null
  const cancel = document.getElementById('credential-cancel') as HTMLButtonElement | null
  const authorizationOpen = document.getElementById('authorization-open') as HTMLButtonElement | null
  const authorizationClose = document.getElementById('authorization-close') as HTMLButtonElement | null
  const consentApprove = document.getElementById('consent-approve') as HTMLButtonElement | null
  const consentCancel = document.getElementById('consent-cancel') as HTMLButtonElement | null
  if (!sessionId) return

  if (consentApprove && consentCancel) {
    consentApprove.addEventListener('click', () => {
      ipcRenderer.send('extension:protected-surface:consent-approve', { sessionId })
    })
    consentCancel.addEventListener('click', () => {
      ipcRenderer.send('extension:protected-surface:consent-cancel', { sessionId })
    })
    window.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      ipcRenderer.send('extension:protected-surface:consent-cancel', { sessionId })
    })
    consentCancel.focus()
    return
  }

  if (authorizationOpen && authorizationClose) {
    authorizationOpen.addEventListener('click', () => {
      ipcRenderer.send('extension:protected-surface:open-external', { sessionId })
    })
    authorizationClose.addEventListener('click', () => {
      ipcRenderer.send('extension:protected-surface:close', { sessionId })
    })
    authorizationOpen.focus()
    return
  }

  if (!form || !input || !cancel) return

  form.addEventListener('submit', (event) => {
    event.preventDefault()
    ipcRenderer.send('extension:protected-surface:submit', {
      sessionId,
      value: input.value
    })
    input.value = ''
  })
  cancel.addEventListener('click', () => {
    input.value = ''
    ipcRenderer.send('extension:protected-surface:cancel', { sessionId })
  })
  input.focus()
})
