import { arc, beat, body, celebrate, cue, gesture, hand, lerp, prop, type StoryContext } from './pet-story-types'

export function lifeStory(c: StoryContext): void {
  const { p, w, h, host, lead, actors } = c
  switch (c.scene) {
    case 'tea': {
      beat(c, [[0, '坐下来，喝口热茶', 'Sit down for some tea'], [.19, '我给你倒一杯', 'Let me pour you a cup'], [.50, '碰个杯，慢慢喝', 'Cheers, take a little sip'], [.80, '放下杯子，聊一会儿', 'Settle in for a chat']])
      const tableY = h * .77, cupLeft = w * .43, cupRight = w * .59
      host.x += w * .04 * cue(p, .06, .18); lead.x -= w * .04 * cue(p, .06, .18)
      prop(c, 'table', 'table', w * .51, tableY + 14, 142, { behind: true })
      const pour = cue(p, .19, .30) * (1 - cue(p, .37, .46))
      prop(c, 'pot', 'pot', lerp(w * .57, cupLeft + 25, pour), tableY - 30 - pour * 12, 43,
        { rotation: -pour * 32, detail: arc(p, .27, .38) })
      const lift = cue(p, .50, .61) * (1 - cue(p, .72, .83))
      const meet = arc(p, .56, .65)
      prop(c, 'cupA', 'cup', cupLeft + meet * 12, tableY - 9 - lift * 31, 26, { rotation: -arc(p, .65, .73) * 17, detail: cue(p, .27, .38) })
      prop(c, 'cupB', 'cup', cupRight - meet * 12, tableY - 9 - lift * 31, 26, { rotation: arc(p, .65, .73) * 17, detail: 1 })
      gesture(c, lead, 'waving', .19, .45); gesture(c, host, 'waving', .50, .77); gesture(c, lead, 'waving', .50, .77)
      host.tilt = arc(p, .65, .75) * 4; lead.tilt = -host.tilt
      prop(c, 'clink', 'spark', (cupLeft + cupRight) / 2, tableY - 38, 19, { opacity: arc(p, .60, .65) })
      actors.slice(2).forEach((a, i) => { a.tilt = arc(p, .83 + i * .025, .96) * a.facing * 5 })
      break
    }
    case 'stargazing': {
      beat(c, [[0, '看，那颗小星星', 'Look, a little star'], [.24, '再找到它的朋友', 'Find its friends'], [.55, '连起来是什么呢', 'What shape do they make?'], [.82, '把今晚的星空记住', 'Remember this little sky']])
      prop(c, 'moon', 'moon', w * .79, h * .21, 40, { opacity: cue(p, .02, .14), behind: true })
      for (let i = 0; i < 4; i++) prop(c, `star${i}`, 'star', w * [.30, .44, .59, .66][i], h * [.27, .18, .26, .39][i], 13 + i % 2 * 3,
        { opacity: cue(p, .10 + i * .12, .18 + i * .12), scale: 1 + arc(p, .10 + i * .12, .22 + i * .12) * .25, behind: true })
      prop(c, 'sky', 'constellation', w * .48, h * .28, w * .40, { opacity: cue(p, .56, .76), detail: cue(p, .55, .77), behind: true })
      actors.forEach((a, i) => {
        a.y += h * .06 * cue(p, .04, .15)
        a.tilt = (i % 2 ? -1 : 1) * arc(p, .18 + i * .035, .84) * 5
        gesture(c, a, 'waiting', .15, .98)
      })
      gesture(c, lead, 'waving', .08, .26); gesture(c, host, 'waving', .31, .49)
      break
    }
    case 'bubbles': {
      beat(c, [[0, '轻轻吹一口气', 'A gentle puff'], [.24, '泡泡飞起来啦', 'Here come the bubbles'], [.51, '用手指轻轻碰一下', 'A tiny touch'], [.79, '啵！再吹一个', 'Pop! One more']])
      const a = hand(lead)
      prop(c, 'wand', 'wand', a.x - 8, a.y - 7, 33, { rotation: -18, opacity: 1 })
      gesture(c, lead, 'waving', .06, .29)
      const flight = cue(p, .23, .63), target = hand(host)
      prop(c, 'bubble', 'bubble', lerp(a.x - 12, target.x, flight), lerp(a.y - 13, target.y - 18, flight) - arc(p, .23, .63) * 22,
        29, { opacity: cue(p, .18, .26) * (1 - cue(p, .63, .67)), scale: .4 + .6 * cue(p, .18, .27) })
      prop(c, 'tiny', 'bubble', lerp(a.x - 4, w * .56, cue(p, .30, .94)), lerp(a.y - 16, h * .26, cue(p, .30, .94)), 16,
        { opacity: cue(p, .29, .37) * (1 - cue(p, .88, .98)) })
      host.x += w * .03 * cue(p, .43, .55)
      host.lift = arc(p, .54, .71) * 9; gesture(c, host, 'waving', .49, .72)
      prop(c, 'pop', 'spark', target.x, target.y - 18, 34, { opacity: arc(p, .64, .72), scale: .7 + cue(p, .64, .72) * .5 })
      celebrate(c, .81)
      break
    }
    case 'orchestra': {
      beat(c, [[0, '三、二、一，起', 'Three, two, one'], [.23, '你来接这一拍', 'Take the next beat'], [.55, '一起合奏', 'Play together'], [.87, '最后一拍，收', 'And… finish']])
      const drumsY = h * .79
      prop(c, 'drumA', 'drum', host.x, drumsY, 49)
      prop(c, 'drumB', 'drum', lead.x, drumsY, 43)
      const first = p > .08 && p < .23, reply = p > .28 && p < .45, together = p > .56 && p < .85
      const bounce = Math.abs(Math.sin(p * 120))
      host.tilt = first || together ? bounce * 4 : 0
      lead.tilt = reply || together ? -bounce * 4 : 0
      gesture(c, host, 'waving', .08, .23); gesture(c, lead, 'waving', .28, .45)
      actors.forEach((a) => gesture(c, a, 'waving', .56, .85))
      const ha = hand(host), hb = hand(lead)
      prop(c, 'stickA', 'baton', ha.x - 12, ha.y + 8 + (first || together ? bounce * 8 : 0), 32, { rotation: 45 })
      prop(c, 'stickB', 'baton', hb.x + 12, hb.y + 8 + (reply || together ? bounce * 8 : 0), 30, { rotation: -45 })
      prop(c, 'noteA', 'note', host.x + body(host) * .40, host.y - 9 - bounce * 4, 19, { opacity: first || together ? .9 : 0 })
      prop(c, 'noteB', 'note', lead.x - body(lead) * .40, lead.y - 9 - bounce * 4, 19, { opacity: reply || together ? .9 : 0 })
      actors.forEach((a, i) => { a.tilt += a.facing * arc(p, .88 + i * .01, .99) * 9 })
      break
    }
  }
}
