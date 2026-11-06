import type { BuiltinPetId } from '@shared/pets-builtin'
import { PET_SCENE_IDS, type PetSceneId } from '@shared/pets-ensemble'
import type { PetAnimationState } from '@shared/pets'

export type PetMotif = 'spark' | 'heart' | 'book' | 'moon' | 'star' | 'code' | 'music' |
  'leaf' | 'wind' | 'orbit' | 'coffee' | 'gift' | 'bug' | 'idea' | 'bubble' | 'ball'
export type PetPersona = { color: string; motif: PetMotif; role: [string, string]; pose: PetAnimationState }

// These are fictional performance roles, not claims about model capabilities.
export const PET_PERSONAS: Record<BuiltinPetId, PetPersona> = {
  'xiao-kun': { color: '#c38a35', motif: 'spark', role: ['小队长', 'Captain'], pose: 'waving' },
  ikun: { color: '#9275c4', motif: 'ball', role: ['节奏担当', 'Rhythm leader'], pose: 'jumping' },
  'whale-girl': { color: '#5279d4', motif: 'bubble', role: ['深海灵感', 'Ocean ideas'], pose: 'review' },
  'gpt-girl': { color: '#419780', motif: 'idea', role: ['灵感魔法', 'Idea magic'], pose: 'waving' },
  'claude-girl': { color: '#c17d56', motif: 'book', role: ['故事书房', 'Story time'], pose: 'review' },
  'grok-girl': { color: '#a1556f', motif: 'spark', role: ['惊喜捣蛋', 'Playful surprise'], pose: 'jumping' },
  'kimi-girl': { color: '#7786c3', motif: 'moon', role: ['月光向导', 'Moon guide'], pose: 'waiting' },
  'gemini-girl': { color: '#ad7cd4', motif: 'star', role: ['双星变奏', 'Twin stars'], pose: 'jumping' },
  'glm-girl': { color: '#5c7cab', motif: 'book', role: ['知识拼图', 'Knowledge puzzle'], pose: 'review' },
  'qwen-girl': { color: '#8274d4', motif: 'orbit', role: ['百变传话', 'Message relay'], pose: 'waving' },
  'minimax-girl': { color: '#cf7a80', motif: 'music', role: ['舞台导演', 'Stage director'], pose: 'waving' },
  'seed-girl': { color: '#6a9b77', motif: 'leaf', role: ['种子花园', 'Seed garden'], pose: 'jumping' },
  'llama-girl': { color: '#78a4cb', motif: 'heart', role: ['云朵拥抱', 'Cloud hugs'], pose: 'idle' },
  'mistral-girl': { color: '#c9904e', motif: 'wind', role: ['微风邮差', 'Breeze courier'], pose: 'running-right' },
  'hunyuan-girl': { color: '#589f9d', motif: 'orbit', role: ['旋涡编舞', 'Orbit dancer'], pose: 'waving' },
  'mimo-girl': { color: '#d88a51', motif: 'code', role: ['小小发明', 'Tiny inventions'], pose: 'running' },
  'doubao-girl': { color: '#a57e78', motif: 'coffee', role: ['暖心茶会', 'Cozy tea'], pose: 'waiting' }
}

type SceneDefinition = {
  title: [string, string]
  story: [string, string]
  group: 'greet' | 'play' | 'work' | 'life'
  motif: PetMotif
  duration: number
}

export const PET_SCENES: Record<PetSceneId, SceneDefinition> = {
  welcome: { title: ['伙伴见面会', 'Meet the crew'], story: ['Kun 逐个介绍，伙伴用自己的主题回应', 'Kun introduces each companion and their signature'], group: 'greet', motif: 'heart', duration: 12000 },
  'high-five': { title: ['击掌小分队', 'High-five team'], story: ['伙伴轮流靠近 Kun，击掌后跃起庆祝', 'Take turns greeting Kun, then jump together'], group: 'greet', motif: 'spark', duration: 14000 },
  'wave-relay': { title: ['挥手接力', 'Wave relay'], story: ['挥手信号从 Kun 传到每一个伙伴', 'Pass a wave from Kun through the whole crew'], group: 'greet', motif: 'heart', duration: 12000 },
  cheer: { title: ['通关庆祝', 'Victory cheer'], story: ['蓄力、接力欢呼，最后一起跳起来', 'Gather, cheer in sequence, then jump together'], group: 'greet', motif: 'star', duration: 10000 },
  dance: { title: ['Kun 领舞', 'Follow Kun'], story: ['Kun 打拍子，伙伴按各自节奏加入', 'Kun sets the beat; every companion joins in'], group: 'play', motif: 'music', duration: 12000 },
  'circle-dance': { title: ['星环圆舞', 'Orbit waltz'], story: ['围成星环，交错旋转再回到队形', 'Orbit together, then return to formation'], group: 'play', motif: 'orbit', duration: 14000 },
  conga: { title: ['快乐小火车', 'Companion train'], story: ['跟随 Kun 绕出一条弯弯的队伍', 'Follow Kun along a winding parade route'], group: 'play', motif: 'music', duration: 14000 },
  chase: { title: ['追逐星星', 'Chase the star'], story: ['Kun 放出星星，伙伴轮流追上它', 'Kun releases a star for the crew to chase'], group: 'play', motif: 'star', duration: 12000 },
  race: { title: ['折返接力赛', 'Shuttle relay'], story: ['一人出发、全队助威，传棒再折返', 'One runner at a time, with the crew cheering'], group: 'play', motif: 'ball', duration: 15000 },
  'hide-and-seek': { title: ['躲猫猫', 'Peekaboo'], story: ['Kun 转身数数，伙伴依次探头出现', 'Kun counts while companions peek out in turn'], group: 'play', motif: 'idea', duration: 12000 },
  leapfrog: { title: ['跳跳波浪', 'Jumping wave'], story: ['从 Kun 开始，一道跳跃波穿过队伍', 'Send a jumping wave across the crew'], group: 'play', motif: 'leaf', duration: 10000 },
  exercise: { title: ['课间伸伸腰', 'Stretch break'], story: ['一起伸腰、左右摇摆，再轻轻跳两下', 'Stretch, sway, and finish with gentle jumps'], group: 'play', motif: 'heart', duration: 14000 },
  brainstorm: { title: ['灵感圆桌', 'Idea circle'], story: ['伙伴贡献主题灵感，Kun 收集成一颗星', 'Share signature ideas; Kun gathers them into a star'], group: 'work', motif: 'idea', duration: 16000 },
  coding: { title: ['一起写代码', 'Build together'], story: ['Kun 分工，伙伴轮流构建，最后一起交付', 'Kun assigns roles; the crew builds and delivers'], group: 'work', motif: 'code', duration: 16000 },
  debug: { title: ['抓住小 Bug', 'Catch the bug'], story: ['Bug 在伙伴间跳动，全队协力围住它', 'A bug hops between companions until the crew catches it'], group: 'work', motif: 'bug', duration: 14000 },
  review: { title: ['成果评审会', 'Show and tell'], story: ['每个伙伴展示成果，Kun 和大家鼓掌', 'Each companion presents while the others applaud'], group: 'work', motif: 'book', duration: 15000 },
  study: { title: ['围坐读书', 'Reading circle'], story: ['轮流翻书讲故事，大家安静倾听', 'Take turns reading while the crew listens'], group: 'work', motif: 'book', duration: 18000 },
  orchestra: { title: ['AI 小乐团', 'Companion orchestra'], story: ['Kun 指挥，音符依次入场，最后全员合奏', 'Kun conducts individual entries and a full ensemble'], group: 'life', motif: 'music', duration: 16000 },
  beatbox: { title: ['节拍挑战', 'Rhythm challenge'], story: ['Kun 给节拍，伙伴轮流接招再齐舞', 'Trade rhythmic solos, then dance in sync'], group: 'play', motif: 'ball', duration: 14000 },
  gift: { title: ['惊喜传礼物', 'Pass the present'], story: ['礼物在伙伴间传递，打开各自主题的惊喜', 'Pass a gift that reveals each companion\'s signature'], group: 'life', motif: 'gift', duration: 16000 },
  tea: { title: ['午后茶话会', 'Afternoon tea'], story: ['Kun 邀大家围坐，伙伴轮流分享茶点', 'Gather around Kun and share a cozy tea break'], group: 'life', motif: 'coffee', duration: 18000 },
  stargazing: { title: ['一起看星空', 'Stargazing'], story: ['伙伴点亮专属星光，最后连成星座', 'Light up signature stars to form a constellation'], group: 'life', motif: 'moon', duration: 16000 },
  bubbles: { title: ['泡泡游园会', 'Bubble garden'], story: ['Kun 吹出泡泡，伙伴轻跳接住各自的泡泡', 'Kun blows bubbles for each companion to catch'], group: 'life', motif: 'bubble', duration: 14000 },
  finale: { title: ['全员谢幕', 'Curtain call'], story: ['逐个亮相、鞠躬，最后全员挥手谢幕', 'Individual entrances, bows, and a final wave'], group: 'greet', motif: 'spark', duration: 16000 }
}

export const PET_ENSEMBLE_PRESETS: Array<{
  id: string; title: [string, string]; scene: PetSceneId; members: BuiltinPetId[]
}> = [
  { id: 'workshop', title: ['小 Kun 的研发小队', 'Xiao Kun\'s workshop'], scene: 'coding',
    members: ['xiao-kun', 'whale-girl', 'gpt-girl', 'claude-girl', 'glm-girl'] },
  { id: 'rhythm', title: ['iKun 的节奏派对', 'iKun\'s rhythm party'], scene: 'beatbox',
    members: ['ikun', 'minimax-girl', 'grok-girl', 'gemini-girl'] },
  { id: 'moonlight', title: ['Kimi 的月下观星', 'Kimi\'s moonlight crew'], scene: 'stargazing',
    members: ['xiao-kun', 'kimi-girl', 'gemini-girl', 'hunyuan-girl'] },
  { id: 'teatime', title: ['豆包的暖心茶会', 'Doubao\'s cozy tea'], scene: 'tea',
    members: ['xiao-kun', 'ikun', 'doubao-girl', 'llama-girl', 'mistral-girl'] },
  { id: 'inventors', title: ['MiMo 的小小发明家', 'MiMo\'s tiny inventors'], scene: 'brainstorm',
    members: ['ikun', 'mimo-girl', 'seed-girl', 'qwen-girl', 'gpt-girl'] },
  { id: 'ocean', title: ['鲸鱼娘的泡泡花园', 'Whale Girl\'s bubble garden'], scene: 'bubbles',
    members: ['xiao-kun', 'ikun', 'whale-girl', 'seed-girl', 'llama-girl', 'hunyuan-girl'] }
]

export const PET_SCENE_DIRECTORS: Partial<Record<PetSceneId, BuiltinPetId>> = {
  orchestra: 'minimax-girl', stargazing: 'kimi-girl', bubbles: 'whale-girl',
  brainstorm: 'gpt-girl', coding: 'mimo-girl', study: 'claude-girl',
  review: 'glm-girl', tea: 'doubao-girl', gift: 'mistral-girl', 'circle-dance': 'hunyuan-girl'
}

export function petEnsembleText(text: [string, string], language: string): string {
  return text[language.toLowerCase().startsWith('zh') ? 0 : 1]
}

export function nextPetScene(scene: PetSceneId): PetSceneId {
  return PET_SCENE_IDS[(PET_SCENE_IDS.indexOf(scene) + 1) % PET_SCENE_IDS.length]
}
