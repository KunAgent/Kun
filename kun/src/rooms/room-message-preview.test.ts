import { expect, it } from 'vitest'
import { roomMessagePreview } from './room-message-preview.js'

it('retains readable code, CJK, comparison operators and identifiers while removing formatting', () => {
  expect(roomMessagePreview('## **Review**\n> __Done__ with `request_id` and ~~old~~: 1 < 3.\n\n```ts\nconst value = 2\n```'))
    .toBe('Review Done with request_id and old: 1 < 3. const value = 2')
})

it('drops link destinations, reference definitions, raw HTML media and encoded data URLs', () => {
  expect(roomMessagePreview('[report][ref] ![image](data:image/png;base64,AAAA)\n' +
    '[ref]: https://private.test/token\n<img src="data:image/png;base64,AAAA">\n' +
    'data&#58;image/png;base64,AAAA https://private.test/query Keep &amp; share'))
    .toBe('report image Keep & share')
})
