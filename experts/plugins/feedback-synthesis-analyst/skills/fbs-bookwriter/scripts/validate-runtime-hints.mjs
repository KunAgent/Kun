#!/usr/bin/env node
/**
 * 校验 fbs-runtime-hints.json：必填键、类型、引用的相对路径文件是否存在。
 * 用于 pack:skill-gates / CI，防止机读约定漂移。
 *
 * 维护约定：若在 fbs-runtime-hints.json 增加新的「文档/产物路径」型顶层块或字段，
 * 请同步更新本文件的 REQUIRED_TOP 与 PATH_CHECKS，并运行
 * `node scripts/validate-runtime-hints.mjs --skill-root <根>` 确认路径存在。
 * scriptsManifest（generated）在干净仓库中需先 `npm run manifest:scripts` 再校验。
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const REQUIRED_TOP = [
  'version',
  'session',
  'promptLayerCache',
  'channelSessionDefaults',
  'subTaskContract',
  'executionSafety',
  's3',
  'search',
  'compliance',
  'hostMemory',
  'userExperience',
  'antiStall',
  'performanceUx',
  'cognitiveAsset',
  'orchestration',
  'strategiesABC',
  'scriptBridge',
  'trace',
  'bookIndex',
  'evolutionGate',
  'contextCompression',
  'auxiliaryTasks',
  'hostPresentation',
  'gates',
];

const PATH_CHECKS = [
  ['search', 'preflightContractPath'],
  ['userExperience', 'rulesCenter'],
  ['userExperience', 'dialogLayer'],
  ['userExperience', 'agentPlaybook'],
  ['antiStall', 'guide'],
  ['performanceUx', 'performanceDoc'],
  ['cognitiveAsset', 'strategyDoc'],
  ['orchestration', 'strategyDoc'],
  ['orchestration', 'multiAgentSyncDoc'],
  ['strategiesABC', 'docMatrix'],
  ['scriptBridge', 'matrixDoc'],
  ['scriptBridge', 'primaryCli'],
  ['trace', 'schemaPath'],
  ['evolutionGate', 'scriptsManifest'],
  ['evolutionGate', 'improvementDoc'],
  ['contextCompression', 'policyDoc'],
  ['contextCompression', 'scenePackCoordinateDoc'],
  ['auxiliaryTasks', 'tasksDoc'],
  ['hostPresentation', 'integrationDoc'],
  ['gates', 'severityDoc'],
  ['gates', 'expansionDoc'],
  ['gates', 'refinementDoc'],
  ['gates', 'searchPolicy'],
  ['gates', 'truthMatrix'],
  ['gates', 'optimizationRoadmapSpec'],
  ['subTaskContract', 'documentationRelativePath'],
  ['executionSafety', 'integrationDocRelative'],
];

function parseArgs(argv) {
  const o = { skillRoot: path.resolve(__dirname, '..'), help: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--skill-root' && argv[i + 1]) o.skillRoot = path.resolve(argv[++i]);
    else if (argv[i] === '--help' || argv[i] === '-h') o.help = true;
  }
  return o;
}

export function validateRuntimeHints(skillRoot) {
  const root = path.resolve(skillRoot);
  const hintsPath = path.join(root, 'fbs-runtime-hints.json');
  const errors = [];

  if (!fs.existsSync(hintsPath)) {
    return { ok: false, errors: [`缺少 ${hintsPath}`] };
  }

  let data;
  try {
    data = JSON.parse(fs.readFileSync(hintsPath, 'utf8'));
  } catch (e) {
    return { ok: false, errors: [`JSON 解析失败: ${e.message}`] };
  }

  for (const key of REQUIRED_TOP) {
    if (!(key in data)) errors.push(`缺少顶层键: ${key}`);
  }

  if (data.version && !/^\d+\.\d+\.\d+$/.test(String(data.version))) {
    errors.push(`version 应为 semver 形式: ${data.version}`);
  }

  for (const [objKey, leaf] of PATH_CHECKS) {
    const obj = data[objKey];
    const p = obj && typeof obj === 'object' ? obj[leaf] : null;
    if (!p || typeof p !== 'string') {
      errors.push(`${objKey}.${leaf} 缺失或非字符串`);
      continue;
    }
    const resolved = path.join(root, p.replace(/^\//, ''));
    if (!fs.existsSync(resolved)) {
      errors.push(`路径不存在: ${objKey}.${leaf} → ${p}`);
    }
  }

  const pkgPath = path.join(root, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      if (pkg.version && data.version && pkg.version !== data.version) {
        errors.push(`version 与 package.json 不一致: hints=${data.version} package=${pkg.version}`);
      }
    } catch {
      // ignore
    }
  }

  const ux = data.userExperience;
  if (ux && typeof ux === 'object') {
    if (typeof ux.maxNextActions !== 'number' || ux.maxNextActions < 1) {
      errors.push('userExperience.maxNextActions 应为正整数');
    }
    if (typeof ux.recoveryCardLines !== 'number' || ux.recoveryCardLines < 1) {
      errors.push('userExperience.recoveryCardLines 应为正整数');
    }
    const narration = ux.visibleTechActionNarration;
    if (!narration || typeof narration !== 'object') {
      errors.push('userExperience.visibleTechActionNarration 应为对象');
    } else {
      ['beforeAction', 'inProgress', 'afterSuccess', 'afterFallback'].forEach((k) => {
        if (!narration[k] || typeof narration[k] !== 'string') {
          errors.push(`userExperience.visibleTechActionNarration.${k} 应为非空字符串`);
        }
      });
    }
  }

  const orch = data.orchestration;
  if (orch && typeof orch === 'object') {
    if (typeof orch.qualityFirst !== 'boolean') {
      errors.push('orchestration.qualityFirst 应为布尔值');
    }
    if (typeof orch.signalDrivenAdjustment !== 'boolean') {
      errors.push('orchestration.signalDrivenAdjustment 应为布尔值');
    }
  }

  const anti = data.antiStall;
  if (anti && typeof anti === 'object') {
    if (typeof anti.defaultScenePackTimeoutMs !== 'number' || anti.defaultScenePackTimeoutMs < 1000) {
      errors.push('antiStall.defaultScenePackTimeoutMs 应为合理毫秒数（≥1000）');
    }
    if (typeof anti.hostMemoryMaxFiles !== 'number' || anti.hostMemoryMaxFiles < 1) {
      errors.push('antiStall.hostMemoryMaxFiles 应为正整数');
    }
  }

  const s3 = data.s3;
  if (s3 && typeof s3 === 'object' && typeof s3.maxFilesModifiedPerTurn !== 'number') {
    errors.push('s3.maxFilesModifiedPerTurn 应为数字');
  }

  const hp = data.hostPresentation;
  if (hp && typeof hp === 'object') {
    if (typeof hp.maxPrimaryActionsInChat !== 'number' || hp.maxPrimaryActionsInChat < 1) {
      errors.push('hostPresentation.maxPrimaryActionsInChat 应为正整数');
    }
    if (typeof hp.hideFullSkillAndIntakeJsonFromUserChat !== 'boolean') {
      errors.push('hostPresentation.hideFullSkillAndIntakeJsonFromUserChat 应为布尔值');
    }
    if (typeof hp.listDirFbsOnlyOnDemand !== 'boolean') {
      errors.push('hostPresentation.listDirFbsOnlyOnDemand 应为布尔值');
    }
    if (!hp.userFacingOneLinerJsonPath || typeof hp.userFacingOneLinerJsonPath !== 'string') {
      errors.push('hostPresentation.userFacingOneLinerJsonPath 应为非空字符串');
    }
    if (!hp.techActionNarrationJsonPath || typeof hp.techActionNarrationJsonPath !== 'string') {
      errors.push('hostPresentation.techActionNarrationJsonPath 应为非空字符串');
    }
    if (!hp.actionSelectionPolicyJsonPath || typeof hp.actionSelectionPolicyJsonPath !== 'string') {
      errors.push('hostPresentation.actionSelectionPolicyJsonPath 应为非空字符串');
    }
    if (!hp.dangerousOperationPolicyJsonPath || typeof hp.dangerousOperationPolicyJsonPath !== 'string') {
      errors.push('hostPresentation.dangerousOperationPolicyJsonPath 应为非空字符串');
    }
    if (!hp.clarifyContractsJsonPath || typeof hp.clarifyContractsJsonPath !== 'string') {
      errors.push('hostPresentation.clarifyContractsJsonPath 应为非空字符串');
    }
    if (!hp.entryOutputProfilesJsonPath || typeof hp.entryOutputProfilesJsonPath !== 'string') {
      errors.push('hostPresentation.entryOutputProfilesJsonPath 应为非空字符串');
    }
    if (!hp.actionGoalImpactJsonPath || typeof hp.actionGoalImpactJsonPath !== 'string') {
      errors.push('hostPresentation.actionGoalImpactJsonPath 应为非空字符串');
    }
    if (!hp.bookQualityConclusionJsonPath || typeof hp.bookQualityConclusionJsonPath !== 'string') {
      errors.push('hostPresentation.bookQualityConclusionJsonPath 应为非空字符串');
    }
    if (!hp.promptLayerCacheJsonPath || typeof hp.promptLayerCacheJsonPath !== 'string') {
      errors.push('hostPresentation.promptLayerCacheJsonPath 应为非空字符串');
    }
  }

  const ch = data.channelSessionDefaults;
  if (!ch || typeof ch !== 'object') {
    errors.push('channelSessionDefaults 应为对象');
  } else {
    if (typeof ch.recursionLimit !== 'number' || ch.recursionLimit < 1) {
      errors.push('channelSessionDefaults.recursionLimit 应为正整数');
    }
    if (typeof ch.intakeEnforceRequiredDefault !== 'boolean') {
      errors.push('channelSessionDefaults.intakeEnforceRequiredDefault 应为布尔值');
    }
    if (typeof ch.subagentOrWorkerTasksDefault !== 'boolean') {
      errors.push('channelSessionDefaults.subagentOrWorkerTasksDefault 应为布尔值');
    }
    if (typeof ch.defaultIntakeFast !== 'boolean') {
      errors.push('channelSessionDefaults.defaultIntakeFast 应为布尔值');
    }
    if (typeof ch.thinkingHintsInAgentContextDefault !== 'boolean') {
      errors.push('channelSessionDefaults.thinkingHintsInAgentContextDefault 应为布尔值');
    }
  }

  const plc = data.promptLayerCache;
  if (!plc || typeof plc !== 'object') {
    errors.push('promptLayerCache 应为对象');
  } else {
    if (typeof plc.enabled !== 'boolean') errors.push('promptLayerCache.enabled 应为布尔值');
    if (!Array.isArray(plc.layers) || plc.layers.length < 2) errors.push('promptLayerCache.layers 应为非空数组（>=2）');
    if (!Array.isArray(plc.invalidateWhen) || plc.invalidateWhen.length < 1) {
      errors.push('promptLayerCache.invalidateWhen 应为非空数组');
    }
    if (!plc.firstResponseJsonPath || typeof plc.firstResponseJsonPath !== 'string') {
      errors.push('promptLayerCache.firstResponseJsonPath 应为非空字符串');
    }
  }

  const st = data.subTaskContract;
  if (!st || typeof st !== 'object') {
    errors.push('subTaskContract 应为对象');
  } else {
    if (!st.contractVersion || typeof st.contractVersion !== 'string') {
      errors.push('subTaskContract.contractVersion 应为非空字符串');
    }
    if (typeof st.defaultTimeoutSeconds !== 'number' || st.defaultTimeoutSeconds < 60) {
      errors.push('subTaskContract.defaultTimeoutSeconds 应为合理秒数（≥60）');
    }
    if (typeof st.maxConcurrentHints !== 'number' || st.maxConcurrentHints < 1) {
      errors.push('subTaskContract.maxConcurrentHints 应为正整数');
    }
    if (!st.firstResponseJsonPath || typeof st.firstResponseJsonPath !== 'string') {
      errors.push('subTaskContract.firstResponseJsonPath 应为非空字符串');
    }
  }

  const ex = data.executionSafety;
  if (!ex || typeof ex !== 'object') {
    errors.push('executionSafety 应为对象');
  } else {
    if (!Array.isArray(ex.userVisiblePrinciplesZh) || ex.userVisiblePrinciplesZh.length < 1) {
      errors.push('executionSafety.userVisiblePrinciplesZh 应为非空字符串数组');
    }
  }

  const perf = data.performanceUx;
  if (!perf || typeof perf !== 'object') {
    errors.push('performanceUx 应为对象');
  } else {
    if (!perf.userValueHeadlineZh || typeof perf.userValueHeadlineZh !== 'string') {
      errors.push('performanceUx.userValueHeadlineZh 应为非空字符串');
    }
    if (!Array.isArray(perf.userValueBulletsZh) || perf.userValueBulletsZh.length < 1) {
      errors.push('performanceUx.userValueBulletsZh 应为非空字符串数组');
    }
    if (typeof perf.fileGrowthReportMaxAgeHours !== 'number' || perf.fileGrowthReportMaxAgeHours < 1) {
      errors.push('performanceUx.fileGrowthReportMaxAgeHours 应为正数（小时）');
    }
    if (typeof perf.fileGrowthSoftSingleMb !== 'number' || perf.fileGrowthSoftSingleMb < 1) {
      errors.push('performanceUx.fileGrowthSoftSingleMb 应为正数');
    }
    if (typeof perf.fileGrowthHardSingleMb !== 'number' || perf.fileGrowthHardSingleMb < perf.fileGrowthSoftSingleMb) {
      errors.push('performanceUx.fileGrowthHardSingleMb 应大于等于 fileGrowthSoftSingleMb');
    }
    if (typeof perf.fileGrowthSoftTotalMb !== 'number' || perf.fileGrowthSoftTotalMb < 1) {
      errors.push('performanceUx.fileGrowthSoftTotalMb 应为正数');
    }
    if (typeof perf.fileGrowthHardTotalMb !== 'number' || perf.fileGrowthHardTotalMb < perf.fileGrowthSoftTotalMb) {
      errors.push('performanceUx.fileGrowthHardTotalMb 应大于等于 fileGrowthSoftTotalMb');
    }
    if (typeof perf.excludeAuditJsonlFromGrowthTrack !== 'boolean') {
      errors.push('performanceUx.excludeAuditJsonlFromGrowthTrack 应为布尔值');
    }
  }

  const ca = data.cognitiveAsset;
  if (!ca || typeof ca !== 'object') {
    errors.push('cognitiveAsset 应为对象');
  } else {
    if (!ca.userValueOneLinerZh || typeof ca.userValueOneLinerZh !== 'string') {
      errors.push('cognitiveAsset.userValueOneLinerZh 应为非空字符串');
    }
    if (!Array.isArray(ca.threeizationZh) || ca.threeizationZh.length < 3) {
      errors.push('cognitiveAsset.threeizationZh 应为至少 3 项的字符串数组');
    }
    if (!Array.isArray(ca.commercialEngineZh) || ca.commercialEngineZh.length < 3) {
      errors.push('cognitiveAsset.commercialEngineZh 应为至少 3 项的字符串数组');
    }
    if (!ca.firstResponseJsonPath || typeof ca.firstResponseJsonPath !== 'string') {
      errors.push('cognitiveAsset.firstResponseJsonPath 应为非空字符串');
    }
  }

  return { ok: errors.length === 0, errors };
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log(`用法: node scripts/validate-runtime-hints.mjs [--skill-root <技能根>]`);
    process.exit(0);
  }

  const { ok, errors } = validateRuntimeHints(args.skillRoot);
  if (ok) {
    console.log('validate-runtime-hints: ✅ fbs-runtime-hints.json 校验通过');
    process.exit(0);
  }
  console.error('validate-runtime-hints: ❌ 校验失败');
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

if (process.argv[1] && process.argv[1].includes('validate-runtime-hints')) {
  main();
}
