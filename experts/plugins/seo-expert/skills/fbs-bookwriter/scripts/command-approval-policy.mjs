#!/usr/bin/env node
import path from 'path';

const DENY_PATTERNS = [
  /git\s+reset\s+--hard/i,
  /git\s+checkout\s+--\s+/i,
  /\brm\s+-rf\b/i,
  /\bdel\s+\/f\s+\/s\b/i,
  /\bformat\s+[a-z]:/i,
  /\bdrop\s+database\b/i,
];

const HIGH_RISK_PATTERNS = [
  /\bgit\s+push\b/i,
  /\bnpm\s+publish\b/i,
  /\bnode\s+scripts\/pack-release\.mjs\b/i,
  /\bnode\s+scripts\/pack-workbuddy-marketplace\.mjs\b/i,
  /\bnode\s+scripts\/clean-dist\.mjs\b/i,
];

function normalize(cmd) {
  return String(cmd || '').trim().replace(/\s+/g, ' ');
}

export function evaluateCommandApproval(command, { allowAuto = true } = {}) {
  const cmd = normalize(command);
  if (!cmd) {
    return { riskLevel: 'unknown', approval: 'confirm', reason: 'empty-command', command: cmd };
  }
  for (const re of DENY_PATTERNS) {
    if (re.test(cmd)) {
      return {
        riskLevel: 'critical',
        approval: 'deny',
        reason: `deny-pattern:${re}`,
        command: cmd,
        userHint: '该命令可能造成不可逆破坏，默认拒绝执行。',
      };
    }
  }
  for (const re of HIGH_RISK_PATTERNS) {
    if (re.test(cmd)) {
      return {
        riskLevel: 'high',
        approval: 'confirm',
        reason: `high-risk-pattern:${re}`,
        command: cmd,
        userHint: '该命令会影响发布或远端状态，执行前需用户明确确认。',
      };
    }
  }
  const writeRisk = /(^| )((move|mv|copy|cp|ren|rename)\b|node\s+scripts\/.*\b(pack|release|publish)\b)/i.test(cmd);
  if (writeRisk) {
    return {
      riskLevel: 'medium',
      approval: allowAuto ? 'confirm' : 'deny',
      reason: 'filesystem-or-release-write',
      command: cmd,
      userHint: '该命令可能改动文件或产物，建议先确认目标范围。',
    };
  }
  return {
    riskLevel: 'low',
    approval: allowAuto ? 'auto' : 'confirm',
    reason: 'low-risk-readonly',
    command: cmd,
    userHint: '只读或低风险命令，可自动执行。',
  };
}

function parseArgs(argv) {
  const out = { command: '', json: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--command') out.command = argv[++i] || '';
    else if (a === '--json') out.json = true;
  }
  if (!out.command) {
    const tail = argv.slice(2).filter((x) => x !== '--json').join(' ').trim();
    if (tail) out.command = tail;
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv);
  const out = evaluateCommandApproval(args.command);
  if (args.json) {
    console.log(JSON.stringify(out, null, 2));
  } else {
    console.log(`[command-approval-policy] ${out.approval} (${out.riskLevel}) ${out.reason}`);
    if (out.command) console.log(`[command] ${out.command}`);
    if (out.userHint) console.log(`[hint] ${out.userHint}`);
  }
  process.exit(out.approval === 'deny' ? 1 : 0);
}

if (process.argv[1] && path.basename(process.argv[1]) === 'command-approval-policy.mjs') {
  main();
}

