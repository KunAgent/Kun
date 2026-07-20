import { describe, expect, it } from 'vitest'
import {
  BasicCoverageEvaluator,
  ScopeFrameMappingError,
  buildReportContract,
  buildResearchFrame,
  canCiteSource,
  coversResearchDimensionFocusGroups,
  frameSanityCheck,
  hashText,
  isResearchEvidenceFocused,
  isEligibleStrongWebEvidence,
  isUsableEvidenceText,
  preflightResearchRun,
  researchDimensionFocusGroups,
  resolveResearchBudget,
  type AtomicClaim,
  type EvidenceSpan,
  type ResearchBrief,
  type ResearchFrame,
  type ResearchNote,
  type ResearchRun,
  type ResearchScopeAssessment,
  type SourceRecord
} from '../src/research/index.js'

describe('research frame mapping and evidence eligibility', () => {
  it('rejects document-index boilerplate as citable evidence', () => {
    expect(isUsableEvidenceText("Figures stated in the annual directors' report or quarterly/interim report may be provisional."))
      .toBe(false)
    expect(isUsableEvidenceText('The full report is usually filed later than results and can be opened from this document index.'))
      .toBe(false)
  })

  it('rejects comparative financial table rows without explicit periods or units', () => {
    expect(isUsableEvidenceText('Profit for the year 年內溢利 13,012,042 3,308,345')).toBe(false)
    expect(isUsableEvidenceText('Profit for the period 期內溢利 4,681,713 964,142')).toBe(false)
    expect(isUsableEvidenceText('Profit for FY2025 (RMB million) 13,012.0 3,308.3')).toBe(true)
    expect(isUsableEvidenceText('Inventories increased from RMB1,524.5 million in 2024 to RMB5,472.8 million in 2025.')).toBe(true)
  })

  it('rejects heading-only text and glued PDF numeric cells', () => {
    expect(isUsableEvidenceText('REVENUE AND GROSS PROFIT')).toBe(false)
    expect(isUsableEvidenceText('Operating income16,8904,1541,231')).toBe(false)
    expect(isUsableEvidenceText('Operating income was RMB16,890 million in FY2025.')).toBe(true)
  })

  it('does not treat an incidental awareness clause as substantive section evidence', () => {
    const administrativeText = '董事会文件须在会议前送呈全体董事，让董事了解本公司的最新动态及财务状况，并使其能作出知情决定。'
    expect(isResearchEvidenceFocused(
      '在「财务健康」维度上，关键事实、作用机制、风险和适用边界是什么？',
      administrativeText,
      '分析某公司的财务健康、业务模式和主要风险。'
    )).toBe(false)
    expect(isResearchEvidenceFocused(
      '在「财务健康」维度上，关键事实、作用机制、风险和适用边界是什么？',
      '2025年公司的财务健康明显改善：收入同比增长62.0%，经营现金流和净利润均有所提升。',
      '分析某公司的财务健康、业务模式和主要风险。'
    )).toBe(true)
  })

  it('rejects embedded PDF page headers and long fragments with a truncated short tail', () => {
    expect(isUsableEvidenceText('POP MART INTERNATIONAL GROUP LIMITED 泡泡瑪特國際集團有限公司 74 NOTES TO THE INTERIM CONDENSED CONSOLIDATED FINANCIAL INFORMATION 中期簡明綜合財務資料附註 5 分部及收益資料 本集團主要從事玩具的品牌開發、設計及銷售')).toBe(false)
    expect(isUsableEvidenceText('POP MART INTERNATIONAL GROUP LIMITED 泡泡瑪特國際集團有限公司 88 NOTES TO THE INTERIM CONDENSED CONSOLIDATED FINANCIAL INFORMATION 中期簡明綜合財務資料附註 15 LEASES Continued Amounts recognised in profit or loss relating to leases Six mo')).toBe(false)
  })

  it('rejects RDF and Dublin Core metadata fragments as citable evidence', () => {
    expect(isUsableEvidenceText('0 attack perspective, fan zhendong, line change, table tennis <dc:title>techniques and tactics</dc:title>'))
      .toBe(false)
  })

  it('rejects raw XML extraction and mid-list fragments', () => {
    expect(isUsableEvidenceText('1877</legis-num><current-chamber>IN THE SENATE</current-chamber><action-date date="20250522">May 22, 2025</action-date>'))
      .toBe(false)
    expect(isUsableEvidenceText('（二）监管谈话；（三）出具警示函；（四）责令公开说明；第五十四条由主管机关责令改正。'))
      .toBe(false)
  })

  it('rejects navigation suffixes and sentence-boundary glue in extracted evidence', () => {
    expect(isUsableEvidenceText('静态文件可以使用积极缓存。另请参阅 Expires 标题。 Cache-Control: public, max-age=31536000'))
      .toBe(false)
    expect(isUsableEvidenceText('Both validators support weak validation, though implementation complexity may vary Building a system of validators requires server logic.'))
      .toBe(false)
    expect(isUsableEvidenceText('弱验证类型应用于用户代理只需要确认资源内容相同即可 通常由 ETag 首部完成 该首部可以提供资源散列值 构建弱验证标签体系可能比较复杂 因为涉及对页面不同元素的重要性排序 但是会对缓存性能优化相当有帮助'))
      .toBe(false)
  })

  it('rejects navigation breadcrumbs while retaining complete structured source prose', () => {
    expect(isUsableEvidenceText('> Public information > Disclosure directory > Topic category > Enforcement action.'))
      .toBe(false)
    expect(isUsableEvidenceText('> 政务信息 > 主动公开目录 > 主题分类 > 行政执法。'))
      .toBe(false)
    expect(isUsableEvidenceText('Board Price Limit Range Main Board (SSE/SZSE) ±10% ChiNext (Growth Board) ±20% (since Aug 2020; no limits first 5 days after listing) STAR Market ±20% (since Jul 2019; no limits first 5 days after listing) Alternative Exchange ±30% (since Nov 2021) Special-Treatment Stocks ±5%'))
      .toBe(true)
  })

  it('repairs a contaminated frame without dropping confirmed cross-domain dimensions', () => {
    const brief: ResearchBrief = {
      ...makeBrief(),
      topic: '对比中美差异',
      userIntent: '按用户确认的领域做跨维度比较。',
      userClarifications: [
        '您希望重点比较哪些领域（可多选）？：经济与贸易；科技与创新；政治体制与治理；教育体系。'
      ]
    }
    const dirtyFrame: ResearchFrame = {
      ...makeFrame(),
      centralQuestion: '您是否有特定比较角度？请补充。',
      coreResearchThread: '等待用户确认是否有特定比较角度。',
      coreQuestions: [{
        id: 'q1',
        text: '您希望重点比较哪些具体领域？',
        priority: 'high',
        required: true
      }]
    }

    const result = preflightResearchRun({
      run: {
        brief,
        frame: dirtyFrame,
        budget: resolveResearchBudget({ preset: 'standard' })
      } as ResearchRun,
      capabilities: { webSearchEnabled: true, userFilesAvailable: false },
      nowIso: '2026-07-10T00:00:00.000Z'
    })
    const titles = result.reportContract.requiredSections.map((section) => section.title)

    expect(result.frameRepaired).toBe(true)
    expect(result.frame.centralQuestion).not.toContain('经济实力谁更强')
    expect(titles).toEqual([
      '经济与贸易',
      '科技与创新',
      '政治体制与治理',
      '教育体系'
    ])
  })

  it('does not map scope clarification prompts into central questions', () => {
    const scope = makeChinaUsScope()
    const frame = buildResearchFrame({
      topic: '调研中美经济差异',
      scope,
      userClarifications: [
        [
          '领域：宏观经济总量、产业结构与竞争力、贸易与供应链、科技创新与数字经济。',
          '用途：投资或商业决策。',
          '核心是综合实力对比和特定领域差距。'
        ].join('\n')
      ]
    })

    expect(frame.centralQuestion).toBe('综合实力对比和特定领域差距？')
    expect(frame.centralQuestion).not.toContain('您是否')
    expect(frame.coreQuestions.map((question) => question.text).join('\n')).toContain('宏观经济总量')
    expect(frame.coreQuestions.map((question) => question.text).join('\n')).toContain('产业结构与竞争力')
    expect(frame.coreQuestions.map((question) => question.text).join('\n')).toContain('贸易与供应链')
    expect(frame.coreQuestions.map((question) => question.text).join('\n')).toContain('科技创新与数字经济')
    expect(frame.coreQuestions.map((question) => question.text).join('\n')).not.toContain('脱钩风险与投资/商业启示')
    expect(frame.coreQuestions.filter((question) => question.text.includes('维度？'))).toHaveLength(0)
    expect(frame.coreQuestions.filter((question) => question.text.includes('或维度'))).toHaveLength(0)
    expect(frame.coreQuestions.slice(0, 5).every((question) => question.required)).toBe(true)
    expect(frame.coreQuestions.at(-1)?.required).toBe(false)
  })

  it('recovers confirmed comparison targets when a model frame omits them', () => {
    const frame = buildResearchFrame({
      topic: '中国乒乓球实力分析',
      userClarifications: ['比较对象：日本、德国、韩国及全球水平。'],
      overrides: {
        centralQuestion: '中国乒乓球队的统治力是否稳固？',
        coreResearchThread: '分析中国乒乓球队的优势与挑战。',
        coreQuestions: [{ id: 'q1', text: '统治力是否稳固？', priority: 'high', required: true }]
      }
    })

    expect(frame.alternativesToCompare).toEqual(['日本', '德国', '韩国'])
  })

  it('keeps confirmed research dimensions separate from delivery requirements', () => {
    const frame = buildResearchFrame({
      topic: '中国乒乓球实力分析',
      userClarifications: [
        '重点回答：竞技成绩、人才储备、技战术、国际竞争格局及男女队差异。',
        '受众与文风：面向普通球迷，通俗但有数据、真实可追溯证据、明确结论和局限说明。'
      ]
    })
    const questions = frame.coreQuestions.map((question) => question.text).join('\n')

    expect(questions).toContain('「国际竞争格局」维度')
    expect(questions).toContain('「男女队」维度')
    expect(questions).not.toContain('需数据支撑')
    expect(questions).not.toContain('可追溯证据')
  })

  it('keeps every explicit research dimension instead of truncating a long scope list', () => {
    const topic = '调查 A 股和美股的异同。基于截至2026年7月可获得的公开资料，重点比较市场规模与结构、交易制度、投资者结构、上市与退市机制、估值和行业构成、监管与信息披露、跨境投资门槛和主要风险；输出中文完整报告，标注可核验来源与局限，不提供个股投资建议。'
    const frame = buildResearchFrame({ topic })
    const reportContract = buildReportContract({ brief: makeBrief(), frame, nowIso: '2026-07-19T00:00:00.000Z' })

    expect(reportContract.requiredSections.map((section) => section.title)).toEqual([
      '市场规模与结构',
      '交易制度',
      '投资者结构',
      '上市与退市机制',
      '估值',
      '行业构成',
      '监管与信息披露',
      '跨境投资门槛',
      '主要风险'
    ])
    expect(frame.coreQuestions.at(-1)).toMatchObject({ required: false, priority: 'medium' })
  })

  it('keeps every dimension from a bare compare list without requiring a scope label', () => {
    const topic = '调查两个市场的异同。比较市场规模与结构、交易制度、投资者结构、上市与退市机制、估值与行业构成、监管与信息披露、跨境投资门槛和主要风险；使用可核验网页来源。'
    const frame = buildResearchFrame({ topic })
    const reportContract = buildReportContract({ brief: makeBrief(), frame, nowIso: '2026-07-20T00:00:00.000Z' })

    expect(reportContract.requiredSections.map((section) => section.title)).toEqual([
      '市场规模与结构',
      '交易制度',
      '投资者结构',
      '上市与退市机制',
      '估值与行业构成',
      '监管与信息披露',
      '跨境投资门槛',
      '主要风险'
    ])
  })

  it('keeps a bare compare list when the comparison verb follows a comma-delimited preface', () => {
    const topic = '调查两个对象的异同。基于截至当前可获得的公开资料，比较规模与结构、运行制度、参与者结构、进入与退出机制、价值与类别构成、监管与信息披露、跨境门槛和主要风险；仅比较两个指定对象，使用可核验网页来源。'
    const frame = buildResearchFrame({ topic })
    const reportContract = buildReportContract({ brief: makeBrief(), frame, nowIso: '2026-07-20T00:00:00.000Z' })

    expect(reportContract.requiredSections.map((section) => section.title)).toEqual([
      '规模与结构',
      '运行制度',
      '参与者结构',
      '进入与退出机制',
      '价值与类别构成',
      '监管与信息披露',
      '跨境门槛',
      '主要风险'
    ])
  })

  it('throws when an override tries to put a clarification prompt into the frame', () => {
    expect(() => buildResearchFrame({
      topic: '调研中美经济差异',
      scope: makeChinaUsScope(),
      overrides: {
        centralQuestion: '4. 您是否有特定的比较角度或核心问题？请说明。'
      }
    })).toThrow(ScopeFrameMappingError)
  })

  it('allows normal topic text that says what the report should answer', () => {
    const frame = buildResearchFrame({
      topic: '对比过去一年 Dota 2 和 CS2 电竞赛事生态的差异。重点回答：赛事体系、奖金池、商业化、观赛热度、战队与选手生态有什么差异。',
      scope: {
        ...makeChinaUsScope(),
        summary: '用户要比较 Dota 2 和 CS2 电竞赛事生态差异。',
        mainContradiction: '核心主线是找出最能改变玩家和内容创作者长期关注判断的赛事生态证据。',
        confirmationChecklist: [
          '需求理解：比较 Dota 2 和 CS2 电竞赛事生态。',
          '核心问题：两者赛事体系、奖金池、商业化、观赛热度有什么差异。',
          '调研主线：优先找最能改变长期关注判断的证据。',
          '输出边界：中文完整报告。'
        ]
      }
    })

    expect(frame.centralQuestion).toContain('赛事体系')
    expect(frame.centralQuestion).toContain('观赛热度')
    expect(frame.alternativesToCompare).toEqual(['Dota 2', 'CS2'])
    expect(frame.coreQuestions.map((question) => question.text).join('\n')).toContain('「赛事体系」维度')
    expect(frame.coreQuestions.map((question) => question.text).join('\n')).toContain('「奖金池」维度')
    expect(frame.coreQuestions.map((question) => question.text).join('\n')).toContain('「商业化」维度')
    expect(frame.coreQuestions.map((question) => question.text).join('\n')).toContain('「观赛热度」维度')
    expect(frame.coreQuestions.map((question) => question.text).join('\n')).toContain('战队与选手生态')
    expect(frame.coreQuestions.map((question) => question.text).join('\n')).not.toContain('维度明确')
    expect(frame.coreQuestions.map((question) => question.text).join('\n')).not.toContain('受众明确')
  })

  it('turns user-confirmed scope coverage language into domain research dimensions', () => {
    const frame = buildResearchFrame({
      topic: '中国乒乓球实力分析',
      scope: {
        ...makeChinaUsScope(),
        summary: '分析2021-2026年中国乒乓球实力，涵盖竞技成绩、人才储备、技战术和国际竞争格局。',
        mainContradiction: '中国队是否仍保持统治力，以及主要挑战来自哪里。',
        confirmationChecklist: [
          '需求理解：中国乒乓球实力分析。',
          '核心问题：中国队的统治力是否下降，主要威胁来自哪里。',
          '调研主线：成绩、人才、技战术和国际竞争格局。',
          '输出边界：中文完整报告。'
        ]
      },
      userClarifications: ['重点回答：竞技成绩、人才储备、技战术和国际竞争格局。']
    })

    const questions = frame.coreQuestions.map((question) => question.text).join('\n')
    expect(questions).toContain('「竞技成绩」维度')
    expect(questions).toContain('「人才储备」维度')
    expect(questions).toContain('「技战术」维度')
    expect(questions).toContain('「国际竞争格局」维度')
    expect(frame.coreQuestions.at(-1)?.text).toContain('反例、替代解释')
    expect(frame.coreQuestions.at(-1)?.required).toBe(false)
    expect(questions).not.toContain('调研范围、关键概念和可比口径')
    expect(questions).not.toContain('并与日德韩及全球对比')
  })

  it('keeps parenthetical subitems inside their top-level fundamental-analysis dimensions', () => {
    const frame = buildResearchFrame({
      topic: '泡泡玛特公司的基本面',
      userClarifications: [
        '您最想了解泡泡玛特基本面的哪些方面？：做完整的投资基本面分析，覆盖财务健康（营收、利润、现金流、负债）、业务模式与增长驱动（IP运营、渠道、会员和海外业务）、行业竞争与市场地位，以及公司治理与管理团队。',
        '这份调研报告的用途是什么？：个人投资参考，重点判断增长质量、盈利能力、竞争壁垒、估值相关风险和长期可持续性。',
        '您关注的是当前最新情况，还是需要历史趋势分析？：以当前可获得的最新公开信息为准，同时分析过去5年趋势。',
        '是否需要与特定竞争对手或行业基准进行比较？：需要与潮玩行业主要对手（如52TOYS、TOP TOY）做必要比较；没有可靠可比数据时明确说明，不强行比较。'
      ]
    })
    const reportContract = buildReportContract({
      brief: makeBrief(),
      frame,
      nowIso: '2026-07-14T00:00:00.000Z'
    })

    expect(frame.alternativesToCompare).toEqual(['52TOYS', 'TOP TOY'])
    expect(frame.centralQuestion).toContain('泡泡玛特公司的基本面')
    expect(frame.centralQuestion).toContain('通过与“52TOYS”与“TOP TOY”的必要比较检验核心判断')
    expect(frame.centralQuestion).not.toMatch(/^“52TOYS”与“TOP TOY”/u)
    expect(reportContract.requiredSections.map((section) => section.title)).toEqual([
      '财务健康（营收、利润、现金流、负债）',
      '业务模式与增长驱动（IP运营、渠道、会员和海外业务）',
      '行业竞争与市场地位',
      '公司治理与管理团队'
    ])
  })

  it('maps an explicit subject aspect list to sections without leaking purpose or output metadata', () => {
    const frame = buildResearchFrame({
      topic: '基于当前可获得的最新公开资料，全面分析某消费公司的财务健康、业务模式、增长潜力、竞争地位和主要风险；以最近一个完整财年为主，覆盖全球业务，用于个人投资参考，输出带可追溯引用、结论与局限的中文完整报告。'
    })
    const reportContract = buildReportContract({
      brief: makeBrief(),
      frame,
      nowIso: '2026-07-15T00:00:00.000Z'
    })

    expect(reportContract.requiredSections.map((section) => section.title)).toEqual([
      '财务健康',
      '业务模式',
      '增长潜力',
      '竞争地位',
      '主要风险',
      '全球业务'
    ])
    const questions = frame.coreQuestions.map((question) => question.text).join('\n')
    expect(questions).not.toContain('用于个人投资参考')
    expect(questions).not.toContain('输出带可追溯引用')
  })

  it('maps an inline overall-aspect including list after ordinary whitespace into every requested section', () => {
    const frame = buildResearchFrame({
      topic: '仅基于一个给定来源 分析某对象最近周期的总体健康，包括收入、利润率、现金流和负债情况；输出带引用与局限的中文报告。'
    })
    const reportContract = buildReportContract({
      brief: makeBrief(),
      frame,
      nowIso: '2026-07-15T00:00:00.000Z'
    })

    expect(reportContract.requiredSections.map((section) => section.title)).toEqual([
      '收入',
      '利润率',
      '现金流',
      '负债情况'
    ])
  })

  it('ignores a strict source URL while parsing an explicit concept relationship', () => {
    const frame = buildResearchFrame({
      topic: '仅基于 https://developer.example/docs/reference/header 解释 alpha-cache 与 beta-store 的具体区别，输出中文报告。'
    })
    const reportContract = buildReportContract({
      brief: makeBrief(),
      frame,
      nowIso: '2026-07-15T00:00:00.000Z'
    })

    expect(reportContract.requiredSections.map((section) => section.title)).toEqual([
      'alpha-cache 与 beta-store'
    ])
  })

  it('does not turn audience or writing style into required research dimensions', () => {
    const frame = buildResearchFrame({
      topic: '中国乒乓球实力分析',
      scope: {
        ...makeChinaUsScope(),
        summary: '涵盖成绩、人才、技战术、国际竞争格局、面向普通球迷、通俗易懂。',
        mainContradiction: '中国队统治力是否稳固。',
        confirmationChecklist: [
          '需求理解：分析中国乒乓球实力。',
          '核心问题：中国队统治力是否稳固。',
          '调研主线：成绩、人才、技战术和竞争格局。',
          '输出边界：面向普通球迷，中文完整报告。'
        ]
      }
    })

    const questions = frame.coreQuestions.map((question) => question.text).join('\n')
    expect(questions).not.toContain('「面向普通球迷」维度')
    expect(questions).not.toContain('「通俗易懂」维度')
  })

  it('does not turn a trailing evidence-quality instruction into a research section', () => {
    const frame = buildResearchFrame({
      topic: '城市韧性评估',
      userClarifications: [
        '重点关注：预警覆盖、基础设施恢复、居民疏散，并明确主要风险和证据边界。'
      ]
    })
    const contract = buildReportContract({
      brief: makeBrief(),
      frame,
      nowIso: '2026-07-15T00:00:00.000Z'
    })

    expect(contract.requiredSections.map((section) => section.title)).toEqual([
      '预警覆盖',
      '基础设施恢复',
      '居民疏散'
    ])
    expect(frame.coreQuestions.map((question) => question.text).join('\n')).not.toContain('证据边界」维度')
  })

  it('filters a trailing evidence-quality instruction from relationship fallback parsing', () => {
    const frame = buildResearchFrame({
      topic: '通用对象评估',
      userClarifications: [
        '您最想了解哪些方面？：完整分析运行稳定性与恢复能力、成本结构与扩展能力，并明确主要风险和证据边界。'
      ]
    })

    expect(frame.coreQuestions.map((question) => question.text).join('\n')).toContain('「运行稳定性 与 恢复能力」维度')
    expect(frame.coreQuestions.map((question) => question.text).join('\n')).toContain('「成本结构 与 扩展能力」维度')
    expect(frame.coreQuestions.map((question) => question.text).join('\n')).not.toContain('并明确主要风险')
    expect(frame.coreQuestions.map((question) => question.text).join('\n')).not.toContain('证据边界」维度')
  })

  it('parses every line of a GUI multi-question answer without leaking later labels', () => {
    const frame = buildResearchFrame({
      topic: '通用系统评估',
      userClarifications: [
        [
          '您最想了解哪些方面？：完整分析运行稳定性与恢复能力、成本结构与扩展能力，并明确主要风险和证据边界。',
          '这份报告的用途是什么？：内部决策参考。',
          '您关注的时间范围是？：最近三年，以最新可得数据为准。',
          '是否需要与其他对象比较？：主结论聚焦当前系统，其他对象只作必要背景。'
        ].join('\n')
      ]
    })
    const questions = frame.coreQuestions.map((question) => question.text).join('\n')

    expect(questions).toContain('「运行稳定性 与 恢复能力」维度')
    expect(questions).toContain('「成本结构 与 扩展能力」维度')
    expect(questions).not.toContain('是否需要')
    expect(questions).not.toContain('时间范围」维度')
    expect(questions).not.toContain('证据边界」维度')
  })

  it('does not turn unresolved scope metadata into required research dimensions', () => {
    const frame = buildResearchFrame({
      topic: '对比中美奥运会擅长项目',
      scope: {
        ...makeChinaUsScope(),
        summary: '用户希望对比中美奥运会擅长项目，但未明确对比维度、时间范围、数据来源和输出用途。',
        mainContradiction: '核心问题是如何基于可验证成绩识别两国的稳定优势项目。'
      }
    })
    const questions = frame.coreQuestions.map((question) => question.text).join('\n')

    expect(questions).not.toContain('数据来源 与 输出用途')
    expect(questions).not.toContain('时间范围')
    expect(questions).not.toContain('对比维度')
  })

  it('maps an explicit list of affected objects into separate required dimensions without joining fragments', () => {
    const topic = '仅基于 MDN 官方文档，解释 HTTP 缓存中 no-cache 与 no-store 的具体含义、两者差异，以及它们对浏览器缓存存储、验证和复用的实际影响。输出中文完整报告。'
    const frame = buildResearchFrame({
      topic,
      scope: {
        ...makeChinaUsScope(),
        summary: '用户要求解释 no-cache 与 no-store 的含义、差异及对浏览器缓存存储、验证和复用的实际影响。',
        mainContradiction: 'no-cache 允许存储但要求复用前验证，no-store 禁止存储。',
        confirmationChecklist: [
          '核心问题：no-cache与no-store的具体含义、差异及其对浏览器缓存存储、验证和复用的影响。'
        ]
      }
    })
    const requiredQuestions = frame.coreQuestions
      .filter((question) => question.required)
      .map((question) => question.text)

    expect(requiredQuestions).toEqual(expect.arrayContaining([
      expect.stringContaining('「浏览器缓存存储」维度'),
      expect.stringContaining('「验证」维度'),
      expect.stringContaining('「复用」维度')
    ]))
    expect(buildReportContract({ brief: makeBrief(), frame, nowIso: '2026-07-14T00:00:00.000Z' }).requiredSections.map((section) => section.title))
      .toEqual(['浏览器缓存存储', '验证', '复用'])
    expect(requiredQuestions.join('\n')).not.toContain('验证 与 复用的实际影响')
    expect(requiredQuestions.join('\n')).not.toContain('存储 与 验证')
  })

  it('maps only user-owned pricing requirements without product-specific presets', () => {
    const frame = buildResearchFrame({
      topic: '对比 Cursor 和 Windsurf 的官方定价差异，重点回答个人开发者怎么选',
      scope: {
        ...makeChinaUsScope(),
        summary: '对比 Cursor 和 Windsurf 的官方定价，结合个人开发者场景判断性价比。',
        mainContradiction: '在个人开发者中高价格敏感度下，如何根据官方定价和核心功能差异选择工具。',
        confirmationChecklist: [
          '需求理解：对比 Cursor 和 Windsurf 官方定价。',
          '核心问题：哪个工具的免费版或付费版更值得个人开发者选择。',
          '调研主线：官方定价为核心，功能差异为辅助。',
          '输出边界：中文完整报告。'
        ]
      }
    })
    const text = frame.coreQuestions.map((question) => question.text).join('\n')

    expect(text).toContain('「官方定价」维度')
    expect(text).not.toContain('「官方定价和核心功能」维度')
    expect(text).not.toContain('「个人开发者」维度')
    expect(frame.alternativesToCompare).toEqual(['Cursor', 'Windsurf'])
    expect(text).not.toContain('性价比结论与边界条件')
    expect(text).not.toContain('科技创新与数字经济')
  })

  it('does not turn scope confirmation workflow text into comparison targets', () => {
    const frame = buildResearchFrame({
      topic: '中国乒乓球实力分析',
      scope: {
        ...makeChinaUsScope(),
        summary: '分析近五年中国乒乓球实力，并与主要对手对比。',
        mainContradiction: '中国乒乓球的国际统治力是否出现松动。',
        confirmationChecklist: [
          '调研主线：按成绩、人才、技术、对手四个维度展开证据收集。',
          '输出边界：面向普通读者的完整分析。'
        ]
      },
      userClarifications: ['需要与日本、德国、韩国等主要对手及全球整体水平对比。']
    })

    expect(frame.alternativesToCompare).toEqual(['日本', '德国', '韩国'])
    expect(frame.alternativesToCompare).not.toContain('对手四个维度展开证据收集')
    expect(frame.alternativesToCompare).not.toContain('分析')
  })

  it('maps explicit table-tennis dimensions without treating event scope as opponents', () => {
    const frame = buildResearchFrame({
      topic: '中国乒乓球实力分析：以近5年奥运会、世锦赛、世界杯和WTT高级别赛事为范围，从竞技成绩、人才储备、技战术、男女队差异和国际竞争格局分析统治力是否稳固；与日本、德国、韩国主要对手及全球整体水平对比'
    })
    const questions = frame.coreQuestions.map((question) => question.text).join('\n')

    expect(frame.alternativesToCompare).toEqual(['日本', '德国', '韩国'])
    expect(questions).toContain('「竞技成绩」维度')
    expect(questions).toContain('「人才储备」维度')
    expect(questions).toContain('「技战术」维度')
    expect(questions).toContain('「男女队」维度')
    expect(questions).toContain('「国际竞争格局」维度')

    const countedDimensionsFrame = buildResearchFrame({
      topic: '中国乒乓球实力分析：以2021年至今的奥运会、世锦赛、世界杯和WTT高级别赛事为范围，从竞技成绩、人才储备、技战术、男女队差异和国际竞争格局五个维度分析中国队的优势、风险与未来两年走势，并与日本、德国、韩国主要对手比较。'
    })
    const countedQuestions = countedDimensionsFrame.coreQuestions.map((question) => question.text).join('\n')

    expect(countedDimensionsFrame.alternativesToCompare).toEqual(['日本', '德国', '韩国'])
    expect(countedQuestions).toContain('「国际竞争格局」维度')
    expect(countedQuestions).not.toContain('在「国际竞争格局五个维度」维度')
  })

  it('removes broad duplicate dimensions from a stale generated frame', () => {
    const frame = buildResearchFrame({
      topic: '东南亚11国移动游戏市场进入优先级分析，覆盖市场规模与增长、竞争格局、用户行为与偏好；同时按游戏类型和内购/广告/混合变现分析高潜赛道',
      overrides: {
        coreResearchThread: '选出最值得进入的国家。',
        centralQuestion: '哪些国家值得优先进入？',
        coreQuestions: [
          { id: 'q1', text: '哪些国家值得优先进入？', priority: 'high', required: true },
          { id: 'q2', text: '在「市场规模与增长」维度上，关键事实、作用机制、风险和适用边界是什么？', priority: 'high', required: true },
          { id: 'q3', text: '在「竞争格局」维度上，关键事实、作用机制、风险和适用边界是什么？', priority: 'high', required: true },
          { id: 'q4', text: '在「用户行为与偏好」维度上，关键事实、作用机制、风险和适用边界是什么？', priority: 'high', required: true },
          { id: 'q5', text: '在「市场规模」维度上，关键事实、作用机制、风险和适用边界是什么？', priority: 'high', required: true },
          { id: 'q6', text: '在「竞争」维度上，关键事实、作用机制、风险和适用边界是什么？', priority: 'high', required: true }
        ]
      }
    })
    const questions = frame.coreQuestions.map((question) => question.text).join('\n')

    expect(questions).toContain('市场规模与增长')
    expect(questions).toContain('竞争格局')
    expect(questions).not.toContain('在「市场规模」维度')
    expect(questions).not.toContain('在「竞争」维度')
  })

  it('does not turn a competitor coverage answer into required report dimensions', () => {
    const frame = buildResearchFrame({
      topic: '东南亚11国移动游戏市场进入优先级分析，覆盖市场规模与增长、竞争格局、用户行为与偏好；同时按游戏类型和内购/广告/混合变现分析高潜赛道',
      userClarifications: [
        '3. 可选竞争范围：全部覆盖，以腾讯、网易、Garena/Sea和主要本地开发商为代表。'
      ]
    })
    const questions = frame.coreQuestions.map((question) => question.text).join('\n')

    expect(questions).toContain('市场规模与增长')
    expect(questions).toContain('竞争格局')
    expect(questions).toContain('「游戏类型」维度')
    expect(questions).toContain('「内购/广告/混合变现」维度')
    expect(questions).not.toMatch(/在「(?:以腾讯|网易|Garena|Sea)」维度/u)
  })

  it('does not treat policy and localization differences as comparison entities', () => {
    const frame = buildResearchFrame({
      topic: '东南亚移动游戏市场进入优先级分析',
      scope: {
        ...makeChinaUsScope(),
        summary: '为中型游戏公司选择首个东南亚进入市场。',
        mainContradiction: '在市场高增长但竞争加剧、政策与本地化差异显著的背景下，如何平衡市场吸引力与进入可行性。'
      }
    })

    expect(frame.alternativesToCompare).toBeUndefined()
  })

  it('does not treat report audiences as comparison targets', () => {
    const frame = buildResearchFrame({
      topic: '解释强弱 ETag、freshness 与 validation、no-cache 与 no-store 的区别和协同机制；面向开发者和架构师，包含 API 与静态资源场景',
      scope: {
        ...makeChinaUsScope(),
        summary: '面向开发者和架构师，解释 API 与静态资源场景中的 HTTP 缓存机制。',
        mainContradiction: '如何在 API 与静态资源场景中平衡缓存效率与数据新鲜度。'
      }
    })

    expect(frame.alternativesToCompare).toBeUndefined()
    expect(frame.coreQuestions.map((question) => question.text).join('\n')).not.toMatch(/对比对象「(?:面向开发者|架构师)」/u)
  })

  it('does not turn a report purpose answer into a research dimension or central question', () => {
    const frame = buildResearchFrame({
      topic: '分析东南亚游戏市场的规模、竞争格局与增长机会',
      userClarifications: ['这份报告主要用于哪个方面？：内部战略决策']
    })

    expect(frame.centralQuestion).not.toContain('内部战略决策')
    expect(frame.coreQuestions.map((question) => question.text).join('\n')).not.toContain('「内部战略决策」维度')
  })

  it('uses concrete dimensions as sections and leaves the central answer to lead and conclusion', () => {
    const frame = buildResearchFrame({
      topic: '比较两个市场的规模与竞争格局',
      userClarifications: ['重点比较维度：市场规模；竞争格局']
    })
    const contract = buildReportContract({ brief: makeBrief(), frame, nowIso: '2026-07-12T00:00:00.000Z' })

    expect(contract.requiredSections.map((section) => section.title)).toEqual([
      '市场规模',
      '竞争格局'
    ])
  })

  it('extracts complete named targets instead of combining orphan pair fragments', () => {
    const frame = buildResearchFrame({ topic: '比较中国和美国的市场差异，面向产品经理和技术负责人输出报告。' })

    expect(frame.alternativesToCompare).toEqual(['中国', '美国'])
  })

  it('does not treat application contexts as comparison targets when comparison words appear elsewhere', () => {
    const frame = buildResearchFrame({
      topic: '解释 ETag 的区别和协同机制',
      scope: {
        ...makeChinaUsScope(),
        summary: '解释缓存验证机制，特别是在 API 与静态资源不同场景下的应用。',
        mainContradiction: '如何在不同应用场景下平衡效率与新鲜度。'
      }
    })

    expect(frame.alternativesToCompare).toBeUndefined()
  })

  it('honors an explicit instruction not to create independent comparison targets', () => {
    const frame = buildResearchFrame({
      topic: '东南亚移动游戏市场进入优先级分析',
      userClarifications: [
        '竞争分析：做概括性竞争格局，同时以腾讯、网易、Garena/Sea和主要本地开发商作为代表案例，不把它们当成独立比较对象。'
      ]
    })

    expect(frame.alternativesToCompare).toBeUndefined()
  })

  it('keeps AI governance scope generic when the user did not confirm a dimension list', () => {
    const frame = buildResearchFrame({
      topic: '解释 NIST AI 风险管理框架，并给出中国中小企业落地 AI 治理的建议',
      scope: {
        ...makeChinaUsScope(),
        summary: '面向中国中小企业管理者解释 NIST AI RMF。',
        mainContradiction: '以最小资源建立可执行的 AI 风险治理流程，同时兼顾中国法规。',
        confirmationChecklist: [
          '需求理解：解释 NIST AI RMF 并给出落地建议。',
          '核心问题：中小企业如何以最小资源落地 NIST AI RMF 并兼顾中国法规。',
          '输出边界：中文报告，包含步骤和检查清单。'
        ]
      },
      userClarifications: [
        '无特定行业，聚焦通用 AI 风险治理。',
        '核心问题：中小企业如何以最小资源落地 NIST AI RMF 并兼顾中国法规。'
      ]
    })
    const text = frame.coreQuestions.map((question) => question.text).join('\n')

    expect(frame.centralQuestion).toContain('中小企业如何以最小资源落地')
    expect(text).not.toContain('科技创新与数字经济')
    expect(text).not.toContain('脱钩风险与投资/商业启示')
    expect(text).toContain('调研范围、关键概念和可比口径')
    expect(text).toContain('主要机制、用户路径或因果链')
    expect(text).toContain('反例、替代解释')
    expect(text).not.toContain('NIST AI RMF 核心结构')
    expect(text).not.toContain('中国法规映射')

    const contract = buildReportContract({
      brief: {
        ...makeBrief(),
        topic: '解释 NIST AI 风险管理框架，并给出中国中小企业落地 AI 治理的建议',
        userIntent: '低成本落地并兼顾中国法规。'
      },
      frame,
      nowIso: '2026-07-10T00:00:00.000Z'
    })
    expect(contract.requiredSections[0]?.title).toBe('综合判断')
    expect(contract.requiredSections).toHaveLength(1)
    expect(contract.requiredSections.some((section) => section.title.endsWith('给出中'))).toBe(false)
  })

  it('does not mistake an explicit no-question instruction for a leaked optional scope prompt', () => {
    const frame = buildResearchFrame({
      topic: '仅基于 MDN 官方网页解释 ETag 和 Cache-Control；重点回答 freshness 与 validation 的区别。不要比较产品，不需要提问或选答，输出简洁报告。'
    })
    const questions = frame.coreQuestions.map((question) => question.text).join('\n')

    expect(frameSanityCheck(frame)).toEqual({ ok: true })
    expect(frame.alternativesToCompare).toBeUndefined()
    expect(questions).toContain('ETag 和 Cache-Control')
    expect(questions).toContain('「freshness 与 validation」维度')
    expect(questions).not.toContain('不需要提问')
    expect(questions).not.toContain('输出简洁报告')
    expect(questions).not.toContain('「validation 的」维度')
    expect(frame.coreQuestions.at(-1)).toMatchObject({ required: false, priority: 'medium' })
  })

  it('merges question ids when required report sections have the same title', () => {
    const frame: ResearchFrame = {
      ...makeFrame(),
      centralQuestion: '综合结论是什么？',
      coreQuestions: [
        { id: 'q1', text: '综合结论是什么？', priority: 'high', required: true },
        { id: 'q2', text: '在「共同维度」维度上，事实是什么？', priority: 'high', required: true },
        { id: 'q3', text: '在「共同维度」维度上，边界是什么？', priority: 'high', required: true }
      ]
    }
    const contract = buildReportContract({ brief: makeBrief(), frame, nowIso: '2026-07-11T00:00:00.000Z' })
    const shared = contract.requiredSections.find((section) => section.title === '共同维度')

    expect(shared?.questionIds).toEqual(['q2', 'q3'])
  })

  it('splits comma-separated answer dimensions into required research questions', () => {
    const frame = buildResearchFrame({
      topic: '仅基于 MDN 官方网页解释 HTTP 缓存，回答强弱验证器、freshness 与 validation、no-cache 与 no-store；不需要提问，输出简洁报告。'
    })
    const required = frame.coreQuestions.filter((question) => question.required).map((question) => question.text)

    expect(required).toEqual(expect.arrayContaining([
      expect.stringContaining('「强弱验证器」维度'),
      expect.stringContaining('「freshness 与 validation」维度'),
      expect.stringContaining('「no-cache 与 no-store」维度')
    ]))
    expect(required.join('\n')).not.toContain('调研范围、关键概念和可比口径')
  })

  it('keeps generic scaffold questions optional while promoting explicit concept groups', () => {
    const frame = buildResearchFrame({
      topic: '仅基于 MDN 官方文档解释强弱 ETag、freshness 与 validation、no-cache 与 no-store 的区别和协同机制'
    })
    const contract = buildReportContract({ brief: makeBrief(), frame, nowIso: '2026-07-12T00:00:00.000Z' })

    expect(frame.coreQuestions.filter((question) => question.required).map((question) => question.text)).toEqual(expect.arrayContaining([
      expect.stringContaining('「强弱 ETag」维度'),
      expect.stringContaining('「freshness 与 validation」维度'),
      expect.stringContaining('「no-cache 与 no-store」维度')
    ]))
    expect(frame.coreQuestions.filter((question) => /调研范围|关键事实、指标/.test(question.text)).every((question) => !question.required)).toBe(true)
    expect(contract.requiredSections.map((section) => section.title)).toEqual([
      '强弱 ETag',
      'freshness 与 validation',
      'no-cache 与 no-store'
    ])
  })

  it('promotes explicit API and static-resource scenarios without treating them as competitors', () => {
    const frame = buildResearchFrame({
      topic: '解释强弱 ETag、freshness 与 validation、no-cache 与 no-store 的区别和协同机制；包含 API 与静态资源场景'
    })

    const requiredText = frame.coreQuestions.filter((question) => question.required).map((question) => question.text).join('\n')
    expect(requiredText).toContain('「API场景」维度')
    expect(requiredText).toContain('「静态资源场景」维度')
    expect(frame.alternativesToCompare).toBeUndefined()
  })

  it('does not discard explicit dimensions when audience metadata shares the same line', () => {
    const frame = buildResearchFrame({
      topic: '仅基于 MDN 官方文档，解释 HTTP 缓存中强弱 ETag、freshness 与 validation、no-cache 与 no-store 的区别和协同机制；面向开发者和架构师，包含 API 与静态资源场景，输出完整中文报告，不补充其他来源'
    })
    const requiredText = frame.coreQuestions
      .filter((question) => question.required)
      .map((question) => question.text)
      .join('\n')

    expect(requiredText).toContain('「强弱 ETag」维度')
    expect(requiredText).toContain('「freshness 与 validation」维度')
    expect(requiredText).toContain('「no-cache 与 no-store」维度')
    expect(requiredText).toContain('「API场景」维度')
    expect(requiredText).toContain('「静态资源场景」维度')
    expect(requiredText).not.toContain('开发者')
    expect(requiredText).not.toContain('架构师')
  })

  it('repairs model scope text that repeats clarification prompts before writing the frame', () => {
    const frame = buildResearchFrame({
      topic: '对比 Cursor 和 Windsurf 的官方定价差异；补充：1. 您希望对比的是 Cursor 和 Windsurf 的哪些具体定价方案？请补充。',
      scope: {
        ...makeChinaUsScope(),
        summary: [
          '对比 Cursor 和 Windsurf 的官方定价差异。',
          '补充：1. 您希望对比的是 Cursor 和 Windsurf 的哪些具体定价方案？请补充。',
          '回答：个人开发者免费版、Pro 档和更高档套餐。'
        ].join('\n'),
        mainContradiction: '围绕「对比 Cursor 和 Windsurf；补充：1. 您希望对比的是哪些具体定价方案？」，什么？例如：哪个性价比更高？',
        confirmationChecklist: [
          '需求理解：对比 Cursor 和 Windsurf 官方定价。',
          '核心问题：围绕「对比 Cursor 和 Windsurf；补充：1. 您希望对比的是哪些具体定价方案？」，什么？例如：哪个性价比更高？',
          '调研主线：官方定价、套餐限制和个人开发者选型。',
          '输出边界：中文完整报告。'
        ]
      },
      userClarifications: [
        [
          '1. 您希望对比的是 Cursor 和 Windsurf 的哪些具体定价方案？',
          '回答：个人开发者免费版、Pro 档和更高档套餐。',
          '最后一题是选答，未选择。'
        ].join('\n')
      ]
    })
    const text = [
      frame.centralQuestion,
      frame.coreResearchThread,
      ...frame.coreQuestions.map((question) => question.text)
    ].join('\n')

    expect(frameSanityCheck(frame)).toEqual({ ok: true })
    expect(frame.centralQuestion).toContain('Cursor')
    expect(frame.centralQuestion).toContain('Windsurf')
    expect(frame.centralQuestion).toContain('官方定价')
    expect(text).not.toMatch(/您希望|请补充|例如[:：]|选答/)
    expect(text).toContain('官方定价')
    expect(text).not.toContain('个人开发者核心功能与使用限制')
  })

  it('counts official product pricing evidence for product-specific dimension coverage', async () => {
    const evaluator = new BasicCoverageEvaluator()
    const frame = buildResearchFrame({
      topic: '对比 Cursor 和 Windsurf 的官方定价差异，重点回答个人开发者怎么选',
      scope: {
        ...makeChinaUsScope(),
        summary: '对比 Cursor 和 Windsurf 的官方定价，结合个人开发者场景判断性价比。',
        mainContradiction: '在个人开发者中高价格敏感度下，如何根据官方定价和核心功能差异选择工具。',
        confirmationChecklist: [
          '需求理解：对比 Cursor 和 Windsurf 官方定价。',
          '核心问题：哪个工具的免费版或付费版更值得个人开发者选择。',
          '调研主线：官方定价为核心，功能差异为辅助。',
          '输出边界：中文完整报告。'
        ]
      }
    })
    const source = makeWebSource('source_cursor_pricing', ['web_fetch', 'web_search', 'official', 'cursor', 'pricing'])
    const span: EvidenceSpan = {
      id: 'span_cursor_pricing',
      sourceId: source.id,
      text: 'Cursor official pricing evidence describes individual developer plans, free and paid options, Pro pricing, usage limits, feature access, and upgrade considerations for a price-sensitive personal developer choosing between tools.',
      textHash: hashText('span_cursor_pricing'),
      location: { url: source.canonicalUrl, paragraphIndex: 1 },
      extractedAt: '2026-07-07T00:00:00.000Z',
      extractorRunId: 'rr_product_coverage'
    }
    const claim: AtomicClaim = {
      id: 'claim_cursor_pricing',
      text: 'Cursor 官方定价页能支撑个人开发者免费版与付费档取舍判断。',
      entities: ['Cursor', '个人开发者', 'Pro'],
      claimType: 'fact',
      supportSpanIds: [span.id],
      confidence: 'high',
      critical: true
    }
    const targetQuestion = frame.coreQuestions.find((question) => question.text.includes('官方定价与套餐口径'))
    const note: ResearchNote = {
      id: 'note_cursor_pricing',
      taskId: 'task_product_pricing',
      questionIds: [targetQuestion?.id ?? 'q2'],
      claimIds: [claim.id],
      summary: 'Cursor 官方定价证据已抓取。',
      implicationForBrief: '该证据可支撑官方套餐口径章节，但仍需要 Windsurf/Devin Desktop 对照来源。',
      confidence: 'high',
      limitations: ['只覆盖 Cursor 一侧。']
    }

    const verdict = await evaluator.evaluate({
      runId: 'rr_product_coverage',
      brief: {
        ...makeBrief(),
        topic: '对比 Cursor 和 Windsurf 的官方定价差异，重点回答个人开发者怎么选',
        userIntent: '个人开发者中高价格敏感度下的工具选型。'
      },
      frame,
      plan: {
        id: 'plan_product_coverage',
        runId: 'rr_product_coverage',
        rationale: 'test',
        tasks: [],
        createdAt: '2026-07-07T00:00:00.000Z'
      },
      budget: resolveResearchBudget({
        preset: 'standard',
        maxSources: 12,
        targetSources: 6,
        maxResearchRounds: 2,
        maxSubagents: 4
      }),
      roundIndex: 1,
      sources: [source],
      evidenceSpans: [span],
      claims: [claim],
      notes: [note],
      nowIso: '2026-07-07T00:00:01.000Z'
    })

    const coverage = verdict.coverageByQuestion.find((item) => item.questionId === note.questionIds[0])
    expect(coverage?.sourceCount).toBe(1)
    expect(coverage?.strongWebSourceCount).toBe(1)
    expect(verdict.coverageMatrix.comparisonTargets.map((target) => target.target)).toEqual(['Cursor', 'Windsurf'])
    expect(verdict.coverageMatrix.comparisonTargets.find((target) => target.target === 'Cursor')?.sourceCount).toBe(1)
    expect(verdict.coverageMatrix.comparisonTargets.find((target) => target.target === 'Windsurf')?.sourceCount).toBe(0)
  })

  it('detects answer-label frame contamination and builds the required report contract', () => {
    const dirtyFrame: ResearchFrame = {
      ...makeFrame(),
      centralQuestion: '回答：宏观经济总量、产业结构与竞争力、贸易与供应链、科技创新与数字经济。',
      coreQuestions: [{
        id: 'q1',
        text: '回答：投资或商业决策。',
        priority: 'high',
        required: true
      }]
    }

    expect(frameSanityCheck(dirtyFrame)).toMatchObject({ ok: false })

    const frame = buildResearchFrame({
      topic: '调研中美经济差异',
      scope: makeChinaUsScope(),
      userClarifications: [
        '领域：宏观经济总量、产业结构与竞争力、贸易与供应链、科技创新与数字经济。',
        '用途：投资或商业决策。',
        '核心是综合实力对比和特定领域差距。'
      ]
    })
    const contract = buildReportContract({
      brief: {
        ...makeBrief(),
        topic: '调研中美经济差异',
        userIntent: '比较中美经济综合实力和关键领域差距。',
        userClarifications: ['用途：投资或商业决策。']
      },
      frame,
      nowIso: '2026-07-07T00:00:00.000Z'
    })

    expect(contract.requiredSections.map((section) => section.title)).toEqual([
      '宏观经济总量',
      '产业结构与竞争力',
      '贸易与供应链',
      '科技创新与数字经济'
    ])
  })

  it('does not count fallback extracted web cards as strong evidence coverage', async () => {
    const evaluator = new BasicCoverageEvaluator()
    const source = makeWebSource('source_fallback', ['web_fetch', 'strong_web_evidence', 'fallback_extracted', 'fallback_structured'])
    const span: EvidenceSpan = {
      id: 'span_fallback',
      sourceId: source.id,
      text: '网页来源已抓取，但模型未能抽取结构化证据：This operation was aborted。最终报告应避免从该片段过度推断。',
      textHash: hashText('span_fallback'),
      location: { url: source.canonicalUrl, paragraphIndex: 1 },
      extractedAt: '2026-07-07T00:00:00.000Z',
      extractorRunId: 'rr_eligibility'
    }
    const claim: AtomicClaim = {
      id: 'claim_fallback',
      text: '抽取失败页面不能支撑关键结论。',
      entities: ['中美经济'],
      claimType: 'fact',
      supportSpanIds: [span.id],
      confidence: 'medium',
      critical: true
    }
    const note: ResearchNote = {
      id: 'note_fallback',
      taskId: 'task_1',
      questionIds: ['q1'],
      claimIds: [claim.id],
      summary: '兜底资料卡不应算作强证据。',
      implicationForBrief: '需要重新搜索或修复抽取。',
      confidence: 'medium',
      limitations: ['抽取失败。']
    }

    const verdict = await evaluator.evaluate({
      runId: 'rr_eligibility',
      brief: makeBrief(),
      frame: makeFrame(),
      plan: {
        id: 'plan_eligibility',
        runId: 'rr_eligibility',
        rationale: 'test',
        tasks: [],
        createdAt: '2026-07-07T00:00:00.000Z'
      },
      budget: resolveResearchBudget({
        preset: 'standard',
        maxSources: 6,
        targetSources: 6,
        maxResearchRounds: 2,
        maxSubagents: 2
      }),
      roundIndex: 1,
      sources: [source],
      evidenceSpans: [span],
      claims: [claim],
      notes: [note],
      nowIso: '2026-07-07T00:00:01.000Z'
    })

    expect(verdict.status).toBe('need_more')
    expect(verdict.coverageMatrix.strongWebSourceCount).toBe(0)
    expect(verdict.coverageByQuestion[0]?.strongWebSourceCount).toBe(0)
    expect(verdict.missingEvidence.join('\n')).toContain('真实网页来源数 0')
    expect(verdict.followUpTasks.length).toBeGreaterThan(0)
  })

  it('does not allow synthetic or p0-runtime sources to become citeable evidence', () => {
    const source: SourceRecord = {
      id: 'source_synthetic',
      sourceType: 'local_file',
      title: 'Synthetic request brief',
      path: 'synthetic://deep-research/request-brief',
      accessedAt: '2026-07-07T00:00:00.000Z',
      importedAt: '2026-07-07T00:00:00.000Z',
      reliability: 'high',
      reliabilityReason: 'Synthetic source should never be citeable.',
      sourcePolicyTags: ['synthetic', 'p0-runtime'],
      fingerprint: 'synthetic',
      status: 'fetched',
      kind: 'user_file'
    }
    const span: EvidenceSpan = {
      id: 'span_synthetic',
      sourceId: source.id,
      text: 'This synthetic source is intentionally long enough to pass character thresholds but must still be rejected by source policy.',
      textHash: hashText('span_synthetic'),
      location: { paragraphIndex: 1 },
      extractedAt: '2026-07-07T00:00:00.000Z',
      extractorRunId: 'rr_synthetic'
    }

    expect(canCiteSource(source)).toBe(false)
    expect(isEligibleStrongWebEvidence({ ...source, sourceType: 'web', kind: 'web_strong' }, span)).toBe(false)
  })

  it('accepts a short but complete official statement as strong web evidence', () => {
    const source = makeWebSource('source_short_official', ['web_fetch', 'official'])
    const span: EvidenceSpan = {
      id: 'span_short_official',
      sourceId: source.id,
      text: 'no-cache 允许存储响应，但每次复用前都必须向源站重新验证。',
      textHash: hashText('span_short_official'),
      location: { url: source.canonicalUrl, paragraphIndex: 1 },
      extractedAt: '2026-07-11T00:00:00.000Z',
      extractorRunId: 'rr_short_official'
    }

    expect(isEligibleStrongWebEvidence(source, span)).toBe(true)
  })

  it('rejects an English evidence fragment truncated to one trailing letter', () => {
    expect(isUsableEvidenceText('Note that no-cache does not mean "don\'t cache". no-cache allows caches t'))
      .toBe(false)
  })

  it('rejects an introductory evidence fragment that ends before its example', () => {
    expect(isUsableEvidenceText('首先，service worker 在其 install 事件处理程序中预缓存静态资源：'))
      .toBe(false)
  })

  it('rejects a dangling connective sentence extracted without its premise', () => {
    expect(isUsableEvidenceText('否则，将从服务器下载资源并更新缓存。'))
      .toBe(false)
  })

  it('rejects an anonymous third-party company profile without an attributable subject', () => {
    expect(isUsableEvidenceText('一家总部位于香港的跨国生产公司，设计、开发及制造面向全球市场的精细收藏玩具。'))
      .toBe(false)
    expect(isUsableEvidenceText('An international manufacturer headquartered in Europe designs collectible products for global markets.'))
      .toBe(false)
    expect(isUsableEvidenceText('示例集团是一家总部位于香港的跨国生产公司，面向全球市场制造收藏玩具。'))
      .toBe(true)
  })

  it('rejects anonymous comparison-table headers without row values or prose', () => {
    expect(isUsableEvidenceText('示例品牌 公司 A 公司 B 公司 C 人民币百万元 排名 复合年增长率 2019年竞争格局 按零售价值计'))
      .toBe(false)
  })

  it('rejects PDF page-heading glue, incomplete enumerated premises, and meeting agendas', () => {
    expect(isUsableEvidenceText('44 上市所得款项净额用途之变更 考虑到 (i) 第三方资源可获取性有限，加之海外业务快速拓展，董事会持续推进新的业务规划但该段在此处被截断'))
      .toBe(false)
    expect(isUsableEvidenceText('考虑到 (i) 外部资源可获取性有限，加之海外业务快速拓展及市场表现亮眼'))
      .toBe(false)
    expect(isUsableEvidenceText('当日下午，公司召开年度业绩发布会，管理层就产品运营、全球拓展及未来战略进行解读。'))
      .toBe(false)
    expect(isUsableEvidenceText('公司召开年度业绩发布会，并宣布海外收入同比增长120%。'))
      .toBe(true)
  })

  it('rejects a truncated code declaration from a documentation page', () => {
    expect(isUsableEvidenceText('const precachedResources = ["/", "/app')).toBe(false)
  })

  it('rejects a numbered table-footnote fragment merged with a repeated equivalence cell', () => {
    expect(isUsableEvidenceText('1 Cache-Control header, although its behavior is the same as Cache-Control: no-cache if the Cache-Control header field is omitted in a request Same as Cache-Control: no-cache'))
      .toBe(false)
  })

  it('maps evidence through bilingual aliases explicitly declared in the research context', () => {
    const context = '比较生命周期排放（life-cycle emissions）与单位成本（unit cost）。'
    expect(isResearchEvidenceFocused(
      '在「生命周期排放」维度上，关键事实是什么？',
      'Life-cycle emissions include production, operation and end-of-life stages.',
      context
    )).toBe(true)
    expect(isResearchEvidenceFocused(
      '在「单位成本」维度上，关键事实是什么？',
      'Unit cost falls when the manufacturing process reaches a larger scale.',
      context
    )).toBe(true)
  })

  it('accepts either side of a paired dimension before the aggregate all-of check', () => {
    const question = '在「baseline 与 peak load」维度上，关键事实是什么？'
    expect(isResearchEvidenceFocused(
      question,
      'The baseline remained stable throughout the observation window.',
      'Capacity planning for the service'
    )).toBe(true)
    expect(isResearchEvidenceFocused(
      question,
      'Peak load exceeded the normal operating range during the evening interval.',
      'Capacity planning for the service'
    )).toBe(true)
  })

  it('derives a single focus group from an arbitrary user dimension without a topic dictionary', () => {
    const groups = researchDimensionFocusGroups('生命周期排放（life-cycle emissions）')
    expect(coversResearchDimensionFocusGroups(
      groups,
      'The life-cycle emissions estimate covers production and operation.'
    )).toBe(true)
    expect(coversResearchDimensionFocusGroups(
      groups,
      'The purchase price was measured at contract signing.'
    )).toBe(false)
  })

  it('does not reduce a generic dimension title to a meaningless modifier', () => {
    const groups = researchDimensionFocusGroups('主要风险')
    const terms = groups.flat()

    expect(terms).toContain('主要风险')
    expect(terms).not.toContain('主要')
  })

  it('requires every explicitly paired concept family for aggregate coverage', () => {
    const groups = researchDimensionFocusGroups('baseline 与 peak load 的区别和关系')
    expect(coversResearchDimensionFocusGroups(
      groups,
      'The baseline remained stable throughout the observation window.'
    )).toBe(false)
    expect(coversResearchDimensionFocusGroups(
      groups,
      'The baseline remained stable, while peak load exceeded the normal operating range.'
    )).toBe(true)
  })

  it('does not match a one-character contrast marker inside an unrelated Chinese word', () => {
    const groups = researchDimensionFocusGroups(
      '强 ETag 与弱 ETag',
      '解释 HTTP 缓存中强 ETag 与弱 ETag 的具体含义。'
    )

    expect(coversResearchDimensionFocusGroups(
      [groups[0] ?? []],
      'no-cache 允许缓存保存响应，但每次复用之前都必须强制验证。'
    )).toBe(false)
    expect(coversResearchDimensionFocusGroups(
      [groups[0] ?? []],
      'A strong ETag requires the representations to be byte-for-byte identical.'
    )).toBe(true)
    expect(coversResearchDimensionFocusGroups(
      [groups[1] ?? []],
      'A weak ETag indicates semantic equivalence rather than byte-for-byte identity.'
    )).toBe(true)
  })

  it('does not translate the first character of an ordinary two-character facet', () => {
    const groups = researchDimensionFocusGroups('上市与退市机制')

    expect(groups[0]).toContain('上市')
    expect(groups[0]).not.toContain('upper')
    expect(groups[0]).not.toContain('upper 市')
    expect(groups[1]).toContain('退市机制')
  })

  it('allows ready_with_limitations only for non-central limitation gaps', async () => {
    const evaluator = new BasicCoverageEvaluator()
    const source = makeWebSource('source_strong', ['web_fetch', 'strong_web_evidence'])
    const evidenceText = '官方网页证据显示，中国和美国的经济竞争已经有足够事实支撑核心判断，文本长度超过强网页证据阈值，且没有出现网络中断、页面异常或无关导航提示。该段还提供了明确的来源语境、指标口径和判断条件，足以作为强网页证据参与覆盖矩阵。'
    const span: EvidenceSpan = {
      id: 'span_strong',
      sourceId: source.id,
      text: evidenceText,
      textHash: hashText(evidenceText),
      location: { url: source.canonicalUrl, paragraphIndex: 1 },
      extractedAt: '2026-07-07T00:00:00.000Z',
      extractorRunId: 'rr_limitations'
    }
    const claim: AtomicClaim = {
      id: 'claim_strong',
      text: '核心问题已有真实网页证据支撑。',
      entities: ['中国', '美国', '中美经济'],
      claimType: 'fact',
      supportSpanIds: [span.id],
      confidence: 'high',
      critical: true
    }
    const note: ResearchNote = {
      id: 'note_strong',
      taskId: 'task_1',
      questionIds: ['q1'],
      claimIds: [claim.id],
      summary: '核心问题已覆盖。',
      implicationForBrief: '可以进入报告，但仍需在最终报告里说明资料范围。',
      confidence: 'high',
      limitations: ['该结论来自网页文本抽取，仍需在最终报告中保留来源语境。']
    }

    const verdict = await evaluator.evaluate({
      runId: 'rr_limitations',
      brief: makeBrief(),
      frame: makeFrame(),
      plan: {
        id: 'plan_limitations',
        runId: 'rr_limitations',
        rationale: 'test',
        tasks: [],
        createdAt: '2026-07-07T00:00:00.000Z'
      },
      budget: resolveResearchBudget({
        preset: 'standard',
        maxSources: 1,
        targetSources: 1,
        maxResearchRounds: 1,
        maxSubagents: 1
      }),
      roundIndex: 1,
      sources: [source],
      evidenceSpans: [span],
      claims: [claim],
      notes: [note],
      nowIso: '2026-07-07T00:00:01.000Z'
    })

    expect(verdict.missingEvidence).toEqual(['缺少反证、争议、限制条件或边界证据。'])
    expect(verdict.status).toBe('ready_with_limitations')
  })

  it('uses section evidence instead of the configured global source minimum as the writing gate', async () => {
    const evaluator = new BasicCoverageEvaluator()
    const source = makeWebSource('source_budget_floor', ['web_fetch'])
    const evidenceText = '官方网页提供了与当前问题直接相关的完整事实说明，并明确给出适用口径、来源语境和限制条件；这段文本足够长，可以作为真实网页证据参与覆盖判断。'
    const span: EvidenceSpan = {
      id: 'span_budget_floor',
      sourceId: source.id,
      text: evidenceText,
      textHash: hashText(evidenceText),
      location: { url: source.canonicalUrl, paragraphIndex: 1 },
      extractedAt: '2026-07-07T00:00:00.000Z',
      extractorRunId: 'rr_budget_floor'
    }
    const claim: AtomicClaim = {
      id: 'claim_budget_floor',
      text: '当前问题已有一条官方网页证据。',
      entities: ['中美经济'],
      claimType: 'fact',
      supportSpanIds: [span.id],
      confidence: 'high',
      critical: true
    }
    const note: ResearchNote = {
      id: 'note_budget_floor',
      taskId: 'task_1',
      questionIds: ['q1'],
      claimIds: [claim.id],
      summary: '核心问题已有一条证据。',
      implicationForBrief: '仍不能替代第二个独立来源。',
      confidence: 'high',
      limitations: ['需要第二个独立来源交叉验证。']
    }
    const brief = makeBrief()

    const verdict = await evaluator.evaluate({
      runId: 'rr_budget_floor',
      brief: {
        ...brief,
        sourcePolicy: { ...brief.sourcePolicy, minSourceCount: 1 }
      },
      frame: makeFrame(),
      plan: {
        id: 'plan_budget_floor',
        runId: 'rr_budget_floor',
        rationale: 'test',
        tasks: [],
        createdAt: '2026-07-07T00:00:00.000Z'
      },
      budget: resolveResearchBudget({
        preset: 'standard',
        minSources: 2,
        targetSources: 2,
        maxSources: 2,
        maxResearchRounds: 1,
        maxSubagents: 1
      }),
      roundIndex: 1,
      sources: [source],
      evidenceSpans: [span],
      claims: [claim],
      notes: [note],
      nowIso: '2026-07-07T00:00:01.000Z'
    })

    expect(verdict.missingEvidence).not.toContain('唯一来源总数 1 低于最低要求 2。')
    expect(verdict.missingEvidence.join('\n')).not.toContain('来源数 1 低于要求')
    expect(verdict.status).toBe('ready_with_limitations')
  })

  it('allows a well-covered report at 75 percent of the deep source target to write with limitations', async () => {
    const evaluator = new BasicCoverageEvaluator()
    const sources = Array.from({ length: 3 }, (_, index) => ({
      ...makeWebSource(`source_practical_floor_${index}`, ['web_fetch', 'strong_web_evidence']),
      canonicalUrl: `https://example.test/practical-floor-${index}`
    }))
    const spans = sources.map((source, index): EvidenceSpan => {
      const text = `第 ${index + 1} 个独立网页来源提供了中美经济总量、产业结构和适用口径的直接证据，内容可回查且足以支撑当前核心问题的谨慎判断。`
      return {
        id: `span_practical_floor_${index}`,
        sourceId: source.id,
        text,
        textHash: hashText(text),
        location: { url: source.canonicalUrl, paragraphIndex: 1 },
        extractedAt: '2026-07-07T00:00:00.000Z',
        extractorRunId: 'rr_practical_floor'
      }
    })
    const claim: AtomicClaim = {
      id: 'claim_practical_floor',
      text: '三个独立网页来源已能支撑对中美经济差距的谨慎判断。',
      entities: ['中国', '美国', '中美经济'],
      claimType: 'fact',
      supportSpanIds: spans.map((span) => span.id),
      confidence: 'high',
      critical: true
    }
    const note: ResearchNote = {
      id: 'note_practical_floor',
      taskId: 'task_1',
      questionIds: ['q1'],
      claimIds: [claim.id],
      summary: '核心问题已由三个独立来源覆盖。',
      implicationForBrief: '可以写作，但必须说明未达到理想的四条来源目标。',
      confidence: 'high',
      limitations: ['总来源数低于理想目标。']
    }
    const brief = makeBrief()
    const verdict = await evaluator.evaluate({
      runId: 'rr_practical_floor',
      brief: {
        ...brief,
        sourcePolicy: { ...brief.sourcePolicy, minSourceCount: 4, maxSourceCount: 4 }
      },
      frame: makeFrame(),
      plan: {
        id: 'plan_practical_floor',
        runId: 'rr_practical_floor',
        rationale: 'test',
        tasks: [],
        createdAt: '2026-07-07T00:00:00.000Z'
      },
      budget: resolveResearchBudget({
        preset: 'deep',
        minSources: 4,
        targetSources: 4,
        maxSources: 4,
        maxResearchRounds: 1,
        maxSubagents: 1
      }),
      roundIndex: 1,
      sources,
      evidenceSpans: spans,
      claims: [claim],
      notes: [note],
      nowIso: '2026-07-07T00:00:01.000Z'
    })

    expect(verdict.missingEvidence).not.toContain('唯一来源总数 3 低于最低要求 4。')
    expect(verdict.status).toBe('ready_with_limitations')
  })

  it('does not let fallback or spanless records satisfy the global source floor', async () => {
    const evaluator = new BasicCoverageEvaluator()
    const validSource = makeWebSource('source_valid_floor', ['web_fetch'])
    const validText = '官方网页给出当前研究问题的直接事实、适用口径和限制条件，文本可回查且足够完整，可以支撑一个有边界的关键判断。'
    const validSpan: EvidenceSpan = {
      id: 'span_valid_floor',
      sourceId: validSource.id,
      text: validText,
      textHash: hashText(validText),
      location: { url: validSource.canonicalUrl, paragraphIndex: 1 },
      extractedAt: '2026-07-07T00:00:00.000Z',
      extractorRunId: 'rr_invalid_floor'
    }
    const validClaim: AtomicClaim = {
      id: 'claim_valid_floor',
      text: '当前研究问题有一条可回查官方证据。',
      entities: ['中美经济'],
      claimType: 'fact',
      supportSpanIds: [validSpan.id],
      confidence: 'high',
      critical: true
    }
    const invalidSources: SourceRecord[] = [{
      ...makeWebSource('source_model_floor', []),
      path: 'synthetic://deep-research/model-card',
      sourcePolicyTags: ['model_generated', 'synthetic'],
      kind: 'model_fallback'
    }, {
      ...makeWebSource('source_spanless_floor', []),
      kind: 'web_weak'
    }]
    const brief = makeBrief()
    const verdict = await evaluator.evaluate({
      runId: 'rr_invalid_floor',
      brief: { ...brief, sourcePolicy: { ...brief.sourcePolicy, minSourceCount: 1 } },
      frame: makeFrame(),
      plan: { id: 'plan_invalid_floor', runId: 'rr_invalid_floor', rationale: 'test', tasks: [], createdAt: '2026-07-07T00:00:00.000Z' },
      budget: resolveResearchBudget({ preset: 'standard', minSources: 2, targetSources: 2, maxSources: 3, maxResearchRounds: 1 }),
      roundIndex: 1,
      sources: [validSource, ...invalidSources],
      evidenceSpans: [validSpan],
      claims: [validClaim],
      notes: [{
        id: 'note_valid_floor',
        taskId: 'task_1',
        questionIds: ['q1'],
        claimIds: [validClaim.id],
        summary: validClaim.text,
        implicationForBrief: validClaim.text,
        confidence: 'high',
        limitations: ['仍需第二个独立来源。']
      }],
      nowIso: '2026-07-07T00:00:01.000Z'
    })

    expect(verdict.coverageMatrix.totalSourceCount).toBe(1)
    expect(verdict.missingEvidence).not.toContain('唯一来源总数 1 低于最低要求 2。')
  })

  it('does not count topically unrelated web sources as coverage for the question', async () => {
    const evaluator = new BasicCoverageEvaluator()
    const source = makeWebSource('source_bea_for_nba', ['web_fetch', 'strong_web_evidence'])
    const span: EvidenceSpan = {
      id: 'span_bea_for_nba',
      sourceId: source.id,
      text: 'Bureau of Economic Analysis reports national accounts, GDP, corporate profits and state personal income for the United States economy. This page is an official macroeconomic statistics page about macro indicators, industry output and regional accounts.',
      textHash: hashText('span_bea_for_nba'),
      location: { url: source.canonicalUrl, paragraphIndex: 1 },
      extractedAt: '2026-07-07T00:00:00.000Z',
      extractorRunId: 'rr_nba_relevance'
    }
    const claim: AtomicClaim = {
      id: 'claim_bea_for_nba',
      text: 'BEA provides U.S. macroeconomic statistics.',
      entities: ['BEA', 'GDP'],
      claimType: 'fact',
      supportSpanIds: [span.id],
      confidence: 'high',
      critical: true
    }
    const note: ResearchNote = {
      id: 'note_bea_for_nba',
      taskId: 'task_1',
      questionIds: ['q1'],
      claimIds: [claim.id],
      summary: 'BEA macro statistics were fetched.',
      implicationForBrief: 'This should not answer the NBA market question.',
      confidence: 'high',
      limitations: []
    }
    const frame: ResearchFrame = {
      ...makeFrame(),
      coreResearchThread: 'NBA media-rights growth versus viewership pressure, compared with NFL and MLB.',
      centralQuestion: 'NBA未来3-5年商业前景如何，收入、利润、球迷市场和收视率趋势相对NFL、MLB有什么差异？',
      coreQuestions: [{
        id: 'q1',
        text: 'NBA未来3-5年商业前景如何，收入、利润、球迷市场和收视率趋势相对NFL、MLB有什么差异？',
        priority: 'high',
        required: true
      }]
    }

    const verdict = await evaluator.evaluate({
      runId: 'rr_nba_relevance',
      brief: {
        ...makeBrief(),
        topic: '调研美国 NBA 市场前景',
        userIntent: '比较 NBA 与 NFL、MLB 的收入、利润、球迷市场和收视率趋势。'
      },
      frame,
      plan: {
        id: 'plan_nba_relevance',
        runId: 'rr_nba_relevance',
        rationale: 'test',
        tasks: [],
        createdAt: '2026-07-07T00:00:00.000Z'
      },
      budget: resolveResearchBudget({
        preset: 'standard',
        maxSources: 6,
        targetSources: 6,
        maxResearchRounds: 2,
        maxSubagents: 2
      }),
      roundIndex: 1,
      sources: [source],
      evidenceSpans: [span],
      claims: [claim],
      notes: [note],
      nowIso: '2026-07-07T00:00:01.000Z'
    })

    expect(verdict.status).toBe('need_more')
    expect(verdict.coverageByQuestion[0]?.sourceCount).toBe(0)
    expect(verdict.coverageByQuestion[0]?.strongWebSourceCount).toBe(0)
    expect(verdict.missingEvidence.join('\n')).toContain('来源数 0')
  })
})

function makeChinaUsScope(): ResearchScopeAssessment {
  return {
    understood: true,
    coreQuestionsConfirmed: true,
    readyForBrief: true,
    assessmentSource: 'model',
    assessmentModel: 'fake-scope',
    summary: '用户真实确认了中美经济差异的多维对比和投资/商业决策用途。',
    mainContradiction: '需要判断中美综合经济实力差异，并识别最能影响商业和投资判断的领域差距。',
    assumptions: ['输出中文完整报告。'],
    clarificationQuestions: [],
    confirmationChecklist: [
      '需求理解：围绕中美经济差异生成报告。',
      '核心问题：4. 您是否有特定的比较角度或核心问题？例如，是想了解中国在哪些领域已超越美国，还是分析两国经济脱钩风险？'
    ],
    createdAt: '2026-07-07T00:00:00.000Z'
  }
}

function makeBrief(): ResearchBrief {
  return {
    id: 'brief_eligibility',
    version: 1,
    topic: '调研中美经济差异',
    userIntent: '比较中美经济综合实力和关键领域差距。',
    outputFormat: '中文完整报告',
    sourcePolicy: {
      allowedSourceTypes: ['web'],
      minSourceCount: 2,
      maxSourceCount: 6,
      requireCitations: true
    },
    successCriteria: ['覆盖关键维度并引用真实网页证据。'],
    constraints: [],
    createdAt: '2026-07-07T00:00:00.000Z'
  }
}

function makeFrame(): ResearchFrame {
  return {
    coreResearchThread: '判断中美经济综合实力差异，并识别最能改变商业和投资判断的证据。',
    centralQuestion: '中美综合经济实力谁更强？主要领域差距、优势与商业/投资启示是什么？',
    coreQuestions: [{
      id: 'q1',
      text: '在宏观经济总量与产业结构维度上，中美关键差距是什么？',
      priority: 'high',
      required: true
    }],
    investigationPath: ['搜索', '抽取', '校验'],
    evidenceNeeded: ['真实网页证据。'],
    disconfirmingEvidenceNeeded: ['反例和口径限制。'],
    nonGoals: ['不使用模型 fallback 作为强证据。']
  }
}

function makeWebSource(id: string, tags: string[]): SourceRecord {
  return {
    id,
    sourceType: 'web',
    title: 'Fallback extracted source',
    canonicalUrl: 'https://example.test/fallback',
    accessedAt: '2026-07-07T00:00:00.000Z',
    importedAt: '2026-07-07T00:00:00.000Z',
    reliability: 'high',
    reliabilityReason: 'test',
    sourcePolicyTags: tags,
    fingerprint: hashText(id),
    status: 'fetched',
    kind: 'web_strong'
  }
}
