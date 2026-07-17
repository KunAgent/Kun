export const ONBOARDING_SYSTEM = {
  version: '2.0.2-enhanced',

  lastUpdated: '2026-04-08',
  
  // ========================================
  // 渐进式学习路径
  // ========================================
  learningPath: {
    // 学习阶段
    stages: [
      {
        stage: 'beginner',
        name: '入门阶段',
        description: '了解基本概念和操作',
        duration: '30分钟',
        lessons: [
          {
            id: 'b1',
            title: '福帮手写书是什么？',
            description: '了解福帮手写书的功能和价值',
            content: `
福帮手写书是一个智能写作助手，帮助您从零开始创作各类长文档，包括：

📚 **支持的文档类型**
- 技术手册
- 行业报告
- 调研报告
- 专题报道
- 长篇文章
- 白皮书
- 产品文档

✨ **核心功能**
1. **智能创作**：AI辅助写作，从大纲到内容生成
2. **素材整理**：自动整理和分类您的材料
3. **质量检查**：自动检查语法、逻辑、表达问题
4. **个性化适配**：学习您的写作风格，持续优化
5. **自然语言交互**：用日常语言即可操作
6. **多格式导出**：支持PDF、Word、HTML等多种格式

🎯 **适用场景**
- 技术文档写作
- 行业分析报告
- 调研报告撰写
- 长篇文章创作
- 产品说明书编写

准备好开始您的写作之旅了吗？
            `,
            interactive: true,
            quiz: {
              question: '福帮手写书不支持以下哪种文档类型？',
              options: ['技术手册', '短视频脚本', '调研报告', '专题报道'],
              correctAnswer: '短视频脚本',
              explanation: '福帮手写书专注于长文档创作，目前主要支持各类书面文档，暂不支持视频脚本。'
            }
          },
          {
            id: 'b2',
            title: '第一次写书',
            description: '学习如何开始第一个写作项目',
            content: `
## 第一次写书非常简单！

### 步骤1：启动福帮手写书
在输入框中输入以下任意指令：
- "写书"
- "福帮手写书"
- "帮我写一本关于[主题]的书"
- "开始创作"

### 步骤2：确定写作主题
福帮手会询问您想写什么，简单描述即可：

👤 **用户**: "我想写一本关于人工智能的技术手册"

🤖 **福帮手**: "好的，我理解您想写一本关于人工智能的技术手册。这本手册的主要受众是谁？"

### 步骤3：回答几个简单问题
根据福帮手的提示，提供一些基本信息：
- 受众群体
- 预期字数
- 风格偏好

### 步骤4：开始创作
福帮手会自动生成大纲，然后逐章帮您创作内容。

### 💡 提示
- 不用担心措辞，用日常语言即可
- 可以随时调整，福帮手会记住您的偏好
- 第一次可以写简短的试试看
            `,
            interactive: true,
            demo: {
              title: '试试看',
              action: 'start_demo',
              demoTopic: '人工智能入门',
              demoLength: '5000字'
            }
          },
          {
            id: 'b3',
            title: '了解基本操作',
            description: '掌握基本的操作指令',
            content: `
## 常用操作指令

### 📝 写作相关
- "继续写" / "往下写" - 继续当前写作
- "修改[某部分]" - 修改指定内容
- "换个风格" - 调整写作风格
- "换策略" - 改变创作深度

### 📦 素材相关
- "激活原料" - 整理现有材料
- "看看我的材料" - 查看已有素材

### ✅ 质量相关
- "检查质量" / "审一审" - 检查内容质量
- "优化[某部分]" - 优化指定内容

### 📤 导出相关
- "导出PDF" - 导出为PDF格式
- "导出Word" - 导出为Word格式
- "打包下载" - 打包所有文件

### 📊 状态相关
- "进度如何" / "到哪了" - 查看当前进度
- "状态" - 查看详细状态

### ⚙️ 其他操作
- "怎么用" - 查看帮助
- "停止" - 停止当前操作
- "重置记忆" - 重置学习到的偏好

### 💡 使用技巧
1. **口语化表达**：可以说"帮我看看"、"往下写吧"
2. **模糊指令**：福帮手会理解上下文
3. **随时调整**：任何时间都可以改变主意
            `,
            interactive: true,
            practice: {
              title: '练习一下',
              tasks: [
                '说"检查质量"',
                '说"导出PDF"',
                '说"进度如何"'
              ]
            }
          }
        ],
        completionCriteria: {
          requiredLessons: 3,
          quizScore: 0.8,
          practiceCompleted: true
        }
      },
      {
        stage: 'intermediate',
        name: '进阶阶段',
        description: '掌握高级功能和技巧',
        duration: '1小时',
        lessons: [
          {
            id: 'i1',
            title: '素材整理的高级用法',
            description: '学习如何高效整理和使用素材',
            content: `
## 素材整理进阶技巧

### 📁 素材类型
福帮手可以处理多种类型的素材：

#### 文字材料
- 采访笔记
- 调研数据
- 文献资料
- 网络文章
- 用户反馈

#### 结构化数据
- 表格数据
- 统计报告
- 研究结果
- 调查问卷

#### 图片资料
- 图表
- 截图
- 照片
- 插图

### 🎯 整理策略

#### 1. 分主题整理
```
主题1: 人工智能
  - 子主题1: 基础概念
  - 子主题2: 技术应用
  - 子主题3: 发展趋势
```

#### 2. 按时间顺序
- 早期材料
- 中期材料
- 最新材料

#### 3. 按重要性分类
- 核心材料
- 辅助材料
- 参考材料

### 💡 使用技巧

1. **定期整理**
   - 建议每天或每周整理一次
   - 保持素材库的整洁

2. **标签管理**
   - 为重要素材添加标签
   - 便于后续查找

3. **质量筛选**
   - 剔除重复或低质量材料
   - 保留最精华的内容

4. **版本控制**
   - 保留原始材料
   - 记录整理过程
            `,
            interactive: true,
            exercise: {
              title: '素材整理练习',
              scenario: '假设您正在写一本关于"远程工作"的报告',
              materials: [
                '员工满意度调查问卷（50份）',
                '远程工作效率数据统计表',
                '远程工作工具使用指南',
                '员工访谈记录（10人）',
                '相关学术论文（5篇）',
                '公司远程工作政策文档'
              ],
              task: '请为这些材料设计一个合理的整理方案'
            }
          },
          {
            id: 'i2',
            title: '质量检查的深度使用',
            description: '学习如何进行全面的内容质量检查',
            content: `
## 内容质量检查全面指南

### 📋 检查维度

#### 1. 语法和文字
- 错别字检查
- 标点符号规范
- 句子结构完整性
- 用词准确性

#### 2. 逻辑和结构
- 段落逻辑连贯性
- 章节结构合理性
- 论证逻辑严密性
- 前后一致性

#### 3. 内容和表达
- 内容准确性
- 表达清晰度
- 语言流畅性
- 风格统一性

#### 4. 格式和规范
- 格式规范性
- 引用准确性
- 数据完整性
- 图表清晰度

### 🎯 检查策略

#### 1. 分层次检查
- 第一遍：宏观结构
- 第二遍：段落逻辑
- 第三遍：细节表达
- 第四遍：格式规范

#### 2. 重点检查
- 核心章节重点检查
- 关键数据重点核实
- 重要结论重点论证

#### 3. 对比检查
- 与原始材料对比
- 与相关文献对比
- 与读者反馈对比

### 💡 提升质量的技巧

1. **多轮检查**
   - 每次写作后检查
   - 修改后再次检查
   - 导出前最终检查

2. **读者视角**
   - 想象读者会问什么
   - 考虑读者可能不理解的地方
   - 从读者角度审视内容

3. **数据支撑**
   - 确保每个结论都有依据
   - 数据来源清晰可靠
   - 引用规范准确

4. **语言优化**
   - 去除冗余表达
   - 精简长句
   - 提升可读性
            `,
            interactive: true,
            checklist: {
              title: '质量检查清单',
              items: [
                '检查错别字和标点符号',
                '验证逻辑结构是否合理',
                '核实数据和事实的准确性',
                '检查段落衔接是否自然',
                '确认风格是否统一',
                '审查格式是否符合规范'
              ]
            }
          },
          {
            id: 'i3',
            title: '个性化写作体验',
            description: '了解和使用智能记忆功能',
            content: `
## 个性化写作体验

### 🧠 智能记忆是什么？

智能记忆是福帮手的一项重要功能，它会学习您的写作风格和偏好，在后续的写作中自动适配，让内容更符合您的要求。

### 📊 学习的内容

福帮手会学习：

#### 1. 写作风格
- 用词习惯
- 句式结构
- 语言风格
- 表达方式

#### 2. 内容偏好
- 常用术语
- 专业领域
- 关注重点
- 风格倾向

#### 3. 写作习惯
- 章节长度
- 段落结构
- 引用习惯
- 图表使用

### 🎯 如何使用智能记忆

#### 查看学习到的风格
输入： "查看我的风格" 或 "显示写作特征"

福帮手会展示它学习到您的写作特点。

#### 脱离个性化
输入： "脱离个性化" 或 "与个性脱钩"

福帮手会停止应用个性化适配，使用标准风格。

#### 恢复个性化
输入： "恢复个性化" 或 "重新启用"

福帮手会重新应用个性化适配。

#### 重置记忆
输入： "重置记忆" 或 "清空记忆"

福帮手会清除所有学习到的偏好。

### ⚖️ 个性化与个性化脱钩

#### 什么时候使用个性化？
- 希望保持一致的风格
- 有明确的风格偏好
- 需要长期创作

#### 什么时候脱离个性化？
- 需要尝试新风格
- 写作不同类型的内容
- 想要更客观的表达
- 希望避免"个性化茧房"

### 🔒 安全性

智能记忆有以下安全保障：

1. **数据隔离**：您的数据与代码完全分离
2. **权限控制**：只有授权才能访问
3. **可重置**：随时可以清除个性化数据
4. **边界控制**：有明确的应用边界

### 💡 使用建议

1. **持续写作**
   - 多写才能更好地学习
   - 保持一致的写作频率

2. **适当反馈**
   - 对不满意的调整提供反馈
   - 让福帮手了解您的偏好

3. **定期查看**
   - 查看学习到的风格是否准确
   - 及时纠正偏差

4. **灵活使用**
   - 根据需要启用或关闭个性化
   - 保持创作灵活性
            `,
            interactive: true,
            simulation: {
              title: '智能记忆体验',
              actions: [
                {
                  label: '查看当前风格',
                  command: '查看我的风格'
                },
                {
                  label: '脱离个性化',
                  command: '脱离个性化'
                },
                {
                  label: '恢复个性化',
                  command: '恢复个性化'
                }
              ]
            }
          }
        ],
        completionCriteria: {
          requiredLessons: 3,
          quizScore: 0.7,
          practiceCompleted: false
        }
      },
      {
        stage: 'advanced',
        name: '高级阶段',
        description: '掌握专家级技巧和优化',
        duration: '2小时',
        lessons: [
          {
            id: 'a1',
            title: '自增强进化机制',
            description: '了解和使用自动能力进化',
            content: `
## 自增强进化机制

### 🚀 什么是自增强进化？

福帮手可以通过联网搜索获取最新的方法论知识，持续优化自身能力，为您提供更好的服务。

### 📚 进化的领域

福帮手可以在以下领域持续进化：

#### 1. 去AI味方法论
- 提升内容人性化程度
- 优化表达自然度
- 增强可读性

#### 2. 质检优化方法论
- 提升问题发现能力
- 优化检查准确性
- 增强建议质量

#### 3. 创意选题方法论
- 拓展选题思路
- 提升创新性
- 优化吸引力

#### 4. 风格微调方法论
- 精准匹配风格
- 细化风格参数
- 提升一致性

#### 5. 内容资产化方法论
- 优化内容价值
- 提升复用性
- 增强资产化

#### 6. 会议角色智能设计
- 优化角色分配
- 提升协作效率
- 增强会议质量

### 🔄 进化流程

#### 触发进化
输入： "检查进化状态" 或 "能力更新情况"

福帮手会显示当前的进化状态。

#### 手动触发进化
输入： "触发[领域]进化"

例如： "触发去AI味进化"

#### 查看知识库
输入： "查看[领域]知识"

福帮手会显示该领域的知识库内容。

#### 回滚进化
输入： "回滚[领域]进化"

福帮手会回滚该领域到之前的版本。

### 🔒 安全保障

进化机制有多重安全保障：

1. **用户授权**：需要明确授权才能进化
2. **质量验证**：进化前会进行质量检查
3. **回滚机制**：可以随时回滚到之前版本
4. **进度追踪**：可以看到完整的进化历史
5. **里程碑记录**：重要进化会记录里程碑

### 💡 使用建议

1. **关注进化**
   - 定期查看进化状态
   - 了解最新改进

2. **谨慎回滚**
   - 只在确实需要时回滚
   - 评估回滚的影响

3. **提供反馈**
   - 对进化效果提供反馈
   - 帮助福帮手持续改进

4. **平衡创新**
   - 享受进化带来的改进
   - 同时保持稳定性要求
            `,
            interactive: true,
            demo: {
              title: '进化体验',
              scenarios: [
                '查看去AI味知识库',
                '触发质检优化进化',
                '回滚创意选题进化'
              ]
            }
          },
          {
            id: 'a2',
            title: '多智能体协同',
            description: '了解和使用会议智能体功能',
            content: `
## 多智能体协同

### 🤝 什么是多智能体协同？

福帮手提供了会议智能体功能，可以模拟多个角色进行协同讨论，帮助您从不同角度审视内容。

### 🎭 会议类型

#### 1. 创意型会议
- **目的**：激发创意和灵感
- **角色**：
  - 创意策划师
  - 文案设计师
  - 市场营销专家
- **适用场景**：
  - 需要创新想法
  - 缺乏灵感
  - 内容单一

#### 2. 审核型会议
- **目的**：全面审核内容质量
- **角色**：
  - 文字编辑
  - 逻辑审查员
  - 事实核查员
- **适用场景**：
  - 需要严格审核
  - 重要文档
  - 正式发布前

#### 3. 辩驳型会议
- **目的**：发现潜在问题
- **角色**：
  - 反对者
  - 批评家
  - 质疑者
- **适用场景**：
  - 需要发现问题
  - 避免盲点
  - 提升严谨性

#### 4. 评论型会议
- **目的**：获取多角度反馈
- **角色**：
  - 读者代表
  - 领域专家
  - 普通用户
- **适用场景**：
  - 需要用户视角
  - 评估可读性
  - 优化用户体验

### 📋 会议流程

#### 1. 启动会议
输入： "开始[类型]会议" 或 "启动[类型]讨论"

例如： "开始创意型会议"

#### 2. 设置主题
福帮手会询问会议主题，提供清晰的描述。

#### 3. 智能体讨论
各个智能体会从各自角度进行讨论和辩论。

#### 4. 整合建议
福帮手会整合所有智能体的意见，给出综合建议。

#### 5. 实施改进
根据建议修改内容，提升质量。

### 💡 使用技巧

1. **选择合适类型**
   - 根据需求选择会议类型
   - 可以多次尝试不同类型

2. **清晰描述主题**
   - 详细描述要讨论的内容
   - 说明关注的重点

3. **积极参与**
   - 对智能体意见进行反馈
   - 提出自己的观点

4. **整合建议**
   - 综合考虑所有意见
   - 选择最有价值的建议
            `,
            interactive: true,
            simulation: {
              title: '会议智能体体验',
              scenarios: [
                {
                  type: 'creative',
                  title: '创意型会议',
                  description: '为一本关于"远程工作"的书籍设计章节结构'
                },
                {
                  type: 'review',
                  title: '审核型会议',
                  description: '审核一篇技术文档的逻辑和表达'
                },
                {
                  type: 'adversarial',
                  title: '辩驳型会议',
                  description: '为一篇行业报告找漏洞和问题'
                }
              ]
            }
          }
        ],
        completionCriteria: {
          requiredLessons: 2,
          quizScore: 0.8,
          practiceCompleted: false
        }
      }
    ],
    
    // 学习路径配置
    pathConfig: {
      autoProgression: true,
      adaptivePacing: true,
      prerequisiteCheck: true,
      completionCertificate: true,
      sharingEnabled: true
    }
  },
  
  // ========================================
  // 交互式教程系统
  // ========================================
  interactiveTutorial: {
    enabled: true,
    
    // 教程类型
    tutorialTypes: [
      {
        type: 'guided',
        name: '引导式教程',
        description: '逐步指导完成操作',
        features: ['step_by_step', 'hints', 'progress_tracking']
      },
      {
        type: 'demo',
        name: '演示教程',
        description: '观看完整操作演示',
        features: ['video_demo', 'annotations', 'pause_resume']
      },
      {
        type: 'practice',
        name: '练习模式',
        description: '实际操作练习',
        features: ['sandbox', 'feedback', 'retry']
      },
      {
        type: 'quiz',
        name: '测验模式',
        description: '测试学习成果',
        features: ['multiple_choice', 'explanation', 'score_tracking']
      }
    ],
    
    // 教程组件
    components: {
      // 步骤指示器
      stepIndicator: {
        enabled: true,
        style: 'numbered',
        progressIndicator: true
      },
      
      // 提示系统
      hintSystem: {
        enabled: true,
        levels: ['subtle', 'moderate', 'explicit'],
        cooldown: 60,  // 秒
        maxHints: 3
      },
      
      // 进度跟踪
      progressTracking: {
        enabled: true,
        autoSave: true,
        showPercentage: true,
        milestoneAlerts: true
      },
      
      // 反馈系统
      feedbackSystem: {
        enabled: true,
        immediateFeedback: true,
        detailedFeedback: true,
        encouragement: true
      }
    }
  },
  
  // ========================================
  // 帮助系统优化
  // ========================================
  helpSystemOptimized: {
    // 智能帮助
    intelligentHelp: {
      enabled: true,
      
      // 上下文感知
      contextAware: {
        enabled: true,
        detectUserState: true,
        anticipateNeeds: true
      },
      
      // 自适应帮助
      adaptiveHelp: {
        enabled: true,
        basedOnSkill: true,
        basedOnHistory: true,
        basedOnContext: true
      },
      
      // 帮助等级
      helpLevels: {
        beginner: {
          label: '新手',
          description: '详细的基础指导',
          detailLevel: 'high',
          examples: 'many'
        },
        intermediate: {
          label: '进阶',
          description: '适中的指导深度',
          detailLevel: 'medium',
          examples: 'some'
        },
        advanced: {
          label: '高级',
          description: '简洁的专业指导',
          detailLevel: 'low',
          examples: 'few'
        }
      }
    },
    
    // 快速操作
    quickActions: [
      {
        id: 'qa_start',
        title: '开始写书',
        description: '快速启动写作项目',
        icon: '📝',
        shortcut: 'Alt+W'
      },
      {
        id: 'qa_materials',
        title: '整理素材',
        description: '整理现有材料',
        icon: '📁',
        shortcut: 'Alt+M'
      },
      {
        id: 'qa_review',
        title: '检查质量',
        description: '质量检查和优化',
        icon: '✅',
        shortcut: 'Alt+R'
      },
      {
        id: 'qa_export',
        title: '导出文档',
        description: '生成和下载文档',
        icon: '📤',
        shortcut: 'Alt+E'
      },
      {
        id: 'qa_help',
        title: '获取帮助',
        description: '查看帮助和教程',
        icon: '❓',
        shortcut: 'F1'
      }
    ],
    
    // 引导问题
    guidedQuestions: [
      {
        id: 'gq_purpose',
        question: '您想写什么类型的内容？',
        type: 'choice',
        options: [
          '技术手册',
          '行业报告',
          '调研报告',
          '专题报道',
          '长篇文章',
          '其他'
        ],
        followUp: {
          '技术手册': '这是什么领域的技术？',
          '行业报告': '是哪个行业？',
          '调研报告': '调研的主题是什么？',
          '其他': '请描述您想写的内容'
        }
      },
      {
        id: 'gq_materials',
        question: '您有现成的素材需要整理吗？',
        type: 'choice',
        options: ['有，需要整理', '没有，从头开始'],
        followUp: {
          '有，需要整理': '素材是什么类型？（文字、数据、图片）',
          '没有，从头开始': '好的，我们从零开始创作'
        }
      },
      {
        id: 'gq_style',
        question: '您希望是什么风格？',
        type: 'choice',
        options: [
          '正式专业',
          '轻松活泼',
          '简洁明了',
          '详尽深入',
          '学习福帮手的建议'
        ]
      }
    ],
    
    // 常见问题
    faq: [
      {
        category: '基本操作',
        questions: [
          {
            q: '如何开始写书？',
            a: '输入"写书"或"福帮手写书"，然后按照提示操作即可。'
          },
          {
            q: '如何检查写作质量？',
            a: '输入"检查质量"或"审一审"，福帮手会自动检查。'
          },
          {
            q: '如何导出文档？',
            a: '输入"导出"加上想要的格式，如"导出PDF"。'
          }
        ]
      },
      {
        category: '高级功能',
        questions: [
          {
            q: '什么是智能记忆？',
            a: '智能记忆会学习您的写作风格，自动适配后续内容。您可以查看、重置或脱离个性化。'
          },
          {
            q: '如何使用会议智能体？',
            a: '输入"开始[类型]会议"，如"开始创意型会议"，选择会议主题即可。'
          },
          {
            q: '什么是自增强进化？',
            a: '福帮手可以通过联网搜索优化自身能力，提供更好的服务。'
          }
        ]
      },
      {
        category: '问题排查',
        questions: [
          {
            q: '福帮手理解错了我的意思怎么办？',
            a: '您可以直接说"不对，我的意思是..."，福帮手会纠正理解。'
          },
          {
            q: '写作风格不符合要求怎么办？',
            a: '可以输入"换个[某种]风格"，或通过智能记忆设置偏好。'
          },
          {
            q: '不满意生成的内容怎么办？',
            a: '可以指出不满意的地方，福帮手会根据反馈调整。'
          }
        ]
      }
    ]
  },
  
  // ========================================
  // 用户体验优化
  // ========================================
  userExperience: {
    // 首次使用引导
    firstTimeUserGuide: {
      enabled: true,
      
      // 引导流程（原则：先感知用户意图，再决定下一步；禁止菜单式选择）
      onboardingFlow: [
        {
          step: 1,
          // 不用「欢迎语」开场，直接用开放式问题让用户说目标
          question: '想写什么呢？随便说说就行——比如"想写一本理财书"、"有材料要整理成报告"都可以。',
          action: 'detect_intent'
        },
        {
          step: 2,
          // AI 根据第1步的答案自动判断路径，直接说明打算怎么做，然后开始
          // 不给用户列选项，除非用户明确说想选
          action: 'auto_route_and_start'
        }
      ],
      
      // 个性化设置（在书写过程中自然积累，不在引导期强行收集）
      preferenceSetup: {
        askPreferences: false,
        inferFromContext: true,
        preferences: [
          '写作风格',
          '输出格式',
          '质量要求',
          '个性化程度'
        ]
      }
    },
    
    // 进度可视化
    progressVisualization: {
      enabled: true,
      
      // 进度条
      progressBar: {
        enabled: true,
        showPercentage: true,
        showMilestones: true,
        colorScheme: 'gradient'
      },
      
      // 里程碑
      milestones: [
        {
          name: '启动',
          icon: '🚀',
          description: '开始写作项目'
        },
        {
          name: '大纲',
          icon: '📋',
          description: '完成大纲设计'
        },
        {
          name: '首章',
          icon: '✍️',
          description: '完成第一章'
        },
        {
          name: '过半',
          icon: '📊',
          description: '完成50%'
        },
        {
          name: '终章',
          icon: '🎯',
          description: '完成最后一章'
        },
        {
          name: '质检',
          icon: '✅',
          description: '通过质量检查'
        },
        {
          name: '导出',
          icon: '📤',
          description: '成功导出'
        }
      ]
    },
    
    // 操作反馈
    operationFeedback: {
      enabled: true,
      
      // 即时反馈
      immediateFeedback: {
        enabled: true,
        showConfirmation: true,
        showError: true,
        showProgress: true
      },
      
      // 详细反馈
      detailedFeedback: {
        enabled: true,
        showDetails: true,
        showSuggestions: true,
        showNextSteps: true
      },
      
      // 成功反馈
      successFeedback: {
        animations: true,
        sounds: false,
        messages: true
      }
    }
  }
};

/**
 * 新手引导系统
 */

export default ONBOARDING_SYSTEM;
