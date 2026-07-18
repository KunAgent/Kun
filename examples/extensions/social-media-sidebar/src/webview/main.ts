import './styles.css'
import {
  SOCIAL_PLATFORMS,
  socialPlatform,
  socialPlatformForUrl,
  type SocialPlatform
} from './platforms'

type ExternalWebview = HTMLElement & {
  canGoBack(): boolean
  canGoForward(): boolean
  getURL(): string
  goBack(): void
  goForward(): void
  loadURL(url: string): Promise<void>
  reload(): void
}

type FailLoadEvent = Event & {
  errorCode?: number
  errorDescription?: string
  validatedURL?: string
}

const app = document.querySelector<HTMLElement>('#app')
if (!app) throw new Error('Social media extension root is unavailable.')

let active = SOCIAL_PLATFORMS[0]!
let ready = false
let loading = true

const shell = element('section', 'social-shell')
const platformBar = element('nav', 'platform-bar')
platformBar.setAttribute('aria-label', '内容平台')

const controls = element('div', 'browser-controls')
const backButton = controlButton('←', '后退')
const forwardButton = controlButton('→', '前进')
const reloadButton = controlButton('↻', '刷新')
const homeButton = controlButton('⌂', '回到平台首页')
const address = element('div', 'address')
address.setAttribute('aria-live', 'polite')

controls.append(backButton, forwardButton, reloadButton, homeButton, address)

const viewport = element('div', 'browser-viewport')
const progress = element('div', 'load-progress')
progress.setAttribute('aria-hidden', 'true')
const webview = document.createElement('webview') as ExternalWebview
webview.className = 'social-webview'
webview.setAttribute('allowpopups', '')
webview.setAttribute('aria-label', active.name)
webview.setAttribute('src', active.url)

const errorPanel = element('section', 'error-panel')
errorPanel.hidden = true
const errorMark = element('div', 'error-mark')
errorMark.textContent = '!'
const errorTitle = element('h2', 'error-title')
errorTitle.textContent = '页面暂时无法打开'
const errorDetail = element('p', 'error-detail')
const retryButton = element('button', 'retry-button')
retryButton.type = 'button'
retryButton.textContent = '重新加载'
errorPanel.append(errorMark, errorTitle, errorDetail, retryButton)

for (const platform of SOCIAL_PLATFORMS) {
  const button = element('button', 'platform-button')
  button.type = 'button'
  button.dataset.platform = platform.id
  button.setAttribute('aria-label', platform.name)
  button.style.setProperty('--platform-accent', platform.accent)
  const badge = element('span', 'platform-badge')
  badge.textContent = platform.shortName
  const name = element('span', 'platform-name')
  name.textContent = platform.name
  button.append(badge, name)
  button.addEventListener('click', () => selectPlatform(platform))
  platformBar.append(button)
}

viewport.append(progress, webview, errorPanel)
shell.append(platformBar, controls, viewport)
app.append(shell)

backButton.addEventListener('click', () => {
  if (ready && webview.canGoBack()) webview.goBack()
})
forwardButton.addEventListener('click', () => {
  if (ready && webview.canGoForward()) webview.goForward()
})
reloadButton.addEventListener('click', () => {
  if (ready) webview.reload()
})
homeButton.addEventListener('click', () => navigate(active.url))
retryButton.addEventListener('click', () => navigate(active.url))

webview.addEventListener('dom-ready', () => {
  ready = true
  updateNavigation()
})
webview.addEventListener('did-start-loading', () => setLoading(true))
webview.addEventListener('did-stop-loading', () => {
  setLoading(false)
  updateNavigation()
})
webview.addEventListener('did-navigate', updateNavigation)
webview.addEventListener('did-navigate-in-page', updateNavigation)
webview.addEventListener('did-fail-load', (event) => {
  const detail = event as FailLoadEvent
  if (detail.errorCode === -3) return
  setLoading(false)
  showError(detail.errorDescription || '请检查网络连接，或稍后重试。')
})

updatePlatformButtons()
setLoading(true)
updateNavigation()

function selectPlatform(platform: SocialPlatform): void {
  active = platform
  updatePlatformButtons()
  navigate(platform.url)
}

function navigate(url: string): void {
  hideError()
  setLoading(true)
  webview.setAttribute('aria-label', active.name)
  if (!ready) {
    webview.setAttribute('src', url)
    return
  }
  void webview.loadURL(url).catch((error: unknown) => {
    setLoading(false)
    showError(error instanceof Error ? error.message : '页面加载失败。')
  })
}

function updateNavigation(): void {
  const currentUrl = ready ? webview.getURL() : active.url
  const detected = socialPlatformForUrl(currentUrl)
  if (detected) active = detected
  updatePlatformButtons()
  address.textContent = safeAddress(currentUrl)
  address.title = currentUrl
  backButton.disabled = !ready || !webview.canGoBack()
  forwardButton.disabled = !ready || !webview.canGoForward()
  reloadButton.disabled = !ready
}

function updatePlatformButtons(): void {
  for (const button of Array.from(
    platformBar.querySelectorAll<HTMLButtonElement>('.platform-button')
  )) {
    const selected = socialPlatform(button.dataset.platform ?? '')?.id === active.id
    button.classList.toggle('is-active', selected)
    button.setAttribute('aria-current', selected ? 'page' : 'false')
  }
}

function setLoading(next: boolean): void {
  loading = next
  shell.classList.toggle('is-loading', loading)
}

function showError(message: string): void {
  errorDetail.textContent = message.slice(0, 280)
  errorPanel.hidden = false
}

function hideError(): void {
  errorPanel.hidden = true
  errorDetail.textContent = ''
}

function safeAddress(rawUrl: string): string {
  try {
    const url = new URL(rawUrl)
    return `${url.hostname}${url.pathname === '/' ? '' : url.pathname}`.slice(0, 120)
  } catch {
    return active.name
  }
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  node.className = className
  return node
}

function controlButton(label: string, ariaLabel: string): HTMLButtonElement {
  const button = element('button', 'control-button')
  button.type = 'button'
  button.textContent = label
  button.setAttribute('aria-label', ariaLabel)
  button.title = ariaLabel
  return button
}
