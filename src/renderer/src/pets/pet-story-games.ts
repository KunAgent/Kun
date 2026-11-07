import { arc, beat, body, celebrate, cue, foot, gesture, hand, lerp, prop, type StoryContext } from './pet-story-types'

export function gameStory(c: StoryContext): void {
  const { p, w, h, host, lead, actors } = c
  switch (c.scene) {
    case 'beatbox': {
      beat(c, [[0, '看我的运球', 'Watch this dribble'], [.27, '传给你，接好', 'Catch this!'], [.52, '接住，再传回来', 'Got it. Back to you'], [.81, '默契配合', 'Nice teamwork']])
      const captain = c.cast[0]?.sourceId === 'ikun' ? host : c.cast[c.leadIndex]?.sourceId === 'ikun' ? lead : host
      const partner = captain === host ? lead : host
      const a = hand(captain), b = hand(partner)
      const first = cue(p, .29, .45), back = cue(p, .64, .79)
      let x = a.x, y = a.y
      if (p < .27) y += Math.abs(Math.sin(Math.min(1, p / .27) * Math.PI * 3)) * (foot(captain) - a.y - 10)
      else if (p < .52) { x = lerp(a.x, b.x, first); y = lerp(a.y, b.y, first) - arc(p, .29, .45) * 30 }
      else { x = lerp(b.x, a.x, back); y = lerp(b.y, a.y, back) - arc(p, .64, .79) * 34 }
      if (p > .79) {
        const tuck = cue(p, .79, .86)
        x = lerp(x, captain.x - captain.facing * body(captain) * .27, tuck)
        y = lerp(y, captain.y + body(captain) * .20, tuck)
      }
      gesture(c, captain, 'waving', .01, .26); gesture(c, captain, 'waving', .27, .45)
      gesture(c, partner, 'waving', .38, .66); gesture(c, captain, 'waving', .73, .86)
      partner.tilt = -partner.facing * arc(p, .44, .53) * 8
      captain.tilt = -captain.facing * arc(p, .78, .86) * 6
      prop(c, 'ball', 'ball', x, y, 27, { rotation: p * 680, scale: 1 - .12 * arc(p, .44, .51), opacity: 1 - cue(p, .855, .86) })
      // iKun's ordinary frames carry a painted-in ball. Its neutral failed-row
      // frame has empty hands, so the pass never leaves a second ball behind.
      if (p < .86 && c.cast[actors.indexOf(captain)]?.sourceId === 'ikun') {
        captain.pose = 'failed'; captain.frame = 0
        captain.tilt += captain.facing * arc(p, .25, .44) * 9
        captain.lift += arc(p, .24, .43) * 3
      }
      celebrate(c, .86)
      break
    }
    case 'dance':
    case 'circle-dance': {
      const paired = c.scene === 'circle-dance'
      beat(c, [[0, paired ? '伸出手，邀请你' : '我做一遍，你来学', paired ? 'Shall we dance?' : 'Try this step'], [.22, paired ? '一左一右，跟着拍子' : '轮到你啦', paired ? 'Step together' : 'Your turn'], [.56, '这次一起跳', 'Now together'], [.87, '收步，鞠个躬', 'And take a bow']])
      const pulse = (from: number, to: number, cycles: number): number => p < from || p > to ? 0 : Math.sin((p - from) / (to - from) * Math.PI * 2 * cycles) * arc(p, from, to)
      const first = paired ? pulse(.22, .52, 2) : pulse(.08, .29, 2)
      const reply = paired ? -first : pulse(.32, .53, 2)
      const together = pulse(.57, .86, 3)
      host.x += (first + together) * w * .035
      lead.x += (reply - together) * w * .035
      host.tilt = (first + together) * 8; lead.tilt = (reply - together) * 8
      host.lift = Math.abs(first + together) * 5; lead.lift = Math.abs(reply - together) * 5
      gesture(c, host, paired ? 'waving' : 'jumping', .08, .87)
      gesture(c, lead, paired ? 'waving' : 'jumping', paired ? .22 : .32, .87)
      actors.slice(2).forEach((a, i) => { a.tilt = together * (i % 2 ? -5 : 5); a.lift = Math.abs(together) * 4; gesture(c, a, 'jumping', .57, .86) })
      actors.forEach((a) => { a.tilt += a.facing * arc(p, .88, .98) * 10 })
      break
    }
    case 'conga': {
      beat(c, [[0, '跟在我后面哦', 'Follow me'], [.25, '一个接一个出发', 'All aboard'], [.55, '小心转弯', 'Here comes a turn'], [.87, '到站啦', 'We’re here']])
      const merge = cue(p, .06, .27), travel = cue(p, .27, .83)
      const order = [host, lead, ...actors.filter((a) => a !== host && a !== lead)]
      order.forEach((a, i) => {
        const slot = (i + .5) / order.length
        const size = Math.min(body(a), w / (order.length + .8))
        a.scale = lerp(a.scale, size / a.size, merge)
        a.x = lerp(a.x, w * (.84 - slot * .68) + Math.sin(travel * Math.PI * 2 - i * .4) * w * .025, merge)
        a.y = lerp(a.y, h * .61 + Math.sin(travel * Math.PI * 2 - i * .4) * 16, merge)
        a.facing = 1; a.lift = arc(p, .27, .83) * Math.abs(Math.sin(p * 35 - i)) * 3
        gesture(c, a, 'running-right', .12 + i * .03, .85)
        gesture(c, a, 'waving', .88, .99)
      })
      break
    }
    case 'chase': {
      beat(c, [[0, '星星溜走啦', 'A runaway star'], [.24, '这边，我来接', 'This way!'], [.54, '差一点，接住啦', 'Almost… got it!'], [.82, '把星星送还给你', 'Here is your star']])
      const a = hand(lead)
      host.x += w * .12 * cue(p, .20, .54) * (1 - cue(p, .71, .91))
      gesture(c, lead, 'waving', .04, .22); gesture(c, host, 'running-right', .20, .51)
      host.lift = arc(p, .52, .65) * 16; gesture(c, host, 'jumping', .51, .68)
      const catchPoint = hand(host), travel = cue(p, .16, .56), give = cue(p, .79, .94)
      prop(c, 'star', 'star', lerp(lerp(a.x, catchPoint.x, travel), a.x, give),
        lerp(lerp(a.y, catchPoint.y, travel) - arc(p, .16, .56) * 40, a.y, give), 25, { rotation: p < .56 ? travel * 180 : 0 })
      lead.tilt = -arc(p, .54, .66) * 7; gesture(c, lead, 'waving', .79, .96)
      actors.slice(2).forEach((actor) => gesture(c, actor, 'waving', .58, .79))
      break
    }
    case 'race': {
      beat(c, [[0, '准备，出发！', 'Ready, go!'], [.16, '第一棒', 'First leg'], [.46, '交给你了', 'Your turn'], [.62, '冲过终点', 'To the finish'], [.86, '一起完成啦', 'We made it']])
      const run = cue(p, .15, .43), next = cue(p, .55, .83)
      const start = host.x, end = lead.x
      host.y -= h * .08 * cue(p, .44, .54)
      host.x = lerp(start, end - (body(host) + body(lead)) * .25, run)
      lead.x = lerp(end, w * .84, next)
      gesture(c, host, 'running-right', .15, .43); gesture(c, host, 'waving', .44, .61)
      gesture(c, lead, 'waving', .42, .56); gesture(c, lead, 'running-right', .56, .83)
      const a = hand(host), b = hand(lead, -1), pass = cue(p, .47, .53)
      prop(c, 'baton', 'baton', lerp(a.x, b.x, pass), lerp(a.y, b.y, pass), 26, { rotation: -25 })
      prop(c, 'finish', 'flag', w * .90, h * .73, 48, { behind: true })
      celebrate(c, .86)
      break
    }
    case 'hide-and-seek': {
      beat(c, [[0, '一、二、三……', 'One, two, three…'], [.27, '躲好了吗', 'Ready or not'], [.53, '我看到你啦', 'There you are!'], [.79, '被发现了，嘿嘿', 'You found me']])
      host.facing = p < .46 ? -1 : 1
      gesture(c, host, 'waiting', 0, .46)
      const peek = arc(p, .18, .36), reveal = cue(p, .53, .70)
      lead.y += 24 * (1 - reveal) - peek * 18
      lead.opacity = Math.max(peek * .85, reveal)
      lead.tilt = -peek * 12; gesture(c, lead, 'waving', .56, .81)
      prop(c, 'bush', 'bush', lead.x, foot(lead) - 6, 105, { opacity: 1 - cue(p, .83, .97) })
      host.x += w * .07 * cue(p, .46, .65)
      gesture(c, host, 'running-right', .46, .60)
      celebrate(c, .81)
      break
    }
    case 'leapfrog': {
      beat(c, [[0, '前面有个小水洼', 'A little puddle'], [.19, '我先跳过去', 'I’ll go first'], [.52, '我也来！', 'Me too!'], [.86, '鞋子没有湿', 'Dry feet!']])
      const first = cue(p, .19, .43), second = cue(p, .54, .80)
      host.x = lerp(host.x, w * .64, first)
      lead.x = lerp(lead.x, w * .30, second)
      lead.y -= h * .16 * cue(p, .10, .18) * (1 - cue(p, .44, .53))
      host.lift = arc(p, .19, .43) * 32; lead.lift = arc(p, .54, .80) * 28
      gesture(c, host, 'jumping', .19, .44); gesture(c, lead, 'jumping', .54, .81)
      prop(c, 'puddle', 'bubble', w * .49, h * .82, 56, { detail: 1, behind: true, opacity: .7 })
      celebrate(c, .87)
      break
    }
    case 'exercise': {
      beat(c, [[0, '休息一下，伸个懒腰', 'Time for a little stretch'], [.24, '向左，再向右', 'Left, then right'], [.64, '轻轻踮脚', 'Up on your toes'], [.88, '呼——舒服多了', 'Ah, that feels better']])
      actors.forEach((a, i) => {
        const delay = i * .018
        a.tilt = (arc(p - delay, .20, .40) - arc(p - delay, .43, .63)) * 12
        a.scale *= 1 + arc(p - delay, .65, .81) * .035
        a.lift = arc(p - delay, .65, .81) * 5
        gesture(c, a, 'waving', .06 + delay, .82)
      })
      break
    }
  }
}
