#!/usr/bin/env node
/**
 * 验证智能体
 * 
 * 职责:
 * - 输出验证
 * - 格式检查
 * - 完整性检查
 * - 合规性验证
 */

import { AgentBase } from './agent-base.mjs';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class ValidationAgent extends AgentBase {
  constructor(config = {}) {
    super({
      agentId: 'validation-agent',
      agentName: 'Validation-Agent',
      agentType: 'specialist',
      capabilities: [
        'esm-self-check-validation',
        'chapter-brief-validation',
        'report-brief-validation',
        'state-transition-validation',
        'format-validation',
        'completeness-check'
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
    const { validationType, data } = payload;
    
    switch (validationType) {
      case 'esm-self-check':
        return this._validateESMSelfCheck(data);
      case 'chapter-brief':
        return this._validateChapterBrief(data);
      case 'report-brief':
        return this._validateReportBrief(data);
      case 'state-transition':
        return this._validateStateTransition(data);
      default:
        throw new Error(`ValidationAgent does not support validation type: ${validationType}`);
    }
  }

  /**
   * 验证ESM自检输出
   * @param {object} data - 数据对象
   * @returns {Promise<object>} - 验证结果
   */
  async _validateESMSelfCheck(data) {
    console.log(`[Validation-Agent] Validating ESM self-check`);
    
    return new Promise((resolve, reject) => {
      const scriptPath = path.join(__dirname, 'audit-esm-self-check.mjs');
      const args = [
        '--book-root', data.bookRoot
      ];
      
      const child = spawn(process.execPath, [scriptPath, ...args], {
        stdio: ['pipe', 'pipe', 'pipe']
      });
      
      let stdout = '';
      let stderr = '';
      
      child.stdout.on('data', (d) => { stdout += d.toString(); });
      child.stderr.on('data', (d) => { stderr += d.toString(); });
      
      child.on('close', (code) => {
        const result = {
          validationType: 'esm-self-check',
          passed: code === 0,
          report: stdout,
          errors: code !== 0 ? [stderr] : [],
          validatedAt: new Date().toISOString()
        };
        
        // 发布验证结果事件
        this.publishEvent('validation.result', result);
        
        if (code === 0) {
          resolve(result);
        } else {
          reject(result);
        }
      });
      
      child.on('error', (error) => {
        const result = {
          validationType: 'esm-self-check',
          passed: false,
          errors: [error.message],
          validatedAt: new Date().toISOString()
        };
        this.publishEvent('validation.result', result);
        reject(error);
      });
    });
  }

  /**
   * 验证章节简报格式
   * @param {object} data - 数据对象
   * @returns {Promise<object>} - 验证结果
   */
  async _validateChapterBrief(data) {
    console.log(`[Validation-Agent] Validating chapter brief`);
    
    return new Promise((resolve, reject) => {
      const scriptPath = path.join(__dirname, 'audit-chapter-brief.mjs');
      const args = [
        '--book-root', data.bookRoot,
        '--chapter-id', data.chapterId
      ];
      
      const child = spawn(process.execPath, [scriptPath, ...args], {
        stdio: ['pipe', 'pipe', 'pipe']
      });
      
      let stdout = '';
      let stderr = '';
      
      child.stdout.on('data', (d) => { stdout += d.toString(); });
      child.stderr.on('data', (d) => { stderr += d.toString(); });
      
      child.on('close', (code) => {
        const result = {
          validationType: 'chapter-brief',
          passed: code === 0,
          report: stdout,
          errors: code !== 0 ? [stderr] : [],
          validatedAt: new Date().toISOString()
        };
        
        // 发布验证结果事件
        this.publishEvent('validation.result', result);
        
        if (code === 0) {
          resolve(result);
        } else {
          reject(result);
        }
      });
      
      child.on('error', (error) => {
        const result = {
          validationType: 'chapter-brief',
          passed: false,
          errors: [error.message],
          validatedAt: new Date().toISOString()
        };
        this.publishEvent('validation.result', result);
        reject(error);
      });
    });
  }

  /**
   * 验证报告简报格式
   * @param {object} data - 数据对象
   * @returns {Promise<object>} - 验证结果
   */
  async _validateReportBrief(data) {
    console.log(`[Validation-Agent] Validating report brief`);
    
    return new Promise((resolve, reject) => {
      const scriptPath = path.join(__dirname, 'audit-report-brief.mjs');
      const args = [
        '--book-root', data.bookRoot
      ];
      
      const child = spawn(process.execPath, [scriptPath, ...args], {
        stdio: ['pipe', 'pipe', 'pipe']
      });
      
      let stdout = '';
      let stderr = '';
      
      child.stdout.on('data', (d) => { stdout += d.toString(); });
      child.stderr.on('data', (d) => { stderr += d.toString(); });
      
      child.on('close', (code) => {
        const result = {
          validationType: 'report-brief',
          passed: code === 0,
          report: stdout,
          errors: code !== 0 ? [stderr] : [],
          validatedAt: new Date().toISOString()
        };
        
        // 发布验证结果事件
        this.publishEvent('validation.result', result);
        
        if (code === 0) {
          resolve(result);
        } else {
          reject(result);
        }
      });
      
      child.on('error', (error) => {
        const result = {
          validationType: 'report-brief',
          passed: false,
          errors: [error.message],
          validatedAt: new Date().toISOString()
        };
        this.publishEvent('validation.result', result);
        reject(error);
      });
    });
  }

  /**
   * 验证状态切换
   * @param {object} data - 数据对象
   * @returns {Promise<object>} - 验证结果
   */
  async _validateStateTransition(data) {
    console.log(`[Validation-Agent] Validating state transition`);
    
    return new Promise((resolve, reject) => {
      const scriptPath = path.join(__dirname, 'audit-state-transition.mjs');
      const args = [
        '--book-root', data.bookRoot,
        '--chapter-id', data.chapterId
      ];
      
      const child = spawn(process.execPath, [scriptPath, ...args], {
        stdio: ['pipe', 'pipe', 'pipe']
      });
      
      let stdout = '';
      let stderr = '';
      
      child.stdout.on('data', (d) => { stdout += d.toString(); });
      child.stderr.on('data', (d) => { stderr += d.toString(); });
      
      child.on('close', (code) => {
        const result = {
          validationType: 'state-transition',
          passed: code === 0,
          report: stdout,
          errors: code !== 0 ? [stderr] : [],
          validatedAt: new Date().toISOString()
        };
        
        // 发布验证结果事件
        this.publishEvent('validation.result', result);
        
        if (code === 0) {
          resolve(result);
        } else {
          reject(result);
        }
      });
      
      child.on('error', (error) => {
        const result = {
          validationType: 'state-transition',
          passed: false,
          errors: [error.message],
          validatedAt: new Date().toISOString()
        };
        this.publishEvent('validation.result', result);
        reject(error);
      });
    });
  }
}
