#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

function parseArgs(argv) {
  const o = {
    skillRoot: process.cwd(),
    bookRoot: process.cwd(),
    channel: 'all',
    enforce: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--skill-root') o.skillRoot = argv[++i] || o.skillRoot;
    else if (a === '--book-root') o.bookRoot = argv[++i] || o.bookRoot;
    else if (a === '--channel') o.channel = argv[++i] || o.channel;
    else if (a === '--enforce') o.enforce = true;
  }
  o.skillRoot = path.resolve(o.skillRoot);
  o.bookRoot = path.resolve(o.bookRoot);
  return o;
}

function mustRead(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`missing_file:${filePath}`);
  return fs.readFileSync(filePath, 'utf8');
}

function checkContains(text, pattern, title, issues) {
  if (!pattern.test(text)) issues.push(title);
}

function runBrokenLinks(skillRoot, channel) {
  const script = path.join(skillRoot, 'scripts', 'audit-broken-links.mjs');
  if (!fs.existsSync(script)) return { ok: false, error: `missing_script:${script}` };
  const r = spawnSync(process.execPath, [script, '--root', skillRoot, '--channel', channel, '--enforce'], { stdio: 'inherit' });
  return { ok: (r.status ?? 2) === 0, code: r.status ?? 2 };
}

function checkEntryContracts({ skillMd, intake, executionContract, onboarding, policy, issues }) {
  checkContains(skillMd, /入口去术语化/, 'SKILL.md 缺少「入口去术语化」约束', issues);
  checkContains(skillMd, /WP1\/WP2 绑定/, 'SKILL.md 缺少「WP1/WP2 绑定」约束', issues);
  checkContains(skillMd, /首个可用工作面固定/, 'SKILL.md 缺少「首个可用工作面固定」约束', issues);
  checkContains(skillMd, /workspace 真值边界/, 'SKILL.md 缺少「workspace 真值边界」约束', issues);
  checkContains(skillMd, /搜索前置合同/, 'SKILL.md 缺少「搜索前置合同」约束', issues);

  checkContains(intake, /入口表达合同/, 'intake-and-routing 缺少「入口表达合同」区块', issues);
  checkContains(intake, /WP1 \/ WP2 双工作面绑定/, 'intake-and-routing 缺少「WP1 / WP2 双工作面绑定」区块', issues);
  checkContains(intake, /搜索前置合同/, 'intake-and-routing 缺少「搜索前置合同」区块', issues);
  checkContains(intake, /首个可用工作面/, 'intake-and-routing 缺少「首个可用工作面」说明', issues);

  checkContains(executionContract, /双工作面合同/, 'execution-contract-brief 缺少「双工作面合同」区块', issues);
  checkContains(executionContract, /workspace 真值与治理边界/, 'execution-contract-brief 缺少「workspace 真值与治理边界」区块', issues);
  checkContains(executionContract, /brain\/<conversation-id>/, 'execution-contract-brief 缺少 artifact 边界说明', issues);

  checkContains(onboarding, /先用日常语言说明当前工作区已就绪/, 'section-8-onboarding 未对齐先白话后术语的入口文案', issues);
  checkContains(onboarding, /这套工作区在 FBS 里叫“虚拟书房”/, 'section-8-onboarding 缺少术语后置示例', issues);

  const entryWorkplanes = policy?.entryWorkplanes || {};
  if (!entryWorkplanes.enabled) issues.push('search-policy 需启用 entryWorkplanes');
  if (entryWorkplanes?.wp1?.id !== 'WP1') issues.push('search-policy.entryWorkplanes.wp1.id 必须为 WP1');
  if (entryWorkplanes?.wp2?.id !== 'WP2') issues.push('search-policy.entryWorkplanes.wp2.id 必须为 WP2');
  if (!Array.isArray(entryWorkplanes?.wp1?.userFacingActions) || entryWorkplanes.wp1.userFacingActions.length < 3) {
    issues.push('search-policy.entryWorkplanes.wp1.userFacingActions 至少包含 3 个日常入口动作');
  }
  if (!Array.isArray(entryWorkplanes?.wp2?.firstUsableWorkspaceDirs) || entryWorkplanes.wp2.firstUsableWorkspaceDirs.length !== 3) {
    issues.push('search-policy.entryWorkplanes.wp2.firstUsableWorkspaceDirs 必须覆盖三层目录');
  }

  const searchPreflight = policy?.searchPreflightContract || {};
  if (!searchPreflight.enabled) issues.push('search-policy 需启用 searchPreflightContract');
  if ((searchPreflight.requiredFields || []).length < 4) issues.push('search-policy.searchPreflightContract.requiredFields 必须覆盖 4 个字段');
  if (!searchPreflight.mustAnnounceBeforeChapterSearch) issues.push('search-policy.searchPreflightContract 必须要求章前检索先宣告');
  if (!searchPreflight.blockedIfMissingAnnouncement) issues.push('search-policy.searchPreflightContract 必须阻断缺失宣告的检索');

  const governance = policy?.workspaceGovernance || {};
  if (!governance.enabled) issues.push('search-policy 需启用 workspaceGovernance');
  if (!Array.isArray(governance.projectTruthDirs) || governance.projectTruthDirs.join(',') !== '.fbs,deliverables,releases') {
    issues.push('search-policy.workspaceGovernance.projectTruthDirs 必须固定为 .fbs/deliverables/releases');
  }
  if (!governance.artifactBoundary || !governance.artifactBoundary.includes('brain/<conversation-id>/')) {
    issues.push('search-policy.workspaceGovernance.artifactBoundary 必须声明 artifact 仅限 brain/<conversation-id>/');
  }
  if (!Array.isArray(governance?.firstUsableWorkspace?.requiredDirs) || governance.firstUsableWorkspace.requiredDirs.length !== 3) {
    issues.push('search-policy.workspaceGovernance.firstUsableWorkspace.requiredDirs 必须覆盖三层目录');
  }
}

function main() {
  const opts = parseArgs(process.argv);
  const issues = [];

  const skillMd = mustRead(path.join(opts.skillRoot, 'SKILL.md'));
  const intake = mustRead(path.join(opts.skillRoot, 'references', '01-core', 'intake-and-routing.md'));
  const executionContract = mustRead(path.join(opts.skillRoot, 'references', '01-core', 'execution-contract-brief.md'));
  const onboarding = mustRead(path.join(opts.skillRoot, 'references', '01-core', 'section-8-onboarding.md'));
  const policy = JSON.parse(mustRead(path.join(opts.skillRoot, 'references', '05-ops', 'search-policy.json')));
  const incremental = mustRead(path.join(opts.skillRoot, 'scripts', 'quality-audit-incremental.mjs'));
  const panorama = mustRead(path.join(opts.skillRoot, 'scripts', 'quality-panorama-orchestrator.mjs'));
  const pkg = JSON.parse(mustRead(path.join(opts.skillRoot, 'package.json')));

  checkContains(skillMd, /轻量入口优先/, 'SKILL.md 缺少「轻量入口优先」', issues);
  checkContains(skillMd, /不得重复 `list_dir \+ read_file`/, 'SKILL.md 缺少「上下文复用优先」约束', issues);
  checkContains(skillMd, /全景质检默认增量/, 'SKILL.md 缺少「全景质检默认增量」约束', issues);
  checkContains(skillMd, /超时与收束/, 'SKILL.md 缺少「超时与收束」约束', issues);

  checkEntryContracts({ skillMd, intake, executionContract, onboarding, policy, issues });

  const q = policy?.qualityPanoramaExecution || {};
  if (q.defaultMode !== 'incremental') issues.push('search-policy 需 defaultMode=incremental');
  if (!q.runStageSerially) issues.push('search-policy 需 runStageSerially=true');
  if ((q.subTaskTimeoutMinutes ?? 0) <= 0) issues.push('search-policy 需配置 subTaskTimeoutMinutes>0');
  if ((q.subTaskMaxTurns ?? 0) <= 0) issues.push('search-policy 需配置 subTaskMaxTurns>0');
  if ((q.subTaskMaxRetries ?? -1) < 0) issues.push('search-policy 需配置 subTaskMaxRetries>=0');

  checkContains(incremental, /mode:\s*'auto'/, 'quality-audit-incremental 默认 mode 必须为 auto', issues);
  checkContains(incremental, /maxFiles:\s*30/, 'quality-audit-incremental 默认 maxFiles 应为 30', issues);

  checkContains(panorama, /strictStageGate:\s*true/, 'quality-panorama 默认 strictStageGate 应为 true', issues);
  checkContains(panorama, /timeoutMinutes:\s*15/, 'quality-panorama 默认 timeoutMinutes 应为 15', issues);
  checkContains(panorama, /maxTurns:\s*12/, 'quality-panorama 默认 maxTurns 应为 12', issues);
  checkContains(panorama, /maxRetries:\s*1/, 'quality-panorama 默认 maxRetries 应为 1', issues);
  checkContains(panorama, /heartbeatSeconds:\s*15/, 'quality-panorama 默认 heartbeatSeconds 应为 15', issues);
  checkContains(panorama, /confirmLargeScan:\s*false/, 'quality-panorama 默认 confirmLargeScan 应为 false', issues);
  checkContains(panorama, /awaiting_large_scope_confirmation/, 'quality-panorama 缺少 >50 文件确认门禁实现', issues);
  checkContains(panorama, /scan-lock\.json|lockFile/, 'quality-panorama 缺少扫描锁实现', issues);
  checkContains(panorama, /scan-progress\.json|progressFile/, 'quality-panorama 缺少进度快照实现', issues);
  checkContains(panorama, /FBS_QC_META|historyDir/, 'quality-panorama 缺少历史结果落盘实现', issues);


  const scripts = pkg?.scripts || {};
  if (!scripts['quality:audit:incremental']) issues.push('package.json 缺少 quality:audit:incremental');
  if (!scripts['quality:audit:panorama']) issues.push('package.json 缺少 quality:audit:panorama');
  if (!scripts['audit:broken-links']) issues.push('package.json 缺少 audit:broken-links');

  console.log(`[entry-gate] 配置审计完成，问题数=${issues.length}`);
  for (const i of issues) console.log(`- ${i}`);

  const link = runBrokenLinks(opts.skillRoot, opts.channel);
  if (!link.ok) {
    console.error(`[entry-gate] 断链审计失败，code=${link.code ?? 2}${link.error ? ` error=${link.error}` : ''}`);
    process.exit(1);
  }

  if (issues.length > 0 && opts.enforce) process.exit(1);
  process.exit(0);
}

main();

