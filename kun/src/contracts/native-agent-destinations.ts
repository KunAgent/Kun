/** Public vendor destinations used only to resolve desktop PAC policy for native CLIs. */
const modelApis = ['https://api.openai.com/', 'https://api.anthropic.com/', 'https://generativelanguage.googleapis.com/', 'https://openrouter.ai/']
export const NATIVE_CLI_DESTINATIONS: Readonly<Record<string, readonly string[]>> = {
  'gemini-cli': ['https://cloudcode-pa.googleapis.com/', 'https://oauth2.googleapis.com/', 'https://generativelanguage.googleapis.com/'],
  'cursor-cli': ['https://api2.cursor.sh/', 'https://cursor.com/'],
  copilot: ['https://api.github.com/', 'https://api.githubcopilot.com/', 'https://github.com/login/'],
  kimi: ['https://api.kimi.com/', 'https://auth.kimi.com/'],
  qoder: ['https://qoder.com/', 'https://api.qoder.com/'],
  'qoder-cn': ['https://qoder.cn/', 'https://api.qoder.cn/'],
  droid: ['https://app.factory.ai/', 'https://api.factory.ai/'],
  'minimax-code': ['https://api.minimax.io/', 'https://api.minimaxi.com/'],
  mimocode: ['https://mimo.xiaomi.com/', ...modelApis],
  goose: modelApis, fx: modelApis, omp: modelApis, hermes: modelApis,
  grok: ['https://api.x.ai/', 'https://accounts.x.ai/']
}
