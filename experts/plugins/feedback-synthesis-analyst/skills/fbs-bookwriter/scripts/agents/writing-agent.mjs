#!/usr/bin/env node
/**
 * 写作智能体
 * 
 * 职责:
 * - S1章节定位
 * - S2章节起草
 * - S3章节成稿
 * - 结构化写作
 * - 风格控制
 */

import { spawn } from 'child_process';
import { AgentBase } from './agent-base.mjs';
import path from 'path';
import { fileURLToPath } from 'url';


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class WritingAgent extends AgentBase {
  constructor(config = {}) {
    super({
      agentId: 'writing-agent',
      agentName: 'Writing-Agent',
      agentType: 'specialist',
      capabilities: [
        's1-chapter-positioning',
        's2-drafting',
        's3-finalizing',
        'structured-writing',
        'style-control'
      ],
      ...config
    });
  }

  /**
   * 执行任务(覆盖基类方法)
   * @param {object} task - 任务对象
   * @returns {Promise<object>} - 任务结果
   */
  async executeTask(task) {
    const { state, payload } = task;
    
    switch (state) {
      case 'S1':
        return this._positionChapter(task);
      case 'S2':
        return this._draftChapter(task);
      case 'S3':
        return this._finalizeChapter(task);
      default:
        throw new Error(`WritingAgent does not support state: ${state}`);
    }
  }

  /**
   * S1章节定位
   * @param {object} task - 任务对象
   * @returns {Promise<object>} - 章节定位结果
   */
  async _positionChapter(task) {
    const { chapterId, payload } = task;
    const { bookRoot, s0Brief } = payload;
    
    console.log(`[Writing-Agent] Positioning chapter: ${chapterId}`);
    
    // 根据S0简报生成章节定位
    const positioning = {
      chapterId,
      bookRoot,
      title: s0Brief?.topic || '',
      subtitle: '',
      objectives: [],
      targetAudience: s0Brief?.reader || '',
      keyPoints: [],
      structure: {
        introduction: '',
        body: [],
        conclusion: ''
      },
      style: {
        tone: 'professional',
        voice: 'authoritative',
        language: 'chinese'
      },
      generatedAt: new Date().toISOString(),
      status: 'completed'
    };
    
    // 发布章节定位完成事件
    this.publishEvent('s1.positioning.generated', {
      chapterId,
      positioning
    });
    
    return positioning;
  }

  /**
   * S2章节起草
   * @param {object} task - 任务对象
   * @returns {Promise<object>} - 章节草稿
   */
  async _draftChapter(task) {
    const { chapterId, payload } = task;
    const { bookRoot, s1Positioning } = payload;
    
    console.log(`[Writing-Agent] Drafting chapter: ${chapterId}`);
    
    // 根据章节定位生成草稿
    const draft = {
      chapterId,
      bookRoot,
      title: s1Positioning?.title || '',
      content: '',
      sections: [],
      metadata: {
        wordCount: 0,
        estimatedReadingTime: 0
      },
      generatedAt: new Date().toISOString(),
      status: 'draft'
    };
    
    // 调用 chapter-scheduler-hint 生成章节提示（只读提示，失败不阻断起草）
    draft.chapterHint = await this._generateChapterHint(bookRoot, chapterId);
    
    // 发布章节起草完成事件
    this.publishEvent('s2.draft.generated', {
      chapterId,
      draft
    });

    
    return draft;
  }

  /**
   * S3章节成稿
   * @param {object} task - 任务对象
   * @returns {Promise<object>} - 章节成稿
   */
  async _finalizeChapter(task) {
    const { chapterId, payload } = task;
    const { bookRoot, s2Draft } = payload;
    
    console.log(`[Writing-Agent] Finalizing chapter: ${chapterId}`);
    
    // 根据草稿生成成稿
    const finalization = {
      chapterId,
      bookRoot,
      title: s2Draft?.title || '',
      content: s2Draft?.content || '',
      sections: s2Draft?.sections || [],
      metadata: {
        wordCount: s2Draft?.metadata?.wordCount || 0,
        estimatedReadingTime: s2Draft?.metadata?.estimatedReadingTime || 0
      },
      generatedAt: new Date().toISOString(),
      status: 'completed'
    };
    
    // 调用 apply-book-memory-template 应用书籍记忆模板
    finalization.memoryTemplate = await this._applyBookMemoryTemplate(bookRoot, chapterId);
    
    // 发布章节成稿完成事件
    this.publishEvent('s3.finalization.generated', {
      chapterId,
      finalization
    });

    
    return finalization;
  }

  /**
   * 生成章节提示
   * @param {string} bookRoot - 书籍根目录
   * @param {string} chapterId - 章节ID
   */
  async _generateChapterHint(bookRoot, chapterId) {
    console.log(`[Writing-Agent] Generating chapter hint: ${chapterId}`);

    const scriptPath = path.join(__dirname, '..', 'chapter-scheduler-hint.mjs');
    const result = await this._runSupportScript({
      scriptPath,
      args: ['--book-root', bookRoot],
      chapterId,
      eventType: 's2.chapter-hint.generated',
      allowFailure: true
    });

    if (!result.ok) {
      console.warn(`[Writing-Agent] Chapter hint skipped for ${chapterId}: ${result.stderr || result.error || 'unknown error'}`);
    }

    return result;
  }

  /**
   * 应用书籍记忆模板
   * @param {string} bookRoot - 书籍根目录
   * @param {string} chapterId - 章节ID
   */
  async _applyBookMemoryTemplate(bookRoot, chapterId) {
    console.log(`[Writing-Agent] Applying book memory template: ${chapterId}`);

    const scriptPath = path.join(__dirname, '..', 'apply-book-memory-template.mjs');
    return this._runSupportScript({
      scriptPath,
      args: ['--book-root', bookRoot],
      chapterId,
      eventType: 's3.memory-template.applied',
      allowFailure: false
    });
  }

  /**
   * 执行辅助脚本
   * @param {object} options - 执行选项
   * @param {string} options.scriptPath - 脚本绝对路径
   * @param {string[]} options.args - CLI 参数
   * @param {string} options.chapterId - 章节ID
   * @param {string} options.eventType - 事件主题
   * @param {boolean} options.allowFailure - 是否允许软失败
   * @returns {Promise<object>} - 执行结果
   */
  async _runSupportScript({ scriptPath, args = [], chapterId, eventType, allowFailure = false }) {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [scriptPath, ...args], {
        stdio: ['ignore', 'pipe', 'pipe']
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        const result = {
          chapterId,
          script: path.basename(scriptPath),
          scriptPath,
          args,
          ok: code === 0,
          exitCode: code,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          executedAt: new Date().toISOString()
        };

        if (eventType) {
          this.publishEvent(eventType, result);
        }

        if (code === 0 || allowFailure) {
          resolve(result);
          return;
        }

        const error = new Error(`Support script failed (${result.script}) with code ${code}: ${result.stderr || 'unknown error'}`);
        error.result = result;
        reject(error);
      });

      child.on('error', (error) => {
        const result = {
          chapterId,
          script: path.basename(scriptPath),
          scriptPath,
          args,
          ok: false,
          exitCode: null,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          error: error.message,
          executedAt: new Date().toISOString()
        };

        if (eventType) {
          this.publishEvent(eventType, result);
        }

        if (allowFailure) {
          resolve(result);
          return;
        }

        reject(error);
      });
    });
  }
}

