import { arc, beat, celebrate, cue, gesture, hand, lerp, prop, type StoryContext } from './pet-story-types'

export function workStory(c: StoryContext): void {
  const { p, w, h, host, lead, actors } = c
  const center = w * .50, deskY = h * .77
  switch (c.scene) {
    case 'brainstorm': {
      beat(c, [[0, '这个点子好像还差一点', 'Something is missing'], [.24, '把你的想法也放进来', 'Add your idea'], [.56, '啊，有办法了！', 'That’s it!'], [.85, '一起想到的', 'We figured it out together']])
      prop(c, 'desk', 'table', center, deskY + 13, 130, { behind: true })
      const reach = cue(p, .18, .36) * (1 - cue(p, .66, .81))
      host.x += w * .065 * reach; lead.x -= w * .065 * reach
      gesture(c, host, 'review', .02, .22); gesture(c, lead, 'review', .10, .25)
      gesture(c, lead, 'waving', .25, .52); gesture(c, host, 'waving', .39, .64)
      host.tilt = arc(p, .20, .52) * 7; lead.tilt = -arc(p, .25, .56) * 7
      const a = hand(host), b = hand(lead)
      prop(c, 'ideaA', 'brick', lerp(a.x, center - 15, cue(p, .39, .52)), lerp(a.y, deskY - 10, cue(p, .39, .52)), 25,
        { opacity: cue(p, .18, .24) * (1 - cue(p, .55, .62)), rotation: 10 })
      prop(c, 'ideaB', 'brick', lerp(b.x, center + 15, cue(p, .25, .39)), lerp(b.y, deskY - 10, cue(p, .25, .39)), 25,
        { opacity: cue(p, .18, .24) * (1 - cue(p, .55, .62)), rotation: -10 })
      prop(c, 'idea', 'bulb', center, deskY - 31, 49, { opacity: cue(p, .54, .64), detail: cue(p, .56, .70), scale: .8 + .2 * cue(p, .54, .67) })
      actors.slice(2).forEach((a, i) => { a.lift = arc(p, .62 + i * .04, .75 + i * .04) * 5; gesture(c, a, 'waving', .65, .84) })
      celebrate(c, .85)
      break
    }
    case 'coding': {
      beat(c, [[0, '我们一起搭起来', 'Let’s build it together'], [.20, '你来拼，我来敲', 'You build, I type'], [.61, '最后一块，放好了', 'The last piece'], [.84, '运行成功！', 'It works!']])
      prop(c, 'desk', 'table', center, deskY + 13, 140, { behind: true })
      prop(c, 'build', 'brick', center, deskY - 23, 47, { opacity: cue(p, .20, .42) })
      host.x += w * .05 * cue(p, .04, .18); lead.x -= w * .04 * cue(p, .04, .18)
      gesture(c, host, 'running', .20, .79)
      host.tilt = p > .20 && p < .79 ? Math.sin(p * 160) * 1.4 : 0
      gesture(c, lead, 'waving', .28, .46); gesture(c, lead, 'waving', .55, .74)
      const b = hand(lead)
      const placement = cue(p, .56, .72)
      prop(c, 'piece', 'brick', lerp(b.x, center + 32, placement), lerp(b.y, deskY + 3, placement), 22,
        { opacity: cue(p, .23, .28), rotation: -12 * (1 - placement) })
      actors.slice(2).forEach((a, i) => gesture(c, a, 'review', .30 + i * .12, .60 + i * .12))
      celebrate(c, .85)
      break
    }
    case 'debug': {
      beat(c, [[0, '等等，有只小 Bug', 'Wait, a little bug'], [.24, '你拦这边，我来抓', 'Block that side'], [.55, '网住啦', 'Caught it'], [.83, '问题解决了', 'All clear']])
      const chase = cue(p, .19, .48), caught = cue(p, .54, .65)
      const bugX = lerp(w * .65, w * .45, chase), bugY = h * .80 - arc(p, .20, .48) * 10
      host.x += w * .09 * cue(p, .22, .45); lead.x -= w * .07 * cue(p, .30, .50)
      gesture(c, host, 'running-right', .22, .45); gesture(c, lead, 'running-left', .30, .50)
      gesture(c, host, 'waving', .45, .71); gesture(c, lead, 'waving', .48, .71)
      lead.tilt = -arc(p, .48, .67) * 12
      prop(c, 'bug', 'bug', bugX, bugY, 23, { opacity: 1 - cue(p, .61, .70), rotation: Math.sin(p * 70) * 9 * (1 - caught) })
      prop(c, 'net', 'net', lerp(hand(lead).x, bugX, caught), lerp(hand(lead).y, bugY - 5, caught), 59,
        { rotation: lerp(-60, -8, caught), opacity: cue(p, .30, .40) * (1 - cue(p, .75, .84)) })
      prop(c, 'spark', 'spark', bugX, bugY - 9, 26, { opacity: arc(p, .63, .75) })
      celebrate(c, .84)
      break
    }
    case 'review': {
      beat(c, [[0, '看看我做的这个', 'Look what I made'], [.27, '让我仔细看看', 'Let me take a look'], [.59, '这一点做得真好', 'This part is lovely'], [.84, '收到你的鼓励啦', 'Thanks for the encouragement']])
      const forward = cue(p, .10, .27)
      lead.x -= w * .04 * forward
      const b = hand(lead)
      prop(c, 'project', 'book', b.x - 7, b.y + 8, 64, { detail: cue(p, .11, .28) })
      host.x += w * .08 * cue(p, .27, .43) * (1 - cue(p, .73, .85))
      host.tilt = arc(p, .29, .57) * 10
      gesture(c, lead, 'waving', .10, .31); gesture(c, host, 'review', .30, .59)
      actors.filter((a) => a !== lead).forEach((a, i) => { a.tilt += arc(p, .61 + i * .045, .72 + i * .045) * a.facing * 7; gesture(c, a, 'waving', .62 + i * .04, .78 + i * .04) })
      prop(c, 'approval', 'star', b.x + 5, b.y + 7, 16, { opacity: cue(p, .65, .73), scale: 1 + arc(p, .65, .76) * .3 })
      lead.lift = arc(p, .85, .96) * 8; gesture(c, lead, 'jumping', .85, .97)
      break
    }
    case 'study': {
      beat(c, [[0, '今天读这一页', 'Let’s read this page'], [.22, '凑近一点，一起看', 'Come closer'], [.46, '轻轻翻一页', 'Turn the page'], [.74, '原来是这样呀', 'Oh, now I see']])
      const settle = cue(p, .07, .25)
      host.x += w * .09 * settle; lead.x -= w * .07 * settle
      host.tilt = arc(p, .23, .79) * 6; lead.tilt = -arc(p, .23, .79) * 4
      prop(c, 'desk', 'table', center, deskY + 13, 132, { behind: true })
      prop(c, 'book', 'book', center, deskY - 14, 76, { detail: cue(p, .07, .22) })
      prop(c, 'page', 'page', center, deskY - 14, 65, { opacity: arc(p, .44, .61), detail: cue(p, .44, .61) })
      gesture(c, lead, 'review', .07, .42); gesture(c, lead, 'waving', .43, .62)
      gesture(c, host, 'waiting', .23, .73)
      actors.filter((a) => a !== lead).forEach((a, i) => { a.tilt += arc(p, .75 + i * .035, .87 + i * .035) * a.facing * 6 })
      prop(c, 'bookmark', 'ribbon', center + 17, deskY + 9, 18, { opacity: cue(p, .61, .67) })
      break
    }
  }
}
