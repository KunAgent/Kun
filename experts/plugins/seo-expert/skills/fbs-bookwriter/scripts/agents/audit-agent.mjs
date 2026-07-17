#!/usr/bin/env node
/**
 * 审计智能体
 * 
 * 职责:
 * - 时序准确性审计
 * - 术语一致性审计
 * - 查询优化审计
 * - 规则验证
 * - 一致性检查
 */

import { AgentBase } from './agent-base.mjs';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class AuditAgent extends AgentBase {
  constructor(config = {}) {
    super({
      agentId: 'audit-agent',
      agentName: 'Audit-Agent',
      agentType: 'specialist',
      capabilities: [
        'temporal-accuracy-audit',
        'term-consistency-audit',
        'query-optimization-audit',
        'rule-validation',
        'consistency-check'
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
    const { payload } = task;
    const { auditType, data } = payload;
    
    switch (auditType) {
      case 'temporal-accuracy':
        return this._auditTemporalAccuracy(data);
      case 'term-consistency':
        return this._auditTermConsistency(data);
      case 'query-optimization':
        return this._auditQueryOptimization(data);
      case 'full-audit':
        return this._runFullAudit(data);
      default:
        throw new Error(`AuditAgent does not support audit type: ${auditType}`);
    }
  }

  /**
   * 审计时序准确性
   * @param {object} data - 数据对象
   * @returns {Promise<object>} - 审计结果
   */
  async _auditTemporalAccuracy(data) {
    console.log(`[Audit-Agent] Auditing temporal accuracy`);
    
    return new Promise((resolve, reject) => {
      const scriptPath = path.join(__dirname, 'audit-temporal-accuracy.mjs');
      const args = [
        '--book-root', data.bookRoot
      ];
      
      if (data.chapterId) {
        args.push('--chapter-id', data.chapterId);
      }
      
      if (data.enforce) {
        args.push('--enforce');
      }
      
      const child = spawn(process.execPath, [scriptPath, ...args], {
        stdio: ['pipe', 'pipe', 'pipe']
      });
      
      let stdout = '';
      let stderr = '';
      
      child.stdout.on('data', (d) => { stdout += d.toString(); });
      child.stderr.on('data', (d) => { stderr += d.toString(); });
      
      child.on('close', (code) => {
        const result = {
          auditType: 'temporal-accuracy',
          passed: code === 0,
          report: stdout,
          errors: code !== 0 ? [stderr] : [],
          auditedAt: new Date().toISOString()
        };
        
        // 发布审计结果事件
        this.publishEvent('audit.result', result);
        
        if (code === 0) {
          resolve(result);
        } else {
          reject(result);
        }
      });
      
      child.on('error', (error) => {
        const result = {
          auditType: 'temporal-accuracy',
          passed: false,
          errors: [error.message],
          auditedAt: new Date().toISOString()
        };
        this.publishEvent('audit.result', result);
        reject(error);
      });
    });
  }

  /**
   * 审计术语一致性
   * @param {object} data - 数据对象
   * @returns {Promise<object>} - 审计结果
   */
  async _auditTermConsistency(data) {
    console.log(`[Audit-Agent] Auditing term consistency`);
    
    return new Promise((resolve, reject) => {
      const scriptPath = path.join(__dirname, 'audit-term-consistency.mjs');
      const args = [
        '--book-root', data.bookRoot
      ];
      
      if (data.chapterId) {
        args.push('--chapter-id', data.chapterId);
      }
      
      if (data.enforce) {
        args.push('--enforce');
      }
      
      const child = spawn(process.execPath, [scriptPath, ...args], {
        stdio: ['pipe', 'pipe', 'pipe']
      });
      
      let stdout = '';
      let stderr = '';
      
      child.stdout.on('data', (d) => { stdout += d.toString(); });
      child.stderr.on('data', (d) => { stderr += d.toString(); });
      
      child.on('close', (code) => {
        const result = {
          auditType: 'term-consistency',
          passed: code === 0,
          report: stdout,
          errors: code !== 0 ? [stderr] : [],
          auditedAt: new Date().toISOString()
        };
        
        // 发布审计结果事件
        this.publishEvent('audit.result', result);
        
        if (code === 0) {
          resolve(result);
        } else {
          reject(result);
        }
      });
      
      child.on('error', (error) => {
        const result = {
          auditType: 'term-consistency',
          passed: false,
          errors: [error.message],
          auditedAt: new Date().toISOString()
        };
        this.publishEvent('audit.result', result);
        reject(error);
      });
    });
  }

  /**
   * 审计查询优化
   * @param {object} data - 数据对象
   * @returns {Promise<object>} - 审计结果
   */
  async _auditQueryOptimization(data) {
    console.log(`[Audit-Agent] Auditing query optimization`);
    
    return new Promise((resolve, reject) => {
      const scriptPath = path.join(__dirname, 'audit-query-optimization.mjs');
      const args = [
        '--book-root', data.bookRoot
      ];
      
      if (data.chapterId) {
        args.push('--chapter-id', data.chapterId);
      }
      
      if (data.enforce) {
        args.push('--enforce');
      }
      
      const child = spawn(process.execPath, [scriptPath, ...args], {
        stdio: ['pipe', 'pipe', 'pipe']
      });
      
      let stdout = '';
      let stderr = '';
      
      child.stdout.on('data', (d) => { stdout += d.toString(); });
      child.stderr.on('data', (d) => { stderr += d.toString(); });
      
      child.on('close', (code) => {
        const result = {
          auditType: 'query-optimization',
          passed: code === 0,
          report: stdout,
          errors: code !== 0 ? [stderr] : [],
          auditedAt: new Date().toISOString()
        };
        
        // 发布审计结果事件
        this.publishEvent('audit.result', result);
        
        if (code === 0) {
          resolve(result);
        } else {
          reject(result);
        }
      });
      
      child.on('error', (error) => {
        const result = {
          auditType: 'query-optimization',
          passed: false,
          errors: [error.message],
          auditedAt: new Date().toISOString()
        };
        this.publishEvent('audit.result', result);
        reject(error);
      });
    });
  }

  /**
   * 运行全量审计
   * @param {object} data - 数据对象
   * @returns {Promise<object>} - 审计结果
   */
  async _runFullAudit(data) {
    console.log(`[Audit-Agent] Running full audit`);
    
    const results = await Promise.allSettled([
      this._auditTemporalAccuracy(data),
      this._auditTermConsistency(data),
      this._auditQueryOptimization(data)
    ]);
    
    const passed = results.every(r => r.status === 'fulfilled' && r.value.passed);
    const errors = results
      .filter(r => r.status === 'rejected' || !r.value.passed)
      .flatMap(r => r.reason?.errors || r.value?.errors || []);
    
    const result = {
      auditType: 'full-audit',
      passed,
      results: results.map(r => r.status === 'fulfilled' ? r.value : r.reason),
      errors,
      auditedAt: new Date().toISOString()
    };
    
    // 发布审计结果事件
    this.publishEvent('audit.result', result);
    
    return result;
  }
}
