#!/usr/bin/env node
/**
 * 会话状态管理器
 * 
 * 功能:
 * - 跨会话状态持久化
 * - 检查点管理
 * - 状态恢复与回滚
 * - 异常检测与恢复
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * 会话状态管理器类
 */
export class SessionStateManager {
  constructor(bookRoot, options = {}) {
    this.bookRoot = bookRoot;
    this.options = {
      autoResume: options.autoResume || false,
      checkpointInterval: options.checkpointInterval || 'chapter',
      maxCheckpoints: options.maxCheckpoints || 10,
      stateFile: options.stateFile || '.fbs/esm-state.md',
      checkpointDir: options.checkpointDir || '.fbs/checkpoints',
      ...options
    };
    
    this.stateFile = path.join(bookRoot, this.options.stateFile);
    this.checkpointDir = path.join(bookRoot, this.options.checkpointDir);
    
    // 确保目录存在
    this.ensureDirectories();
    
    // 当前状态
    this.currentState = null;
  }

  /**
   * 确保目录存在
   */
  ensureDirectories() {
    const dirs = [
      path.join(this.bookRoot, '.fbs'),
      this.checkpointDir
    ];
    
    dirs.forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });
  }

  /**
   * 保存当前状态
   */
  async saveState(state) {
    const stateData = {
      timestamp: new Date().toISOString(),
      version: '2.0.2',
      currentState: state.current,

      lastAction: state.lastAction,
      context: state.context || {},
      metadata: state.metadata || {}
    };
    
    // 写入状态文件
    await fs.promises.writeFile(
      this.stateFile,
      this.formatStateAsMarkdown(stateData),
      'utf8'
    );
    
    this.currentState = stateData;
    
    return {
      success: true,
      timestamp: stateData.timestamp,
      stateFile: this.stateFile
    };
  }

  /**
   * 加载最新状态
   */
  async loadState() {
    try {
      if (!fs.existsSync(this.stateFile)) {
        return {
          canResume: false,
          reason: '状态文件不存在'
        };
      }
      
      const content = await fs.promises.readFile(this.stateFile, 'utf8');
      const state = this.parseStateFromMarkdown(content);
      
      // 验证状态有效性
      if (!this.validateState(state)) {
        return {
          canResume: false,
          reason: '状态文件无效或损坏',
          needsRecovery: true
        };
      }
      
      this.currentState = state;
      
      // 生成恢复提示
      const resumePrompt = this.generateResumePrompt(state);
      
      return {
        canResume: true,
        state,
        resumePrompt,
        autoResume: this.options.autoResume
      };
      
    } catch (error) {
      return {
        canResume: false,
        reason: `加载状态失败: ${error.message}`,
        needsRecovery: true,
        error
      };
    }
  }

  /**
   * 创建检查点
   */
  async createCheckpoint(label, state = null) {
    const checkpointData = {
      id: this.generateCheckpointId(),
      timestamp: new Date().toISOString(),
      label: label || this.generateCheckpointLabel(),
      state: state || this.currentState,
      metadata: {
        esmState: state?.current || this.currentState?.currentState,
        lastAction: state?.lastAction || this.currentState?.lastAction,
        chapterIndex: state?.context?.chapterIndex || this.currentState?.context?.chapterIndex,
        searchCount: state?.context?.searchCount || this.currentState?.context?.searchCount,
        wordCount: state?.context?.wordCount || this.currentState?.context?.wordCount
      }
    };
    
    const checkpointFile = path.join(
      this.checkpointDir,
      `${checkpointData.id}.checkpoint.json`
    );
    
    await fs.promises.writeFile(
      checkpointFile,
      JSON.stringify(checkpointData, null, 2),
      'utf8'
    );
    
    // 清理旧检查点
    await this.cleanupOldCheckpoints();
    
    return {
      success: true,
      checkpointId: checkpointData.id,
      checkpointFile,
      timestamp: checkpointData.timestamp
    };
  }

  /**
   * 加载检查点
   */
  async loadCheckpoint(checkpointId) {
    try {
      const checkpointFile = path.join(
        this.checkpointDir,
        `${checkpointId}.checkpoint.json`
      );
      
      if (!fs.existsSync(checkpointFile)) {
        return {
          success: false,
          reason: '检查点不存在'
        };
      }
      
      const content = await fs.promises.readFile(checkpointFile, 'utf8');
      const checkpoint = JSON.parse(content);
      
      // 恢复状态
      await this.restoreFromCheckpoint(checkpoint);
      
      return {
        success: true,
        checkpoint,
        restoredAt: new Date().toISOString()
      };
      
    } catch (error) {
      return {
        success: false,
        reason: `加载检查点失败: ${error.message}`,
        error
      };
    }
  }

  /**
   * 列出所有检查点
   */
  listCheckpoints() {
    try {
      const files = fs.readdirSync(this.checkpointDir)
        .filter(f => f.endsWith('.checkpoint.json'))
        .sort()
        .reverse();
      
      const checkpoints = files.map(file => {
        const filePath = path.join(this.checkpointDir, file);
        const content = fs.readFileSync(filePath, 'utf8');
        const checkpoint = JSON.parse(content);
        
        return {
          id: checkpoint.id,
          label: checkpoint.label,
          timestamp: checkpoint.timestamp,
          metadata: checkpoint.metadata,
          filePath
        };
      });
      
      return {
        success: true,
        checkpoints
      };
      
    } catch (error) {
      return {
        success: false,
        reason: `列出检查点失败: ${error.message}`,
        error
      };
    }
  }

  /**
   * 删除检查点
   */
  async deleteCheckpoint(checkpointId) {
    try {
      const checkpointFile = path.join(
        this.checkpointDir,
        `${checkpointId}.checkpoint.json`
      );
      
      if (fs.existsSync(checkpointFile)) {
        await fs.promises.unlink(checkpointFile);
        return { success: true };
      }
      
      return {
        success: false,
        reason: '检查点不存在'
      };
      
    } catch (error) {
      return {
        success: false,
        reason: `删除检查点失败: ${error.message}`,
        error
      };
    }
  }

  /**
   * 从检查点恢复
   */
  async restoreFromCheckpoint(checkpoint) {
    if (checkpoint.state) {
      await this.saveState(checkpoint.state);
      this.currentState = checkpoint.state;
    }
  }

  /**
   * 清理旧检查点
   */
  async cleanupOldCheckpoints() {
    try {
      const files = fs.readdirSync(this.checkpointDir)
        .filter(f => f.endsWith('.checkpoint.json'))
        .map(f => ({
          name: f,
          path: path.join(this.checkpointDir, f),
          mtime: fs.statSync(path.join(this.checkpointDir, f)).mtime
        }))
        .sort((a, b) => b.mtime - a.mtime);
      
      // 保留最近的 maxCheckpoints 个检查点
      if (files.length > this.options.maxCheckpoints) {
        const toDelete = files.slice(this.options.maxCheckpoints);
        
        for (const file of toDelete) {
          await fs.promises.unlink(file.path);
        }
        
        return {
          success: true,
          deletedCount: toDelete.length
        };
      }
      
      return {
        success: true,
        deletedCount: 0
      };
      
    } catch (error) {
      return {
        success: false,
        reason: `清理检查点失败: ${error.message}`,
        error
      };
    }
  }

  /**
   * 生成检查点 ID
   */
  generateCheckpointId() {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 生成检查点标签
   */
  generateCheckpointLabel() {
    const esmState = this.currentState?.currentState || 'UNKNOWN';
    const chapterIndex = this.currentState?.context?.chapterIndex || 0;
    return `${esmState} - 第${chapterIndex}章`;
  }

  /**
   * 验证状态有效性
   */
  validateState(state) {
    if (!state) return false;
    if (!state.currentState) return false;
    if (!state.timestamp) return false;
    
    // 检查 ESM 状态是否在有效范围内
    const validStates = [
      'IDLE', 'INTAKE', 'RESEARCH', 'PLAN',
      'WRITE', 'REVIEW', 'WRITE_MORE', 'DELIVER'
    ];
    
    return validStates.includes(state.currentState);
  }

  /**
   * 生成恢复提示
   */
  generateResumePrompt(state) {
    const esmState = state.currentState || 'UNKNOWN';
    const timestamp = new Date(state.timestamp).toLocaleString('zh-CN');
    const lastAction = state.lastAction || '无记录';
    
    let prompt = `检测到上次进度：${esmState}`;
    
    if (state.context) {
      if (state.context.chapterIndex) {
        prompt += `（第${state.context.chapterIndex}章）`;
      }
      if (state.context.topic) {
        prompt += `\n主题：${state.context.topic.substring(0, 50)}`;
      }
      if (state.context.wordCount) {
        prompt += `\n已写字数：${state.context.wordCount}字`;
      }
    }
    
    prompt += `\n时间：${timestamp}`;
    prompt += `\n最后操作：${lastAction}`;
    
    if (this.options.autoResume) {
      prompt += `\n\n✅ 已自动恢复上次进度`;
    } else {
      prompt += `\n\n是否继续上次的进度？`;
      prompt += `\n- 输入"继续"从${esmState}恢复`;
      prompt += `\n- 输入"重新开始"从 S0 开始`;
    }
    
    return prompt;
  }

  /**
   * 格式化状态为 Markdown
   */
  formatStateAsMarkdown(state) {
    return `# ESM 状态

> 更新时间: ${state.timestamp}
> 版本: ${state.version}

## 当前状态

\`\`\`
${state.currentState}
\`\`\`

## 最后操作

${state.lastAction || '无记录'}

## 上下文

${this.formatContextAsMarkdown(state.context)}

## 元数据

${this.formatMetadataAsMarkdown(state.metadata)}
`;
  }

  /**
   * 格式化上下文为 Markdown
   */
  formatContextAsMarkdown(context) {
    if (!context) return '无上下文信息';
    
    const lines = [];
    
    if (context.topic) {
      lines.push(`- **主题**: ${context.topic}`);
    }
    if (context.chapterIndex !== undefined) {
      lines.push(`- **章节**: 第${context.chapterIndex}章`);
    }
    if (context.genre) {
      lines.push(`- **体裁**: ${context.genre}`);
    }
    if (context.targetReader) {
      lines.push(`- **目标读者**: ${context.targetReader}`);
    }
    if (context.wordCount) {
      lines.push(`- **字数**: ${context.wordCount}`);
    }
    if (context.searchCount) {
      lines.push(`- **检索次数**: ${context.searchCount}`);
    }
    
    return lines.join('\n') || '无上下文信息';
  }

  /**
   * 格式化元数据为 Markdown
   */
  formatMetadataAsMarkdown(metadata) {
    if (!metadata || Object.keys(metadata).length === 0) {
      return '无元数据';
    }
    
    const lines = [];
    
    for (const [key, value] of Object.entries(metadata)) {
      lines.push(`- **${key}**: ${value}`);
    }
    
    return lines.join('\n');
  }

  /**
   * 从 Markdown 解析状态
   */
  parseStateFromMarkdown(markdown) {
    const state = {
      timestamp: '',
      version: '',
      currentState: '',
      lastAction: '',
      context: {},
      metadata: {}
    };
    
    // 提取时间戳
    const timestampMatch = markdown.match(/更新时间:\s*(.+)/);
    if (timestampMatch) {
      state.timestamp = timestampMatch[1].trim();
    }
    
    // 提取版本
    const versionMatch = markdown.match(/版本:\s*(.+)/);
    if (versionMatch) {
      state.version = versionMatch[1].trim();
    }
    
    // 提取当前状态
    const esmMatch = markdown.match(/## 当前状态\s*```\s*(\w+)\s*```/);
    if (esmMatch) {
      state.currentState = esmMatch[1].trim();
    }
    
    // 提取最后操作
    const actionMatch = markdown.match(/## 最后操作\s*(.+)/s);
    if (actionMatch) {
      state.lastAction = actionMatch[1].trim();
    }
    
    // 提取上下文（简化实现）
    const topicMatch = markdown.match(/\*\*主题\*\*:\s*(.+)/);
    if (topicMatch) {
      state.context.topic = topicMatch[1].trim();
    }
    
    const chapterMatch = markdown.match(/\*\*章节\*\*:\s*第(\d+)章/);
    if (chapterMatch) {
      state.context.chapterIndex = parseInt(chapterMatch[1]);
    }
    
    const genreMatch = markdown.match(/\*\*体裁\*\*:\s*(.+)/);
    if (genreMatch) {
      state.context.genre = genreMatch[1].trim();
    }
    
    const wordCountMatch = markdown.match(/\*\*字数\*\*:\s*(\d+)/);
    if (wordCountMatch) {
      state.context.wordCount = parseInt(wordCountMatch[1]);
    }
    
    const searchCountMatch = markdown.match(/\*\*检索次数\*\*:\s*(\d+)/);
    if (searchCountMatch) {
      state.context.searchCount = parseInt(searchCountMatch[1]);
    }
    
    return state;
  }

  /**
   * 导出状态快照
   */
  async exportSnapshot(outputPath) {
    try {
      const snapshot = {
        version: '2.0.2',
        exportedAt: new Date().toISOString(),

        state: this.currentState,
        checkpoints: (await this.listCheckpoints()).checkpoints
      };
      
      await fs.promises.writeFile(
        outputPath,
        JSON.stringify(snapshot, null, 2),
        'utf8'
      );
      
      return {
        success: true,
        outputFile: outputPath
      };
      
    } catch (error) {
      return {
        success: false,
        reason: `导出快照失败: ${error.message}`,
        error
      };
    }
  }

  /**
   * 导入状态快照
   */
  async importSnapshot(inputPath) {
    try {
      const content = await fs.promises.readFile(inputPath, 'utf8');
      const snapshot = JSON.parse(content);
      
      // 恢复状态
      if (snapshot.state) {
        await this.saveState(snapshot.state);
      }
      
      // 恢复检查点
      if (snapshot.checkpoints && snapshot.checkpoints.length > 0) {
        for (const checkpoint of snapshot.checkpoints) {
          await this.createCheckpoint(checkpoint.label, checkpoint.state);
        }
      }
      
      return {
        success: true,
        importedAt: new Date().toISOString(),
        stateCount: snapshot.checkpoints?.length || 0
      };
      
    } catch (error) {
      return {
        success: false,
        reason: `导入快照失败: ${error.message}`,
        error
      };
    }
  }
}

/**
 * CLI 入口
 */
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  
  if (args.length < 2 || args.includes('--help')) {
    console.log(`
会话状态管理器

用法:
  node session-state-manager.mjs <action> <book-root> [options]

动作:
  save              保存当前状态
  load              加载最新状态
  checkpoint        创建检查点
  list-checkpoints  列出所有检查点
  restore           从检查点恢复
  delete            删除检查点
  export            导出状态快照
  import            导入状态快照

参数:
  book-root          书籍项目根目录
  checkpoint-id      检查点 ID (用于 restore/delete)
  label              检查点标签 (用于 checkpoint)

选项:
  --auto-resume      自动恢复上次进度 (默认: false)
  --interval          检查点间隔: chapter, action (默认: chapter)
  --max-checkpoints   最大检查点数量 (默认: 10)
  --output           输出文件路径 (用于 export)
  --state-file        状态文件名 (默认: .fbs/esm-state.md)
  --checkpoint-dir    检查点目录 (默认: .fbs/checkpoints)
  --json             以 JSON 格式输出
  --help             显示帮助信息

示例:
  # 保存当前状态
  node session-state-manager.mjs save ./my-book
  
  # 加载最新状态
  node session-state-manager.mjs load ./my-book
  
  # 创建检查点
  node session-state-manager.mjs checkpoint ./my-book --label "第3章完成"
  
  # 列出检查点
  node session-state-manager.mjs list-checkpoints ./my-book
  
  # 从检查点恢复
  node session-state-manager.mjs restore ./my-book 1234567890-abc123
  
  # 导出状态快照
  node session-state-manager.mjs export ./my-book --output snapshot.json
  
  # 导入状态快照
  node session-state-manager.mjs import ./my-book ./snapshot.json
    `);
    process.exit(0);
  }
  
  const action = args[0];
  const bookRoot = args[1];
  const options = parseArgs(args.slice(2));
  
  try {
    const manager = new SessionStateManager(bookRoot, options);
    
    switch (action) {
      case 'save': {
        const state = {
          current: options.current || 'IDLE',
          lastAction: options.action || '手动保存',
          context: {},
          metadata: {}
        };
        const result = await manager.saveState(state);
        console.log('状态已保存:', result.timestamp);
        break;
      }
        
      case 'load': {
        const result = await manager.loadState();
        if (result.canResume) {
          console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
          console.log('可恢复的进度');
          console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
          console.log(result.resumePrompt);
          
          if (options.json) {
            console.log('\n状态数据:', JSON.stringify(result.state, null, 2));
          }
        } else {
          console.log('无法恢复:', result.reason);
        }
        break;
      }
        
      case 'checkpoint': {
        const label = options.label || undefined;
        const result = await manager.createCheckpoint(label);
        console.log('检查点已创建:', result.checkpointId);
        console.log('标签:', result.timestamp);
        break;
      }
        
      case 'list-checkpoints': {
        const result = await manager.listCheckpoints();
        if (result.success) {
          console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
          console.log('检查点列表');
          console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
          
          if (result.checkpoints.length === 0) {
            console.log('无检查点');
          } else {
            result.checkpoints.forEach((cp, i) => {
              console.log(`${i + 1}. ${cp.label}`);
              console.log(`   ID: ${cp.id}`);
              console.log(`   时间: ${new Date(cp.timestamp).toLocaleString('zh-CN')}`);
              console.log(`   ESM状态: ${cp.metadata.esmState || 'N/A'}`);
              if (cp.metadata.chapterIndex !== undefined) {
                console.log(`   章节: 第${cp.metadata.chapterIndex}章`);
              }
              console.log('');
            });
          }
          
          if (options.json) {
            console.log('\n完整数据:', JSON.stringify(result.checkpoints, null, 2));
          }
        } else {
          console.log('列出失败:', result.reason);
        }
        break;
      }
        
      case 'restore': {
        const checkpointId = args[2];
        if (!checkpointId) {
          console.error('错误: 请提供检查点 ID');
          process.exit(1);
        }
        
        const result = await manager.loadCheckpoint(checkpointId);
        if (result.success) {
          console.log('已从检查点恢复:', result.restoredAt);
          console.log('检查点:', result.checkpoint.label);
        } else {
          console.log('恢复失败:', result.reason);
        }
        break;
      }
        
      case 'delete': {
        const checkpointId = args[2];
        if (!checkpointId) {
          console.error('错误: 请提供检查点 ID');
          process.exit(1);
        }
        
        const result = await manager.deleteCheckpoint(checkpointId);
        if (result.success) {
          console.log('检查点已删除');
        } else {
          console.log('删除失败:', result.reason);
        }
        break;
      }
        
      case 'export': {
        const outputPath = options.output || 'state-snapshot.json';
        const result = await manager.exportSnapshot(outputPath);
        if (result.success) {
          console.log('快照已导出:', result.outputFile);
        } else {
          console.log('导出失败:', result.reason);
        }
        break;
      }
        
      case 'import': {
        const inputPath = args[2];
        if (!inputPath) {
          console.error('错误: 请提供快照文件路径');
          process.exit(1);
        }
        
        const result = await manager.importSnapshot(inputPath);
        if (result.success) {
          console.log('快照已导入:', result.importedAt);
          console.log('恢复状态数:', result.stateCount);
        } else {
          console.log('导入失败:', result.reason);
        }
        break;
      }
        
      default:
        console.error('未知动作:', action);
        process.exit(1);
    }
    
  } catch (error) {
    console.error('错误:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

/**
 * 解析命令行参数
 */
function parseArgs(args) {
  const options = {
    autoResume: false,
    interval: 'chapter',
    maxCheckpoints: 10,
    output: null,
    stateFile: '.fbs/session-state.md',

    checkpointDir: '.fbs/checkpoints',
    current: null,
    action: null,
    json: false
  };
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === '--auto-resume') {
      options.autoResume = true;
    } else if (arg === '--interval' && args[i + 1]) {
      options.interval = args[++i];
    } else if (arg === '--max-checkpoints' && args[i + 1]) {
      options.maxCheckpoints = parseInt(args[++i]);
    } else if (arg === '--output' && args[i + 1]) {
      options.output = args[++i];
    } else if (arg === '--state-file' && args[i + 1]) {
      options.stateFile = args[++i];
    } else if (arg === '--checkpoint-dir' && args[i + 1]) {
      options.checkpointDir = args[++i];
    } else if (arg.startsWith('--current=')) {
      options.current = arg.split('=')[1];
    } else if (arg.startsWith('--action=')) {
      options.action = arg.split('=')[1];
    } else if (arg === '--json') {
      options.json = true;
    }
  }
  
  return options;
}
