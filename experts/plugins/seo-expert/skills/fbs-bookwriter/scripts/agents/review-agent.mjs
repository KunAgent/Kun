#!/usr/bin/env node
/**
 * 审校智能体
 * 
 * 职责:
 * - S3审校(P/C/B)
 * - 内容审校
 * - 格式检查
 * - 合规验证
 */

import { AgentBase } from './agent-base.mjs';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class ReviewAgent extends AgentBase {
  constructor(config = {}) {
    super({
      agentId: 'review-agent',
      agentName: 'Review-Agent',
      agentType: 'specialist',
      capabilities: [
        's3-review',
        'content-proofreading',
        'format-checking',
        'compliance-verification',
        'p-c-b-review'
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
    
    if (state === 'S4') {
      return this._reviewChapter(task);
    } else {
      throw new Error(`ReviewAgent does not support state: ${state}`);
    }
  }

  /**
   * 审校章节
   * @param {object} task - 任务对象
   * @returns {Promise<object>} - 审校结果
   */
  async _reviewChapter(task) {
    const { chapterId, payload } = task;
    const { bookRoot, s3Finalization } = payload;
    
    console.log(`[Review-Agent] Reviewing chapter: ${chapterId}`);
    
    // 并行执行P/C/B审校
    const [politicsReview, contentReview, businessReview] = await Promise.all([
      this._politicsReview(bookRoot, chapterId),
      this._contentReview(bookRoot, chapterId, s3Finalization),
      this._businessReview(bookRoot, chapterId, s3Finalization)
    ]);
    
    // 汇总审校结果
    const reviewResult = {
      chapterId,
      bookRoot,
      politicsReview,
      contentReview,
      businessReview,
      overallScore: this._calculateOverallScore(politicsReview, contentReview, businessReview),
      issues: [
        ...politicsReview.issues,
        ...contentReview.issues,
        ...businessReview.issues
      ],
      suggestions: [
        ...politicsReview.suggestions,
        ...contentReview.suggestions,
        ...businessReview.suggestions
      ],
      passed: this._checkReviewPassed(politicsReview, contentReview, businessReview),
      reviewedAt: new Date().toISOString(),
      status: 'completed'
    };
    
    // 发布审校完成事件
    this.publishEvent('s4.review.completed', {
      chapterId,
      reviewResult
    });
    
    return reviewResult;
  }

  /**
   * 政治审校
   * @param {string} bookRoot - 书籍根目录
   * @param {string} chapterId - 章节ID
   * @returns {Promise<object>} - 审校结果
   */
  async _politicsReview(bookRoot, chapterId) {
    console.log(`[Review-Agent] Politics review for chapter: ${chapterId}`);
    
    // 模拟政治审校
    return {
      type: 'politics',
      score: 95,
      issues: [],
      suggestions: [],
      reviewedAt: new Date().toISOString()
    };
  }

  /**
   * 内容审校
   * @param {string} bookRoot - 书籍根目录
   * @param {string} chapterId - 章节ID
   * @param {object} s3Finalization - S3成稿
   * @returns {Promise<object>} - 审校结果
   */
  async _contentReview(bookRoot, chapterId, s3Finalization) {
    console.log(`[Review-Agent] Content review for chapter: ${chapterId}`);
    
    // 调用质量检查脚本
    const issues = await this._runQualityCheck(bookRoot, chapterId);
    
    // 分析内容质量
    const analysis = this._analyzeContentQuality(s3Finalization, issues);
    
    return {
      type: 'content',
      score: analysis.score,
      issues: issues.map(issue => ({
        type: issue.type,
        severity: issue.severity,
        location: issue.location,
        description: issue.description,
        suggestion: issue.suggestion
      })),
      suggestions: analysis.suggestions,
      metrics: analysis.metrics,
      reviewedAt: new Date().toISOString()
    };
  }

  /**
   * 商业审校
   * @param {string} bookRoot - 书籍根目录
   * @param {string} chapterId - 章节ID
   * @param {object} s3Finalization - S3成稿
   * @returns {Promise<object>} - 审校结果
   */
  async _businessReview(bookRoot, chapterId, s3Finalization) {
    console.log(`[Review-Agent] Business review for chapter: ${chapterId}`);
    
    // 模拟商业审校
    return {
      type: 'business',
      score: 90,
      issues: [],
      suggestions: [],
      reviewedAt: new Date().toISOString()
    };
  }

  /**
   * 运行质量检查
   * @param {string} bookRoot - 书籍根目录
   * @param {string} chapterId - 章节ID
   * @returns {Promise<array>} - 问题列表
   */
  async _runQualityCheck(bookRoot, chapterId) {
    console.log(`[Review-Agent] Running quality check for chapter: ${chapterId}`);
    
    // 这里可以调用现有的质量检查脚本
    // 如 quality-check.mjs, quality-S.md 等
    // 暂时返回模拟数据
    
    return [
      {
        type: 'format',
        severity: 'warning',
        location: 'line 10',
        description: '标题格式不一致',
        suggestion: '统一使用 # 作为一级标题'
      },
      {
        type: 'content',
        severity: 'info',
        location: 'line 50',
        description: '段落过长',
        suggestion: '建议拆分为多个短段落'
      }
    ];
  }

  /**
   * 分析内容质量
   * @param {object} s3Finalization - S3成稿
   * @param {array} issues - 问题列表
   * @returns {object} - 分析结果
   */
  _analyzeContentQuality(s3Finalization, issues) {
    // 计算分数
    const criticalIssues = issues.filter(i => i.severity === 'critical').length;
    const warningIssues = issues.filter(i => i.severity === 'warning').length;
    const infoIssues = issues.filter(i => i.severity === 'info').length;
    
    const score = Math.max(0, 100 - criticalIssues * 10 - warningIssues * 3 - infoIssues);
    
    // 生成建议
    const suggestions = [
      ...issues.filter(i => i.suggestion).map(i => i.suggestion)
    ];
    
    // 计算指标
    const metrics = {
      wordCount: s3Finalization?.metadata?.wordCount || 0,
      issueCount: issues.length,
      criticalCount: criticalIssues,
      warningCount: warningIssues,
      infoCount: infoIssues
    };
    
    return { score, suggestions, metrics };
  }

  /**
   * 计算综合评分
   */
  _calculateOverallScore(politics, content, business) {
    return Math.round((politics.score * 0.3 + content.score * 0.4 + business.score * 0.3));
  }

  /**
   * 检查审校是否通过
   */
  _checkReviewPassed(politics, content, business) {
    const minScore = 70;
    const maxCriticalIssues = 0;
    
    const hasCriticalIssues = [
      ...politics.issues,
      ...content.issues,
      ...business.issues
    ].some(issue => issue.severity === 'critical');
    
    return !hasCriticalIssues && 
           politics.score >= minScore && 
           content.score >= minScore && 
           business.score >= minScore;
  }
}
