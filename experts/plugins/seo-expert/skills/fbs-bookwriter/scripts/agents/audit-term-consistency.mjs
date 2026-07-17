#!/usr/bin/env node
import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const script = path.join(__dirname, '..', 'audit-term-consistency.mjs');
const args = process.argv.slice(2);
const r = spawnSync(process.execPath, [script, ...args], { stdio: 'inherit' });
process.exit(typeof r.status === 'number' ? r.status : 1);
