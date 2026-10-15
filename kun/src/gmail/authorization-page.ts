import { randomBytes } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { KUN_CHEER_WEBP, KUN_HEADSET_WEBP, KUN_LAPTOP_WEBP } from './authorization-page-art.js'

/** Same link as the Kun account result page: the desktop app only brings its window forward. */
const RETURN_LINK = 'kun://account'

export type GmailAuthorizationPageState = 'connected' | 'finishing' | 'cancelled' | 'failed'

type StateCopy = { chip: string; heading: string; body: string; button: string }

const COPY = {
  zh: {
    lang: 'zh-CN', title: 'Kun · Gmail 授权', hint: '也可以直接关闭这个页面', footer: '由这台电脑上的 Kun 提供',
    connected: { chip: 'Gmail 已连接', heading: '可以回到 Kun 了', body: '{email}已连接到这个对话。<br>回到 Kun，刚才的任务会自动继续。', button: '回到 Kun' },
    finishing: { chip: '正在连接', heading: 'Google 已授权', body: 'Kun 正在完成最后一步。<br>回到 Kun 就能看到结果。', button: '回到 Kun' },
    cancelled: { chip: '已取消', heading: '这次没有连接 Gmail', body: '你在 Google 页面取消了授权。<br>需要时在 Kun 里再点一次「连接」。', button: '回到 Kun' },
    failed: { chip: '没有完成', heading: 'Gmail 没能连上', body: '授权可能已经过期，或者少勾了权限。<br>回到 Kun 查看原因，再试一次。', button: '回到 Kun 查看' }
  },
  en: {
    lang: 'en', title: 'Kun · Gmail authorization', hint: 'You can also close this page', footer: 'Served by Kun on this computer',
    connected: { chip: 'Gmail connected', heading: 'You can head back to Kun', body: '{email}Now connected to this conversation.<br>Your task picks up again in Kun.', button: 'Back to Kun' },
    finishing: { chip: 'Connecting', heading: 'Google approved access', body: 'Kun is finishing the last step.<br>Head back to Kun to see the result.', button: 'Back to Kun' },
    cancelled: { chip: 'Cancelled', heading: 'Gmail wasn’t connected', body: 'Authorization was cancelled on the Google page.<br>Click “Connect” in Kun again whenever you need it.', button: 'Back to Kun' },
    failed: { chip: 'Didn’t finish', heading: 'Gmail couldn’t connect', body: 'The authorization may have expired or a permission was left unchecked.<br>Go back to Kun to see why and try again.', button: 'See why in Kun' }
  }
} as const

const ART: Record<GmailAuthorizationPageState, string> = {
  connected: KUN_CHEER_WEBP, finishing: KUN_LAPTOP_WEBP, cancelled: KUN_HEADSET_WEBP, failed: KUN_HEADSET_WEBP
}

const GMAIL_MARK = '<svg class="mark" viewBox="52 42 88 66" aria-hidden="true">' +
  '<path fill="#4285f4" d="M58 108h14V74L52 59v43c0 3.32 2.69 6 6 6"/><path fill="#34a853" d="M120 108h14c3.32 0 6-2.69 6-6V59l-20 15"/>' +
  '<path fill="#fbbc04" d="M120 48v26l20-15v-8c0-7.42-8.47-11.65-14.4-7.2"/><path fill="#ea4335" d="M72 74V48l24 18 24-18v26L96 92"/>' +
  '<path fill="#c5221f" d="M52 51v8l20 15V48l-5.6-4.2c-5.94-4.45-14.4-.22-14.4 7.2"/></svg>'

const CHIP_ICON: Record<GmailAuthorizationPageState, string> = {
  connected: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>',
  finishing: '<svg class="i spin" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 1 1-6.2-8.56"/></svg>',
  cancelled: '', failed: ''
}

const STYLE = `*{box-sizing:border-box}html,body{margin:0;height:100%}
body{--ink:#20242d;--ink2:#687083;--card:rgba(255,255,255,.94);--line:#e7e9ee;--btn:#4e67db;--btn-ink:#fff;--glow:rgba(78,103,219,.28);--ghost:#fff;--ok:#17834a;--ok-bg:#e8f6ee;--run:#3d55c9;--run-bg:#eceffd;--off:#4b5059;--off-bg:#f1f2f5;--bad:#b42318;--bad-bg:#fdecea;--ga:rgba(133,193,241,.7);--gb:rgba(255,212,165,.6);--wa:rgba(133,193,241,.4);--wb:rgba(108,162,221,.32);--wc:rgba(255,255,255,.88);
background:linear-gradient(180deg,#e4f0ff 0%,#eeecff 52%,#fdf4e8 100%);color:var(--ink);font:15px/1.6 -apple-system,BlinkMacSystemFont,"SF Pro Text","PingFang SC","Microsoft YaHei","Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
@media (prefers-color-scheme:dark){body{--ink:#e8eaf0;--ink2:#a1a8b5;--card:rgba(27,31,39,.94);--line:#2b303a;--btn:#78a3ea;--btn-ink:#0d1424;--glow:rgba(120,163,234,.2);--ghost:#232832;--ok:#5fd68f;--ok-bg:rgba(74,222,128,.12);--run:#9db8f5;--run-bg:rgba(120,163,234,.14);--off:#c3c8d2;--off-bg:rgba(255,255,255,.08);--bad:#ff9b8f;--bad-bg:rgba(255,107,91,.14);--ga:rgba(52,104,190,.55);--gb:rgba(96,78,190,.45);--wa:rgba(84,136,214,.3);--wb:rgba(62,104,184,.26);--wc:rgba(150,186,240,.14);background:linear-gradient(180deg,#111a2f 0%,#161a35 55%,#1d1a2a 100%)}}
main{position:relative;display:flex;min-height:100%;flex-direction:column;align-items:center;justify-content:center;padding:96px 20px 72px;overflow:hidden}
.glow{position:absolute;border-radius:50%;filter:blur(44px);pointer-events:none}.a{width:320px;height:320px;left:-90px;top:-70px;background:var(--ga)}.b{width:300px;height:240px;right:-80px;bottom:90px;background:var(--gb)}
.card{position:relative;display:flex;width:min(380px,100%);flex-direction:column;align-items:center;padding:0 28px 26px;border:1px solid var(--line);border-radius:24px;background:var(--card);box-shadow:0 30px 70px rgba(20,30,50,.16);text-align:center;animation:rise .5s cubic-bezier(.2,.8,.2,1) both}
img{width:150px;height:150px;margin-top:-82px;animation:hop .6s .1s cubic-bezier(.34,1.56,.64,1) both}
.chip{display:inline-flex;align-items:center;gap:7px;height:28px;margin-top:4px;padding:0 12px;border-radius:999px;font-size:12.5px;font-weight:600}
.connected{background:var(--ghost);border:1px solid var(--line);color:var(--ink)}.connected .i{color:var(--ok)}.finishing{background:var(--run-bg);color:var(--run)}.cancelled{background:var(--off-bg);color:var(--off)}.failed{background:var(--bad-bg);color:var(--bad)}
.mark{width:16px;height:12px}.chip .i{width:13px;height:13px;stroke-width:2.4}
h1{margin:12px 0 0;font-size:24px;font-weight:650;letter-spacing:-.015em}p{margin:8px 0 0;color:var(--ink2);font-size:14px;line-height:1.7}.email{display:block;color:var(--ink);font-weight:500;overflow-wrap:anywhere}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;width:100%;height:48px;margin-top:20px;border-radius:13px;background:var(--btn);color:var(--btn-ink);font-size:15px;font-weight:600;text-decoration:none;box-shadow:0 12px 26px var(--glow);transition:transform .15s}
.btn.quiet{background:var(--ghost);color:var(--ink);border:1px solid var(--line);box-shadow:none}
.btn:hover{transform:translateY(-1px)}.btn:focus-visible{outline:2px solid var(--btn);outline-offset:3px}.btn svg{width:16px;height:16px}
.hint{margin-top:12px;color:var(--ink2);font-size:12.5px}footer{position:absolute;bottom:20px;color:var(--ink2);font-size:12px}
.waves{position:absolute;left:0;right:0;bottom:0;width:100%;height:90px}.w1{fill:var(--wa)}.w2{fill:var(--wb)}.w3{fill:var(--wc)}
svg.i{fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}.spin{animation:spin 1s linear infinite}
@keyframes rise{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}@keyframes hop{0%{opacity:0;transform:translateY(10px) scale(.94)}60%{opacity:1;transform:translateY(-4px) scale(1.02)}100%{transform:none}}@keyframes spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.card,img,.spin{animation:none}.btn{transition:none}}`

const WAVES = '<svg class="waves" viewBox="0 0 1200 112" preserveAspectRatio="none" aria-hidden="true">' +
  '<path class="w1" d="M0 62C100 34 200 34 300 62S500 90 600 62S800 34 900 62S1100 90 1200 62V112H0Z"/>' +
  '<path class="w2" d="M0 58C120 82 180 82 300 58S480 34 600 58S780 82 900 58S1080 34 1200 58V112H0Z"/>' +
  '<path class="w3" d="M0 66C90 46 210 46 300 66S510 86 600 66S810 46 900 66S1110 86 1200 66V112H0Z"/></svg>'

const ARROW = '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>'

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`)
}

function language(request: IncomingMessage): keyof typeof COPY {
  return /^\s*zh\b/i.test(String(request.headers['accept-language'] || '')) ? 'zh' : 'en'
}

/** Self-contained result page for the loopback callback: no network, no scripts, no request data echoed back. */
export function renderGmailAuthorizationPage(input: {
  state: GmailAuthorizationPageState
  lang: keyof typeof COPY
  email?: string
  nonce: string
}): string {
  const copy = COPY[input.lang]
  const state: StateCopy = copy[input.state]
  const email = input.email ? `<span class="email">${escapeHtml(input.email)}</span>` : ''
  const body = state.body.replace('{email}', email)
  const chipLead = input.state === 'connected' ? GMAIL_MARK : ''
  const quiet = input.state === 'cancelled' ? ' quiet' : ''
  return `<!doctype html><html lang="${copy.lang}"><head><meta charset="utf-8">` +
    '<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark">' +
    `<title>${copy.title}</title><style nonce="${input.nonce}">${STYLE}</style></head>` +
    `<body><main><span class="glow a"></span><span class="glow b"></span>${WAVES}` +
    `<section class="card" role="${input.state === 'failed' ? 'alert' : 'status'}"><img src="${ART[input.state]}" alt="">` +
    `<span class="chip ${input.state}">${chipLead}${state.chip}${CHIP_ICON[input.state]}</span>` +
    `<h1>${state.heading}</h1><p>${body}</p>` +
    `<a class="btn${quiet}" href="${RETURN_LINK}">${state.button}${ARROW}</a>` +
    `<span class="hint">${copy.hint}</span></section><footer>${copy.footer}</footer></main></body></html>`
}

export function sendGmailAuthorizationPage(
  request: IncomingMessage,
  response: ServerResponse,
  state: GmailAuthorizationPageState,
  email?: string
): void {
  const nonce = randomBytes(16).toString('base64')
  response.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'content-security-policy': `default-src 'none'; style-src 'nonce-${nonce}'; img-src data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`
  })
  response.end(renderGmailAuthorizationPage({ state, lang: language(request), email, nonce }))
}
