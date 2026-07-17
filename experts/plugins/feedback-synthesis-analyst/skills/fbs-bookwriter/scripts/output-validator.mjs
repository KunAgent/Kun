/**
 * FBS-BookWriter 输出验证框架
 * 
 * 功能：
 * - 验证对话输出是否符合规范模板
 * - 检查分隔符、字段完整性
 * - 提供白名单机制避免误报
 * - 支持多种输出类型（ESM自检、Brief、状态宣告等）
 * 
 * 版本：v1.59C
 * 作者：FBS-BookWriter Team
 * 许可：MIT
 */

import fs from 'fs/promises';
import path from 'path';

/**
 * 输出模板定义
 */
const OUTPUT_TEMPLATES = {
  // ESM 自检输出
  esmSelfCheck: {
    separator: '━━ 📍 当前进度 ━━',
    requiredFields: [
      '所在步骤',
      '文稿类型',
      '出口条件',
      '下一步',
      '异常'
    ],
    optionalFields: [
      '检查点',
      '通过项',
      '缺失项'
    ]
  },
  
  // ESM 自检输出（紧凑模式）
  esmSelfCheckCompact: {
    separator: '[ESM 自检]',
    requiredFields: [
      '状态',
      '出口',
      '下一步'
    ],
    pattern: /\[ESM 自检\]\s*状态:\s*\w+\s*[|·]\s*出口:\s*[\u4e00-\u9fa5a-zA-Z0-9\s:|]+\s*[|·]\s*下一步:\s*[\u4e00-\u9fa5a-zA-Z0-9]+/
  },
  
  // 状态切换宣告
  stateTransition: {
    separator: '━━━━━━ 🔄 进入下一步 ━━━━━━',
    requiredFields: [
      '上一步',
      '下一步',
      '文稿类型',
      '切换原因',
      '现在要做',
      'ESM 自检'
    ],
    optionalFields: [
      '时间',
      '时间戳'
    ]
  },
  
  // Chapter Brief
  chapterBrief: {
    separator: '━━━━━━ 📌 Chapter Brief · Ch',
    requiredFields: [
      '章节标题',
      '核心主张',
      '论述路径',
      '素材状态',
      '承接上章',
      '作者声音约束',
      '模型知识使用',
      '锁定期术语核查'
    ],
    optionalFields: [
      '字数预期',
      '写作节奏',
      '交付标准'
    ]
  },
  
  // Report Brief
  reportBrief: {
    separator: '━━━━━━━━ 📌 Report Brief ━━━━━━━━',
    requiredFields: [
      '报道标题',
      '核心叙事线',
      '结构路径',
      '信源状态',
      '目标读者',
      '作者声音约束',
      '模型知识使用',
      '预计字数'
    ]
  },
  
  // S0 调研简报
  s0Brief: {
    separator: '# [S0] 调研简报',
    requiredFields: [
      '主题',
      'lockedAt',
      'confirmedByUser',
      '体裁等级',
      '目标读者',
      '时间基准',
      '内容竞品',
      '读者画像',
      '变现路径',
      'S0 维度完整性自查'
    ],
    optionalFields: [
      '概念定义',
      '推荐信息源',
      '差异化机会',
      '核心痛点'
    ]
  },
  
  // S0 调研进度
  s0Progress: {
    separator: 'S0进度',
    requiredFields: [
      '维度',
      '轮次',
      '已达标',
      '待补'
    ],
    pattern: /S0进度\s*\[.*\]\s*已达标:.*\s*\|\s*待补:.*/
  },
  
  // 术语锁定动态哨兵
  termLockSentinel: {
    separator: '━━ 📌 锁定期术语核查 ━━',
    requiredFields: [
      '术语',
      '定义',
      '首次出现章节',
      '跨章使用情况'
    ],
    optionalFields: [
      '锁定状态',
      '一致性检查'
    ]
  },
  
  // 章内自审卡
  chapterSelfAudit: {
    separator: '━━ 📋 章内自审卡 ━━',
    requiredFields: [
      'S层',
      'P层',
      'C层',
      'B层',
      'Chapter Brief对齐',
      '素材取用核查',
      '落盘确认'
    ]
  },
  
  // 异常回退宣告
  stateRollback: {
    separator: '[强制回退]',
    requiredFields: [
      '旧状态',
      '新状态',
      '原因',
      '必做'
    ],
    pattern: /\[强制回退\]\s*\w+\s*→\s*\w+\s*·\s*原因:.*\s*·\s*必做:.*/
  }
};

/**
 * 验证结果
 */
class ValidationResult {
  constructor(valid, type, content) {
    this.valid = valid;
    this.type = type;
    this.content = content;
    this.errors = [];
    this.warnings = [];
    this.info = [];
  }

  addError(message) {
    this.errors.push(message);
    this.valid = false;
  }

  addWarning(message) {
    this.warnings.push(message);
  }

  addInfo(message) {
    this.info.push(message);
  }

  toJSON() {
    return {
      valid: this.valid,
      type: this.type,
      errors: this.errors,
      warnings: this.warnings,
      info: this.info
    };
  }
}

/**
 * 输出验证器
 */
export class OutputValidator {
  constructor(config = {}) {
    this.templates = { ...OUTPUT_TEMPLATES, ...config.templates };
    this.whitelist = config.whitelist || [];
    this.strictMode = config.strictMode !== false;
    this.verbose = config.verbose || false;
  }

  /**
   * 验证输出
   * @param {string} output - 输出内容
   * @param {string} type - 输出类型（模板key）
   * @returns {ValidationResult}
   */
  validate(output, type) {
    const result = new ValidationResult(true, type, output);
    
    // 检查是否在白名单中
    if (this.isWhitelisted(output)) {
      result.addInfo('输出在白名单中，跳过验证');
      return result;
    }

    // 获取模板定义
    const template = this.templates[type];
    if (!template) {
      result.addError(`未知的输出类型: ${type}`);
      return result;
    }

    // 检查分隔符
    this.checkSeparator(result, output, template.separator);

    // 检查正则模式（如果定义）
    if (template.pattern) {
      this.checkPattern(result, output, template.pattern);
    }

    // 检查必需字段
    if (template.requiredFields) {
      this.checkRequiredFields(result, output, template.requiredFields);
    }

    // 检查可选字段（仅警告）
    if (template.optionalFields && this.verbose) {
      this.checkOptionalFields(result, output, template.optionalFields);
    }

    return result;
  }

  /**
   * 批量验证输出
   * @param {Array<{content: string, type: string}>} outputs - 输出数组
   * @returns {Array<ValidationResult>}
   */
  validateBatch(outputs) {
    return outputs.map(({ content, type }) => this.validate(content, type));
  }

  /**
   * 从对话历史中提取并验证输出
   * @param {Array} dialogHistory - 对话历史
   * @param {string} type - 输出类型（可选，不指定则验证所有已知类型）
   * @returns {Array<ValidationResult>}
   */
  validateDialogHistory(dialogHistory, type = null) {
    const results = [];
    const typesToCheck = type ? [type] : Object.keys(this.templates);

    for (const message of dialogHistory) {
      if (message.role !== 'assistant') continue;

      for (const checkType of typesToCheck) {
        const template = this.templates[checkType];
        
        // 检查是否包含分隔符或匹配模式
        const hasSeparator = template.separator && message.content.includes(template.separator);
        const hasPattern = template.pattern && template.pattern.test(message.content);

        if (hasSeparator || hasPattern) {
          const result = this.validate(message.content, checkType);
          results.push(result);
          break; // 只匹配第一个类型
        }
      }
    }

    return results;
  }

  /**
   * 检查分隔符
   */
  checkSeparator(result, output, separator) {
    if (!separator) return;

    if (!output.includes(separator)) {
      result.addError(`缺少分隔符: "${separator}"`);
      return;
    }

    // 检查分隔符是否正确（检查格式）
    if (separator.includes('{')) {
      // 动态分隔符（如 Ch{NN}），只检查前缀
      const prefix = separator.split('{')[0];
      if (!output.includes(prefix)) {
        result.addError(`分隔符前缀不匹配: "${prefix}"`);
      }
    }

    result.addInfo(`✓ 分隔符检查通过: "${separator}"`);
  }

  /**
   * 检查正则模式
   */
  checkPattern(result, output, pattern) {
    if (!pattern.test(output)) {
      result.addError(`输出格式不符合模式: ${pattern}`);
      return;
    }

    result.addInfo(`✓ 格式模式检查通过`);
  }

  /**
   * 检查必需字段
   */
  checkRequiredFields(result, output, requiredFields) {
    for (const field of requiredFields) {
      // 尝试多种匹配方式
      const found = 
        output.includes(field) ||
        output.includes(`${field}:`) ||
        output.includes(`${field}：`) ||
        new RegExp(`\\b${field}\\s*[:：]`).test(output);

      if (!found) {
        result.addError(`缺少必需字段: "${field}"`);
      } else {
        result.addInfo(`✓ 字段检查通过: "${field}"`);
      }
    }
  }

  /**
   * 检查可选字段（仅警告）
   */
  checkOptionalFields(result, output, optionalFields) {
    for (const field of optionalFields) {
      const found = output.includes(field);
      if (!found) {
        result.addWarning(`建议包含字段: "${field}"`);
      }
    }
  }

  /**
   * 检查是否在白名单中
   */
  isWhitelisted(output) {
    for (const whitelistItem of this.whitelist) {
      if (typeof whitelistItem === 'string') {
        if (output.includes(whitelistItem)) {
          return true;
        }
      } else if (whitelistItem instanceof RegExp) {
        if (whitelistItem.test(output)) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * 添加自定义模板
   */
  addTemplate(type, template) {
    this.templates[type] = template;
  }

  /**
   * 移除模板
   */
  removeTemplate(type) {
    delete this.templates[type];
  }

  /**
   * 获取所有模板类型
   */
  getTemplateTypes() {
    return Object.keys(this.templates);
  }
}

/**
 * 验证器工厂
 */
export function createValidator(config = {}) {
  return new OutputValidator(config);
}

/**
 * CLI 接口
 */
export async function runCLI() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log('FBS-BookWriter 输出验证框架 v1.59C');
    console.log('\n用法:');
    console.log('  node output-validator.mjs <output-file> <type>');
    console.log('  node output-validator.mjs --dialog-history <dialog-history-file> [type]');
    console.log('  node output-validator.mjs --list-types');
    console.log('\n示例:');
    console.log('  node output-validator.mjs output.txt esmSelfCheck');
    console.log('  node output-validator.mjs --dialog-history .fbs/dialog-history.json');
    console.log('  node output-validator.mjs --list-types');
    process.exit(0);
  }

  // 列出所有模板类型
  if (args[0] === '--list-types') {
    console.log('支持的输出类型:');
    const validator = new OutputValidator();
    for (const type of validator.getTemplateTypes()) {
      console.log(`  - ${type}`);
    }
    process.exit(0);
  }

  // 验证单个文件
  if (args[0] !== '--dialog-history') {
    const [filePath, type] = args;
    
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const validator = new OutputValidator({ strictMode: false, verbose: true });
      const result = validator.validate(content, type);

      console.log(`\n验证结果: ${result.valid ? '✅ 通过' : '❌ 失败'}`);
      console.log(`类型: ${result.type}\n`);

      if (result.errors.length > 0) {
        console.log('错误:');
        result.errors.forEach(err => console.log(`  ❌ ${err}`));
      }

      if (result.warnings.length > 0) {
        console.log('\n警告:');
        result.warnings.forEach(warn => console.log(`  ⚠️  ${warn}`));
      }

      if (result.info.length > 0) {
        console.log('\n信息:');
        result.info.forEach(info => console.log(`  ℹ️  ${info}`));
      }

      process.exit(result.valid ? 0 : 1);
    } catch (error) {
      console.error(`错误: ${error.message}`);
      process.exit(1);
    }
  }

  // 验证对话历史
  if (args[0] === '--dialog-history') {
    const [_, __, type] = args;
    const filePath = args[1];

    try {
      const history = JSON.parse(await fs.readFile(filePath, 'utf-8'));
      const validator = new OutputValidator({ strictMode: false, verbose: true });
      const results = validator.validateDialogHistory(history, type);

      console.log(`\n对话历史验证结果: ${results.length} 个输出\n`);

      let passed = 0;
      let failed = 0;

      for (const result of results) {
        console.log(`\n[${result.type}] ${result.valid ? '✅ 通过' : '❌ 失败'}`);

        if (result.valid) {
          passed++;
        } else {
          failed++;
          result.errors.forEach(err => console.log(`  ❌ ${err}`));
        }

        if (result.warnings.length > 0) {
          result.warnings.forEach(warn => console.log(`  ⚠️  ${warn}`));
        }
      }

      console.log(`\n总计: ${results.length} 个输出, ${passed} 通过, ${failed} 失败`);

      process.exit(failed > 0 ? 1 : 0);
    } catch (error) {
      console.error(`错误: ${error.message}`);
      process.exit(1);
    }
  }
}

// 如果直接运行此文件，执行CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  runCLI();
}
