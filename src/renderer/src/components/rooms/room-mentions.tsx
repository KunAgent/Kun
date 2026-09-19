import type { JSONContent } from '@tiptap/core'
import type { Room } from '@shared/rooms-api'
import { AssistantMarkdown } from '../chat/AssistantMarkdown'

export const ROOM_ALL_MENTION = '*'
const escapeLabel = (value: string) => value.replace(/[\\[\]]/g, '\\$&')
export function roomMentionToken(id: string, label: string): string {
  return `[@${escapeLabel(label)}](${id === ROOM_ALL_MENTION ? '#kun-room-all' : '#kun-room-member-' + id})`
}
const mentionPattern = () => /\[@((?:\\.|[^\]\\])*)\]\((#kun-room-member-([A-Za-z0-9_-]+)|#kun-room-all)\)/g
export function roomRichContent(body: string, permitted: string[]): JSONContent {
  return { type: 'doc', content: body.split('\n').map((line) => {
    const content: JSONContent[] = []
    let offset = 0
    for (const match of line.matchAll(mentionPattern())) {
      const id = match[3] ?? ROOM_ALL_MENTION
      if (!permitted.includes(id)) continue
      if (match.index! > offset) content.push({ type: 'text', text: line.slice(offset, match.index) })
      content.push({ type: 'roomMention', attrs: { id, label: match[1].replace(/\\([\\[\]])/g, '$1') } })
      offset = match.index! + match[0].length
    }
    if (offset < line.length) content.push({ type: 'text', text: line.slice(offset) })
    return { type: 'paragraph', content }
  }) }
}
export function roomRichDraft(doc: JSONContent): { body: string; mentions: string[] } {
  const mentions = new Set<string>()
  const text = (node: JSONContent): string => {
    if (node.type === 'text') return node.text ?? ''
    if (node.type === 'hardBreak') return '\n'
    if (node.type === 'roomMention') {
      const id = String(node.attrs?.id ?? ''), label = String(node.attrs?.label ?? id)
      mentions.add(id)
      return roomMentionToken(id, label)
    }
    return (node.content ?? []).map(text).join(node.type === 'doc' ? '\n' : '')
  }
  return { body: text(doc), mentions: [...mentions] }
}
export function roomSendMentionIds(mentions: string[], room: Room): string[] {
  const enabled = room.members.filter((member) => member.enabled && !member.removedAt).map((member) => member.id)
  return [...new Set(mentions.flatMap((id) => id === ROOM_ALL_MENTION ? enabled : [id]))]
}

/** Preserve one Markdown document, with room-owned links intercepted before the generic link renderer. */
export function RoomMentionBody({ body, room, onMember }: { body: string; room?: Room; onMember?: (id: string) => void }) {
  return <div className="rooms-mention-body" onClickCapture={(event) => {
    const link = (event.target as HTMLElement).closest?.('a[href]')
    const href = link?.getAttribute('href'), id = href?.startsWith('#kun-room-member-') ? href.slice('#kun-room-member-'.length) : undefined
    if (!id && href !== '#kun-room-all') return
    event.preventDefault(); event.stopPropagation()
    if (id && (!room || room.members.some((member) => member.id === id))) onMember?.(id)
  }}><AssistantMarkdown text={body} streaming={false} className="ds-markdown rooms-message-markdown" /></div>
}

export function roomUnmarkMentions(body: string, removed: string[]): string {
  return body.replace(mentionPattern(), (whole, label: string, _target: string, id?: string) =>
    removed.includes(id ?? ROOM_ALL_MENTION) ? '@' + label : whole)
}
