'use strict'
const assert = require('node:assert/strict')
const { writeFile, chmod } = require('node:fs/promises')
const { join } = require('node:path')

const rows = [
  ['swe-2-high', 'SWE-2'], ['swe-1-7-lightning-medium', 'SWE-1.7 Lightning'],
  ['claude-fable-5-1-medium', 'Claude Fable 5.1'], ['claude-opus-5-5-medium', 'Claude Opus 5.5'],
  ['gpt-6-astra-medium', 'GPT-6 Astra'], ['gpt-6-sol-medium', 'GPT-6 Sol'], ['gpt-6-luna-medium', 'GPT-6 Luna'],
  ['kimi-k3-high', 'Kimi K3'], ['glm-5-2', 'GLM-5.2 High'],
  ['fusion-gpt-6-astra-high-sidekick-swe-2-medium', 'Fusion (GPT-6 Astra High Thinking + SWE-2 Medium)'],
  ['fusion-gpt-6-sol-high-sidekick-swe-2-medium', 'Fusion (GPT-6 Sol High Thinking + SWE-2 Medium)']
]
async function writeDevinModelStub(root) {
  const path = join(root, 'devin-model-fixture')
  await writeFile(path, `#!${process.execPath}
if (process.argv.includes('--version')) { console.log('Devin CLI 3000.11.3'); process.exit(0) }
const rows = ${JSON.stringify(rows)}
let selected = rows[0][0]
const config = () => [
 { id:'model', name:'Model', category:'model', type:'select', currentValue:selected,
 options:rows.map(([value,name])=>({value,name,_meta:{'cognition.ai/supportsImages':!value.startsWith('glm')}})) },
 { id:'thought_level',name:'Reasoning',category:'thought_level',type:'select',currentValue:'medium',
 options:(selected.startsWith('gpt') ? ['low','medium','high'] : ['medium','high','max']).map(value=>({value,name:value})) }
]
const send = value => process.stdout.write(JSON.stringify(value)+'\\n')
require('node:readline').createInterface({input:process.stdin}).on('line', line => {
 let msg; try {msg=JSON.parse(line)}catch{return}
 if(msg.id === undefined)return
 let result={}
 if(msg.method==='initialize')result={protocolVersion:1,agentInfo:{name:'Devin fixture',version:'3000.11.3'},agentCapabilities:{loadSession:true},authMethods:[]}
 if(msg.method==='session/new'||msg.method==='session/load')result={sessionId:'devin-model-session',configOptions:config()}
 if(msg.method==='session/set_config_option') {
  if(msg.params.configId==='model')selected=msg.params.value
  result={configOptions:config()}
  send({jsonrpc:'2.0',method:'session/update',params:{sessionId:'devin-model-session',update:{sessionUpdate:'config_option_update',configOptions:config()}}})
 }
 send({jsonrpc:'2.0',id:msg.id,result})
})
`)
  await chmod(path, 0o755)
  return path
}

async function runDevinModelFlow({ page, poll, capture, resize }) {
  await page.locator('[data-agent-mode-trigger]').click()
  const devin = page.locator('[data-agent-mode-option="devin"]')
  await poll(() => devin.isEnabled(), 60_000, 'Devin model fixture ready')
  await devin.click()
  const trigger = page.locator('.ds-composer-model-picker button[aria-haspopup="menu"]').first()
  await poll(async () => (await trigger.innerText()).includes('SWE-2'), 30_000, 'Native display name applied')
  const open = async () => {
    await trigger.click()
    await page.getByRole('menuitem', { name: /Native sign-in|原生登录/u }).hover()
    await page.locator('[data-devin-model-list]').waitFor()
  }
  await open()
  const list = page.locator('[data-devin-model-list]')
  assert.equal(await list.locator('[data-devin-model^="fusion-"]').count(), 0)
  assert.match(await list.innerText(), /SWE-1.7 Lightning/u)
  assert.equal(await list.locator('[data-provider-icon="claude"]').count(), 2)
  await capture('devin-models-1-native')
  await list.locator('[data-devin-model-category="fusion"]').click()
  assert.equal(await list.locator('[data-devin-model]').count(), 2)
  assert.match(await list.innerText(), /SWE-2 Medium/u)
  await capture('devin-models-2-fusion')
  await list.locator('input[type="search"]').fill('GPT-6 Astra')
  assert.equal(await list.locator('[data-devin-model]').count(), 2)
  await list.locator('[data-devin-model="gpt-6-astra-medium"]').click()
  assert.match(await trigger.innerText(), /GPT-6 Astra/u)
  await open()
  await poll(async () => await list.locator('select option').count() === 3, 30_000, 'Model-specific reasoning choices loaded')
  assert.deepEqual(await list.locator('select option').evaluateAll(options => options.map(option => option.value)), ['low', 'medium', 'high'])
  assert.match(await list.innerText(), /Recently used|最近使用/u)
  await capture('devin-models-3-recent-and-reasoning')
  await resize(960, 700)
  await capture('devin-models-4-narrow')
  const box = await list.boundingBox()
  const viewport = await page.evaluate(() => ({width:innerWidth,height:innerHeight}))
  assert(box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width && box.y + box.height <= viewport.height)
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  return ['Native labels and provider icons replace opaque IDs', 'Fusion combinations have a separate category and readable partner names',
    'Search spans model names and Fusion combinations while selection preserves the native ID',
    'Selected-model reasoning choices and recently used models update in the existing picker', 'The model panel fits a 960px workbench without overflow']
}
module.exports = { writeDevinModelStub, runDevinModelFlow }
