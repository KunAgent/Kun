import type { ThreadRecord } from '../../contracts/threads.js'
import type { Turn } from '../../contracts/turns.js'
import type { TurnItem } from '../../contracts/items.js'
import type { RuntimeEvent } from '../../contracts/events.js'
import type { EventBus } from '../../ports/event-bus.js'
import type { KunToolBridgeHost } from '../../harness/kun-tool-bridge-host.js'
import { resolveTurnClientSurface } from '../../loop/turn-context-resolver.js'
import { DESIGN_OPEN_TOOL_NAME } from '../../adapters/tool/design-open-tool.js'
import { AcpError } from './acp-schema.js'

export type AcpDesignDeliveryHost = {
  bridge: Pick<KunToolBridgeHost, 'listTools' | 'releaseTurn'>
  events: Pick<EventBus, 'subscribe'>
}

/** What the current user message asks for, from this gate's point of view. */
export type DesignDeliveryIntent = 'required' | 'preferred' | 'declined' | 'none'

const canvasInstructions = [
  'Deliver the requested UI mockups on the Kun Design canvas in this conversation. Call design_open on the kun-tools MCP server (use its advertised tool name).',
  'Pass a title and screens with name and complete HTML, one board per screen or state. Use the in-app preview. A native artifact, Markdown, screenshot, or loose HTML file does not publish a Kun board.',
  'Do not implement the design in project code unless the user asks. Only report publication after the tool succeeds.'
].join(' ')
const canvasHint = 'If the user wants to see the UI, publish the screens to the Kun Design canvas with the advertised design_open tool. This is optional; follow an explicit code or file request instead.'
const recoveryMarker = 'Kun has no successful design_open result for this request.'
const recovery = `${recoveryMarker} Reuse the UI work already prepared; publish it now with the advertised kun-tools design_open tool, not another file or native artifact. Do not repeat denied actions or bypass permissions.`
const unavailable = 'Kun Design canvas was not published: design_open is unavailable on this ACP turn. Use a desktop Code turn with the Kun tool bridge available, or explicitly request a standalone file.'
const unpublished = 'Kun Design canvas was not published: the ACP agent did not return a successful design_open result. A standalone file or a statement that the design is ready is not a canvas delivery.'

// Quoted text, code fences, inline code, and block quotes are references, not a
// new instruction. This keeps a pasted transcript from forcing a delivery.
const codeFence = /```[\s\S]*?(?:```|$)/gu
const inlineCode = /`[^`\n]*`/gu
const quoted = /“[^”]*”|「[^」]*」|『[^』]*』|"[^"\n]*"/gu
const blockQuote = /^\s*>.*$/gmu

// These are deliberately small, bounded patterns over one normalized message.
// Broad noun lists plus a clause-level action are easier to audit than one
// giant optional-group regex, and none of them uses an unbounded wildcard.
const declineCanvas = /(?:不要|不用|无需|无须|不必|别|跳过|不做|不生成|不画|不出|不发布|不需要|不想|不打算|不是|并非|而非)[^。！？!?\n]{0,16}(?:设计稿|原型图|线框图|视觉稿|效果图|画布|design[_\s-]?open|design\s+canvas|mock[ -]?ups?|wireframes?)|\b(?:no|not|without|skip|avoid|don['’]t|do not|doesn['’]t|does not)\b[^.!?\n]{0,30}\b(?:canvas|design[_\s-]?open|mock[ -]?ups?|wireframes?|design drafts?)\b/iu
const declineRedesign = /(?:不要|不用|无需|无须|不必|别|跳过|不做|不需要|不想|不打算)[^。！？!?\n]{0,8}(?:重新设计|重设计|改版|设计一下|重做|重新做)|\b(?:don['’]t|do not|without)\b[^.!?\n]{0,20}\b(?:redesign|revamp|restyle)\b/iu
const statusStatement = /\bno (?:successful|usable|published|ready|working) (?:design[_\s-]?open|design\s+canvas|canvas|mock[ -]?ups?|wireframes?)\b/iu
const onlyFile = /(?:只|仅)(?:要|需|需要|想|给|输出|提供|生成|做|写|改|修改|交付|保留|用)?[^。！？!?\n]{0,14}(?:文件|代码|html|markdown|md|svg|png|图片|文本|文字|纯代码|源码)|(?:直接|只)(?:改|写|修改|实现|输出|生成)?[^。！？!?\n]{0,10}(?:代码|文件|html)|\b(?:only|just)\b[^.!?\n]{0,25}\b(?:code|files?|html|markdown|svg|text)\b|\b(?:code|file|html|text)[ -]only\b/iu
const singleComponent = /(?:只(?:要|做|画|生成|给|输出|提供)?)(?:一个|这个|该)?(?:组件|按钮|输入框|卡片|下拉框|弹窗|图标|icon)|\b(?:single|inline)\s+(?:(?:inline|small|simple|reusable|styled|icon)\s+){0,2}(?:component|button|input|card|dropdown|modal|icon)\b|\bjust\s+(?:a|an)?\s*(?:(?:inline|small|simple|reusable|styled|icon)\s+){0,2}(?:component|button|input|card|dropdown|modal|icon)\b|\bone\s+(?:(?:inline|small|simple|reusable|styled|icon)\s+){0,2}(?:component|button|input|card|dropdown|modal|icon)\b/iu
const componentMeasure = /(?:一个|单个|单独(?:的)?(?:一个)?|inline|内联)(?:inline|内联|简单|小|可复用)?的?(?:组件|按钮|输入框|卡片|下拉框|弹窗|图标|icon)/iu
const pageContext = /页面|页|界面|屏幕|布局|流程|page|screen|layout|flow/iu
const designSystem = /设计系统|组件库|design system|component library/iu
const discussion = /(?:为什么|为何|怎么|如何|怎样|排查|调查|调试|修复|检查|解释|说明|介绍|了解|看看|看一下|查看|预览|评审|评价|点评)[^。！？!?\n]{0,30}(?:设计稿|原型图|线框图|画布|设计画布|design[_\s-]?open|design\s+canvas)|\b(?:why|how|debug|troubleshoot|fix|explain|describe|review|assess|evaluate|what(?:'s| is)|does|doesn['’]t|not working|issue|error|problem|broken)\b[^.!?\n]{0,40}\b(?:design[_\s-]?open|design\s+canvas|canvas|mock[ -]?ups?|wireframes?)\b|(?:设计稿|原型图|线框图|画布|设计画布|design[_\s-]?open|design\s+canvas)[^。！？!?\n]{0,20}(?:功能|用法|报错|错误|失败|问题|不工作|没反应|怎么用|如何用|是什么|原理|文档|教程)|\b(?:design[_\s-]?open|design\s+canvas|canvas|mock[ -]?ups?|wireframes?)\b[^.!?\n]{0,25}\b(?:bug|error|issue|broken|not working|how to|what is|documentation|docs|tutorial)\b/iu
const explicitCanvas = /(?:发布到|放到|放在|添加到|显示在|打开)[^。！？!?\n]{0,10}(?:画布|设计画布|design\s+canvas|design[_\s-]?open)|(?:用|使用|调用|在)[^。！？!?\n]{0,20}(?:设计画布|design\s+canvas|design[_\s-]?open)|\b(?:use|open|publish|put|place|add|send|show)\b[^.!?\n]{0,40}\b(?:design[_\s-]?open|design\s+canvas)\b/iu
const generatesDesign = /(?:生成|绘制|画|制作|做|创建|产出|输出|提供|给我|想要|只要|仅要|来(?:一)?[个份套张]?|设计(?:一[个份套版张组]|几[张个份]|[\d两三四五六七八九十]+[张个份]|一下|新的?)|出(?:一[个份套版张]|几[张个份]|[\d两三四五六七八九十]+[张个份]|个|份|套|版|点|些))[^。！？!?\n]{0,18}(?:设计稿|原型图|线框图|视觉稿|效果图|高保真(?:设计|稿)?|低保真(?:设计|稿)?)|\b(?:create|make|draw|produce|generate|design|draft|publish|give me|provide|render|mock up|put)\b[^.!?\n]{0,55}\b(?:design drafts?|mock[ -]?ups?|wireframes?|high[- ]fidelity|low[- ]fidelity)\b/iu
const designNounRedesign = /(?:设计稿|原型图|线框图|视觉稿|效果图)[^。！？!?\n]{0,20}(?:重新设计|重设计|改版|设计一下|重新做|重做)|\b(?:redesign|revamp|restyle)\b[^.!?\n]{0,30}\b(?:design drafts?|mock[ -]?ups?|wireframes?)\b|\b(?:design drafts?|mock[ -]?ups?|wireframes?)\b[^.!?\n]{0,25}\b(?:redesign|revamp|restyle)\b/iu
const implementFromDesign = /(?:按|按照|根据|参考|基于|照着|依照|对照|用|拿)[^。！？!?\n]{0,12}(?:设计稿|原型图|线框图|视觉稿)[^。！？!?\n]{0,20}(?:实现|还原|落地|开发|编码|写代码|改代码|接入|做成|改成|转成|变成|替换|套用|生成(?:代码|页面|组件|html)|写(?:成|出来|页面|代码))|(?:实现|还原|落地|开发|编码|写代码|改代码|接入|做成|改成|转成|变成|替换|套用|生成(?:代码|页面|组件|html)|写(?:成|出来|页面|代码))[^。！？!?\n]{0,20}(?:设计稿|原型图|线框图|视觉稿)|(?:设计稿|原型图|线框图|视觉稿)[^。！？!?\n]{0,12}(?:改成|转成|变成|写成|做成|实现|还原|落地|开发|编码|接入|替换|套用)(?:代码|html|页面|组件)?|\b(?:use|follow|based on|from|according to|per)\b[^.!?\n]{0,25}\b(?:design|mock[ -]?up|wireframe)\b(?!\s+canvas)[^.!?\n]{0,25}\b(?:implement|build|code|develop|write|convert|translate|wire)\b|\b(?:implement|code|develop|convert|translate|wire up)\b[^.!?\n]{0,30}\b(?:design|mock[ -]?up|wireframe)\b(?!\s+canvas)|\b(?:build|write)\b[^.!?\n]{0,20}\bfrom (?:the |this |that |existing |provided )?(?:design|mock[ -]?up|wireframe)\b|\b(?:turn|convert|translate)\b[^.!?\n]{0,20}\b(?:design|mock[ -]?up|wireframe)\b[^.!?\n]{0,15}\binto (?:code|html|react|the app)\b/iu
const redesignUi = /(?:重新设计|重设计|改版|设计一下|重新做|重做)[^。！？!?\n]{0,20}(?:界面|页面|页|布局|ui|视觉|交互|样式|风格)|(?:界面|页面|页|布局|ui|视觉|交互|样式|风格)[^。！？!?\n]{0,20}(?:重新设计|重设计|改版|设计一下|重新做|重做)|\b(?:redesign|revamp|restyle)\b[^.!?\n]{0,35}\b(?:ui|screen|page|layout|interface|visual|style)\b|\b(?:ui|screen|page|layout|interface|visual|style)\b[^.!?\n]{0,30}\b(?:redesign|revamp|restyle)\b/iu
const designUi = /(?:设计|规划)[^。！？!?\n]{0,10}(?:页面|页|界面|布局|ui|视觉|交互|样式|风格)|(?:页面|页|界面|布局|ui|视觉|交互|样式|风格)[^。！？!?\n]{0,10}(?:设计|规划)|\bdesign\b[^.!?\n]{0,20}\b(?:page|screen|ui|layout|interface|visual|style)\b/iu

function withoutReferences(text: string): string {
  return text
    .replace(codeFence, ' ')
    .replace(inlineCode, code => code.toLowerCase() === '`design_open`' ? ' design_open ' : ' ')
    .replace(quoted, ' ')
    .replace(blockQuote, ' ')
    .replace(/[^\S\n]+/gu, ' ')
    .trim()
}

/**
 * Classify only a deliverable request. `preferred` is a soft hint for a pure
 * UI redesign; `declined` means the user explicitly chose code/files, an
 * existing design, or a single component over the canvas.
 * `none` leaves any earlier requirement in place for a neutral follow-up.
 */
export function classifyDesignIntent(text: string): DesignDeliveryIntent {
  const request = withoutReferences(text)
  if (!request) return 'none'
  // A constraint in one clause must not negate a different deliverable:
  // “只要设计稿，不要改代码” and “不用重新设计，请发布到画布” both request a board.
  const clauses = request.split(/[，,。.!?！？;；\n]+/u).filter(clause => clause.trim() && !statusStatement.test(clause))
  if (clauses.some(clause => declineCanvas.test(clause) || onlyFile.test(clause))) return 'declined'
  if (!designSystem.test(request) &&
      (singleComponent.test(request) || (componentMeasure.test(request) && !pageContext.test(request)))) return 'declined'
  const actions = clauses.filter(clause => !discussion.test(clause))
  if (actions.some(clause => explicitCanvas.test(clause))) return 'required'
  const create = actions.filter(clause => !declineRedesign.test(clause) && !implementFromDesign.test(clause))
  if (create.some(clause => generatesDesign.test(clause) || designNounRedesign.test(clause))) return 'required'
  if (actions.length > create.length) return 'declined'
  if (create.some(clause => redesignUi.test(clause) || designUi.test(clause))) return 'preferred'
  return 'none'
}

function publishedBoard(item: TurnItem, threadId: string, turnId: string): boolean {
  if (item.threadId !== threadId || item.turnId !== turnId || item.role !== 'tool' ||
      item.kind !== 'tool_result' || item.status !== 'completed' || item.isError ||
      item.toolName !== DESIGN_OPEN_TOOL_NAME) return false
  const output = item.output as { ok?: boolean; status?: string; designRequest?: { status?: string; documentId?: string; screens?: unknown[] } } | null
  const board = output?.designRequest
  return output?.ok === true && output.status === 'ready' && board?.status === 'ready' && Boolean(board.documentId) &&
    Array.isArray(board.screens) && board.screens.length > 0
}

function deniedDesignApproval(event: RuntimeEvent, threadId: string, turnId: string): boolean {
  return event.threadId === threadId && event.turnId === turnId &&
    event.kind === 'approval_resolved' && event.status === 'denied' &&
    event.toolName === DESIGN_OPEN_TOOL_NAME
}

/**
 * Main desktop Code only: this uses the MCP catalog; it never authorizes a
 * tool or changes harness policy. A successful receipt must be a completed
 * design_open result from this exact thread and turn; agent prose, files,
 * other tools, and prior turns never satisfy the gate.
 */
export function acpDesignDelivery(host: AcpDesignDeliveryHost | undefined, thread: ThreadRecord, turn: Turn,
  descriptorDelivered: boolean, items: readonly TurnItem[]) {
  if (!host || resolveTurnClientSurface(turn) !== 'gui' ||
      (turn.agentSurface ?? thread.agentSurface ?? 'code') !== 'code' ||
      turn.imContext || thread.roomContext || thread.executionUnit || thread.relation === 'side' ||
      turn.guiPlan || turn.guiDesignMode || turn.guiExcalidrawCanvas || turn.guiDesignArtifact ||
      (turn.mode ?? thread.mode) === 'plan' || turn.orchestration === 'graph') return undefined

  let required = false
  let published = false
  let denied = false
  let cancelled = false
  let availability: boolean | undefined
  let unsubscribe: (() => void) | undefined
  let closed = false

  const stopListening = () => {
    unsubscribe?.()
    unsubscribe = undefined
  }
  const startListening = () => {
    if (unsubscribe || closed) return
    unsubscribe = host.events.subscribe(thread.id, event => {
      if (event.threadId !== thread.id || event.turnId !== turn.id) return
      if ((event.kind === 'item_created' || event.kind === 'item_updated' || event.kind === 'item_completed') &&
          publishedBoard(event.item, thread.id, turn.id)) published = true
      if (deniedDesignApproval(event, thread.id, turn.id)) denied = true
      if (event.kind === 'turn_aborted') cancelled = true
    })
  }
  const toolAvailable = async (): Promise<boolean> => {
    if (!descriptorDelivered) return false
    if (availability === undefined) {
      availability = (await host.bridge.listTools(thread.id, turn.id))
        .some(tool => tool.name === DESIGN_OPEN_TOOL_NAME)
    }
    return availability === true
  }

  return {
    async instructions(text: string): Promise<string | undefined> {
      if (closed) return undefined
      const intent = classifyDesignIntent(text)
      if (intent === 'declined') {
        required = false
        stopListening()
        return undefined
      }
      // A neutral follow-up such as "continue" must not cancel an earlier request.
      if (intent === 'none') return undefined
      if (intent === 'required') required = true
      if (intent === 'required' && descriptorDelivered) startListening()
      let available = false
      try {
        available = await toolAvailable()
      } catch {
        available = false
      }
      if (!available) {
        if (intent === 'required') {
          stopListening()
          throw new AcpError('agent_error', unavailable)
        }
        return undefined
      }
      if (intent === 'required') {
        // The subscription is already active before the catalog read; take
        // the snapshot now so an already-applied result is not missed.
        published = published || items.some(item => publishedBoard(item, thread.id, turn.id))
        return canvasInstructions
      }
      return required ? canvasInstructions : canvasHint
    },
    /** Called after pending tools and user steering settle, never for refusal/cancellation. */
    correction(stopReason: string | undefined, timeLeft: boolean): string | undefined {
      return required && !published && !denied && !cancelled && stopReason === 'end_turn' && timeLeft ? recovery : undefined
    },
    assertPublished() {
      if (!required || published || cancelled) return
      if (denied) throw new AcpError('policy_denied', 'Kun Design canvas was not published: permission to call design_open was denied.')
      throw new AcpError('agent_error', unpublished)
    },
    close() {
      if (closed) return
      closed = true
      stopListening()
      host.bridge.releaseTurn(thread.id, turn.id)
    }
  }
}
