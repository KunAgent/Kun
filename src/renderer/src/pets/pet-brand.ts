import openai from '../assets/provider-icons/openai.svg'
import claude from '../assets/provider-icons/claude.svg'
import grok from '../assets/provider-icons/grok.svg'
import kimi from '../assets/provider-icons/kimi.svg'
import gemini from '../assets/pet-brands/gemini.svg'
import zhipu from '../assets/provider-icons/zhipu.svg'
import minimax from '../assets/pet-brands/minimax.svg'
import mistral from '../assets/pet-brands/mistral.svg'
import doubao from '../assets/pet-brands/doubao.svg'
import deepseek from '../assets/provider-icons/deepseek.svg'
import qwen from '../assets/pet-brands/qwen.svg'
import hunyuan from '../assets/pet-brands/hunyuan.svg'
import meta from '../assets/pet-brands/meta.svg'
import bytedance from '../assets/pet-brands/bytedance.svg'
import xiaomi from '../assets/pet-brands/xiaomi.svg'

export type PetBrand = { name: string; icon: string; color?: string }

const brands: Record<string, PetBrand> = {
  'kun:whale-girl': { name: 'DeepSeek', icon: deepseek, color: '#4d6bfe' },
  'kun:gpt-girl': { name: 'GPT / OpenAI', icon: openai, color: '#10a37f' },
  'kun:claude-girl': { name: 'Claude / Anthropic', icon: claude, color: '#d97757' },
  'kun:grok-girl': { name: 'Grok / xAI', icon: grok, color: '#18181b' },
  'kun:kimi-girl': { name: 'Kimi', icon: kimi, color: '#18181b' },
  'kun:gemini-girl': { name: 'Gemini / Google', icon: gemini },
  'kun:glm-girl': { name: 'GLM / Zhipu', icon: zhipu, color: '#3859ff' },
  'kun:qwen-girl': { name: 'Qwen', icon: qwen },
  'kun:minimax-girl': { name: 'MiniMax', icon: minimax },
  'kun:seed-girl': { name: 'Seed / ByteDance', icon: bytedance },
  'kun:llama-girl': { name: 'Llama / Meta', icon: meta },
  'kun:mistral-girl': { name: 'Mistral', icon: mistral },
  'kun:hunyuan-girl': { name: 'Hunyuan', icon: hunyuan },
  'kun:mimo-girl': { name: 'MiMo / Xiaomi', icon: xiaomi, color: '#ff6900' },
  'kun:doubao-girl': { name: 'Doubao', icon: doubao }
}

export function petBrand(petId: string | null | undefined): PetBrand | null {
  return petId ? brands[petId] ?? null : null
}

export function petBrandBadgeLayout(width: number, row = 0, column = 0): { size: number; left: number; top: number } {
  const height = width * 208 / 192
  const size = Math.min(44, Math.max(12, Math.round(width * 0.22)))
  const x = row === 1 ? 0.82 : row === 2 ? 0.18 : 0.72
  const jump = row === 4 ? [0, -10, -18, -10, 0][column] ?? 0 : 0
  return { size, left: width * x, top: height * 0.77 + jump * width / 192 }
}
