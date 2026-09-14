export type ProtectedRoomDialogContent = { title: string; subtitle: string; body: string; workspace?: string;
  workspaceLabel: string; footnote: string; cancelLabel: string; confirmLabel: string; dark: boolean; accent?: boolean }
export function protectedRoomDialogHtml(content: ProtectedRoomDialogContent, nonce: string) {
  const payload = JSON.stringify(content).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'; frame-src 'none'">
<style nonce="${nonce}">
*{box-sizing:border-box}body{margin:0;background:${content.dark ? '#181a1d' : '#f9fbfc'};color:${content.dark ? '#e9edf2' : '#243244'};font:14px -apple-system,BlinkMacSystemFont,sans-serif}
main{padding:26px;display:flex;flex-direction:column;height:100vh;gap:14px}header{display:flex;gap:12px;align-items:center}.icon{display:grid;place-items:center;width:40px;height:40px;border-radius:12px;background:${content.dark ? '#283440' : '#e9f1f8'};font-size:23px}
h1{font-size:18px;font-weight:600;margin:0}h2{font-size:13px;font-weight:400;color:${content.dark ? '#a4b2c3' : '#637489'};margin:5px 0 0;overflow-wrap:anywhere}
pre{margin:0;min-height:58px;flex:1;overflow:auto;padding:14px;border:1px solid ${content.dark ? '#384049' : '#dce5ed'};border-radius:12px;background:${content.dark ? '#202429' : '#fff'};font:12px/1.7 ui-monospace,SFMono-Regular,monospace;white-space:pre-wrap;overflow-wrap:anywhere}
.workspace{font-size:12px;overflow-wrap:anywhere;max-height:65px;overflow:auto}.workspace strong{display:block;font-weight:500;margin-bottom:5px}p{font-size:12px;line-height:1.6;color:${content.dark ? '#a4b2c3' : '#637489'};margin:0}
footer{display:flex;gap:10px;justify-content:flex-end}button{border:1px solid ${content.dark ? '#384049' : '#dce5ed'};border-radius:10px;padding:10px 20px;background:transparent;color:inherit;font:500 13px inherit;cursor:pointer}
button.primary{background:${content.accent ? '#9a5016' : '#304a64'};color:white;border-color:transparent}button:hover{filter:brightness(.94)}button:focus-visible{outline:2px solid #6998c4;outline-offset:3px}
</style></head><body><main><header><div class="icon" aria-hidden="true">✓</div><div><h1 id="title"></h1><h2 id="subtitle"></h2></div></header>
<pre id="body" tabindex="0"></pre><div class="workspace" id="workspace"><strong id="workspace-label"></strong><span id="workspace-value"></span></div><p id="note"></p>
<footer><button id="cancel"></button><button id="confirm" class="primary"></button></footer></main>
<script nonce="${nonce}">const data=${payload};document.title='Kun · '+data.title;
for(const [id,value] of Object.entries({title:data.title,subtitle:data.subtitle,body:data.body,note:data.footnote,cancel:data.cancelLabel,confirm:data.confirmLabel,'workspace-label':data.workspaceLabel,'workspace-value':data.workspace||''}))document.getElementById(id).textContent=value;
if(!data.workspace)document.getElementById('workspace').hidden=true;
document.getElementById('cancel').onclick=(event)=>{if(event.isTrusted)window.kunProtectedRoom.confirm(false)};
document.getElementById('confirm').onclick=(event)=>{if(event.isTrusted)window.kunProtectedRoom.confirm(true)};
document.addEventListener('keydown',(event)=>{if(event.isTrusted&&event.key==='Escape')window.kunProtectedRoom.confirm(false)});
document.getElementById('cancel').focus();</script></body></html>`
}
