/**
 * ComplexityEstimator — evaluates task complexity before model routing.
 *
 * Produces a score in [0, 100] across five dimensions:
 *   1. Input length
 *   2. Multi-step reasoning signals
 *   3. Tool-usage signals
 *   4. Code-generation signals
 *   5. Domain-knowledge signals
 *
 * Design principle: underestimate rather than overestimate — false positives
 * cost money but never quality; false negatives directly hurt output quality.
 *
 * Addresses GitHub Issue #364.
 */

export type ComplexityTier = 'low' | 'medium' | 'high'

export type DimensionScore = {
  dimension: string
  score: number
  signals: string[]
}

export type ComplexityAssessment = {
  score: number
  tier: ComplexityTier
  dimensions: DimensionScore[]
  assessedAt: number
  durationMs: number
}

// ── keyword sets (bilingual Chinese + English) ────────────────────────────

const REASONING_KEYWORDS = [
  'analyze', 'analyse', 'deduce', 'deduct', 'compare', 'evaluate', 'assess',
  'reason', 'why', 'explain', 'prove', 'derive', 'infer', 'design', 'architect',
  'investigate', 'diagnose', 'debug', 'troubleshoot', 'optimize', 'optimise',
  'refactor', 'plan', 'strategy', 'trade-off', 'tradeoff',
  'which is better', 'what is the best', 'should i', 'recommend',
  '分析', '推导', '比较', '对比', '评估', '论证', '推理', '为什么', '解释',
  '证明', '设计', '排查', '调试', '优化', '重构', '规划', '权衡',
  '优劣', '推荐', '诊断', '优缺点', '给出', '建议',
  'first', 'then', 'step by step', 'multiple steps',
]

const TOOL_KEYWORDS = [
  'read file', 'write file', 'edit file', 'create file', 'delete file',
  'run command', 'execute', 'shell', 'bash', 'terminal', 'list files',
  'search', 'find in', 'grep', 'install', 'build', 'compile', 'test', 'deploy',
  'docker', 'curl', 'wget', 'browse', 'fetch', 'scrape',
  '读取文件', '写文件', '修改文件', '创建文件', '删除文件', '运行命令',
  '执行', '终端', '命令行', '列出文件', '搜索文件', '查找', '安装', '编译',
  '测试', '部署', '提交', '查看', '打开', '浏览', '获取',
  '读取', '写入', '列出', '搜索',
]

const CODE_KEYWORDS = [
  'write code', 'write a function', 'implement', 'implement a', 'code a',
  'build a', 'develop a', 'create a class', 'add a method', 'refactor',
  'fix bug', 'fix the bug', 'fix error', 'debug this', 'rewrite',
  'add feature', 'oauth', 'middleware', 'database', 'connection pool',
  'api endpoint', 'rest api', 'algorithm', 'data structure',
  'authentication', 'authorization', 'encryption', 'async', 'await',
  'promise', 'callback', 'recursion', 'concurrent', 'parallel',
  'sql query', 'migration', 'schema', 'typescript', 'javascript', 'python',
  'rust', 'go ', 'java', 'c++', 'react', 'vue', 'component', 'hook',
  '写代码', '写一个', '实现', '编写', '代码', '函数', '类', '方法',
  '重构', '修复bug', '修复错误', '调试代码', '重写', '添加功能',
  '中间件', '数据库', '连接池', '接口', '算法', '数据结构', '认证',
  '授权', '加密', '异步', '递归', '并发', 'sql', '迁移', '组件',
]

const DOMAIN_KEYWORDS = [
  'oauth', 'jwt', 'openid', 'tls', 'ssl', 'cors', 'csrf', 'xss',
  'deadlock', 'mutex', 'semaphore', 'consensus', 'paxos', 'raft',
  'distributed', 'microservice', 'kubernetes', 'terraform',
  'websocket', 'graphql', 'grpc', 'protobuf', 'acid', 'mvcc',
  'machine learning', 'neural network', 'transformer', 'embedding',
  'vector database', 'rag', 'fine-tun', 'reinforcement learning',
  'cryptograph', 'blockchain', 'compiler', 'interpreter',
  'garbage collection', 'memory management', 'virtual machine',
  'connection pool', 'lifecycle', 'health check',
  '分布式', '微服务', '容器', '编排', '负载均衡', '一致性', '事务',
  '索引优化', '查询优化', '并发控制', '锁机制', '内存管理', '垃圾回收',
  '机器学习', '神经网络', '向量数据库', '加密算法', '安全漏洞',
  '中间件', '连接池', '生命周期', '数据库',
]

// ── scoring functions ────────────────────────────────────────────────────

function countMatches(input: string, keywords: string[]): { count: number; matched: string[] } {
  const lower = input.toLowerCase()
  const matched: string[] = []
  for (const kw of keywords) {
    if (lower.includes(kw.toLowerCase())) matched.push(kw)
  }
  return { count: matched.length, matched }
}

function scoreInputLength(charCount: number): { score: number; signals: string[] } {
  if (charCount < 50) return { score: Math.min(8, charCount / 6), signals: [`short input (${charCount} chars)`] }
  if (charCount < 300) return { score: 10 + Math.min(15, (charCount - 50) / 17), signals: [`medium input (${charCount} chars)`] }
  return { score: Math.min(35, 25 + (charCount - 300) / 100), signals: [`long input (${charCount} chars)`] }
}

function scoreReasoning(input: string): { score: number; signals: string[] } {
  const { count, matched } = countMatches(input, REASONING_KEYWORDS)
  if (count === 0) return { score: 0, signals: ['no explicit reasoning keywords'] }
  if (count === 1) return { score: 12, signals: [`reasoning: ${matched.slice(0, 3).join(', ')}`] }
  if (count === 2) return { score: 20, signals: [`reasoning: ${matched.slice(0, 3).join(', ')}`] }
  return { score: Math.min(30, 22 + (count - 2) * 3), signals: [`reasoning: ${matched.slice(0, 3).join(', ')}`] }
}

function scoreToolUsage(input: string): { score: number; signals: string[] } {
  const { count, matched } = countMatches(input, TOOL_KEYWORDS)
  if (count === 0) return { score: 0, signals: ['no tool-usage signals'] }
  return { score: Math.min(25, 12 + count * 3), signals: [`tools: ${matched.slice(0, 3).join(', ')}`] }
}

function scoreCodeGeneration(input: string): { score: number; signals: string[] } {
  const { count, matched } = countMatches(input, CODE_KEYWORDS)
  if (count === 0) return { score: 0, signals: ['no code-generation signals'] }
  if (count === 1) return { score: 25, signals: [`code: ${matched.slice(0, 3).join(', ')}`] }
  if (count === 2) return { score: 35, signals: [`code: ${matched.slice(0, 3).join(', ')}`] }
  return { score: Math.min(45, 35 + (count - 2) * 4), signals: [`code: ${matched.slice(0, 3).join(', ')}`] }
}

function scoreDomainKnowledge(input: string): { score: number; signals: string[] } {
  const { count, matched } = countMatches(input, DOMAIN_KEYWORDS)
  if (count === 0) return { score: 0, signals: ['no domain-specific terms'] }
  return { score: Math.min(15, 5 + count * 2), signals: [`domain: ${matched.slice(0, 3).join(', ')}`] }
}

export function classifyTier(score: number): ComplexityTier {
  if (score <= 30) return 'low'
  if (score <= 70) return 'medium'
  return 'high'
}

export const COMPLEXITY_THRESHOLDS = { lowMax: 30, mediumMax: 70 } as const

/**
 * Estimate task complexity. Must complete in <500ms.
 * Pure heuristic — no LLM call — to keep latency negligible.
 */
export function estimateComplexity(input: string): ComplexityAssessment {
  const start = performance.now()
  const text = (input ?? '').trim()

  const lengthResult = scoreInputLength([...text].length)
  const reasoningResult = scoreReasoning(text)
  const toolResult = scoreToolUsage(text)
  const codeResult = scoreCodeGeneration(text)
  const domainResult = scoreDomainKnowledge(text)

  const dimensions: DimensionScore[] = [
    { dimension: 'input_length', score: Math.round(lengthResult.score), signals: lengthResult.signals },
    { dimension: 'multi_step_reasoning', score: Math.round(reasoningResult.score), signals: reasoningResult.signals },
    { dimension: 'tool_usage', score: Math.round(toolResult.score), signals: toolResult.signals },
    { dimension: 'code_generation', score: Math.round(codeResult.score), signals: codeResult.signals },
    { dimension: 'domain_knowledge', score: Math.round(domainResult.score), signals: domainResult.signals },
  ]

  const raw =
    lengthResult.score * 0.8 +
    reasoningResult.score * 1.2 +
    toolResult.score * 0.8 +
    codeResult.score * 1.4 +
    domainResult.score * 0.8

  const score = Math.max(0, Math.min(100, Math.round(raw)))
  return { score, tier: classifyTier(score), dimensions, assessedAt: Date.now(), durationMs: Math.round((performance.now() - start) * 100) / 100 }
}

export function isLowComplexity(input: string): boolean {
  return estimateComplexity(input).tier === 'low'
}
