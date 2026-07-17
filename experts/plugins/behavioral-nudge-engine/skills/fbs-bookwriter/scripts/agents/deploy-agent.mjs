#!/usr/bin/env node
/**
 * 部署智能体
 * 
 * 职责:
 * - S5 交付
 * - S6 转化
 * - 格式转换
 * - 交付物打包
 * - 宿主桥接
 */

import fs from 'fs';
import crypto from 'crypto';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { AgentBase } from './agent-base.mjs';
import { emitBridgeEvent, EVENT_TYPES } from '../host-bridge.mjs';
import { notifyBookEvent } from '../wecom/scene-pack-loader.mjs';
import { runFinalDraftStateMachine } from '../final-draft-state-machine.mjs';
import { createRelease, updateRelease, RELEASE_STATUS } from '../releases-registry.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SKILL_ROOT = path.join(__dirname, '..', '..');

function readSkillText(relativePath) {
  const targetPath = path.join(SKILL_ROOT, relativePath);
  if (!fs.existsSync(targetPath) || !fs.statSync(targetPath).isFile()) {
    return null;
  }
  return fs.readFileSync(targetPath, 'utf8');
}

function resolveDeliverablesDir(bookRoot) {

  return path.join(bookRoot, 'deliverables');
}

function resolveReleasesDir(bookRoot) {
  return path.join(bookRoot, 'releases');
}

function unwrapArtifactPath(artifact) {
  if (!artifact) return null;
  return typeof artifact === 'string' ? artifact : artifact.path || null;
}

function createPreviewConfig(targetPath, format) {
  if (!targetPath || format !== 'html') return null;
  return {
    mode: 'static-server',
    rootDir: path.dirname(targetPath),
    entry: path.basename(targetPath),
    route: `/${path.basename(targetPath)}`,
    host: '127.0.0.1',
  };
}

function createPresentationTarget({ path: targetPath, format, recommendedTool, label, channel, stage }) {
  if (!targetPath) return null;
  return {
    path: targetPath,
    format,
    recommendedTool,
    label,
    channel,
    stage,
    preview: createPreviewConfig(targetPath, format),
  };
}

function buildPresentationPlan({ stage, chapterId, chapterTitle, htmlPath, mdPath, packagePath, releaseManifestPath }) {
  const labelBase = chapterTitle || chapterId;
  const primary = createPresentationTarget(
    htmlPath
      ? {
          path: htmlPath,
          format: 'html',
          recommendedTool: 'preview_url',
          label: `${labelBase} HTML 交付物`,
          channel: 'deliverables',
          stage,
        }
      : mdPath
        ? {
            path: mdPath,
            format: 'md',
            recommendedTool: 'open_result_view',
            label: `${labelBase} Markdown 交付物`,
            channel: 'deliverables',
            stage,
          }
        : releaseManifestPath
          ? {
              path: releaseManifestPath,
              format: 'json',
              recommendedTool: 'open_result_view',
              label: `${labelBase} 发布清单`,
              channel: 'releases',
              stage,
            }
          : packagePath
            ? {
                path: packagePath,
                format: 'json',
                recommendedTool: 'open_result_view',
                label: `${labelBase} 交付包`,
                channel: 'deliverables',
                stage,
              }
            : null
  );

  const fallbacks = [
    createPresentationTarget({
      path: mdPath,
      format: 'md',
      recommendedTool: 'preview_url',
      label: `${labelBase} Markdown 交付物`,
      channel: 'deliverables',
      stage,
    }),

    createPresentationTarget({
      path: releaseManifestPath,
      format: 'json',
      recommendedTool: 'open_result_view',
      label: `${labelBase} 发布清单`,
      channel: 'releases',
      stage,
    }),
    createPresentationTarget({
      path: packagePath,
      format: 'json',
      recommendedTool: 'open_result_view',
      label: `${labelBase} 交付包`,
      channel: 'deliverables',
      stage,
    }),
  ].filter((target) => target && target.path !== primary?.path);

  return {
    primary,
    fallbacks,
    guidance: primary?.format === 'html'
      ? '优先展示 deliverables/ 下的 HTML 交付物，不要把 references/、SKILL.md 或 .fbs/ 内部文件当作最终结果打开。'
      : '缺少 HTML 时，再回退到 deliverables/ 或 releases/ 中的产物，仍不要打开 references/、SKILL.md 或 .fbs/ 内部文件。'
  };
}


export class DeployAgent extends AgentBase {
  constructor(config = {}) {
    super({
      agentId: 'deploy-agent',
      agentName: 'Deploy-Agent',
      agentType: 'specialist',
      capabilities: [
        's5-delivery',
        's6-transformation',
        'format-conversion',
        'delivery-packaging',
        'host-bridge'
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
    const { state } = task;

    switch (state) {
      case 'S5':
        return this._deliverChapter(task);
      case 'S6':
        return this._transformChapter(task);
      default:
        throw new Error(`DeployAgent does not support state: ${state}`);
    }
  }

  /**
   * 交付章节(S5)
   * @param {object} task - 任务对象
   * @returns {Promise<object>} - 交付结果
   */
  async _deliverChapter(task) {
    const { chapterId, payload = {} } = task;
    const { bookRoot } = payload;
    const reviewResult = this._resolveReviewResult(payload);

    console.log(`[Deploy-Agent] Delivering chapter: ${chapterId}`);

    if (!bookRoot) {
      throw new Error(`DeliverAgent missing bookRoot for chapter ${chapterId}`);
    }

    if (!reviewResult || !reviewResult.passed) {
      throw new Error(`Chapter ${chapterId} review failed, cannot deliver`);
    }

    const artifacts = await this._convertFormats(bookRoot, chapterId);
    const packageInfo = await this._packageArtifacts(bookRoot, chapterId, artifacts);
    await this._verifyArtifacts(bookRoot, chapterId, artifacts, packageInfo.path);
    await this._updateChapterIndex(bookRoot, chapterId);

    const deliveryReport = {
      chapterId,
      bookRoot,
      sourcePath: artifacts.md.sourcePath || artifacts.md.path,
      artifacts,
      deliveryDir: resolveDeliverablesDir(bookRoot),
      packagePath: packageInfo.path,
      checksum: packageInfo.checksum,
      deliveryFormat: ['md', 'html', 'package'],
      deliveredAt: new Date().toISOString(),
      status: 'completed',
      presentation: buildPresentationPlan({
        stage: 'S5',
        chapterId,
        htmlPath: artifacts.html.path,
        mdPath: artifacts.md.path,
        packagePath: packageInfo.path,
      })
    };

    emitBridgeEvent(bookRoot, EVENT_TYPES.STAGE_CHANGE, {
      stage: 'S5',
      chapterId,
      status: 'completed',
      summary: `${chapterId} 已完成交付`,
      artifacts: {
        md: artifacts.md.path,
        html: artifacts.html.path,
        package: packageInfo.path,
      },
      presentation: deliveryReport.presentation,
    });

    this.publishEvent('s5.delivery.completed', {
      chapterId,
      deliveryReport
    });

    return deliveryReport;
  }

  /**
   * 执行 S6 转化与发布映射
   * @param {object} task - 任务对象
   * @returns {Promise<object>} - 转化结果
   */
  async _transformChapter(task) {
    const { chapterId, payload = {} } = task;
    const { bookRoot } = payload;
    const deliveryReport = this._resolveDeliveryResult(payload);

    console.log(`[Deploy-Agent] Transforming chapter in S6: ${chapterId}`);

    if (!bookRoot) {
      throw new Error(`DeployAgent missing bookRoot for S6 chapter ${chapterId}`);
    }

    const source = this._resolveChapterSource(bookRoot, chapterId, deliveryReport?.sourcePath);
    const sourceContent = fs.readFileSync(source.path, 'utf8');
    const chapterTitle = this._deriveChapterTitle(sourceContent, source.path, chapterId);
    const generatedAt = new Date().toISOString();
    const fbsDir = path.join(bookRoot, '.fbs');
    fs.mkdirSync(fbsDir, { recursive: true });

    const contentUnitsPath = path.join(fbsDir, '[S6]-content-units.md');
    const roadmapPath = path.join(fbsDir, '[S6]-product-roadmap.md');
    const releaseMapPath = path.join(fbsDir, '[S6]-release-map.md');
    const sessionsSummaryPath = path.join(fbsDir, 'sessions-summary.md');
    const storyBankPath = path.join(fbsDir, 'story-bank.md');

    const contentUnits = this._buildContentUnits(chapterTitle, sourceContent);
    const roadmap = this._buildRoadmap(chapterTitle, sourceContent);
    const contentUnitsSection = this._renderContentUnitsSection(chapterId, chapterTitle, generatedAt, source.path, contentUnits);
    const roadmapSection = this._renderRoadmapSection(chapterId, chapterTitle, generatedAt, roadmap);
    const releaseRows = this._buildReleaseRows(chapterTitle);

    this._appendMarkdownSection(
      contentUnitsPath,
      '# S6 传播内容单元\n\n> 由 Deploy-Agent 在 S6 阶段自动追加生成。\n',
      contentUnitsSection
    );
    this._appendMarkdownSection(
      roadmapPath,
      '# S6 知识产品转化路线图\n\n> 由 Deploy-Agent 在 S6 阶段自动追加生成。\n',
      roadmapSection
    );
    this._appendReleaseMap(releaseMapPath, chapterId, generatedAt, releaseRows);

    this._appendStoryBankSummary(storyBankPath, chapterId, chapterTitle, generatedAt);
    this._appendSessionsSummary(sessionsSummaryPath, chapterId, chapterTitle, generatedAt, releaseRows);
    const { releaseDir, releaseManifestPath } = this._writeReleaseManifest({
      bookRoot,
      chapterId,
      chapterTitle,
      generatedAt,
      deliveryReport,
      releaseRows,
      contentUnitsPath,
      roadmapPath,
      releaseMapPath,
      storyBankPath,
      sessionsSummaryPath,
    });
    const governance = this._syncReleaseGovernance({
      bookRoot,
      chapterTitle,
      chapterId,
      generatedAt,
      releaseManifestPath,
      deliveryReport,
    });


    this._notifyRewardEvent(bookRoot, 's6_transform', { title: chapterTitle });
    this._notifyRewardEvent(bookRoot, 'release_ready', { title: chapterTitle });

    const transformationReport = {
      chapterId,
      bookRoot,
      chapterTitle,
      sourcePath: source.path,
      generatedAt,
      releaseDir,
      releaseState: '待发布',
      contentUnitsCount: contentUnits.length,
      roadmapCount: roadmap.length,
      releaseCount: releaseRows.length,
      artifacts: {
        contentUnitsPath,
        roadmapPath,
        releaseMapPath,
        releaseManifestPath,
        storyBankPath,
        sessionsSummaryPath,
      },
      governance,


      status: 'completed',
      presentation: buildPresentationPlan({
        stage: 'S6',
        chapterId,
        chapterTitle,
        htmlPath: unwrapArtifactPath(deliveryReport?.artifacts?.html),
        mdPath: unwrapArtifactPath(deliveryReport?.artifacts?.md),
        packagePath: deliveryReport?.packagePath,
        releaseManifestPath,
      })
    };

    emitBridgeEvent(bookRoot, EVENT_TYPES.S6_TRANSFORMATION, {
      stage: 'S6',
      chapterId,
      chapterTitle,
      summary: `${chapterTitle} 已完成 S6 转化`,
      artifacts: transformationReport.artifacts,
      presentation: transformationReport.presentation,
    });

    emitBridgeEvent(bookRoot, EVENT_TYPES.RELEASE_STATE, {
      chapterId,
      chapterTitle,
      state: '待发布',
      summary: `${chapterTitle} 已写入发布映射`,
      assets: releaseRows.map(row => row.asset),
      governance,
      presentation: transformationReport.presentation,
    });

    this.publishEvent('s6.transformation.completed', {
      chapterId,
      transformationReport
    });

    // 保留旧事件名作为兼容别名，避免旧监听器完全失效。
    this.publishEvent('s6.archive.completed', {
      chapterId,
      archiveReport: transformationReport,
      legacyAlias: true,
    });

    return transformationReport;
  }

  /**
   * 格式转换
   * @param {string} bookRoot - 书籍根目录
   * @param {string} chapterId - 章节ID
   * @returns {Promise<object>} - 转换结果
   */
  async _convertFormats(bookRoot, chapterId) {
    console.log(`[Deploy-Agent] Converting formats for chapter: ${chapterId}`);

    const artifacts = {};
    artifacts.md = await this._convertToMD(bookRoot, chapterId);
    artifacts.html = await this._convertToHTML(bookRoot, chapterId);

    return artifacts;
  }

  /**
   * 转换为 MD 格式（复制到独立交付目录）
   */
  async _convertToMD(bookRoot, chapterId) {
    const source = this._resolveChapterSource(bookRoot, chapterId);
    const deliverDir = resolveDeliverablesDir(bookRoot);
    const mdPath = path.join(deliverDir, `${chapterId}.md`);
    fs.mkdirSync(deliverDir, { recursive: true });
    fs.copyFileSync(source.path, mdPath);

    return {
      format: 'md',
      path: mdPath,
      sourcePath: source.path,
      size: fs.statSync(mdPath).size
    };
  }


  /**
   * 转换为 HTML 格式（本地最小可读版）
   */
  async _convertToHTML(bookRoot, chapterId) {
    const source = this._resolveChapterSource(bookRoot, chapterId);
    const deliverDir = resolveDeliverablesDir(bookRoot);
    const htmlPath = path.join(deliverDir, `${chapterId}.html`);
    fs.mkdirSync(deliverDir, { recursive: true });

    const markdown = fs.readFileSync(source.path, 'utf8');
    const title = this._deriveChapterTitle(markdown, source.path, chapterId);

    let body = '';
    try {
      const MarkdownIt = (await import('markdown-it')).default;
      const md = new MarkdownIt({ html: true, linkify: true, typographer: true });
      try {
        const footnoteMod = await import('markdown-it-footnote');
        const footnotePlugin = footnoteMod.default || footnoteMod;
        if (footnotePlugin) md.use(footnotePlugin);
      } catch {}
      body = md.render(markdown);
    } catch {
      body = markdown
        .split(/\r?\n/)
        .map(line => {
          if (!line.trim()) return '';
          if (/^###\s+/.test(line)) return `<h3>${this._escapeHtml(line.replace(/^###\s+/, ''))}</h3>`;
          if (/^##\s+/.test(line)) return `<h2>${this._escapeHtml(line.replace(/^##\s+/, ''))}</h2>`;
          if (/^#\s+/.test(line)) return `<h1>${this._escapeHtml(line.replace(/^#\s+/, ''))}</h1>`;
          return `<p>${this._escapeHtml(line)}</p>`;
        })
        .filter(Boolean)
        .join('\n');
    }

    const sharedCss = readSkillText(path.join('assets', 'style.css')) || '';
    const shellCss = `
      :root { color-scheme: light; }
      body.fbs-deliverable-preview {
        margin: 0;
        padding: 32px 16px 64px;
        background: #f6f8fb;
      }
      .fbs-deliverable-preview .page {
        max-width: 920px;
        margin: 0 auto;
        background: #fff;
        border-radius: 18px;
        box-shadow: 0 18px 48px rgba(15, 58, 110, 0.10);
        padding: 48px 56px;
      }
      .fbs-deliverable-preview h1:first-of-type {
        page-break-before: auto;
      }
      @media (max-width: 768px) {
        body.fbs-deliverable-preview {
          padding: 16px 10px 32px;
        }
        .fbs-deliverable-preview .page {
          padding: 28px 20px;
          border-radius: 12px;
        }
      }
    `;

    const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="generator" content="FBS DeployAgent enhanced-html" />
  <title>${this._escapeHtml(title)}</title>
  <style>${sharedCss}
${shellCss}</style>
</head>
<body class="fbs-deliverable-preview">
  <main class="page">
${body}
  </main>
</body>
</html>
`;

    fs.writeFileSync(htmlPath, html, 'utf8');

    return {
      format: 'html',
      path: htmlPath,
      size: fs.statSync(htmlPath).size
    };
  }


  /**
   * 打包交付物
   */
  async _packageArtifacts(bookRoot, chapterId, artifacts) {
    const deliverDir = resolveDeliverablesDir(bookRoot);
    const packagePath = path.join(deliverDir, `${chapterId}-package.json`);
    fs.mkdirSync(deliverDir, { recursive: true });

    const checksum = this._calculateChecksum(artifacts);
    const packageInfo = {
      chapterId,
      version: Date.now(),
      artifacts,
      checksum,
      packagedAt: new Date().toISOString()
    };

    fs.writeFileSync(packagePath, JSON.stringify(packageInfo, null, 2) + '\n', 'utf8');
    console.log(`[Deploy-Agent] Packaged artifacts: ${packagePath}`);

    return { path: packagePath, checksum };
  }

  /**
   * 验证交付物
   */
  async _verifyArtifacts(bookRoot, chapterId, artifacts, packagePath) {
    console.log(`[Deploy-Agent] Verifying artifacts for chapter: ${chapterId}`);

    const requiredFiles = [artifacts?.md?.path, artifacts?.html?.path, packagePath].filter(Boolean);
    for (const filePath of requiredFiles) {
      if (!fs.existsSync(filePath)) {
        throw new Error(`Artifacts verification failed: missing file ${filePath}`);
      }
      const size = fs.statSync(filePath).size;
      if (size <= 0) {
        throw new Error(`Artifacts verification failed: empty file ${filePath}`);
      }
    }

    return true;
  }

  /**
   * 更新章节索引
   */
  async _updateChapterIndex(bookRoot, chapterId) {
    console.log(`[Deploy-Agent] Updating chapter index: ${chapterId}`);

    const scriptPath = path.join(__dirname, '..', 'sync-book-chapter-index.mjs');
    if (!fs.existsSync(scriptPath)) {
      return;
    }

    return new Promise((resolve) => {
      const args = ['--book-root', bookRoot];

      const child = spawn(process.execPath, [scriptPath, ...args], {
        stdio: 'ignore'
      });

      child.on('close', (code) => {
        if (code === 0) {
          console.log(`[Deploy-Agent] Chapter index updated: ${chapterId}`);
        } else {
          console.warn(`[Deploy-Agent] Chapter index update failed with exit code ${code ?? 'unknown'}, continuing...`);
        }
        resolve();
      });


      child.on('error', (error) => {
        console.warn(`[Deploy-Agent] Index update error: ${error.message}`);
        resolve();
      });
    });
  }

  _resolveReviewResult(payload) {
    return payload.s4Review ?? payload.S4 ?? payload.reviewResult ?? null;
  }

  _resolveDeliveryResult(payload) {
    return payload.s5Delivery ?? payload.S5 ?? payload.deliveryReport ?? null;
  }

  _resolveChapterSource(bookRoot, chapterId, explicitPath = null) {
    const tryPaths = [];
    if (explicitPath) tryPaths.push(explicitPath);
    tryPaths.push(path.join(bookRoot, '.fbs', 'chapters', `${chapterId}.md`));

    for (const candidate of tryPaths) {
      if (candidate && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return { path: candidate };
      }
    }

    const digitToken = this._extractChapterDigits(chapterId);
    const searchDirs = [bookRoot, path.join(bookRoot, 'chapters'), path.join(bookRoot, '.fbs', 'chapters')]
      .filter(dir => fs.existsSync(dir) && fs.statSync(dir).isDirectory());

    const matches = [];
    for (const dir of searchDirs) {
      for (const name of fs.readdirSync(dir)) {
        if (!name.endsWith('.md')) continue;
        const fullPath = path.join(dir, name);
        if (!fs.statSync(fullPath).isFile()) continue;
        const lower = name.toLowerCase();
        if (lower.includes(String(chapterId).toLowerCase())) {
          matches.push(fullPath);
          continue;
        }
        if (digitToken && new RegExp(`\\[S3-Ch0*${parseInt(digitToken, 10)}\\]`, 'i').test(name)) {
          matches.push(fullPath);
        }
      }
    }

    if (matches.length > 0) {
      return { path: matches[0] };
    }

    throw new Error(`Chapter source not found for ${chapterId}`);
  }

  _extractChapterDigits(chapterId) {
    const match = String(chapterId || '').match(/(\d+)/);
    return match ? match[1].padStart(2, '0') : null;
  }

  _deriveChapterTitle(content, filePath, chapterId) {
    const heading = content.match(/^#\s+(.+)$/m)?.[1]?.trim();
    if (heading) return heading;
    const name = path.basename(filePath, '.md');
    return name || `章节 ${chapterId}`;
  }

  _buildContentUnits(chapterTitle, sourceContent) {
    const paragraphs = this._extractParagraphs(sourceContent);
    const firstSentence = this._extractFirstSentence(sourceContent);

    return [
      {
        title: `${chapterTitle}·核心观点`,
        dimension: '反常识论断',
        content: paragraphs[0] || firstSentence || `${chapterTitle} 提炼出的核心观点。`,
        primaryChannel: '公众号',
        secondaryChannel: '知乎',
      },
      {
        title: `${chapterTitle}·方法框架`,
        dimension: '方法论框架',
        content: paragraphs[1] || paragraphs[0] || `${chapterTitle} 可抽取为课程化或白皮书化的方法框架。`,
        primaryChannel: '课程/内训',
        secondaryChannel: '知识星球',
      },
      {
        title: `${chapterTitle}·关键金句`,
        dimension: '金句',
        content: firstSentence || paragraphs[0] || `${chapterTitle} 的一句核心表达。`,
        primaryChannel: '社媒海报',
        secondaryChannel: '朋友圈/社群',
      }
    ];
  }

  _buildRoadmap(chapterTitle, sourceContent) {
    const summary = this._extractParagraphs(sourceContent)[0] || `${chapterTitle} 的方法与案例可继续深化。`;
    return [
      {
        type: '公开课模块',
        title: `${chapterTitle}·公开课单元`,
        priority: '立即可做',
        effort: '2-4 天',
        value: summary,
      },
      {
        type: '白皮书/行业报告',
        title: `${chapterTitle}·专题白皮书`,
        priority: '短期规划',
        effort: '1-2 周',
        value: `围绕 ${chapterTitle} 衍生为可复用的行业输出。`,
      },
      {
        type: '场景包来源',
        title: `${chapterTitle}·规则沉淀`,
        priority: '中期规划',
        effort: '1 周',
        value: `把 ${chapterTitle} 的判断标准转成场景包规则。`,
      }
    ];
  }

  _buildReleaseRows(chapterTitle) {
    return [
      {
        asset: `${chapterTitle}·传播单元`,
        source: '[S6]-content-units.md',
        stage: '待发布',
        channel: '公众号 / 知乎 / 社群',
        feedback: '待收集',
        risk: '发布前需人工复核事实口径',
        rollback: '如反馈集中则回转化区',
      },
      {
        asset: `${chapterTitle}·转化路线图`,
        source: '[S6]-product-roadmap.md',
        stage: '待发布',
        channel: '课程 / 白皮书 / 内训',
        feedback: '待验证转化意愿',
        risk: '需结合真实业务场景再细化',
        rollback: '如目标不清则回写作区补强',
      }
    ];
  }

  _renderContentUnitsSection(chapterId, chapterTitle, generatedAt, sourcePath, units) {
    const blocks = units.map((unit, index) => `## ${chapterId.toUpperCase()} · 单元 ${String(index + 1).padStart(2, '0')}：${unit.title}

**维度**：${unit.dimension}  
**来源章节**：${chapterTitle}  
**来源文件**：${sourcePath}  
**核心内容**：

${unit.content}

**传播建议**：
- 首选平台：${unit.primaryChannel}
- 次选平台：${unit.secondaryChannel}
- 注意事项：发布前复核事实、口径与引用边界。
`).join('\n---\n\n');

    return `\n## [${generatedAt.slice(0, 10)}] ${chapterTitle}（${chapterId}）\n\n> 生成时间：${generatedAt}\n> 来源文件：${sourcePath}\n\n${blocks}\n`;
  }

  _renderRoadmapSection(chapterId, chapterTitle, generatedAt, roadmap) {
    const lines = roadmap.map(item => `### ${item.type} · ${item.title}

- **优先级**：${item.priority}
- **预计工时**：${item.effort}
- **价值说明**：${item.value}
`).join('\n');

    return `\n## [${generatedAt.slice(0, 10)}] ${chapterTitle}（${chapterId}）\n\n> 生成时间：${generatedAt}\n> 章节转化路线图自动补录。\n\n${lines}`;
  }

  _writeReleaseManifest({
    bookRoot,
    chapterId,
    chapterTitle,
    generatedAt,
    deliveryReport,
    releaseRows,
    contentUnitsPath,
    roadmapPath,
    releaseMapPath,
    storyBankPath,
    sessionsSummaryPath,
  }) {

    const releaseDir = resolveReleasesDir(bookRoot);
    const releaseManifestPath = path.join(releaseDir, `${chapterId}-release.json`);
    fs.mkdirSync(releaseDir, { recursive: true });

    const releaseManifest = {
      chapterId,
      chapterTitle,
      generatedAt,
      state: '待发布',
      sourcePath: deliveryReport?.sourcePath || null,
      deliveryDir: deliveryReport?.deliveryDir || resolveDeliverablesDir(bookRoot),
      deliverables: {
        md: deliveryReport?.artifacts?.md?.path || null,
        html: deliveryReport?.artifacts?.html?.path || null,
        package: deliveryReport?.packagePath || null,
      },
      transformationArtifacts: {
        contentUnitsPath,
        roadmapPath,
        releaseMapPath,
        storyBankPath,
        sessionsSummaryPath,
      },

      entries: releaseRows.map(row => ({
        asset: row.asset,
        source: row.source,
        state: row.stage,
        channel: row.channel,
        feedback: row.feedback,
        risk: row.risk,
        rollback: row.rollback,
      })),
    };

    fs.writeFileSync(releaseManifestPath, JSON.stringify(releaseManifest, null, 2) + '\n', 'utf8');

    return {
      releaseDir,
      releaseManifestPath,
    };
  }

  _syncReleaseGovernance({ bookRoot, chapterTitle, chapterId, generatedAt, releaseManifestPath, deliveryReport }) {
    let releaseId = null;
    let releaseStatus = null;
    try {
      const version = generatedAt.slice(0, 10).replace(/-/g, '.');
      const release = createRelease(bookRoot, {
        title: chapterTitle || chapterId,
        version,
        description: `S6 自动登记：${chapterId}`,
        status: RELEASE_STATUS.DRAFT,
        channel: 'auto-s6',
        deliverablePaths: [
          releaseManifestPath,
          deliveryReport?.artifacts?.md?.path,
          deliveryReport?.artifacts?.html?.path,
        ].filter(Boolean),
        meta: { source: 'deploy-agent', chapterId },
      });
      const staged = updateRelease(bookRoot, release.id, { status: RELEASE_STATUS.STAGED });
      releaseId = staged?.id || release?.id || null;
      releaseStatus = staged?.status || release?.status || null;
    } catch {
      // ignore registry write failures
    }

    const state = runFinalDraftStateMachine({
      bookRoot,
      action: 'transition',
      to: 'candidate',
      artifact: releaseManifestPath,
      reason: `S6 自动挂载发布候选（${chapterId}）`,
      actor: 'deploy-agent',
      force: false,
    });

    return {
      releaseId,
      releaseStatus,
      finalDraftCode: state?.code ?? null,
      finalDraftState: state?.state?.currentState || null,
      finalDraftMessage: state?.message || null,
      finalDraftStatePath: state?.statePath || null,
    };
  }

  _appendReleaseMap(filePath, chapterId, generatedAt, rows) {
    const header = '# S6 发布映射\n\n> 由 Deploy-Agent 在 S6 阶段自动追加生成。\n\n| 资产 | 来源文件 | 发布阶段 | 目标渠道 | 反馈信号 | 风险提示 | 回流动作 |\n|------|----------|----------|----------|----------|----------|----------|\n';
    this._ensureFileWithHeader(filePath, header);

    const rowLines = rows
      .map(row => `| ${row.asset}（${chapterId}） | ${row.source} | ${row.stage} | ${row.channel} | ${row.feedback} | ${row.risk} | ${row.rollback} |`)
      .join('\n');

    fs.appendFileSync(filePath, `\n<!-- ${generatedAt} / ${chapterId} -->\n${rowLines}\n`, 'utf8');
  }






  _appendSessionsSummary(filePath, chapterId, chapterTitle, generatedAt, releaseRows) {
    const header = '# 会议纪要汇总（.fbs/sessions-summary.md）\n\n> 由执行链自动追加关键阶段决策摘要。\n';
    this._ensureFileWithHeader(filePath, header);

    const releaseLines = releaseRows
      .map((row) => `- ${row.asset}：${row.stage}（${row.channel}）`)
      .join('\n');

    const section = `\n## [${generatedAt.slice(0, 10)}] S6 知识产品转化 · ${chapterTitle}\n\n- 章节：${chapterId}\n- 状态：已完成 S6 转化，并同步写入发布映射与发布清单。\n- 下一步：优先人工复核事实口径、引用边界与外部发布场景。\n\n### 本轮产出\n- 更新 .fbs/story-bank.md 的归档摘要\n- 追加 .fbs/[S6]-content-units.md\n- 追加 .fbs/[S6]-product-roadmap.md\n- 追加 .fbs/[S6]-release-map.md\n- 生成 releases/${chapterId}-release.json\n\n### 发布准备\n${releaseLines}\n`;

    fs.appendFileSync(filePath, `${section}\n`, 'utf8');
  }

  _appendStoryBankSummary(filePath, chapterId, chapterTitle, generatedAt) {
    const header = '# 故事库（.fbs/story-bank.md）\n\n> 由执行链自动追加 S6 归档摘要。\n';
    this._ensureFileWithHeader(filePath, header);

    const section = `\n## [${generatedAt.slice(0, 10)}] S6 归档摘要 · ${chapterTitle}\n\n- 章节：${chapterId}\n- 状态：已完成 S6 转化，建议人工补充“已用 / 未用保留 / 弃置”细分标记。\n`;
    fs.appendFileSync(filePath, `${section}\n`, 'utf8');
  }


  _appendMarkdownSection(filePath, header, section) {
    this._ensureFileWithHeader(filePath, header);
    fs.appendFileSync(filePath, `${section.trim()}\n\n`, 'utf8');
  }

  _ensureFileWithHeader(filePath, header) {
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, `${header.trim()}\n\n`, 'utf8');
    }
  }

  _extractParagraphs(content) {
    return content
      .replace(/^#{1,6}\s+/gm, '')
      .split(/\n\s*\n/)
      .map(part => part.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .slice(0, 6);
  }

  _extractFirstSentence(content) {
    const sentence = content
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/\r?\n/g, ' ')
      .match(/[^。！？!?]{8,120}[。！？!?]?/);
    return sentence ? sentence[0].trim() : '';
  }

  _notifyRewardEvent(bookRoot, event, opts) {
    if (process.env.FBS_DISABLE_REWARD_EVENTS === '1') {
      return;
    }
    try {
      notifyBookEvent(bookRoot, event, opts);
    } catch {}
  }

  _escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * 计算校验和
   */
  _calculateChecksum(artifacts) {
    return crypto
      .createHash('sha1')
      .update(JSON.stringify(artifacts))
      .digest('hex');
  }
}
