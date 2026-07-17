#!/usr/bin/env node
/**
 * FBS-BookWriter 自然语言指令系统优化方案
 * 
 * 目标：提升用户操作灵活性和功能/场景激活便利性
 * 
 * 优化方向：
 * 1. 扩展自然语言触发词覆盖面
 * 2. 支持模糊表达和同义词
 * 3. 上下文感知的意图识别
 * 4. 多轮对话的智能理解
 * 5. 帮助系统的自然化表达
 */

import { formatBalanceSummary, getUpgradeHint } from '../wecom/lib/credits-ledger.mjs';

export const NLU_OPTIMIZATION = {
  version: '2.0.2',

  lastUpdated: '2026-04-08',
  
  // ========================================
  // 核心意图扩展
  // ========================================
  intentExpansion: {
    // 轻量激活入口：仅激活技能，不直接进入重操作
    ACTIVATE_ONLY: {
      original: ['福帮手', '福帮手写书skill'],
      expanded: [
        '福帮手', '福帮手写书skill',
        '启动福帮手', '打开福帮手', '加载福帮手',
        '启动skill', '打开skill', '加载skill'
      ]
    },

    // 写书意图扩展
    WRITE_BOOK: {
      original: ['福帮手写书', '写书', '写手册', '写指南'],
      expanded: [
        // 直接表达
        '福帮手写书',
        '写书', '写一本', '我要写', '帮我写',

        '创作', '写作', '开始写', '开始创作',
        
        // 具体裁
        '写手册', '写指南', '写白皮书', '写报告',
        '写报道', '写深度稿', '写特稿', '写专题',
        '写长文', '写长篇', '写书稿',
        '写行业指南', '写行业报告', '写调研报告',
        '写技术文档', '写产品手册', '写教程',
        
        // 协作模式
        '协作写书', '共同创作', '团队写作',

        // 拆书式改写
        '拆书改写', '拆书', '改写',
        '海外本地化改写', '爆款结构改写',
        
        // 结构操作
        '定大纲', '设计结构', '规划章节',
        '写章节', '写目录', '制定大纲',
        
        // 视觉内容
        '封面', '插图', '图片', '配图',
        '排版构建', '图文书', '画封面',
        
        // 体裁特定
        '写调查报道', '写专题报道', '写长篇报道',
        '去AI味', '人性化写作', '去机器味',
        
        // 口语化表达
        '弄个书', '搞个文档', '弄个手册',
        '写个东西', '整本书', '做资料'
      ],
      
      // 上下文相关触发
      contextual: {
        initial: ['开始', '启动', '新建项目', '新建书稿'],
        continuation: ['继续写', '接着来', '往下写', '继续写'],
        modification: ['修改', '调整', '优化', '改写']
      }
    },
    
    // 激活原料意图扩展
    ACTIVATE_MATERIAL: {
      original: ['激活原料', '原料盘点', '整理素材'],
      expanded: [
        '激活原料', '激活材料',
        '原料盘点', '材料盘点', '素材盘点',
        '整理素材', '整理材料', '整理文档',
        '看看我的材料', '看看我的素材', '查看材料',
        '盘点素材', '盘点材料', '盘点文档',
        '检查素材', '检查材料', '检查文档',
        
        // 数据相关
        '整理数据', '盘点数据', '看看数据',
        '查看资料', '查看文档', '查看素材',
        
        // 口语化表达
        '看看有啥材料', '检查一下素材',
        '整理下资料', '盘点下文档'
      ]
    },
    
    // 继续意图扩展
    CONTINUE: {
      original: ['继续写', '接着来', '往下写'],
      expanded: [
        '继续写', '继续创作', '继续',
        '接着写', '接着来', '接着创作',
        '往下写', '往下继续', '下面写',
        '继续', '继续吧', '继续做',
        '下一段', '下一章', '下一个',
        
        // 暗示继续
        '好', '嗯', '可以', '行',
        '没问题', '好的呢', '继续呢',
        
        // 明确继续
        '继续这个', '继续当前', '继续现在',
        '接着这个', '接着当前'
      ]
    },
    
    // 检查质量意图扩展
    REVIEW: {
      original: ['检查质量', '审一审', '自检'],
      expanded: [
        '检查质量', '质量检查', '质检',
        '审一审', '审核', '审阅',
        '自检', '自我检查', '检查',
        '审查', '校对', '校阅',
        '改错', '改错字', '改问题',
        '查错', '查问题', '查错误',
        '优化', '改进', '提升',
        
        // 具体方面
        '检查语法', '检查错字', '检查表达',
        '检查逻辑', '检查内容', '检查结构',
        '审查质量', '审核质量', '质量把关',
        
        // 口语化表达
        '看看有没有错', '检查下问题',
        '帮我看看', '帮我改改', '帮我审审'
      ]
    },
    
    // 导出意图扩展
    EXPORT: {
      original: ['导出', '打包', '下载', '生成'],
      expanded: [
        '导出', '导出文档', '导出文件',
        '打包', '打包下载', '打包文件',
        '下载', '下载文档', '下载文件',
        '生成', '生成文档', '生成文件',
        '输出', '输出文档', '输出文件',
        
        // 格式相关
        '导出PDF', '导出Word', '导出HTML',
        '生成PDF', '生成Word', '生成HTML',
        '转PDF', '转Word', '转HTML',
        
        // 完成相关
        '完成了', '写完了', '做好了',
        '可以下载了', '要导出了', '要下载了'
      ]
    },
    
    // 策略意图扩展
    STRATEGY: {
      original: ['换策略', '改深度', '切换模式'],
      expanded: [
        '换策略', '换模式', '换深度',
        '改策略', '改模式', '改深度',
        '切换策略', '切换模式', '切换深度',
        '调整策略', '调整模式', '调整深度',
        '变更策略', '变更模式',
        
        // 深度相关
        '更深度', '更深入', '更详细',
        '更简单', '更简洁', '更快速',
        
        // 模式相关
        '交互式', '自主式', '自动模式',
        '人工模式', '半自动', '全自动',
        
        // 口语化表达
        '换个写法', '改个方式',
        '调整下策略', '换种模式'
      ]
    },
    
    // 状态意图扩展
    STATUS: {
      original: ['进度如何', '到哪了', '状态'],
      expanded: [
        '进度如何', '进度', '当前进度',
        '到哪了', '到哪里了', '写到哪了',
        '状态', '当前状态', '运行状态',
        '进展', '进展如何', '当前进展',
        
        // 卡顿询问
        '卡住', '没反应', '还在吗',
        '无响应', '是不是挂了', '死了吗',
        '还在工作', '还有多久', '多长时间',
        
        // 完成询问
        '好了吗', '完成了吗', '写完了吗',
        '多少了', '写多少了', '进度多少',
        
        // 口语化表达
        '咋样了', '怎么样了', '进度啥样',
        '还在弄吗', '还在写吗', '多久能好'
      ]
    },
    
    // 停止意图扩展
    STOP: {
      original: ['终止', '停止', '取消', '中断', '退出', '退出福帮手'],
      expanded: [
        '终止', '停止', '取消', '中断', '退出', '退出福帮手', '关闭福帮手', '退出skill',
        '不写了', '不要写了', '停止写作',
        '暂停', '暂停一下', '休息一下',
        '算了', '不做了', '不做这个了',
        '结束', '完成', '完成本次',
        '停止当前', '停止现在', '中断当前',
        
        // 口语化表达
        '不弄了', '不想写了', '不搞了',
        '先停一下', '先不写了', '算了先这样'
      ]
    },

    
    // 帮助意图扩展
    HELP: {
      original: ['怎么用', '帮帮我', '指令'],
      expanded: [
        '怎么用', '如何使用', '用法',
        '帮帮我', '帮我', '帮助',
        '指令', '命令', '操作',
        '功能', '能做什么', '会什么',
        
        // 学习相关
        '怎么开始', '第一步', '入门',
        '新手指导', '新手教程', '快速开始',
        
        // 功能相关
        '有什么功能', '能干嘛', '支持什么',
        '功能介绍', '功能说明', '功能列表',
        
        // 问题相关
        '有问题', '不会用', '怎么弄',
        '怎么做', '怎么操作', '如何操作'
      ]
    },
    
    // 确认意图扩展
    CONFIRM_TOPIC: {
      original: ['确认', '是的', '没错'],
      expanded: [
        '确认', '确定', '同意',
        '是的', '是', '对',
        '没错', '没问题', '好的',
        '可以', '行', '同意的',
        '没问题', '就是这样', '就是它',
        
        // 积极回应
        '嗯', '好的呢', '行呢',
        '可以呢', '没问题呢', '对呢',
        
        // 继续表达
        '继续', '往下', '开始',
        '开始吧', '继续吧', '就这样吧'
      ]
    },
    
    // 智能记忆新意图
    SMART_MEMORY: {
      triggers: {
        // 重置记忆
        reset: [
          '重置记忆', '清空记忆', '删除记忆',
          '重新开始', '清空学习', '重置学习',
          '忘记我', '忘记偏好', '清空偏好'
        ],
        
        // 查看风格
        viewStyle: [
          '查看风格', '显示风格', '我的写作风格',
          '记忆状态', '显示记忆', '查看记忆',
          '我的特征', '写作特征', '个性特征'
        ],
        
        // 脱离个性化
        decouple: [
          '脱离个性化', '与个性脱钩', '断开个性化',
          '关闭个性化', '禁用个性化', '不使用个性化',
          '普通模式', '标准模式', '默认模式'
        ],
        
        // 恢复个性化
        enablePersonalization: [
          '恢复个性化', '重新启用', '恢复适配',
          '开启个性化', '启用个性化', '使用个性化',
          '个性化模式', '智能模式', '自适应模式'
        ],
        
        // 查看学习历史
        viewHistory: [
          '查看学习历史', '学习记录', '特征统计',
          '学习进度', '学习情况', '学习数据'
        ],
        
        // 检查边界
        checkBoundary: [
          '检查边界', '应用边界', '适配强度',
          '个性化程度', '适配深度', '影响范围'
        ],
        
        // WorkBuddy分析
        analyzeWorkBuddy: [
          'WorkBuddy分析', '整理分析', '升级适配',
          '环境分析', '配置分析', '适配检查'
        ]
      }
    }
  },

  // ========================================
  // 乐包意图（CHECK_BALANCE / UPGRADE_HINT / FULL_BOOK_VIEW / LIST_COMMANDS）
  // ========================================
  creditsIntents: {

    // 查看乐包余额
    CHECK_BALANCE: {
      triggers: [
        '查看乐包', '查乐包', '我的乐包', '乐包余额',
        '乐包多少', '还有多少乐包', '有多少乐包',
        '余额', '我的余额', '乐包剩多少', '还剩多少乐包',
        '我有多少乐包', '乐包数量', '看乐包',
        '能用啥场景包', '能解锁哪些', '我能用哪些体裁',
        '乐包够吗', '有多少个乐包',
      ],
      handler: 'handleCheckBalance',
      description: '显示当前乐包余额、各体裁解锁状态及升级提醒',
      /**
       * handleCheckBalance()
       * 调用 formatBalanceSummary() 输出完整余额 + 解锁状态 Markdown 表格
       * entitlementSheet 可选：由调用方从 loadScenePack 结果中取出传入
       */
      handle(entitlementSheet = null) {
        return formatBalanceSummary(entitlementSheet);
      },
    },

    // 升级/解锁提醒（用户主动询问如何解锁）
    UPGRADE_HINT: {
      triggers: [
        '怎么解锁', '如何升级', '怎么获得乐包', '怎么赚乐包',
        '如何获得更多乐包', '怎么才能用高级场景包',
        '如何解锁体裁', '解锁条件', '升级要多少乐包',
        '乐包怎么获得', '乐包怎么来', '怎么增加乐包',
        '乐包有什么用', '用乐包干什么',
        '还差多少', '差多少可以解锁', '差多少能解锁',
        '什么时候能用家谱', '什么时候能用家谱体裁',
        '怎样才能得到乐包', '乐包可以买吗', '可以充值吗',
      ],
      handler: 'handleUpgradeHint',
      description: '告知用户乐包获取方式与当前距离解锁目标的差距',
      /**
       * handleUpgradeHint()
       * 输出：① 当前余额与最近目标差距 ② 积累方式表 ③ 增值入口提示
       * entitlementSheet 可选，传入时用远端门槛替代本地默认值
       */
      handle(entitlementSheet = null) {
        const { hint, nearestGenre, gap, balance, thresholds } = getUpgradeHint(entitlementSheet);

        const genreLabels = {
          genealogy: '家谱', consultant: '创业顾问', ghostwriter: '代撰稿',
          whitepaper: '白皮书', report: '报告',
          training: '企业培训', 'personal-book': '个人出书',
        };

        // 当前进度行
        const progressLines = Object.entries(thresholds)
          .filter(([g]) => g !== 'general')
          .map(([g, t]) => {
            const label  = genreLabels[g] ?? g;
            const status = balance >= t ? '✅ 已解锁' : `🔒 还差 ${t - balance} 个乐包`;
            return `| ${label} | ${t} 个乐包 | ${status} |`;
          });

        const lines = [
          `**当前乐包余额：${balance} 个**`,
          '',
          '**乐包获取方式**',
          '',
          '| 行为 | 乐包奖励 |',
          '|------|---------|',
          '| 首次安装 | +100 个乐包 |',
          '| 每日首次使用 | +5 个乐包 |',
          '| 完成一章 | +10 个乐包 |',
          '| 章节质检通过 | +3 个乐包 |',
          '| 完成整本书 | +50 个乐包 |',
          '',
          '**体裁解锁进度**',
          '',
          '| 体裁 | 门槛 | 状态 |',
          '|------|------|------|',
          ...progressLines,
        ];

        if (hint) {
          lines.push('', `> ${hint}`);
        } else if (nearestGenre === null) {
          lines.push('', '> 🎊 全部体裁都解锁了！如需开启高级增值能力，可以用激活码升级。');
        } else {
          lines.push('', `> 继续写就能自然积累乐包，离解锁「${genreLabels[nearestGenre] ?? nearestGenre}」还差 ${gap} 个。`);
        }

        // 增值入口：余额较低时提示购买激活码
        if (balance < 200) {
          lines.push('', '_想快点解锁？用激活码可以一次性充值乐包，或直接解锁指定体裁。_');
        }

        return lines.join('\n');
      },
    },

    // 全书视图（展示整本书的目录结构与进度）
    FULL_BOOK_VIEW: {
      triggers: [
        '全书视图', '书的全貌', '目录总览', '整本书结构',
        '全部章节', '章节总览', '看全书', '书的目录',
        '全书目录', '所有章节', '书的进度', '整体进度',
        '全书进度', '书写了多少', '写了多少章', '书有多少章',
        '当前进度', '写作进度', '项目进度',
      ],
      handler: 'handleFullBookView',
      description: '展示全书目录结构、各章节状态与整体写作进度',
      /**
       * handleFullBookView()
       * 输出全书章节列表及完成状态（依赖宿主传入 bookState）
       * bookState 可选：{ title, chapters: [{no, title, status, wordCount}] }
       */
      handle(bookState = null) {
        if (!bookState || !bookState.chapters || bookState.chapters.length === 0) {
          return [
            '**目前还没有书稿进度**',
            '',
            '书稿还没开始，或者工作区还没初始化——',
            '你想怎么起头？',
            '',
            '- 说「**写书**」或「**写白皮书**」，我帮你从头开始',
            '- 说「**激活原料**」，如果你手头有现成材料想整理',
            '- 说「**继续**」，如果你觉得上次已经开始了',
          ].join('\n');
        }

        const { title = '（未命名书稿）', chapters } = bookState;
        const total = chapters.length;
        const done  = chapters.filter(c => c.status === 'done' || c.status === '已完成').length;
        const totalWords = chapters.reduce((s, c) => s + (c.wordCount || 0), 0);

        const statusIcon = s => {
          if (s === 'done' || s === '已完成') return '✅';
          if (s === 'in_progress' || s === '进行中') return '✏️';
          if (s === 'review' || s === '审核中') return '🔍';
          return '⬜';
        };

        const chapterLines = chapters.map(c =>
          `| ${c.no ?? '-'} | ${c.title ?? '（未命名）'} | ${statusIcon(c.status)} ${c.status ?? '未开始'} | ${c.wordCount ? c.wordCount + ' 字' : '-'} |`
        );

        return [
          `**全书视图：《${title}》**`,
          '',
          `进度：${done} / ${total} 章完成，累计 ${totalWords.toLocaleString()} 字`,
          '',
          '| 章节 | 标题 | 状态 | 字数 |',
          '|------|------|------|------|',
          ...chapterLines,
          '',
          done === total
            ? '> 🎊 全书已完成！可使用 `导出` 生成最终文档，或使用 `质量自检` 进行最终审校。'
            : `> 继续创作第 ${done + 1} 章，或输入 \`写章节\` 继续写作。`,
        ].join('\n');
      },
    },

    // 指令列表（展示所有可用短指令）
    LIST_COMMANDS: {
      triggers: [
        '全部指令', '所有命令', '指令列表', '命令列表',
        '有哪些指令', '有哪些命令', '指令大全', '命令大全',
        '所有指令', '列出指令', '显示指令', '查看指令',
        '帮助菜单', '全部命令', '有什么指令', '指令手册',
        '短指令', '快捷指令', '怎么用', '有什么功能',
      ],
      handler: 'handleListCommands',
      description: '展示 FBS-BookWriter 所有可用短指令（66条分类列表）',
      /**
       * handleListCommands()
       * 输出全部 66 条短指令，按类别分组展示
       */
      handle() {
        return [
          '**FBS-BookWriter 全部指令（66条）**',
          '',
          '---',
          '',
          '**基础指令（18条）**',
          '`快速起步` `激活原料` `原料盘点` `定大纲` `写章节` `续写` `改写`',
          '`扩写` `缩写` `润色` `质量自检` `导出` `封面` `插图`',
          '`排版构建` `去AI味` `书名建议` `简介生成`',
          '',
          '**系统控制（3条）**',
          '`暂停` `继续` `重置`',
          '',
          '**v6新增指令（9条）**',
          '`全书视图` `章节地图` `情节线` `人物关系` `时间轴`',
          '`风格分析` `读者画像` `出版评估` `营销文案`',
          '',
          '**新手引导（18条）**',
          '`我是新手` `怎么开始` `写什么好` `给我灵感` `随机题材`',
          '`推荐大纲` `帮我起名` `故事雏形` `章节示范` `写作技巧`',
          '`克服拖延` `写作计划` `每日任务` `进度提醒` `答疑解惑`',
          '`常见问题` `新手套装` `快速入门`',
          '',
          '**技能包落地（18条）**',
          '`查看乐包` `乐包余额` `怎么解锁` `解锁体裁` `场景包列表`',
          '`激活场景包` `切换体裁` `家谱模式` `商业模式` `学术模式`',
          '`白皮书模式` `报告模式` `培训模式` `个人出书` `代撰稿模式`',
          '`场景包详情` `体裁说明` `高级功能`',
          '',
          '---',
          '',
          '> 输入任意指令名称即可触发对应功能。',
          '> 详细说明参见 `section-4-commands.md`。',
        ].join('\n');
      },
    },
  },
  
  // ========================================
  // 上下文感知规则
  // ========================================
  contextAwareness: {
    // 会话状态检测
    sessionStates: {
      initial: ['首次进入', '新会话', '刚开始'],
      writing: ['正在写', '创作中', '写作中'],
      paused: ['暂停中', '等待中', '休息中'],
      reviewing: ['审核中', '检查中', '审阅中'],
      exporting: ['导出中', '生成中', '打包中'],
      error: ['出错了', '失败了', '有问题']
    },
    
    // 多轮对话规则
    multiTurnRules: {
      // 第1轮：首次进入
      firstTurn: {
        priority: 'WRITE_BOOK',
        fallback: 'HELP',
        action: 'showQuickStartGuide'
      },
      
      // 第2轮：有主题但没有具体指令
      secondTurnWithTopic: {
        priority: 'CONTINUE',
        fallback: 'STRATEGY',
        action: 'askContinueOrStrategy'
      },
      
      // 第3+轮：有上下文
      subsequentTurns: {
        priority: 'contextBased',
        fallback: 'STATUS',
        action: 'inferFromContext'
      }
    },
    
    // 上下文关键词
    contextKeywords: {
      writing: ['写', '创作', '编辑', '修改', '调整'],
      reviewing: ['检查', '审核', '审阅', '校对', '查错'],
      exporting: ['导出', '下载', '生成', '打包', '输出'],
      managing: ['管理', '整理', '盘点', '查看'],
      config: ['设置', '配置', '选项', '参数', '偏好']
    }
  },
  
  // ========================================
  // 模糊匹配和容错
  // ========================================
  fuzzyMatching: {
    // 常见错字容忍
    typoTolerance: {
      '写书': ['写数', '写舒', '写叔'],
      '检查': ['捡查', '检阅'],
      '导出': ['道出', '导楚'],
      '素材': ['素菜', '素材'],
      '继续': ['继绪', '接续']
    },

    // 语音转文字错误
    voiceToTextErrors: {
      '一下': ['一下', '一下', '一下'],
      '开始': ['开是', '开试', '开实'],
      '结束': ['结术', '结束', '杰书'],
      '质量': ['质量', '治量', '只量']
    },

    // 相似词映射
    synonymMapping: {
      '写': ['写', '写', '写'],
      '检查': ['检查', '审查', '审核', '审阅', '校对'],
      '导出': ['导出', '输出', '下载', '生成', '打包'],
      '继续': ['继续', '接着', '往下', '后续'],
      '停止': ['停止', '终止', '中断', '暂停', '取消'],
      '帮助': ['帮助', '帮助', '帮帮', '指导']
    }
  },

  
  // ========================================
  // 帮助系统优化
  // ========================================
  helpSystem: {
    // 自然语言帮助
    naturalHelp: {
      greeting: '您好！我是福帮手写书助手，可以帮助您从零开始创作各类长文档。',
      
      quickActions: [
        {
          title: '开始写书',
          description: '帮我创作一本书、手册或报告',
          trigger: '写书',
          examples: ['帮我写一本关于AI的书', '写技术手册', '写行业报告']
        },
        {
          title: '整理素材',
          description: '盘点和整理已有的材料',
          trigger: '整理素材',
          examples: ['整理我的素材', '看看有哪些材料', '盘点数据']
        },
        {
          title: '检查质量',
          description: '检查和优化内容质量',
          trigger: '检查质量',
          examples: ['检查一下质量', '帮我改改', '审查内容']
        },
        {
          title: '导出文档',
          description: '生成PDF、Word或HTML文档',
          trigger: '导出',
          examples: ['导出PDF', '生成文档', '打包下载']
        },
        {
          title: '查看进度',
          description: '查看当前创作进度',
          trigger: '进度',
          examples: ['进度如何', '写到哪了', '状态']
        },
        {
          title: '个性化设置',
          description: '设置或查看个性化写作偏好',
          trigger: '个性化',
          examples: ['查看我的风格', '重置记忆', '脱离个性化']
        }
      ],
      
      guidedQuestions: [
        '您想写什么类型的内容？（书籍、手册、报告等）',
        '您有现成的素材需要整理吗？',
        '需要我帮您检查内容质量吗？',
        '遇到什么问题了吗？'
      ]
    },
    
    // 智能推荐
    smartRecommendation: {
      basedOnContext: true,
      basedOnHistory: true,
      basedOnIntent: true,
      
      recommendationRules: [
        {
          condition: 'userHasMaterials',
          recommendation: '激活原料',
          message: '我检测到您有一些材料，需要帮您整理吗？'
        },
        {
          condition: 'writingInProgress',
          recommendation: '继续写作',
          message: '您之前在写[主题]，需要继续吗？'
        },
        {
          condition: 'contentReady',
          recommendation: '质量检查',
          message: '内容写完了，需要我帮您检查一下质量吗？'
        },
        {
          condition: 'qualityChecked',
          recommendation: '导出文档',
          message: '质量检查完成了，要导出文档吗？'
        }
      ]
    }
  },
  
  // ========================================
  // 性能优化
  // ========================================
  performance: {
    // 意图识别优化
    intentRecognition: {
      cacheEnabled: true,
      cacheSize: 100,
      cacheTTL: 300000, // 5分钟
      
      // 分层识别
      tieredMatching: {
        tier1: 'exact_match',      // 精确匹配
        tier2: 'fuzzy_match',      // 模糊匹配
        tier3: 'semantic_match',    // 语义匹配
        tier4: 'llm_classification' // LLM分类
      },
      
      // 并行处理
      parallelProcessing: true,
      maxParallelMatches: 3
    },
    
    // 上下文管理优化
    contextManagement: {
      maxContextSize: 10,
      contextCompression: true,
      contextPrioritization: true
    },
    
    // 响应时间优化
    responseOptimization: {
      targetResponseTime: 1000, // 1秒
      maxResponseTime: 5000,     // 5秒
      timeoutHandling: 'fallback'
    }
  }
};

/**
 * 自然语言处理引擎
 */
export class NaturalLanguageEngine {
  constructor(config = NLU_OPTIMIZATION) {
    this.config = config;
    this.context = {
      sessionState: 'initial',
      currentIntent: null,
      conversationHistory: [],
      userPreferences: {}
    };
    
    this.intentCache = new Map();
  }

  /**
   * 生成情境感知的轻量激活响应
   * 根据当前会话状态决定回应内容，避免机械套话
   * @param {object} context - { hasChapterStatus, lastChapterName, lastChapterNo, isNewUser }
   * @returns {string}
   */
  getActivationResponse(context = {}) {
    const { hasChapterStatus, lastChapterName, lastChapterNo, isNewUser } = context;

    if (hasChapterStatus && lastChapterName) {
      return `上次写到第${lastChapterNo || ''}章《${lastChapterName}》，说「继续」我就接着写；或者告诉我这次想做什么。`;
    }

    if (isNewUser) {
      return `福帮手已就绪。你是想写一本书、整理手头的材料，还是先看看能做什么？`;
    }

    return `我在。说说你现在想做什么——写书、整理材料，还是继续上次？`;
  }

  /**
   * 识别意图
   */
  recognizeIntent(input, context = {}) {
    // 1. 检查缓存
    const cacheKey = `${input}_${JSON.stringify(context)}`;
    if (this.intentCache.has(cacheKey)) {
      return this.intentCache.get(cacheKey);
    }
    
    // 2. 分层识别
    let result = this.tieredMatching(input, context);
    
    // 3. 上下文修正
    result = this.contextAwareCorrection(result, context);
    
    // 4. 缓存结果
    this.intentCache.set(cacheKey, result);
    
    return result;
  }
  
  /**
   * 分层匹配
   */
  tieredMatching(input, context) {
    // Tier 1: 精确匹配
    const exactMatch = this.exactMatch(input);
    if (exactMatch) {
      return { intent: exactMatch, confidence: 1.0, method: 'exact' };
    }
    
    // Tier 2: 模糊匹配
    const fuzzyMatch = this.fuzzyMatch(input);
    if (fuzzyMatch) {
      return { intent: fuzzyMatch, confidence: 0.9, method: 'fuzzy' };
    }
    
    // Tier 3: 语义匹配
    const semanticMatch = this.semanticMatch(input);
    if (semanticMatch) {
      return { intent: semanticMatch, confidence: 0.7, method: 'semantic' };
    }
    
    // Tier 4: 兜底
    return { intent: 'HELP', confidence: 0.5, method: 'fallback' };
  }
  
  /**
   * 合并意图池（核心意图 + 乐包意图）
   */
  _getMergedIntents() {
    const merged = { ...(this.config.intentExpansion ?? {}) };
    const creditsIntents = this.config.creditsIntents ?? {};

    for (const [intent, data] of Object.entries(creditsIntents)) {
      merged[intent] = {
        original: data.triggers ?? [],
        expanded: data.triggers ?? [],
        ...data,
      };
    }

    return merged;
  }

  /**
   * 精确匹配
   */
  exactMatch(input) {
    const text = input.trim();
    const intents = this._getMergedIntents();

    for (const [intent, data] of Object.entries(intents)) {
      const exactTriggers = [
        ...(Array.isArray(data.original) ? data.original : []),
        ...(Array.isArray(data.triggers) ? data.triggers : []),
      ];
      if (exactTriggers.includes(text)) {
        return intent;
      }
    }
    return null;
  }
  
  /**
   * 模糊匹配
   */
  fuzzyMatch(input) {
    const text = input.toLowerCase();
    const intents = this._getMergedIntents();

    for (const [intent, data] of Object.entries(intents)) {
      const fuzzyTriggers = [
        ...(Array.isArray(data.expanded) ? data.expanded : []),
        ...(Array.isArray(data.triggers) ? data.triggers : []),
      ];
      for (const trigger of fuzzyTriggers) {
        if (text.includes(String(trigger).toLowerCase())) {
          return intent;
        }
      }
    }
    return null;
  }
  
  /**
   * 语义匹配（简化版）
   */
  semanticMatch(input) {
    // 这里应该使用更复杂的语义匹配算法
    // 简化实现：基于关键词
    const keywords = input.split(/[\s,，。]+/).filter(w => w.length > 1);
    const intents = this._getMergedIntents();

    for (const [intent, data] of Object.entries(intents)) {
      const semanticTriggers = [
        ...(Array.isArray(data.expanded) ? data.expanded : []),
        ...(Array.isArray(data.triggers) ? data.triggers : []),
      ];
      const matchedKeywords = semanticTriggers.filter(trigger =>
        keywords.some(keyword => String(trigger).includes(keyword))
      );
      if (matchedKeywords.length >= 2) {
        return intent;
      }
    }
    return null;
  }
  
  /**
   * 上下文感知修正
   */
  contextAwareCorrection(result, context) {
    // 根据上下文修正意图
    if (context.sessionState === 'writing' && result.intent === 'WRITE_BOOK') {
      return { ...result, intent: 'CONTINUE', corrected: true };
    }
    
    if (context.hasUnconfirmedAction && result.intent === 'WRITE_BOOK') {
      return { ...result, intent: 'CONFIRM_TOPIC', corrected: true };
    }
    
    return result;
  }
  
  /**
   * 更新上下文
   */
  updateContext(updates) {
    this.context = { ...this.context, ...updates };
  }
  
  /**
   * 获取帮助建议
   */
  getHelpSuggestions(context = {}) {
    const suggestions = [];
    
    // 基于上下文的建议
    if (context.userHasMaterials) {
      suggestions.push({
        intent: 'ACTIVATE_MATERIAL',
        message: '你有现成材料，要先把它们整理一下吗？',
        priority: 'high'
      });
    }
    
    if (context.writingInProgress) {
      suggestions.push({
        intent: 'CONTINUE',
        message: '上次写到一半，要接着写吗？',
        priority: 'high'
      });
    }
    
    // 默认建议
    suggestions.push(...this.config.helpSystem.naturalHelp.quickActions.slice(0, 3));
    
    return suggestions;
  }
  
  /**
   * 清除缓存
   */
  clearCache() {
    this.intentCache.clear();
  }
}

export default NLU_OPTIMIZATION;
