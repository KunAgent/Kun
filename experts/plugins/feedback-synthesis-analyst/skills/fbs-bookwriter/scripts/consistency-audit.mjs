#!/usr/bin/env node
/**
 * FBS-BookWriter 文档承诺与代码落地一致性审计工具
 * 
 * 目标：确保文档中承诺的功能在代码中有对应实现
 * 
 * 审计范围：
 * 1. SKILL.md 功能承诺 vs 实际代码实现
 * 2. search-policy.json 配置 vs 脚本行为
 * 3. NLU 意图定义 vs 触发词实现
 * 4. 智能记忆配置 vs 实际功能
 * 5. 版本号一致性检查
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * 一致性审计结果
 */
const auditResults = {
  passed: 0,
  failed: 0,
  warnings: 0,
  issues: []
};

/**
 * 审计报告生成器
 */
export class ConsistencyAuditor {
  constructor(projectRoot = path.resolve(__dirname, '..')) {
    this.projectRoot = projectRoot;
    this.results = {
      versionConsistency: [],
      featureImplementation: [],
      nluConsistency: [],
      configConsistency: [],
      codeQuality: []
    };
  }
  
  /**
   * 运行完整审计
   */
  async runFullAudit() {
    console.log('═════════════════════════════════════');
    console.log(' FBS-BookWriter 一致性审计');
    console.log('═════════════════════════════════════\n');
    
    await this.auditVersionConsistency();
    await this.auditFeatureImplementation();
    await this.auditNLUConsistency();
    await this.auditConfigConsistency();
    await this.auditCodeQuality();
    
    this.generateReport();
    return auditResults.failed;
  }
  
  /**
   * 审计版本号一致性
   */
  async auditVersionConsistency() {
    console.log('[审计] 版本号一致性检查...\n');
    
    const versionSources = {
      packageJson: this._extractVersionFromPackageJson(),
      skillMd: this._extractVersionFromSkillMd(),
      versionMjs: this._extractVersionFromVersionMjs(),
      pluginMeta: this._extractVersionFromPluginMeta()
    };
    
    console.log('检测到的版本号:');
    for (const [source, version] of Object.entries(versionSources)) {
      const status = version ? `✅ ${version}` : '❌ 未找到';
      console.log(`  ${this._padRight(source, 20)}: ${status}`);
      
      if (version) {
        this.results.versionConsistency.push({
          source,
          version,
          status: 'detected'
        });
      }
    }
    
    // 检查一致性
    const versions = Object.values(versionSources).filter(v => v);
    const uniqueVersions = [...new Set(versions)];
    
    if (uniqueVersions.length === 1) {
      console.log(`\n✅ 版本号一致: ${uniqueVersions[0]}`);
      auditResults.passed++;
      const docsCheck = this._checkCoreDocVersionConsistency(uniqueVersions[0]);
      if (docsCheck.ok) {
        console.log(`✅ 核心文档版本一致（references/01-core，抽样 ${docsCheck.checkedCount}）`);
        auditResults.passed++;
      } else {
        console.log(`❌ 核心文档版本不一致：${docsCheck.reason}`);
        auditResults.failed++;
        auditResults.issues.push({ type: 'core_doc_version_mismatch', reason: docsCheck.reason });
      }
    } else {
      console.log(`\n❌ 版本号不一致: ${uniqueVersions.join(', ')}`);
      auditResults.failed++;
      this.results.versionConsistency.push({
        type: 'inconsistency',
        versions: uniqueVersions
      });
    }
    
    console.log('');
  }

  _checkCoreDocVersionConsistency(expectedVersion) {
    const coreDir = path.join(this.projectRoot, 'references/01-core');
    const files = [
      'skill-index.md',
      'intake-and-routing.md',
      'skill-full-spec.md',
      'section-nlu.md',
      'session-protocols.md',
      's3-expansion-phase.md',
      's3-refinement-phase.md',
      'runtime-mandatory-contract.md',
      'skill-cli-bridge-matrix.md',
      'memory-layer-matrix.md',
    ];
    try {
      const mismatches = [];
      let checkedCount = 0;
      for (const file of files) {
        const p = path.join(coreDir, file);
        if (!fs.existsSync(p)) continue;
        const content = fs.readFileSync(p, 'utf8');
        checkedCount++;
        const m = content.match(/> \*\*版本\*\*：([^\r\n]+)/);
        if (!m) continue;
        const semver = String(m[1]).match(/\d+\.\d+\.\d+/)?.[0] || '';
        if (!semver || semver !== String(expectedVersion).trim()) {
          mismatches.push(`${file}:${m[1]}`);
        }
      }
      if (mismatches.length > 0) {
        return { ok: false, checkedCount, reason: mismatches.join(', ') };
      }
      return { ok: true, checkedCount };
    } catch (e) {
      return { ok: false, checkedCount: 0, reason: String(e?.message || e) };
    }
  }
  
  /**
   * 审计功能实现一致性
   */
  async auditFeatureImplementation() {
    console.log('[审计] 功能实现一致性检查...\n');
    
    // 从 SKILL.md 提取承诺的功能
    const promisedFeatures = this._extractPromisedFeatures();
    console.log(`从 SKILL.md 提取了 ${promisedFeatures.length} 个功能承诺\n`);
    
    // 检查每个功能的实现情况
    for (const feature of promisedFeatures) {
      const implementation = await this._checkFeatureImplementation(feature);
      
      this.results.featureImplementation.push(implementation);
      
      const status = implementation.found ? '✅' : '❌';
      const detail = implementation.found 
        ? `已实现 (${implementation.location})`
        : `未找到实现`;
      
      console.log(`  ${status} ${feature.name}`);
      console.log(`      ${detail}\n`);
      
      if (implementation.found) {
        auditResults.passed++;
      } else {
        auditResults.failed++;
        auditResults.issues.push({
          type: 'missing_implementation',
          feature: feature.name,
          reference: feature.reference
        });
      }
    }
  }
  
  /**
   * 审计 NLU 一致性
   */
  async auditNLUConsistency() {
    console.log('[审计] NLU 意图一致性检查...\n');
    
    // 从 section-nlu.md 提取意图定义
    const definedIntents = this._extractDefinedIntents();
    console.log(`从 section-nlu.md 提取了 ${definedIntents.length} 个意图\n`);
    
    // 从代码中检查触发词实现
    for (const intent of definedIntents) {
      const implementation = await this._checkIntentImplementation(intent);
      
      this.results.nluConsistency.push(implementation);
      
      const status = implementation.found ? '✅' : '❌';
      const detail = implementation.found
        ? `已实现 (${implementation.triggersCount} 个触发词)`
        : `未找到实现`;
      
      console.log(`  ${status} ${intent.id}`);
      console.log(`      ${detail}\n`);
      
      if (implementation.found) {
        auditResults.passed++;
      } else {
        auditResults.failed++;
        auditResults.issues.push({
          type: 'missing_intent_implementation',
          intent: intent.id,
          triggers: intent.triggers
        });
      }
    }
  }
  
  /**
   * 审计配置一致性
   */
  async auditConfigConsistency() {
    console.log('[审计] 配置一致性检查...\n');
    
    // 检查 search-policy.json 中的配置是否被使用
    const configCheck = await this._checkSearchPolicyConsistency();
    
    this.results.configConsistency.push(configCheck);
    
    console.log(`✅ search-policy.json: ${configCheck.usedConfigs}/${configCheck.totalConfigs} 个配置被使用\n`);
    auditResults.passed++;
    
    // 检查智能记忆配置
    const smartMemoryCheck = await this._checkSmartMemoryConsistency();
    
    this.results.configConsistency.push(smartMemoryCheck);
    
    if (smartMemoryCheck.consistent) {
      console.log('✅ 智能记忆配置: 一致\n');
      auditResults.passed++;
    } else {
      console.log('❌ 智能记忆配置: 不一致\n');
      console.log(`   问题: ${smartMemoryCheck.issues.join(', ')}\n`);
      auditResults.failed++;
    }

    const intentCanonicalCheck = this._checkIntentCanonicalConsistency();
    this.results.configConsistency.push(intentCanonicalCheck);
    if (intentCanonicalCheck.ok) {
      console.log(`✅ 意图单真源: 一致（${intentCanonicalCheck.intentCount} intents）\n`);
      auditResults.passed++;
    } else {
      console.log(`❌ 意图单真源检查失败: ${intentCanonicalCheck.reason}\n`);
      auditResults.failed++;
      auditResults.issues.push({ type: 'intent_canonical', reason: intentCanonicalCheck.reason });
    }
  }
  
  /**
   * 审计代码质量
   */
  async auditCodeQuality() {
    console.log('[审计] 代码质量检查...\n');
    
    // 检查 TODO, FIXME, HACK 等标记
    const codeMarkers = await this._checkCodeMarkers();
    
    this.results.codeQuality.push(codeMarkers);
    
    console.log(`检测到待处理标记:`);
    console.log(`  TODO: ${codeMarkers.todoCount} 个`);
    console.log(`  FIXME: ${codeMarkers.fixmeCount} 个`);
    console.log(`  HACK: ${codeMarkers.hackCount} 个`);
    console.log(`  DEPRECATED: ${codeMarkers.deprecatedCount} 个\n`);
    
    if (codeMarkers.totalMarkers === 0) {
      console.log('✅ 没有发现待处理标记\n');
      auditResults.passed++;
    } else {
      console.log(`⚠️  发现 ${codeMarkers.totalMarkers} 个待处理标记\n`);
      auditResults.warnings++;
      
      for (const marker of codeMarkers.markers) {
        auditResults.issues.push({
          type: 'code_marker',
          marker: marker.type,
          file: marker.file,
          line: marker.line
        });
      }
    }
    
    // 检查编码问题
    const encodingCheck = await this._checkFileEncoding();
    
    console.log(`编码问题: ${encodingCheck.issues.length} 个文件\n`);
    
    if (encodingCheck.issues.length === 0) {
      console.log('✅ 没有发现编码问题\n');
      auditResults.passed++;
    } else {
      console.log('⚠️  以下文件可能存在编码问题:');
      for (const issue of encodingCheck.issues) {
        console.log(`  - ${issue.file}\n`);
      }
      auditResults.warnings++;
    }

    const lex = await this._auditS2LexiconSync();
    if (lex.ok) {
      console.log(`✅ S2 机读词表与脚本引用一致（${lex.lexiconPath}）\n`);
      auditResults.passed++;
    } else {
      console.log(`❌ S2 机读词表检查失败: ${lex.reason}\n`);
      auditResults.failed++;
      auditResults.issues.push({ type: 's2_lexicon', reason: lex.reason });
    }

    const imp = this._auditImperativeLexiconMatchQualityS();
    if (imp.ok) {
      console.log('✅ quality-S 绝对化命令词列举与 s2-imperative-lexicon.json 集合一致\n');
      auditResults.passed++;
    } else {
      console.log(`❌ A 类词集合校验失败: ${imp.reason}\n`);
      auditResults.failed++;
      auditResults.issues.push({ type: 'imperative_lexicon_mismatch', reason: imp.reason });
    }
  }

  _auditImperativeLexiconMatchQualityS() {
    const qsPath = path.join(this.projectRoot, 'references/02-quality/quality-S.md');
    const lexPath = path.join(this.projectRoot, 'references/02-quality/s2-imperative-lexicon.json');
    try {
      const qs = fs.readFileSync(qsPath, 'utf8');
      const m = qs.match(/绝对化命令词[^：\n]*[：:]\s*([^\n。]+)/);
      if (!m) return { ok: false, reason: '未在 quality-S.md 中匹配到「绝对化命令词」行' };
      const fromDoc = [...new Set(m[1].split(/[、，,\s]+/).map((s) => s.trim()).filter(Boolean))];
      const json = JSON.parse(fs.readFileSync(lexPath, 'utf8'));
      const fromJson = Array.isArray(json.terms) ? [...json.terms] : [];
      if (fromDoc.length !== fromJson.length) {
        return { ok: false, reason: `词条数量不一致: quality-S=${fromDoc.length} JSON=${fromJson.length}` };
      }
      const setOk = fromDoc.every((t) => fromJson.includes(t)) && fromJson.every((t) => fromDoc.includes(t));
      if (!setOk) {
        return { ok: false, reason: `词条集合不一致: doc=[${fromDoc.sort().join('、')}] json=[${[...fromJson].sort().join('、')}]` };
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: String(e?.message || e) };
    }
  }

  _auditS2LexiconSync() {
    const lexiconPath = path.join(this.projectRoot, 'references/02-quality/s2-quality-machine-lexicon.json');
    const imperativePath = path.join(this.projectRoot, 'references/02-quality/s2-imperative-lexicon.json');
    const loaderPath = path.join(this.projectRoot, 'scripts/lib/s2-quality-lexicon.mjs');
    const auditorPath = path.join(this.projectRoot, 'scripts/quality-auditor.mjs');
    try {
      if (!fs.existsSync(lexiconPath)) return { ok: false, reason: '缺少 s2-quality-machine-lexicon.json', lexiconPath };
      JSON.parse(fs.readFileSync(lexiconPath, 'utf8'));
      if (!fs.existsSync(imperativePath)) return { ok: false, reason: '缺少 s2-imperative-lexicon.json', lexiconPath };
      JSON.parse(fs.readFileSync(imperativePath, 'utf8'));
      if (!fs.existsSync(loaderPath)) return { ok: false, reason: '缺少 scripts/lib/s2-quality-lexicon.mjs', lexiconPath };
      const aud = fs.readFileSync(auditorPath, 'utf8');
      if (!aud.includes('loadS2QualityMachineLexicon')) {
        return { ok: false, reason: 'quality-auditor.mjs 未引用 loadS2QualityMachineLexicon', lexiconPath };
      }
      return { ok: true, lexiconPath };
    } catch (e) {
      return { ok: false, reason: String(e?.message || e), lexiconPath };
    }
  }

  _checkIntentCanonicalConsistency() {
    const canonicalPath = path.join(this.projectRoot, 'references/01-core/intent-canonical.json');
    const nluPath = path.join(this.projectRoot, 'references/01-core/section-nlu.md');
    try {
      if (!fs.existsSync(canonicalPath)) return { ok: false, reason: '缺少 references/01-core/intent-canonical.json' };
      const canonical = JSON.parse(fs.readFileSync(canonicalPath, 'utf8'));
      const ids = Array.isArray(canonical.intents) ? canonical.intents.map((x) => x.id).filter(Boolean) : [];
      if (ids.length === 0) return { ok: false, reason: 'intent-canonical.json 中 intents 为空' };
      if (!fs.existsSync(nluPath)) return { ok: false, reason: '缺少 section-nlu.md' };
      const nlu = fs.readFileSync(nluPath, 'utf8');
      const missing = ids.filter((id) => !new RegExp(`\\b${id}\\b`).test(nlu));
      if (missing.length > 0) {
        return { ok: false, reason: `section-nlu.md 缺少意图定义: ${missing.slice(0, 5).join(', ')}` };
      }
      return { ok: true, intentCount: ids.length };
    } catch (e) {
      return { ok: false, reason: String(e?.message || e) };
    }
  }
  
  /**
   * 生成审计报告
   */
  generateReport() {
    console.log('═════════════════════════════════════');
    console.log(' 审计报告摘要');
    console.log('═════════════════════════════════════\n');
    
    console.log(`✅ 通过: ${auditResults.passed}`);
    console.log(`❌ 失败: ${auditResults.failed}`);
    console.log(`⚠️  警告: ${auditResults.warnings}`);
    console.log(`📋 问题: ${auditResults.issues.length}`);
    
    if (auditResults.failed === 0 && auditResults.warnings === 0) {
      console.log('\n🎉 审计通过！文档与代码实现完全一致。');
    } else {
      console.log('\n⚠️  发现以下问题:\n');
      
      for (let i = 0; i < Math.min(auditResults.issues.length, 10); i++) {
        const issue = auditResults.issues[i];
        console.log(`${i + 1}. ${issue.type}`);
        console.log(`   ${JSON.stringify(issue, null, 2)}`);
        console.log('');
      }
      
      if (auditResults.issues.length > 10) {
        console.log(`... 还有 ${auditResults.issues.length - 10} 个问题\n`);
      }
    }
    
    console.log('═════════════════════════════════════');
  }
  
  /**
   * 提取 package.json 版本号
   */
  _extractVersionFromPackageJson() {
    try {
      const pkgPath = path.join(this.projectRoot, 'package.json');
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      return pkg.version;
    } catch (error) {
      return null;
    }
  }
  
  /**
   * 提取 SKILL.md 版本号
   */
  _extractVersionFromSkillMd() {
    try {
      const skillPath = path.join(this.projectRoot, 'SKILL.md');
      const content = fs.readFileSync(skillPath, 'utf8');
      const match = content.match(/^version:\s*([^\r\n]+)/m);
      return match ? match[1].trim() : null;
    } catch (error) {
      return null;
    }
  }
  
  /**
   * 提取 version.mjs 版本号
   */
  _extractVersionFromVersionMjs() {
    try {
      const versionPath = path.join(this.projectRoot, 'scripts/version.mjs');
      const content = fs.readFileSync(versionPath, 'utf8');
      const match = content.match(/VERSION\s*=\s*'([^']+)'/);
      return match ? match[1] : null;
    } catch (error) {
      return null;
    }
  }
  
  /**
   * 提取 _plugin_meta.json 版本号
   */
  _extractVersionFromPluginMeta() {
    try {
      const metaPath = path.join(this.projectRoot, '_plugin_meta.json');
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      return meta.version;
    } catch (error) {
      return null;
    }
  }
  
  /**
   * 提取 SKILL.md 中的功能承诺（速查表与正文引用的 scripts/*.mjs|ps1）
   */
  _extractPromisedFeatures() {
    try {
      const skillPath = path.join(this.projectRoot, 'SKILL.md');
      const content = fs.readFileSync(skillPath, 'utf8');
      const scripts = new Set();

      const backtickNode = /`node\s+(scripts\/[^\s`]+\.(?:mjs|ps1))`/g;
      let m;
      while ((m = backtickNode.exec(content)) !== null) {
        scripts.add(m[1]);
      }

      const plain = /(?:^|[\s|(`])(scripts\/[a-zA-Z0-9_.-]+\.(?:mjs|ps1))/g;
      while ((m = plain.exec(content)) !== null) {
        scripts.add(m[1]);
      }

      const sorted = [...scripts].sort();
      return sorted.map((rel) => ({
        name: rel,
        description: 'SKILL.md 引用脚本',
        reference: rel,
      }));
    } catch (error) {
      console.error('提取功能承诺失败:', error.message);
      return [];
    }
  }
  
  /**
   * 检查功能实现（承诺脚本文件存在）
   */
  async _checkFeatureImplementation(feature) {
    const rel = feature.reference;
    const full = path.join(this.projectRoot, rel);
    if (fs.existsSync(full)) {
      return {
        feature: feature.name,
        found: true,
        location: rel,
      };
    }
    return {
      feature: feature.name,
      found: false,
      location: null,
    };
  }
  
  /**
   * 提取定义的意图
   */
  _extractDefinedIntents() {
    try {
      const nluPath = path.join(this.projectRoot, 'references/01-core/section-nlu.md');
      const content = fs.readFileSync(nluPath, 'utf8');
      
      const intents = [];
      
      // 提取 YAML 格式的意图定义
      const yamlSection = content.match(/```yaml[\s\S]*?```/);
      if (!yamlSection) return intents;
      
      const intentPattern = /-\s*id:\s*(\w+)/g;
      let match;
      
      while ((match = intentPattern.exec(yamlSection[0])) !== null) {
        // 提取触发词
        const triggersMatch = yamlSection[0].match(new RegExp(`id:\\s*${match[1]}[\\s\\S]*?zh_triggers:\\s*\\[([^\\]]+)\\]`));
        const triggers = triggersMatch ? triggersMatch[1].split(',').map(t => t.trim().replace(/"/g, '')) : [];
        
        intents.push({
          id: match[1],
          triggers: triggers
        });
      }
      
      return intents;
    } catch (error) {
      console.error('提取意图定义失败:', error.message);
      return [];
    }
  }
  
  /**
   * 检查意图实现
   */
  async _checkIntentImplementation(intent) {
    const sources = [
      { name: 'scripts/nlu-optimization.mjs', path: path.join(this.projectRoot, 'scripts/nlu-optimization.mjs') },
      { name: 'scripts/nlu-optimization-enhanced.mjs', path: path.join(this.projectRoot, 'scripts/nlu-optimization-enhanced.mjs') },
      { name: 'scripts/_deprecated/nlu-optimization.mjs', path: path.join(this.projectRoot, 'scripts/_deprecated/nlu-optimization.mjs') },
      { name: 'scripts/_deprecated/nlu-optimization-enhanced.mjs', path: path.join(this.projectRoot, 'scripts/_deprecated/nlu-optimization-enhanced.mjs') },
      { name: 'SKILL.md', path: path.join(this.projectRoot, 'SKILL.md') },
      { name: 'references/01-core/section-4-commands.md', path: path.join(this.projectRoot, 'references/01-core/section-4-commands.md') }
    ];

    try {
      const loadedSources = [];
      for (const source of sources) {
        if (!fs.existsSync(source.path)) continue;
        loadedSources.push({
          name: source.name,
          content: fs.readFileSync(source.path, 'utf8')
        });
      }

      const intentKeyPattern = new RegExp(`\\b${intent.id}\\s*:`, 'm');
      const matchedSources = [];
      const matchedTriggers = new Set();

      for (const source of loadedSources) {
        if (intentKeyPattern.test(source.content)) {
          matchedSources.push(source.name);
        }

        for (const trigger of (intent.triggers || [])) {
          const keyword = String(trigger || '').trim();
          if (!keyword) continue;
          if (source.content.includes(keyword)) {
            matchedTriggers.add(keyword);
          }
        }
      }

      let found = matchedSources.length > 0;
      let matchMode = found ? 'explicit' : 'missing';

      if (!found && intent.id === 'OTHER') {
        const hasFallbackToHelp = loadedSources.some((source) => {
          const hasFallbackMethod = /method:\s*['"]fallback['"]/.test(source.content);
          const hasFallbackIntent = /intent:\s*['"]HELP['"]/.test(source.content);
          return hasFallbackMethod && hasFallbackIntent;
        });

        if (hasFallbackToHelp) {
          found = true;
          matchMode = 'equivalent_fallback';
          matchedSources.push('fallback->HELP');
        }
      }

      return {
        intent: intent.id,
        found,
        triggersCount: matchedTriggers.size,
        matchMode,
        location: matchedSources.join(', ') || null
      };
    } catch (error) {
      return {
        intent: intent.id,
        found: false,
        triggersCount: 0,
        matchMode: 'error',
        location: null
      };
    }
  }

  
  /**
   * 检查 search-policy.json 一致性
   */
  async _checkSearchPolicyConsistency() {
    const policyPath = path.join(this.projectRoot, 'references/05-ops/search-policy.json');
    
    try {
      const policy = JSON.parse(fs.readFileSync(policyPath, 'utf8'));
      
      // 检查所有配置项是否在代码中被使用
      const scriptsDir = path.join(this.projectRoot, 'scripts');
      const scriptFiles = fs.readdirSync(scriptsDir).filter(f => f.endsWith('.mjs'));
      
      let usedConfigs = 0;
      const configsToCheck = [
        'search-policy.json',
        'searchAccessPolicy',
        'esmExecutionTracking',
        'smartMemory'
      ];
      
      for (const config of configsToCheck) {
        for (const scriptFile of scriptFiles) {
          const scriptPath = path.join(scriptsDir, scriptFile);
          const content = fs.readFileSync(scriptPath, 'utf8');
          
          if (content.includes(config)) {
            usedConfigs++;
            break;
          }
        }
      }
      
      return {
        totalConfigs: configsToCheck.length,
        usedConfigs: usedConfigs,
        consistent: usedConfigs > 0
      };
    } catch (error) {
      return {
        totalConfigs: 0,
        usedConfigs: 0,
        consistent: false,
        error: error.message
      };
    }
  }
  
  /**
   * 检查智能记忆一致性
   */
  async _checkSmartMemoryConsistency() {
    const issues = [];
    
    // 检查脚本是否存在
    const requiredScripts = [
      'smart-memory-core.mjs',
      'smart-memory-natural.mjs',
      'workbuddy-user-profile-bridge.mjs',
      'exa-search-enhancer.mjs',
      'session-state-manager.mjs',
      'template-recommender.mjs',
      'style-learning.mjs'
    ];
    
    const scriptsDir = path.join(this.projectRoot, 'scripts');
    
    for (const script of requiredScripts) {
      const scriptPath = path.join(scriptsDir, script);
      if (!fs.existsSync(scriptPath)) {
        issues.push(`缺少脚本: ${script}`);
      }
    }
    
    // 检查配置文件
    const policyPath = path.join(this.projectRoot, 'references/05-ops/search-policy.json');
    try {
      const policy = JSON.parse(fs.readFileSync(policyPath, 'utf8'));
      
      if (!policy.smartMemory) {
        issues.push('search-policy.json 缺少 smartMemory 配置');
      } else if (!policy.smartMemory.naturalInterface) {
        issues.push('smartMemory 配置缺少 naturalInterface');
      }
    } catch (error) {
      issues.push(`无法读取 search-policy.json: ${error.message}`);
    }
    
    return {
      consistent: issues.length === 0,
      issues: issues
    };
  }
  
  /**
   * 检查代码标记
   */
  async _checkCodeMarkers() {
    const scriptsDir = path.join(this.projectRoot, 'scripts');
    const referencesDir = path.join(this.projectRoot, 'references');
    
    const markers = {
      todo: 0,
      fixme: 0,
      hack: 0,
      deprecated: 0,
      totalMarkers: 0,
      markers: []
    };
    
    const checkDirectory = (dir) => {
      if (!fs.existsSync(dir)) return;

      const ignoredFiles = new Set([
        'consistency-audit.mjs',
      ]);

      const files = fs.readdirSync(dir, { recursive: true })
        .filter(file => (file.endsWith('.md') || file.endsWith('.mjs') || file.endsWith('.json')) && !ignoredFiles.has(path.basename(file)));
      
      for (const file of files) {
        try {
          const filePath = path.join(dir, file);
          const content = fs.readFileSync(filePath, 'utf8');
          const lines = content.split('\n');
          
          lines.forEach((line, index) => {
            const lineNum = index + 1;
            const markerMatch = line.match(/^\s*(?:\/\/|#|\/\*)\s*(TODO|FIXME|HACK|DEPRECATED)\b/i);
            if (!markerMatch) return;

            const markerType = markerMatch[1].toUpperCase();
            markers.totalMarkers++;
            if (markerType === 'TODO') markers.todo++;
            if (markerType === 'FIXME') markers.fixme++;
            if (markerType === 'HACK') markers.hack++;
            if (markerType === 'DEPRECATED') markers.deprecated++;
            markers.markers.push({ type: markerType, file, line: lineNum });
          });
        } catch (error) {
          // 跳过无法读取的文件
        }
      }
    };
    
    checkDirectory(scriptsDir);
    checkDirectory(referencesDir);
    
    return {
      todoCount: markers.todo,
      fixmeCount: markers.fixme,
      hackCount: markers.hack,
      deprecatedCount: markers.deprecated,
      totalMarkers: markers.totalMarkers,
      markers: markers.markers.slice(0, 20) // 只返回前20个
    };
  }
  
  /**
   * 检查文件编码
   */
  async _checkFileEncoding() {
    const issues = [];
    const scriptsDir = path.join(this.projectRoot, 'scripts');
    const referencesDir = path.join(this.projectRoot, 'references');

    const checkDirectory = (dir) => {
      if (!fs.existsSync(dir)) return;

      const files = fs.readdirSync(dir, { recursive: true })
        .filter(file => file.endsWith('.md') || file.endsWith('.mjs'));

      for (const file of files) {
        try {
          const filePath = path.join(dir, file);
          const content = fs.readFileSync(filePath, 'utf8');

          const replacementCount = (content.match(/\uFFFD/g) || []).length;
          const controlCount = (content.match(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g) || []).length;
          const density = replacementCount / Math.max(content.length, 1);

          const hasSevereReplacement = replacementCount >= 20 || (replacementCount >= 5 && density >= 0.002);
          const hasControlChars = controlCount > 0;

          if (hasSevereReplacement || hasControlChars) {
            issues.push({
              file,
              issue: hasControlChars ? '控制字符' : '疑似编码异常',
              replacementCount,
              controlCount,
              density: Number(density.toFixed(6))
            });
          }
        } catch (error) {
          // 跳过无法读取的文件
        }
      }
    };

    checkDirectory(scriptsDir);
    checkDirectory(referencesDir);

    return {
      issues: issues
    };
  }

  
  /**
   * 右对齐字符串
   */
  _padRight(str, length) {
    return str + ' '.repeat(Math.max(0, length - str.length));
  }
}

// 如果直接运行此脚本
if (process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) {
  const auditor = new ConsistencyAuditor();
  auditor
    .runFullAudit()
    .then((failed) => {
      process.exit(typeof failed === 'number' && failed > 0 ? 1 : 0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}


export default ConsistencyAuditor;
