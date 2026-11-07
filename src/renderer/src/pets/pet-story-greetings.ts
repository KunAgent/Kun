import { arc, beat, body, celebrate, cue, gesture, hand, lerp, prop, type StoryContext } from './pet-story-types'

/** Invitations, physical contact and delayed responses, not simultaneous waving. */
export function greetingStory(c: StoryContext): void {
  const { p, host, lead, w, h, actors } = c
  switch (c.scene) {
    case 'welcome': {
      beat(c, [[0, '咦，是你呀', 'Oh, hello!'], [.24, '过来坐坐', 'Come a little closer'], [.52, '很高兴见到你', 'Good to see you'], [.84, '下次再一起玩', 'Let’s play again']])
      gesture(c, host, 'waving', .08, .26)
      lead.x -= w * .09 * cue(p, .27, .43)
      gesture(c, lead, 'running-left', .27, .43)
      gesture(c, lead, 'waving', .45, .65)
      host.tilt = arc(p, .51, .66) * 7
      lead.tilt = -arc(p, .64, .77) * 7
      actors.slice(2).forEach((actor, i) => gesture(c, actor, 'waving', .67 + i * .09, .79 + i * .09))
      prop(c, 'heart', 'heart', w * .5, h * .49, 19, { opacity: arc(p, .55, .78), scale: .7 + .3 * arc(p, .55, .78) })
      break
    }
    case 'high-five': {
      beat(c, [[0, '击个掌？', 'High five?'], [.22, '来啦', 'Coming!'], [.47, '啪！', 'High five!'], [.67, '默契满分', 'Perfect timing']])
      const approach = cue(p, .18, .40) * (1 - cue(p, .65, .82))
      const contact = w * .52
      host.x = lerp(host.x, contact - body(host) * .27, approach)
      lead.x = lerp(lead.x, contact + body(lead) * .27, approach)
      lead.y = lerp(lead.y, host.y + (body(host) - body(lead)) * .12, approach)
      gesture(c, host, 'waving', .07, .60)
      gesture(c, lead, 'running-left', .18, .37)
      gesture(c, lead, 'waving', .38, .62)
      host.tilt = arc(p, .43, .58) * 6; lead.tilt = -host.tilt
      const a = hand(host), b = hand(lead)
      prop(c, 'contact', 'spark', (a.x + b.x) / 2, (a.y + b.y) / 2, 30, { opacity: arc(p, .47, .54), scale: .6 + arc(p, .47, .54) * .5 })
      celebrate(c, .72)
      break
    }
    case 'wave-relay': {
      beat(c, [[0, '悄悄打个招呼', 'A little hello'], [.24, '收到，传给你', 'Your turn'], [.72, '大家都收到啦', 'Everyone got it']])
      const order = [host, lead, ...actors.filter((a) => a !== host && a !== lead)]
      order.forEach((actor, i) => {
        const start = .06 + i * .62 / order.length
        gesture(c, actor, 'waving', start, start + .18)
        actor.tilt = arc(p, start, start + .18) * actor.facing * 8
        if (i > 0) actor.lift = arc(p, start - .04, start + .03) * 4
      })
      actors.forEach((a) => gesture(c, a, 'waving', .82, .98))
      break
    }
    case 'cheer': {
      beat(c, [[0, '做到了！', 'We did it!'], [.22, '把好消息告诉大家', 'Share the good news'], [.58, '一起庆祝', 'Celebrate together'], [.86, '给你一个赞', 'Well done']])
      gesture(c, host, 'review', .03, .22)
      gesture(c, host, 'waving', .22, .46)
      actors.forEach((a, i) => { a.lift = arc(p, .33 + i * .055, .48 + i * .055) * 10; gesture(c, a, 'jumping', .33 + i * .055, .51 + i * .055) })
      celebrate(c, .64)
      for (let i = 0; i < 5; i++) prop(c, `confetti${i}`, 'star', w * (.22 + i * .14), h * (.28 + cue(p, .63, .85) * .13), 9 + i % 2 * 4,
        { opacity: arc(p, .63, .86), rotation: i * 57 + cue(p, .63, .85) * 100 })
      break
    }
    case 'finale': {
      beat(c, [[0, '谢谢今天的陪伴', 'Thanks for today'], [.25, '轮到你啦', 'Take a bow'], [.73, '我们下次见', 'See you next time']])
      actors.forEach((a, i) => {
        const start = .05 + i * .60 / actors.length
        a.tilt = arc(p, start, start + .18) * a.facing * 14
        gesture(c, a, 'review', start, start + .18)
        gesture(c, a, 'waving', .78, .98)
      })
      break
    }
    case 'gift': {
      beat(c, [[0, '给你准备了小惊喜', 'A little surprise for you'], [.25, '轻轻接好', 'Here you go'], [.56, '打开看看', 'Shall we open it?'], [.80, '谢谢你呀', 'Thank you!']])
      const closer = cue(p, .09, .24) * (1 - cue(p, .81, .95))
      host.x += w * .05 * closer; lead.x -= w * .05 * closer
      gesture(c, lead, 'waving', .12, .49); gesture(c, host, 'waving', .34, .60)
      const from = hand(lead), to = hand(host), passed = cue(p, .33, .47)
      const x = lerp(from.x, to.x, passed), y = lerp(from.y, to.y, passed)
      prop(c, 'present', 'gift', x, y, 36, { detail: cue(p, .58, .72), rotation: -arc(p, .52, .57) * 7 })
      const signature = c.cast[c.leadIndex]?.sourceId ?? ''
      const surprise = signature === 'claude-girl' || signature === 'glm-girl' ? 'book'
        : signature === 'gpt-girl' ? 'bulb' : signature === 'ikun' ? 'ball'
        : signature === 'kimi-girl' ? 'moon' : signature === 'doubao-girl' ? 'cup'
        : signature === 'minimax-girl' ? 'note' : signature === 'mimo-girl' ? 'computer'
        : signature === 'llama-girl' ? 'heart' : signature === 'gemini-girl' || signature === 'hunyuan-girl' ? 'star' : 'plant'
      prop(c, 'surprise', surprise, x, y - 20 * cue(p, .64, .77), 30,
        { opacity: cue(p, .65, .72), scale: .5 + .5 * cue(p, .64, .78) })
      lead.tilt = -arc(p, .73, .84) * 7
      celebrate(c, .84)
      break
    }
  }
}
