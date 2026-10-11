import { randomBytes } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import kunCheer from '../../asset/img/kun-account/cheer.webp?inline'
import kunHeadset from '../../asset/img/kun-account/headset.webp?inline'
import { KUN_ACCOUNT_CALLBACK_PATH, KUN_ACCOUNT_RETURN_LINK } from './config'

const COPY = {
  zh: {
    lang: 'zh-CN', title: 'Kun 登录', open: '回到 Kun', footer: '由这台电脑上的 Kun 提供',
    ok: { chip: '已确认', heading: '登录已确认', body: 'Kun 正在完成最后一步。<br>回到 Kun 就能看到你的账号。', hint: '也可以直接关闭这个页面' },
    failed: { heading: '这次登录没有完成', body: '可能取消了授权，或者登录页已经过期。<br>回到 Kun 再点一次「登录」就好。', hint: '这个页面可以关闭' }
  },
  en: {
    lang: 'en', title: 'Kun sign-in', open: 'Back to Kun', footer: 'Served by Kun on this computer',
    ok: { chip: 'Confirmed', heading: 'Sign-in confirmed', body: 'Kun is finishing the last step.<br>Head back to Kun to see your account.', hint: 'You can also close this page' },
    failed: { heading: 'Sign-in didn’t finish', body: 'Authorization may have been declined, or the page expired.<br>Go back to Kun and click “Sign in” again.', hint: 'You can close this page' }
  }
} as const

const STYLE = `*{box-sizing:border-box}html,body{margin:0;height:100%}
body{--ink:#20242d;--ink2:#687083;--card:rgba(255,255,255,.92);--line:#e7e9ee;--btn:#4e67db;--btn-ink:#fff;--glow:rgba(78,103,219,.28);--ok:#17834a;--ok-bg:#e8f6ee;--ga:rgba(133,193,241,.7);--gb:rgba(255,212,165,.6);--wa:rgba(133,193,241,.4);--wb:rgba(108,162,221,.32);--wc:rgba(255,255,255,.88);--star:transparent;
background:linear-gradient(180deg,#e4f0ff 0%,#eeecff 52%,#fdf4e8 100%);color:var(--ink);font:15px/1.6 -apple-system,BlinkMacSystemFont,"SF Pro Text","PingFang SC","Microsoft YaHei","Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
@media (prefers-color-scheme:dark){body{--ink:#e8eaf0;--ink2:#a1a8b5;--card:rgba(27,31,39,.94);--line:#2b303a;--btn:#78a3ea;--btn-ink:#0d1424;--glow:rgba(120,163,234,.2);--ok:#5fd68f;--ok-bg:rgba(74,222,128,.12);--ga:rgba(52,104,190,.55);--gb:rgba(96,78,190,.45);--wa:rgba(84,136,214,.3);--wb:rgba(62,104,184,.26);--wc:rgba(150,186,240,.14);--star:#dfe8ff;background:linear-gradient(180deg,#111a2f 0%,#161a35 55%,#1d1a2a 100%)}}
main{position:relative;display:flex;min-height:100%;flex-direction:column;align-items:center;justify-content:center;padding:96px 20px 72px;overflow:hidden}
main::before{content:"";position:absolute;left:0;top:0;width:2px;height:2px;border-radius:50%;box-shadow:12vw 14vh var(--star),78vw 9vh var(--star),88vw 34vh var(--star),9vw 58vh var(--star),64vw 22vh var(--star),36vw 8vh var(--star)}
.glow{position:absolute;border-radius:50%;filter:blur(44px);pointer-events:none}.a{width:320px;height:320px;left:-90px;top:-70px;background:var(--ga)}.b{width:300px;height:240px;right:-80px;bottom:90px;background:var(--gb)}
.card{position:relative;display:flex;width:min(360px,100%);flex-direction:column;align-items:center;padding:0 28px 26px;border:1px solid var(--line);border-radius:24px;background:var(--card);box-shadow:0 30px 70px rgba(20,30,50,.16);text-align:center;animation:rise .5s cubic-bezier(.2,.8,.2,1) both}
img{width:150px;height:150px;margin-top:-82px;animation:hop .6s .1s cubic-bezier(.34,1.56,.64,1) both}
.chip{display:inline-flex;align-items:center;gap:6px;height:26px;margin-top:6px;padding:0 10px;border-radius:999px;background:var(--ok-bg);color:var(--ok);font-size:12.5px;font-weight:600}.chip svg{width:13px;height:13px}
h1{margin:10px 0 0;font-size:24px;font-weight:650;letter-spacing:-.015em}p{margin:8px 0 0;color:var(--ink2);font-size:14px;line-height:1.7}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;width:100%;height:48px;margin-top:20px;border-radius:13px;background:var(--btn);color:var(--btn-ink);font-size:15px;font-weight:600;text-decoration:none;box-shadow:0 12px 26px var(--glow);transition:transform .15s}
.btn:hover{transform:translateY(-1px)}.btn:focus-visible{outline:2px solid var(--btn);outline-offset:3px}.btn svg{width:16px;height:16px}
.hint{margin-top:12px;color:var(--ink2);font-size:12.5px}footer{position:absolute;bottom:20px;color:var(--ink2);font-size:12px}
.waves{position:absolute;left:0;right:0;bottom:0;width:100%;height:90px}.w1{fill:var(--wa)}.w2{fill:var(--wb)}.w3{fill:var(--wc)}
svg.i{fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
@keyframes rise{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}@keyframes hop{0%{opacity:0;transform:translateY(10px) scale(.94)}60%{opacity:1;transform:translateY(-4px) scale(1.02)}100%{transform:none}}
@media (prefers-reduced-motion:reduce){.card,img{animation:none}.btn{transition:none}}`

const WAVES = '<svg class="waves" viewBox="0 0 1200 112" preserveAspectRatio="none" aria-hidden="true">' +
  '<path class="w1" d="M0 62C100 34 200 34 300 62S500 90 600 62S800 34 900 62S1100 90 1200 62V112H0Z"/>' +
  '<path class="w2" d="M0 58C120 82 180 82 300 58S480 34 600 58S780 82 900 58S1080 34 1200 58V112H0Z"/>' +
  '<path class="w3" d="M0 66C90 46 210 46 300 66S510 86 600 66S810 46 900 66S1110 86 1200 66V112H0Z"/></svg>'

function language(request?: IncomingMessage): keyof typeof COPY {
  return /^\s*zh\b/i.test(String(request?.headers['accept-language'] || '')) ? 'zh' : 'en'
}

/** The loopback result page: no network, no external assets, no request data echoed back. */
export function sendAccountCallbackPage(response: ServerResponse, ok: boolean, request?: IncomingMessage): void {
  const nonce = randomBytes(16).toString('base64')
  const copy = COPY[language(request)]
  const state = ok ? copy.ok : copy.failed
  response.writeHead(ok ? 200 : 400, {
    'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; img-src data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`
  })
  const chip = ok
    ? `<span class="chip"><svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>${copy.ok.chip}</span>`
    : ''
  response.end(`<!doctype html><html lang="${copy.lang}"><head><meta charset="utf-8">` +
    '<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark">' +
    `<title>${copy.title}</title><style nonce="${nonce}">${STYLE}</style>` +
    `<script nonce="${nonce}">history.replaceState(null,'','${KUN_ACCOUNT_CALLBACK_PATH}')</script></head>` +
    `<body><main><span class="glow a"></span><span class="glow b"></span>${WAVES}` +
    `<section class="card" role="${ok ? 'status' : 'alert'}"><img src="${ok ? kunCheer : kunHeadset}" alt="">${chip}` +
    `<h1>${state.heading}</h1><p>${state.body}</p>` +
    `<a class="btn" href="${KUN_ACCOUNT_RETURN_LINK}">${copy.open}<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg></a>` +
    `<span class="hint">${state.hint}</span></section><footer>${copy.footer}</footer></main></body></html>`)
}
