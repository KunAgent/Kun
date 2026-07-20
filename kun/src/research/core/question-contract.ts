/**
 * [INPUT]: 依赖 core/types 的 ResearchQuestion、QuestionContract 与 EvidenceAssignment 契约，依赖 hashJson 生成稳定分配指纹
 * [OUTPUT]: 对外提供领域中立的问题答案类型推断、要求区间与目标窗口实质重叠的时间窗/指标焦点契约、同义量化观测识别、量化不利结果与仅含风险标签的制度参数区分、风险清单与跨分句伪否定区分、明确风险加具体后果与纯配置建议的区分、把模型自认的单一样本降级为背景的证据角色判定和证据分配指纹
 * [POS]: research/core 的问题到证据语义边界，被网页抽取、WritableGate、ReportArchitect 缓存校验复用；识别因果连接词、直接影响动词、驱动因素列表、时间窗错位、复合问题替代分面、量化规模事实、非技术问题中的工具变更记录和风险方法论与具体风险命题的差异，不维护题材词表
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { hashJson } from './hash.js'
import type {
  ResearchEvidenceAssignment,
  ResearchEvidenceRole,
  ResearchQuestion,
  ResearchQuestionAnswerType,
  ResearchQuestionContract
} from './types.js'

const QUESTION_TYPE_PATTERNS: Array<[ResearchQuestionAnswerType, RegExp]> = [
  ['risk', /(?:风险|威胁|挑战|不确定|隐患|脆弱|下行|阻碍|\brisk\b|\brisks\b|\bthreat|\bchallenge|\buncertaint|\bvulnerab|\bdownside|\bhazard)/iu],
  ['comparison', /(?:比较|对比|差异|异同|区别|优劣|权衡|相较|相比|\bversus\b|\bvs\.?\b|\bcompar|\bdiffer|\btrade[ -]?off)/iu],
  ['cause', /(?:原因|成因|为何|为什么|驱动因素|导致|因果|\bwhy\b|\bcause|\bdriver|\blead(?:s|ing)?\s+to\b|\bresult(?:s|ing)?\s+in\b)/iu],
  ['trend', /(?:趋势|走势|前景|未来|演变|预测|展望|变化|\btrend|\boutlook|\bfuture|\bforecast|\btrajectory|\bprojection|\bchange)/iu],
  ['recommendation', /(?:建议|推荐|应该|应当|如何选择|决策|策略选择|\brecommend|\bshould\b|\bchoose\b|\bdecision|\bstrategy)/iu],
  ['evaluation', /(?:评估|评价|表现|实力|健康|质量|地位|潜力|竞争力|\bevaluat|\bassess|\bperformance|\bhealth|\bposition|\bpotential|\bquality)/iu]
]

const BINARY_QUESTION = /(?:是否|有无|有没有|存在吗|能否|可否|是不是|\bwhether\b|\bis there\b|\bare there\b|\bdoes\b|\bdo\b|\bcan\b|\bcould\b)/iu
const RISK_DENIAL = /(?:\b(?:not|no|without)\b(?!\s+only\b)[^.!?;:]{0,64}\b(?:risk|risks|exposure|threat|uncertaint(?:y|ies)|challenge|downside)\b|\b(?:risk|risks|exposure|threat|uncertaint(?:y|ies)|challenge|downside)\b[^.!?]{0,36}\b(?:low|limited|minor|immaterial|insignificant|not\s+significant)\b|(?:没有|并无|并未|无|不存在|不构成|未(?:发现|识别|观察到|显示|构成|带来|造成))(?:任何|明显|显著|重大)?[^。！？；;：:]{0,20}(?:风险|威胁|挑战|不确定性|暴露|下行压力|隐患)|(?:风险|威胁|挑战|不确定性|暴露|下行压力|隐患)[^。！？]{0,20}(?:不显著|较低|有限|可控|不重大))/giu
const RISK_PROCESS_ONLY = /\b(?:risk management|managing risks?|identify(?:ing)? risks?|monitor(?:ing)? risks?|mitigat(?:e|ing) risks?|risk (?:analysis|assessment|evaluation|identification|monitoring|mitigation)|environmental impact (?:analysis|assessment|evaluation|identification|monitoring|prediction)|life[ -]?cycle assessment)\b|(?:(?:风险|环境影响)(?:分析|评估|评价|识别|预测|监测|管理|治理|缓解|最小化)|(?:分析|评估|评价|识别|预测|监测|管理|治理|缓解|最小化)[^。！？]{0,16}(?:风险|环境影响)|生命周期评价)/giu
const RISK_PROCESS_SIGNAL = /\b(?:risk (?:management|analysis|assessment|evaluation|identification|monitoring|mitigation)|environmental impact (?:analysis|assessment|evaluation|identification|monitoring|prediction)|life[ -]?cycle assessment|identify(?:ing)? risks?|monitor(?:ing)? risks?|mitigat(?:e|ing) risks?)\b|(?:(?:风险|环境影响)(?:分析|评估|评价|识别|预测|监测|管理|治理|缓解|最小化)|(?:分析|评估|评价|识别|预测|监测|管理|治理|缓解|最小化)[^。！？]{0,16}(?:风险|环境影响)|生命周期评价)/iu
const RISK_PROCESS_QUESTION = /(?:如何|怎样|怎么)[^？?]{0,24}(?:风险|环境影响)(?:分析|评估|评价|识别|预测|监测|管理|治理|缓解)|(?:风险|环境影响)(?:分析|评估|评价|识别|预测|监测|管理|治理|缓解)(?:流程|框架|方法|体系|如何)|\bhow\b[^?]{0,48}\b(?:manage|assess|evaluate|identify|monitor|mitigate)\b[^?]{0,24}\b(?:risk|impact)s?\b|\b(?:risk|impact) (?:management|assessment|analysis|evaluation|identification|monitoring|mitigation) (?:process|framework|method|system)\b/iu
const CONCRETE_ADVERSE_RELATION = /(?:导致|造成|引发|加剧|推高|增加|减少|降低|损害|伤害|破坏|污染|威胁|暴露于|面临|依赖|中断|短缺|损失|死亡|下降|下滑|恶化|失败)[^。！？]{0,80}(?:风险|影响|损失|压力|生态|健康|安全|成本|供应|运行)?|(?:风险|挑战|威胁|不利影响)(?:包括|来自|源于)|\b(?:cause|lead(?:s|ing)? to|result(?:s|ing)? in|creat(?:e|es|ing)|increase|reduce|worsen|damage|harm|pollut|contaminat|poison|threaten|expose|depend(?:s|ing)? on|disrupt|shortage|loss|decline|mortality|failure)\b[^.!?]{0,96}\b(?:risk|impact|loss|pressure|harm|damage|disruption|shortage|failure)?\b|\b(?:risk|challenge|threat|adverse impact)s?\b\s+(?:include|from|arise from|stem from)\b/iu
const NAMED_RISK_WITH_CONSEQUENCE = /(?:风险|威胁|挑战|隐患|\brisk\b|\bthreat\b|\bchallenge\b)\s*[:：-]\s*[^。！？.!?]{4,140}(?:(?:可能|会|将|直接)?(?:影响|限制|阻断|中断|降低|增加|造成|导致|损害|损失|无法)|\b(?:may|can|could|will)\b[^.!?]{0,80}\b(?:affect|limit|block|interrupt|reduce|increase|cause|lead|damage|lose|prevent)\b)/iu
const NAMED_RISK_LIST = /(?:风险|威胁|挑战|\brisk(?:s)?\b|\bthreat(?:s)?\b|\bchallenge(?:s)?\b)(?:提示|清单|因素|事项|\s+factors?|\s+list)?\s*[:：]\s*[^。！？.!?]{4,180}/iu
const ADVERSE_RELATION = /(?:风险|威胁|挑战|不确定|隐患|脆弱|暴露|波动|损失|减少|降低|损害|伤害|破坏|污染|毒性|死亡|下降|下滑|恶化|失败|中断|短缺|约束|限制|压力|担忧|不利|负面|依赖|瓶颈|侵蚀|\brisk\b|\brisks\b|\bthreat|\bchallenge|\buncertaint|\bvulnerab|\bexpos|\bvolatil|\bloss|\breduc|\bdamag|\bharm|\bpollut|\bcontamin|\btoxic|\bpoison|\bmortality|\bdeclin|\bdeterior|\bfail|\bdisrupt|\bshortage|\bconstraint|\bpressure|\bconcern|\bdownside|\badverse|\bnegative|\bdependen|\breliance|\bbottleneck|\berosion)/iu
const CAUSAL_DENIAL = /(?:不能证明|无法证明|没有证据表明|未发现[^。！？]{0,20}(?:导致|因果)|无(?:直接)?因果|\bno evidence\b[^.!?]{0,48}\b(?:cause|lead|result)|\bdoes not cause\b|\bnot caused by\b|\bno causal)/iu
const CAUSAL_RELATION = /(?:由于|因为|源于|归因于|导致|造成|驱动|促成|使得|从而|因此|影响|取决于|依赖|推高|压低|增加[^。！？]{0,28}(?:成本|费用|需求|消耗|投入)|(?:降低|减少|节省)[^。！？]{0,28}(?:成本|费用|需求|消耗|投入)|(?:成本|费用|价格)(?:驱动因素|影响因素|构成)|占[^。！？]{0,20}(?:成本|费用|支出)|需要[^。！？]{0,20}(?:投入|投资|成本|费用)|\bbecause\b|\bdue to\b|\bcaused by\b|\bdriven by\b|\bleads? to\b|\bresults? in\b|\battribut(?:e|ed|able) to\b|\b(?:affect|influenc|impact)(?:s|ed|ing)?\b|\bcontribut(?:e|es|ed|ing) to\b|\baccount(?:s|ed|ing)? for\b|\bdepend(?:s|ed|ing)? on\b|\b(?:cost|price|expense) drivers?\b|\b(?:increas|rais|reduc|lower|mitigat)(?:e|es|ed|ing)\s+(?:\w+[ -]?){0,3}(?:cost|costs|demand|expense|expenses|requirement|requirements|consumption|price|prices)\b|\brequire(?:s|d|ing)?\s+(?:\w+[ -]?){0,3}(?:investment|spending|expenditure|cost|costs)\b|\brepresent(?:s|ed|ing)?\s+(?:the\s+)?(?:largest|major|significant)\s+(?:cost|expense|share)\b)/iu
const TREND_RELATION = /(?:同比|环比|较上|过去|未来|预计|预测|将会|趋势|增长|上升|下降|下滑|减少|持平|稳定|维持|\byear[ -]on[ -]year\b|\bcompared with\b|\bfrom\b[^.!?]{0,36}\bto\b|\bforecast|\bexpect(?:s|ed)?\b|\bproject(?:s|ed)?\b|\bincreas|\bgrew\b|\bgrowth\b|\bdecreas|\bdeclin|\bfell\b|\bremain(?:s|ed)? stable\b)/iu

const QUESTION_MEASURE_ALIASES: Array<[RegExp, string[]]> = [
  [/(?:成本|费用|开支|造价|\bcosts?\b|\bexpenses?\b|\bexpenditure\b)/iu, ['成本', '费用', '开支', 'cost', 'costs', 'expense', 'expenses', 'expenditure']],
  [/(?:价格|售价|\bprices?\b|\bpricing\b)/iu, ['价格', '售价', 'price', 'prices', 'pricing']],
  [/(?:收入|营收|销售额|\brevenue\b|\bsales\b)/iu, ['收入', '营收', '销售额', 'revenue', 'sales']],
  [/(?:利润|盈利|\bprofits?\b|\bearnings\b)/iu, ['利润', '盈利', 'profit', 'profits', 'earnings']],
  [/(?:能耗|能源消耗|\benergy consumption\b|\bpower consumption\b)/iu, ['能耗', '能源消耗', 'energy consumption', 'power consumption']],
  [/(?:数量|规模|容量|产量|\bvolume\b|\bcapacity\b|\boutput\b)/iu, ['数量', '规模', '容量', '产量', 'volume', 'capacity', 'output']]
]
const QUANTITATIVE_MEASURE_FOCUS_TERMS = new Set([
  '数量', '规模', '容量', '产量', 'volume', 'capacity', 'output'
])
const CONCRETE_QUANTITATIVE_OBSERVATION = /(?:\d[\d,.]*(?:\s*(?:%|％|‰|bp|bps|percent(?:age)?|million|billion|trillion|thousand|万|亿|兆|百|千|家|个|项|人|次|台|套|吨|公里|元|美元|欧元|英镑))|(?:总数|总量|合计|占比|份额|比例|数量|规模|容量|产量|\btotal\b|\bcount\b|\bshare\b|\bratio\b|\bvolume\b|\bcapacity\b|\boutput\b)[^。！？.!?]{0,36}\d)/iu
const MEASURED_ADVERSE_OUTCOME = /(?:(?:损失|死亡|中断|故障|违约|失败|下降|下滑|恶化|波动|短缺|延误|伤害|污染|暴露|\bloss(?:es)?\b|\bmortality\b|\boutage\b|\bfailure\b|\bdefault\b|\bdecline\b|\bvolatility\b|\bshortage\b|\bdelay\b|\bharm\b|\bpollution\b|\bexposure\b)[^。！？.!?]{0,48}\d|\d[^。！？.!?]{0,48}(?:损失|死亡|中断|故障|违约|失败|下降|下滑|恶化|波动|短缺|延误|伤害|污染|暴露|\bloss(?:es)?\b|\bmortality\b|\boutage\b|\bfailure\b|\bdefault\b|\bdecline\b|\bvolatility\b|\bshortage\b|\bdelay\b|\bharm\b|\bpollution\b|\bexposure\b))/iu
const OPERATIONAL_ARTIFACT_SIGNAL = /\b(?:api|endpoint|repository|github|release|changelog|version|fix|request|fetch(?:es|ed|ing)?)\b|(?:接口|端点|代码仓库|仓库|版本|修复|调用|数据工具)/giu
const EXAMPLE_ONLY_SIGNAL = /(?:个案|案例|单一(?:对象|主体|样本)|示例|样例|仅作参考)|\b(?:case|example|single (?:entity|subject|sample)|illustrative only)\b/iu
const PRESCRIPTIVE_ALLOCATION_ONLY = /(?:建议|推荐)[^。！？\n]{0,120}(?:配置|分配|买入|持有)|\b(?:recommend|suggest|allocate)\b[^.!?\n]{0,120}(?:portfolio|asset|share|percent|%)/iu

export function buildResearchQuestionContract(
  question: Pick<ResearchQuestion, 'id' | 'text' | 'required'>,
  sectionTitle = '',
  nowIso?: string
): ResearchQuestionContract {
  const explicitDimension = question.text.match(/在「([^」]+)」维度/u)?.[1]?.trim() ?? ''
  const answerType = inferQuestionAnswerType(sectionTitle.trim() || explicitDimension || question.text)
  const binary = BINARY_QUESTION.test(question.text)
  const contractText = `${sectionTitle}\n${explicitDimension}\n${question.text}`
  const focusTerms = questionMeasureFocusTerms(contractText)
  const timeScope = researchQuestionTimeScope(contractText, nowIso)
  return {
    questionId: question.id,
    question: question.text,
    answerType,
    required: question.required,
    binary,
    requiresSupportingEvidence: question.required && !(answerType === 'risk' && binary),
    ...(focusTerms.length > 0 ? { focusTerms } : {}),
    ...(timeScope ? { timeScope } : {})
  }
}

export function inferQuestionAnswerType(text: string): ResearchQuestionAnswerType {
  const normalized = text.normalize('NFKC').trim()
  for (const [answerType, pattern] of QUESTION_TYPE_PATTERNS) {
    if (pattern.test(normalized)) return answerType
  }
  return 'fact'
}

export function classifyResearchEvidenceAssignment(input: {
  contract: ResearchQuestionContract
  claimId: string
  evidenceText: string
  suggestedRole?: ResearchEvidenceRole
  suggestedExplanation?: string
}): ResearchEvidenceAssignment {
  const exampleOnly = EXAMPLE_ONLY_SIGNAL.test(input.suggestedExplanation ?? '')
    && !EXAMPLE_ONLY_SIGNAL.test(input.contract.question)
  const role = exampleOnly ? 'context' : deterministicEvidenceRole(input.contract, input.evidenceText)
  const modelValidated = input.suggestedRole === role
  return {
    questionId: input.contract.questionId,
    claimId: input.claimId,
    role,
    relevance: role === 'supports' ? 1 : role === 'contradicts' ? 0.7 : 0.25,
    explanation: modelValidated && input.suggestedExplanation?.trim()
      ? input.suggestedExplanation.trim().slice(0, 240)
      : assignmentExplanation(input.contract.answerType, role),
    source: modelValidated ? 'model_validated' : 'deterministic'
  }
}

export function researchEvidenceAssignmentFingerprint(assignments: ResearchEvidenceAssignment[]): string {
  return hashJson(assignments
    .map(({ questionId, claimId, role }) => ({ questionId, claimId, role }))
    .sort((left, right) => `${left.questionId}:${left.claimId}`.localeCompare(`${right.questionId}:${right.claimId}`)))
}

function deterministicEvidenceRole(contract: ResearchQuestionContract, evidenceText: string): ResearchEvidenceRole {
  const normalized = evidenceText.normalize('NFKC').trim()
  if (!normalized) return 'context'
  if (!evidenceAddressesQuestionFocus(contract, normalized)) return 'context'
  if (contract.answerType === 'risk') {
    const processEvidence = RISK_PROCESS_SIGNAL.test(normalized)
    if (processEvidence && RISK_PROCESS_QUESTION.test(contract.question)) return 'supports'
    if (processEvidence && !CONCRETE_ADVERSE_RELATION.test(normalized)) return 'context'
    if (PRESCRIPTIVE_ALLOCATION_ONLY.test(normalized) && !NAMED_RISK_WITH_CONSEQUENCE.test(normalized)) return 'context'
    const withoutDenials = normalized.replace(RISK_DENIAL, ' ').replace(RISK_PROCESS_ONLY, ' ')
    const hasDenial = RISK_DENIAL.test(normalized)
    RISK_DENIAL.lastIndex = 0
    const hasMeasuredAdverseOutcome = CONCRETE_QUANTITATIVE_OBSERVATION.test(withoutDenials) &&
      MEASURED_ADVERSE_OUTCOME.test(withoutDenials)
    const hasAdverseRelation = contract.binary
      ? ADVERSE_RELATION.test(withoutDenials)
      : CONCRETE_ADVERSE_RELATION.test(withoutDenials) || NAMED_RISK_WITH_CONSEQUENCE.test(withoutDenials) || NAMED_RISK_LIST.test(withoutDenials) || hasMeasuredAdverseOutcome
    if (hasAdverseRelation) return 'supports'
    if (hasDenial) return contract.binary ? 'supports' : 'contradicts'
    return 'context'
  }
  if (contract.answerType === 'cause') {
    if (CAUSAL_DENIAL.test(normalized)) return 'contradicts'
    return CAUSAL_RELATION.test(normalized) ? 'supports' : 'context'
  }
  if (contract.answerType === 'trend') {
    if (!TREND_RELATION.test(normalized)) return 'context'
    return evidenceMatchesQuestionTimeScope(contract, normalized) ? 'supports' : 'context'
  }
  return 'supports'
}

function questionMeasureFocusTerms(text: string): string[] {
  return [...new Set(QUESTION_MEASURE_ALIASES
    .filter(([pattern]) => pattern.test(text))
    .flatMap(([, aliases]) => aliases))]
}

function evidenceAddressesQuestionFocus(contract: ResearchQuestionContract, evidenceText: string): boolean {
  if (isUnrequestedOperationalArtifact(contract.question, evidenceText)) return false
  const focusTerms = contract.focusTerms ?? []
  if (focusTerms.length === 0) return true
  const normalized = evidenceText.normalize('NFKC').toLowerCase()
  if (focusTerms.some((term) => normalized.includes(term.normalize('NFKC').toLowerCase()))) return true
  if (alternativeDimensionFocusTerms(contract.question).some((term) => normalized.includes(term))) return true
  const asksForQuantitativeMeasure = focusTerms.some((term) =>
    QUANTITATIVE_MEASURE_FOCUS_TERMS.has(term.normalize('NFKC').toLowerCase())
  )
  return asksForQuantitativeMeasure && CONCRETE_QUANTITATIVE_OBSERVATION.test(normalized)
}

function isUnrequestedOperationalArtifact(question: string, evidenceText: string): boolean {
  const evidenceSignals = evidenceText.match(OPERATIONAL_ARTIFACT_SIGNAL) ?? []
  OPERATIONAL_ARTIFACT_SIGNAL.lastIndex = 0
  if (evidenceSignals.length < 2) return false
  const questionSignals = question.match(OPERATIONAL_ARTIFACT_SIGNAL) ?? []
  OPERATIONAL_ARTIFACT_SIGNAL.lastIndex = 0
  return questionSignals.length === 0
}

function alternativeDimensionFocusTerms(question: string): string[] {
  const dimension = question.match(/在「([^」]+)」维度/u)?.[1]?.normalize('NFKC').toLowerCase().trim()
  if (!dimension) return []
  const facets = dimension
    .split(/[、，,；;/]|\s*(?:与|和|及)\s*/u)
    .map((facet) => facet.trim())
    .filter((facet) => facet.length >= 2)
  return facets.length > 1 ? facets : []
}

function researchQuestionTimeScope(
  text: string,
  nowIso?: string
): ResearchQuestionContract['timeScope'] | undefined {
  const referenceYear = referenceYearFromIso(nowIso)
  const explicit = text.match(/\b(19\d{2}|20\d{2})\s*(?:[-–—至到~～]\s*)(19\d{2}|20\d{2})\b/u)
  if (explicit) {
    const startYear = Number(explicit[1])
    const endYear = Number(explicit[2])
    if (Number.isFinite(startYear) && Number.isFinite(endYear)) {
      return {
        direction: endYear > referenceYear ? 'future' : 'past',
        startYear: Math.min(startYear, endYear),
        endYear: Math.max(startYear, endYear)
      }
    }
  }
  const relative = text.match(/(?:过去|近|最近|此前|前|未来|今后|接下来|随后)\s*([一二两三四五六七八九十\d]{1,3})\s*年|\b(past|last|previous|future|next)\s+(\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten)\s+years?\b/iu)
  if (!relative) return undefined
  const quantity = parseSmallNumber(relative[1] ?? relative[3] ?? '')
  if (!quantity || quantity > 100) return undefined
  const direction = /未来|今后|接下来|随后|\b(?:future|next)\b/iu.test(relative[0]) ? 'future' : 'past'
  return direction === 'future'
    ? { direction, startYear: referenceYear, endYear: referenceYear + quantity }
    : { direction, startYear: referenceYear - quantity, endYear: referenceYear }
}

function evidenceMatchesQuestionTimeScope(contract: ResearchQuestionContract, evidenceText: string): boolean {
  const scope = contract.timeScope
  if (!scope) return true
  const explicitRelativeScope = scope.direction === 'future'
    ? /(?:未来|今后|接下来|随后)\s*[一二两三四五六七八九十\d]{0,3}\s*年|\b(?:future|next)\s+(?:\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten)?\s*years?\b/iu
    : /(?:过去|近|最近|此前|前)\s*[一二两三四五六七八九十\d]{0,3}\s*年|\b(?:past|last|previous)\s+(?:\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten)?\s*years?\b/iu
  if (explicitRelativeScope.test(evidenceText)) return true
  const years = [...new Set([...evidenceText.matchAll(/\b(?:19\d{2}|20\d{2})\b/gu)].map((match) => Number(match[0])))]
  if (years.length >= 2) {
    const evidenceStart = Math.min(...years)
    const evidenceEnd = Math.max(...years)
    const overlap = Math.max(0, Math.min(evidenceEnd, scope.endYear) - Math.max(evidenceStart, scope.startYear))
    const comparableSpan = Math.min(
      Math.max(1, evidenceEnd - evidenceStart),
      Math.max(1, scope.endYear - scope.startYear)
    )
    return overlap >= Math.max(1, Math.ceil(comparableSpan / 2))
  }
  const inScopeYears = years.filter((year) => year >= scope.startYear && year <= scope.endYear)
  if (inScopeYears.length === 0) return false
  return /(?:自|从|截至|到|至|以来|期间|年度|\bsince\b|\bfrom\b|\bto\b|\bthrough\b|\bbetween\b|\bby\b|\bas of\b)/iu.test(evidenceText)
}

function referenceYearFromIso(nowIso?: string): number {
  const year = Number((nowIso ?? '').slice(0, 4))
  return Number.isInteger(year) && year >= 1900 && year <= 2200 ? year : new Date().getUTCFullYear()
}

function parseSmallNumber(value: string): number | undefined {
  if (/^\d+$/u.test(value)) return Number(value)
  const english: Record<string, number> = {
    one: 1, two: 2, three: 3, four: 4, five: 5,
    six: 6, seven: 7, eight: 8, nine: 9, ten: 10
  }
  const englishValue = english[value.toLowerCase()]
  if (englishValue) return englishValue
  const chineseDigits: Record<string, number> = {
    一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5,
    六: 6, 七: 7, 八: 8, 九: 9, 十: 10
  }
  if (value === '十') return 10
  if (value.includes('十')) {
    const [tens, ones] = value.split('十')
    return (tens ? chineseDigits[tens] ?? 0 : 1) * 10 + (ones ? chineseDigits[ones] ?? 0 : 0)
  }
  return chineseDigits[value]
}

function assignmentExplanation(answerType: ResearchQuestionAnswerType, role: ResearchEvidenceRole): string {
  if (role === 'supports') return `该证据包含直接回答 ${answerType} 问题所需的关系。`
  if (role === 'contradicts') return `该证据直接限制或反驳 ${answerType} 问题中的候选判断，但不能单独替代正面答案。`
  return `该证据与主题有关，但没有直接回答 ${answerType} 问题，只能作为背景。`
}
