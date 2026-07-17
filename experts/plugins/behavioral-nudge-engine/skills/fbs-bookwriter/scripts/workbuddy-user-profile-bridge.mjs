#!/usr/bin/env node
/**
 * WorkBuddy 用户画像桥接器
 * 
 * 功能:
 * - 自动读取 USER.md / IDENTITY.md / SOUL.md
 * - 解析用户工作背景和偏好
 * - 动态适配 S0 采集协议
 * - 减少重复信息收集
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** 防卡顿：宿主 memory/memery 目录下单次最多解析的文件数 */
const MAX_HOST_MEMORY_FILES = 24;
/** 单个 *_memory.md 最大读入字符数（防超大文件阻塞） */
const MAX_MEMERY_FILE_CHARS = 96 * 1024;

/**
 * 提取用户画像
 */
export function extractUserProfile(workbuddyDir) {
  const userProfilePath = path.join(workbuddyDir, 'USER.md');
  const identityPath = path.join(workbuddyDir, 'IDENTITY.md');
  const soulPath = path.join(workbuddyDir, 'SOUL.md');
  const hostMemorySources = resolveHostMemorySources(workbuddyDir);
  
  const profile = {
    basicInfo: {
      name: '',
      callName: '',
      city: '',
      pronouns: ''
    },
    workContext: {
      projectTypes: [],
      currentProject: '',
      expertise: []
    },
    preferences: {
      mode: '', // 完全自主 vs 交互式
      output: '', // 直接写入 vs 先展示
      collaboration: '', // 单智能体 vs 多智能体
      confirmation: '' // 批量 vs 逐章确认
    },
    history: {
      projectTypes: [],
      writingGenres: [],
      commonKeywords: [],
      recentProjects: []
    },
    personality: {
      vibe: '',
      values: [],
      boundaries: []
    },
    isProfileComplete: false
  };
  
  // 解析 USER.md
  if (fs.existsSync(userProfilePath)) {
    const userContent = fs.readFileSync(userProfilePath, 'utf8');
    parseUserMD(userContent, profile);
  }
  
  // 解析 IDENTITY.md
  if (fs.existsSync(identityPath)) {
    const identityContent = fs.readFileSync(identityPath, 'utf8');
    parseIdentityMD(identityContent, profile);
  }
  
  // 解析 SOUL.md
  if (fs.existsSync(soulPath)) {
    const soulContent = fs.readFileSync(soulPath, 'utf8');
    parseSoulMD(soulContent, profile);
  }
  
  // 解析宿主记忆目录（优先 memory/，兼容 legacy memery/）
  hostMemorySources.forEach((source) => {
    parseMemeryFiles(source.dir, source.files, profile);
  });
  
  // 判断画像完整性
  profile.isProfileComplete = checkProfileCompleteness(profile);
  
  return profile;
}

function resolveHostMemorySources(workbuddyDir) {
  const candidateDirs = [
    path.join(workbuddyDir, 'memory'),
    path.join(workbuddyDir, 'memery'),
  ];
  const seenDirs = new Set();
  const claimedFiles = new Set();

  return candidateDirs
    .filter((dir) => {
      const resolved = path.resolve(dir);
      if (seenDirs.has(resolved) || !fs.existsSync(dir)) return false;
      seenDirs.add(resolved);
      return true;
    })
    .map((dir) => ({
      dir,
      files: fs.readdirSync(dir)
        .filter((file) => /_(?:memory|memery)\.md$/i.test(file))
        .filter((file) => {
          const key = file.toLowerCase().replace(/_(?:memory|memery)\.md$/i, '');
          if (claimedFiles.has(key)) return false;
          claimedFiles.add(key);
          return true;
        })

        .sort((left, right) => left.localeCompare(right, 'en'))
        .slice(0, MAX_HOST_MEMORY_FILES),
    }))
    .filter((source) => source.files.length > 0);
}


/**
 * 解析 USER.md
 */
function parseUserMD(content, profile) {
  const lines = content.split('\n');
  
  lines.forEach(line => {
    if (line.startsWith('- **Name:**')) {
      profile.basicInfo.name = extractValue(line);
    } else if (line.startsWith('- **What to call them:**')) {
      profile.basicInfo.callName = extractValue(line);
    } else if (line.startsWith('- **Pronouns:**')) {
      profile.basicInfo.pronouns = extractValue(line);
    } else if (line.startsWith('- **City:**')) {
      profile.basicInfo.city = extractValue(line);
    } else if (line.includes('Context') || line.includes('上下文')) {
      // 提取工作上下文
      const contextMatch = content.match(/Context\s*[:：]\s*([\s\S]*?)(?=\n\n|\n#{1,3})/i);
      if (contextMatch) {
        profile.workContext.currentProject = contextMatch[1].trim().substring(0, 200);
        extractProjectTypes(contextMatch[1], profile);
      }
    }
  });
}

/**
 * 解析 IDENTITY.md
 */
function parseIdentityMD(content, profile) {
  const lines = content.split('\n');
  
  lines.forEach(line => {
    if (line.startsWith('- **Name:**')) {
      if (!profile.basicInfo.name) {
        profile.basicInfo.name = extractValue(line);
      }
    } else if (line.startsWith('- **Creature:**')) {
      profile.personality.vibe = extractValue(line);
    } else if (line.startsWith('- **Vibe:**')) {
      profile.personality.vibe += ' ' + extractValue(line);
    }
  });
  
  // 提取角色定位
  const roleMatch = content.match(/角色定位[：:]\s*([\s\S]*?)(?=\n---|\n#{1,3})/i);
  if (roleMatch) {
    profile.workContext.expertise.push(roleMatch[1].trim().substring(0, 100));
  }
}

/**
 * 解析 SOUL.md
 */
function parseSoulMD(content, profile) {
  // 提取价值观
  const valuesMatch = content.match(/Core Truths[：:]([\s\S]*?)(?=\n#{1,3}|\n---)/i);
  if (valuesMatch) {
    const valuesSection = valuesMatch[1];
    const bullets = valuesSection.match(/^\s*[-*]\s*.*$/gm) || [];
    profile.personality.values = bullets.map(b => b.replace(/^\s*[-*]\s*/, '').trim());
  }
  
  // 提取边界
  const boundariesMatch = content.match(/Boundaries[：:]([\s\S]*?)(?=\n#{1,3}|\n---)/i);
  if (boundariesMatch) {
    const boundariesSection = boundariesMatch[1];
    const bullets = boundariesSection.match(/^\s*[-*]\s*.*$/gm) || [];
    profile.personality.boundaries = bullets.map(b => b.replace(/^\s*[-*]\s*/, '').trim());
  }
  
  // 提取专长
  const expertiseMatch = content.match(/专长[：:]([\s\S]*?)(?=\n#{1,3}|\n---|$)/i);
  if (expertiseMatch) {
    const expertiseSection = expertiseMatch[1];
    const bullets = expertiseSection.match(/^\s*[-*]\s*.*$/gm) || [];
    bullets.forEach(bullet => {
      profile.workContext.expertise.push(bullet.replace(/^\s*[-*]\s*/, '').trim());
    });
  }
}

/**
 * 解析宿主记忆文件
 * - 优先兼容官方修正后的 `memory/`
 * - 同时兼容 legacy `memery/` 老数据
 * - v2.0.3 修复 [B1]：优先解析 RAW_JSON_START...RAW_JSON_END JSON 段，
 *   JSON 解析成功时从结构化字段提取数据；失败时回退原 Markdown 正则路径。
 */
function parseMemeryFiles(memeryDir, files, profile) {

  files.forEach(file => {
    const filePath = path.join(memeryDir, file);
    let content = fs.readFileSync(filePath, 'utf8');
    if (content.length > MAX_MEMERY_FILE_CHARS) {
      content = content.slice(0, MAX_MEMERY_FILE_CHARS);
    }

    // ── 优先路径：解析 RAW_JSON_START...RAW_JSON_END JSON 段 ──
    const jsonMatch = content.match(/RAW_JSON_START\s*([\s\S]*?)\s*RAW_JSON_END/);
    if (jsonMatch) {
      try {
        const data = JSON.parse(jsonMatch[1]);
        // 从结构化字段提取
        if (data.workContext) {
          if (data.workContext.currentProject) {
            profile.workContext.currentProject = String(data.workContext.currentProject).substring(0, 200);
          }
          if (Array.isArray(data.workContext.projectTypes)) {
            data.workContext.projectTypes.forEach(t => {
              if (typeof t === 'string' && !profile.history.projectTypes.includes(t)) {
                profile.history.projectTypes.push(t);
              }
            });
          }
          if (Array.isArray(data.workContext.expertise)) {
            data.workContext.expertise.forEach(e => {
              if (typeof e === 'string') profile.workContext.expertise.push(e.substring(0, 100));
            });
          }
        }
        if (data.uid && !profile.basicInfo.name) {
          profile.basicInfo.name = String(data.uid).substring(0, 50);
        }
        if (data.memoryBlock && typeof data.memoryBlock === 'string') {
          inferPreferences(data.memoryBlock, profile);
        }
        return; // JSON 解析成功，跳过 Markdown 回退路径
      } catch {
        // JSON 解析失败，回退到 Markdown 正则路径
      }
    }

    // ── 回退路径：原 Markdown 正则解析 ──
    const workMatch = content.match(/\*\*工作背景\*\*[\s\S]*?([\s\S]*?)(?=\*\*|$)/i);
    if (workMatch) {
      profile.workContext.currentProject = workMatch[1].trim();
      extractProjectTypes(workMatch[1], profile);
      inferPreferences(workMatch[1], profile);
    }

    // 提取近期动态
    const recentMatch = content.match(/\*\*近期动态\*\*[\s\S]*?([\s\S]*?)(?=---|$)/i);
    if (recentMatch) {
      const recentText = recentMatch[1];
      const recentProjects = recentText.match(/[\u4e00-\u9fa5a-zA-Z0-9]+项目/g) || [];
      profile.history.recentProjects = recentProjects.slice(0, 5);
    }
  });
}

/**
 * 提取项目类型
 * v2.0.3 修复 [B1]：替换为覆盖 8 大场景包的通用体裁词汇表，与具体用户解耦。
 */
function extractProjectTypes(text, profile) {
  // 通用体裁词汇表（对应 8 大场景包 + 常见书籍类型）
  const types = [
    // 书籍/长文档通用
    '书籍', '专著', '长文', '手册', '指南', '教材',
    // whitepaper 场景包
    '白皮书', '行业报告', '研究报告', '分析报告',
    // report 场景包
    '调查报告', '深度报道', '专题报道', '新闻报道',
    // consultant 场景包
    '顾问报告', '咨询报告', '方案', '策划',
    // genealogy 场景包
    '家谱', '族谱', '家史', '家族史', '谱牒',
    // ghostwriter 场景包
    '代撰', '代写', '传记', '回忆录',
    // training 场景包
    '培训教材', '课程', '教案', '讲义',
    // personal-book 场景包
    '个人书', '自传', '文集', '随笔',
    // general 场景包
    '散文', '小说', '非虚构',
  ];
  types.forEach(type => {
    if (text.includes(type)) {
      if (!profile.history.projectTypes.includes(type)) {
        profile.history.projectTypes.push(type);
      }
    }
  });
}

/**
 * 推断用户偏好
 */
function inferPreferences(text, profile) {
  // 推断工作模式
  if (text.includes('完全自主') || text.includes('直接写入')) {
    profile.preferences.mode = 'fully_autonomous';
  } else if (text.includes('交互式') || text.includes('确认')) {
    profile.preferences.mode = 'interactive';
  }
  
  // 推断协作模式
  if (text.includes('多智能体') || text.includes('团队协作')) {
    profile.preferences.collaboration = 'multi_agent';
  } else {
    profile.preferences.collaboration = 'single_agent';
  }
  
  // 推断输出模式
  if (text.includes('结果摘要') || text.includes('直接写入')) {
    profile.preferences.output = 'direct_write';
  } else if (text.includes('先展示') || text.includes('先看')) {
    profile.preferences.output = 'show_first';
  }
}

/**
 * 提取行内值
 */
function extractValue(line) {
  const match = line.match(/[:：]\s*(.+?)(?:\s*$|[\u{1F300}-\u{1F9FF}])/u);
  return match ? match[1].trim() : '';
}

/**
 * 检查画像完整性
 */
function checkProfileCompleteness(profile) {
  const requiredFields = [
    profile.basicInfo.name,
    profile.basicInfo.callName,
    profile.workContext.currentProject,
    profile.preferences.mode
  ];
  
  return requiredFields.every(field => field.length > 0);
}

/**
 * 适配 S0 采集协议
 */
export function adaptIntakeProtocol(userProfile) {
  const adapted = {
    skipBasicInfo: false,
    customGreeting: '',
    customQuestions: [],
    defaultMode: '',
    defaultCollaboration: '',
    suggestActions: []
  };
  
  if (userProfile.isProfileComplete) {
    // 跳过基础信息收集
    adapted.skipBasicInfo = true;
    
    // 生成个性化问候
    const callName = userProfile.basicInfo.callName || userProfile.basicInfo.name || '您';
    adapted.customGreeting = `你好${callName}，继续${userProfile.workContext.currentProject}？`;
    
    // 推荐行动
    adapted.suggestActions = generateSuggestedActions(userProfile);
    
    // 根据历史推荐模式
    if (userProfile.preferences.mode) {
      adapted.defaultMode = userProfile.preferences.mode;
      adapted.customQuestions.push(`这次是否继续${modeToChinese(userProfile.preferences.mode)}模式？`);
    }
    
    // 推荐协作模式
    if (userProfile.preferences.collaboration) {
      adapted.defaultCollaboration = userProfile.preferences.collaboration;
      adapted.customQuestions.push(`用${collaborationToChinese(userProfile.preferences.collaboration)}协作方式可以吗？`);
    }
    
    // 基于历史项目推荐类型
    if (userProfile.history.projectTypes.length > 0) {
      adapted.customQuestions.push(
        `这次还是${userProfile.history.projectTypes[0]}类型的项目吗？`
      );
    }
  } else {
    // 画像不完整，需要补充
    adapted.customQuestions = [
      '请告诉我您的称呼',
      '您在做什么项目？',
      '您更喜欢哪种工作方式？（完全自主 / 交互式）'
    ];
  }
  
  return adapted;
}

/**
 * 生成推荐行动
 */
function generateSuggestedActions(profile) {
  const actions = [];
  
  // 基于最近项目
  if (profile.history.recentProjects.length > 0) {
    actions.push({
      type: 'continue_project',
      text: `继续${profile.history.recentProjects[0]}`,
      project: profile.history.recentProjects[0]
    });
  }
  
  // 基于专业领域
  if (profile.workContext.expertise.length > 0) {
    actions.push({
      type: 'expertise_project',
      text: `基于${profile.workContext.expertise[0]}的新项目`,
      expertise: profile.workContext.expertise[0]
    });
  }
  
  // 新项目
  actions.push({
    type: 'new_project',
    text: '开始全新的写作项目'
  });
  
  return actions;
}

/**
 * 模式转中文
 */
function modeToChinese(mode) {
  const mapping = {
    'fully_autonomous': '完全自主',
    'interactive': '交互式确认'
  };
  return mapping[mode] || mode;
}

/**
 * 协作方式转中文
 */
function collaborationToChinese(collaboration) {
  const mapping = {
    'multi_agent': '多智能体',
    'single_agent': '单智能体'
  };
  return mapping[collaboration] || collaboration;
}

/**
 * 供 session-resume-brief 追加的短摘要（与书稿记忆并列，便于语气与偏好对齐）
 */
export function getHostProfileSummaryForBrief(workbuddyDir) {
  if (!workbuddyDir || !fs.existsSync(workbuddyDir)) return '';
  try {
    const profile = extractUserProfile(workbuddyDir);
    const lines = [];
    const call = profile.basicInfo.callName || profile.basicInfo.name;
    if (call) lines.push(`- **称呼偏好**：${call}`);
    if (profile.workContext.currentProject) {
      lines.push(`- **工作上下文**：${String(profile.workContext.currentProject).slice(0, 200)}`);
    }
    if (profile.preferences.mode) {
      lines.push(`- **模式偏好**：${modeToChinese(profile.preferences.mode) || profile.preferences.mode}`);
    }
    if (profile.preferences.collaboration) {
      lines.push(`- **协作偏好**：${collaborationToChinese(profile.preferences.collaboration) || profile.preferences.collaboration}`);
    }
    if (profile.personality.values?.length) {
      lines.push(`- **价值取向（节选）**：${profile.personality.values.slice(0, 2).join('；')}`);
    }
    if (lines.length === 0) return '';
    return ['## 宿主用户画像摘要（WorkBuddy 用户目录）', '', ...lines, ''].join('\n');
  } catch {
    return '';
  }
}

/**
 * CLI 入口
 */
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  
  if (args.length < 1) {
    console.log(`
WorkBuddy 用户画像桥接器

用法:
  node workbuddy-user-profile-bridge.mjs <workbuddy-dir> [options]

参数:
  workbuddy-dir  WorkBuddy 配置目录 (通常是 ~/.workbuddy)
  
选项:
  --profile-only  仅输出用户画像
  --intake-only   仅输出适配后的采集协议
  --json          以 JSON 格式输出
  --help          显示帮助信息

示例:
  node workbuddy-user-profile-bridge.mjs ~/.workbuddy
  node workbuddy-user-profile-bridge.mjs ~/.workbuddy --intake-only
  node workbuddy-user-profile-bridge.mjs ~/.workbuddy --json
    `);
    process.exit(0);
  }
  
  const workbuddyDir = args[0];
  const options = {
    profileOnly: args.includes('--profile-only'),
    intakeOnly: args.includes('--intake-only'),
    json: args.includes('--json')
  };
  
  try {
    // 提取用户画像
    const profile = extractUserProfile(workbuddyDir);
    
    if (options.intakeOnly) {
      // 输出适配后的采集协议
      const intakeProtocol = adaptIntakeProtocol(profile);
      if (options.json) {
        console.log(JSON.stringify(intakeProtocol, null, 2));
      } else {
        console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('适配后的 S0 采集协议');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
        
        console.log(`问候: ${intakeProtocol.customGreeting}\n`);
        
        if (intakeProtocol.skipBasicInfo) {
          console.log('✅ 跳过基础信息收集');
        }
        
        if (intakeProtocol.customQuestions.length > 0) {
          console.log('\n定制问题:');
          intakeProtocol.customQuestions.forEach((q, i) => {
            console.log(`  ${i + 1}. ${q}`);
          });
        }
        
        if (intakeProtocol.suggestedActions.length > 0) {
          console.log('\n推荐行动:');
          intakeProtocol.suggestedActions.forEach((action, i) => {
            console.log(`  ${i + 1}. ${action.text}`);
          });
        }
        
        if (intakeProtocol.defaultMode) {
          console.log(`\n默认模式: ${modeToChinese(intakeProtocol.defaultMode)}`);
        }
        
        if (intakeProtocol.defaultCollaboration) {
          console.log(`默认协作: ${collaborationToChinese(intakeProtocol.defaultCollaboration)}`);
        }
      }
    } else if (options.profileOnly || !options.intakeOnly) {
      // 输出用户画像
      if (options.json) {
        console.log(JSON.stringify(profile, null, 2));
      } else {
        console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('用户画像');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
        
        console.log('基本信息:');
        console.log(`  姓名: ${profile.basicInfo.name || '未设置'}`);
        console.log(`  称呼: ${profile.basicInfo.callName || '未设置'}`);
        console.log(`  城市: ${profile.basicInfo.city || '未设置'}`);
        console.log(`  代词: ${profile.basicInfo.pronouns || '未设置'}`);
        
        console.log('\n工作背景:');
        console.log(`  当前项目: ${profile.workContext.currentProject || '未设置'}`);
        console.log(`  项目类型: ${profile.history.projectTypes.join(', ') || '无'}`);
        console.log(`  专业领域: ${profile.workContext.expertise.join(', ') || '无'}`);
        
        console.log('\n用户偏好:');
        console.log(`  工作模式: ${modeToChinese(profile.preferences.mode) || '未设置'}`);
        console.log(`  输出方式: ${profile.preferences.output || '未设置'}`);
        console.log(`  协作模式: ${collaborationToChinese(profile.preferences.collaboration) || '未设置'}`);
        
        console.log('\n历史记录:');
        console.log(`  最近项目: ${profile.history.recentProjects.join(', ') || '无'}`);
        
        console.log('\n个性特征:');
        console.log(`  气质: ${profile.personality.vibe || '未设置'}`);
        console.log(`  价值观: ${profile.personality.values.slice(0, 3).join(', ') || '无'}`);
        
        console.log(`\n画像完整度: ${profile.isProfileComplete ? '✅ 完整' : '❌ 不完整'}`);
      }
    }
  } catch (error) {
    console.error('错误:', error.message);
    process.exit(1);
  }
}
