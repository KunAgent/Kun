#!/usr/bin/env node
export { evaluateCommandApproval } from './command-approval-policy.mjs';
import { evaluateCommandApproval } from './command-approval-policy.mjs';

function parseArgs(argv) {
  const out = { command: '', json: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--command') out.command = argv[++i] || '';
    else if (argv[i] === '--json') out.json = true;
  }
  if (!out.command) out.command = argv.slice(2).filter((x) => x !== '--json').join(' ').trim();
  return out;
}

function main() {
  const args = parseArgs(process.argv);
  const out = evaluateCommandApproval(args.command);
  if (args.json) console.log(JSON.stringify(out, null, 2));
  else console.log(`[approval-policy] ${out.approval} (${out.riskLevel})`);
  process.exit(out.approval === 'deny' ? 1 : 0);
}

if (process.argv[1] && process.argv[1].endsWith('approval-policy.mjs')) {
  main();
}

