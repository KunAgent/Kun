import type { RoomUserInput } from '../../components/rooms/rooms-client'
import { submitRoomUserInput } from '../../components/rooms/RoomChoiceCard'
import { MobileUserInput } from '../chat/MobileUserInput'

export function MobileRoomUserInput({ input, onUpdated, autoOpen = false }: {
  input: RoomUserInput
  onUpdated: () => Promise<void>
  autoOpen?: boolean
}) {
  return <MobileUserInput autoOpen={autoOpen} input={{
    kind: 'user_input', id: input.id, requestId: input.id, live: true, status: 'pending',
    questions: input.questions.length ? input.questions.map((question) => ({ ...question, header: '' }))
      : [{ id: input.id, header: '', question: input.prompt, options: [] }]
  }} resolve={async (id, action) => {
    await submitRoomUserInput(id, action.kind === 'cancel' ? { cancelled: true } : { answers: action.answers })
    // Submission already succeeded. A refresh failure must not invite a duplicate answer.
    void onUpdated().catch(() => undefined)
  }} />
}
