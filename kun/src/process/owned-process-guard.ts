/**
 * Standalone code avoids a dependency on a source/build-relative executable.
 * The guard owns no business state. Its IPC peer is the sole lifetime owner.
 * Group leaders are registered while blocked on a private launch pipe.
 */
export const OWNED_PROCESS_GUARD_SOURCE = String.raw`
const { execFileSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const groups = new Map();
let disconnected = false;
let shutdownRequested = false;
let ownerLostAt;
const now = () => Date.now();
let processSnapshot;
function identity(pid) {
  try {
    if (process.platform === 'linux') {
      const stat = readFileSync('/proc/' + pid + '/stat', 'utf8');
      const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
      return fields[0] === 'Z' ? null : fields[19];
    }
    const value = execFileSync('/bin/ps', ['-p', String(pid), '-o', 'stat=', '-o', 'lstart='],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 1000 }).trim();
    return !value || value.startsWith('Z') ? null : value.replace(/^\S+\s+/, '').replace(/\s+/g, ' ');
  } catch { return null; }
}
function members(group) {
  if (!processSnapshot) {
    let listing;
    try {
      listing = execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,pgid=,stat=,lstart='],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 1000 });
    } catch { throw new Error('Could not verify owned process group'); }
    processSnapshot = [];
    for (const line of listing.split('\n')) {
      const [pidText, ppidText, pgidText, state, ...birth] = line.trim().split(/\s+/);
      if (!pidText || state?.startsWith('Z')) continue;
      processSnapshot.push({ pid: Number(pidText), ppid: Number(ppidText), pgid: Number(pgidText),
        birth: birth.join(' ') });
    }
  }
  const rows = processSnapshot;
  const birthOf = row => process.platform === 'linux' ? identity(row.pid) : row.birth;
  const live = new Set();
  const knownGroups = new Set([group.pid]);
  for (const row of rows) {
    const known = group.known.get(row.pid);
    if (known === undefined || birthOf(row) !== known) continue;
    live.add(row.pid);
    if (group.trackDescendants) knownGroups.add(row.pgid);
  }
  let added = true;
  while (added) {
    added = false;
    for (const row of rows) {
      if (live.has(row.pid)) continue;
      if (!knownGroups.has(row.pgid) && !(group.trackDescendants && live.has(row.ppid))) continue;
      const birth = birthOf(row);
      if (birth === null) continue;
      if (row.pid === group.pid && birth !== group.birth) throw new Error('Owned group leader identity changed');
      live.add(row.pid);
      group.known.set(row.pid, birth);
      if (group.trackDescendants) knownGroups.add(row.pgid);
      added = true;
    }
  }
  return [...live];
}
function signal(group, name) {
  const live = members(group);
  if (live.length === 0) return;
  try { process.kill(-group.pid, name); }
  catch (error) { if (error.code !== 'ESRCH') throw error; }
  if (group.trackDescendants) {
    for (const pid of live) {
      if (identity(pid) !== group.known.get(pid)) continue;
      try { process.kill(pid, name); }
      catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
  }
}
function reply(id, error) {
  if (!process.connected || id === undefined) return;
  process.send({ id, ...(error ? { error: String(error.message || error) } : {}) }, () => {});
}
function beginStop(group, graceMs, timeoutMs, id) {
  if (id !== undefined) group.waiters.push(id);
  const deadline = now() + timeoutMs;
  group.deadline = Math.min(group.deadline ?? Infinity, deadline);
  group.forceAt = Math.min(group.forceAt ?? Infinity, now() + graceMs);
  try { signal(group, graceMs > 0 ? 'SIGTERM' : 'SIGKILL'); }
  catch (error) { group.error = error; }
}
function finish(group, error) {
  for (const id of group.waiters) reply(id, error);
  group.waiters = [];
  if (!error) {
    groups.delete(group.pid);
    if (process.connected) process.send({ gone: group.pid }, () => {});
  }
}
function tick() {
  processSnapshot = undefined;
  if (!disconnected && identity(scopeOwnerPid) !== scopeOwnerBirth) ownerLost();
  for (const group of groups.values()) {
    try {
      if (members(group).length === 0) { finish(group); continue; }
      if (group.forceAt !== undefined && now() >= group.forceAt) signal(group, 'SIGKILL');
      else if (group.termAt !== undefined && now() >= group.termAt && !group.termSent) {
        group.termSent = true;
        signal(group, 'SIGTERM');
      }
      if (group.deadline !== undefined && now() >= group.deadline) {
        finish(group, group.error ?? new Error('Owned process group did not exit before deadline'));
        // Failed groups retain their identity while the owner is alive. A
        // guard must itself exit after owner loss, reporting failure.
        if (disconnected) process.exitCode = 1;
      }
    } catch (error) {
      finish(group, error);
      if (disconnected) process.exitCode = 1;
    }
  }
  if (disconnected && [...groups.values()].every((group) => now() >= group.deadline)) {
    clearInterval(timer);
    process.exit(groups.size ? 1 : 0);
  }
  if (shutdownRequested && groups.size === 0) {
    clearInterval(timer);
    process.disconnect?.();
  }
}
process.on('message', (message) => {
  processSnapshot = undefined;
  if (!message || typeof message !== 'object') return;
  if (message.type === 'register') {
    if (disconnected || shutdownRequested) { reply(message.id, new Error('Owner is stopping')); return; }
    const birth = identity(message.pid);
    if (!Number.isSafeInteger(message.pid) || message.pid < 2 || birth === null) {
      reply(message.id, new Error('Could not establish owned process identity')); return;
    }
    groups.set(message.pid, { pid: message.pid, birth, known: new Map([[message.pid, birth]]),
      waiters: [], ownerLossGraceMs: message.ownerLossGraceMs, trackDescendants: message.trackDescendants });
    reply(message.id);
  } else if (message.type === 'stop') {
    const group = groups.get(message.pid);
    if (!group) { reply(message.id); return; }
    beginStop(group, message.graceMs, message.timeoutMs, message.id);
  } else if (message.type === 'shutdown') {
    shutdownRequested = true;
    for (const group of groups.values()) beginStop(group, message.graceMs, message.timeoutMs);
    reply(message.id);
  }
});
function ownerLost() {
  if (ownerLostAt !== undefined) return;
  ownerLostAt = now();
  disconnected = true;
  for (const group of groups.values()) {
    const grace = group.ownerLossGraceMs;
    group.termAt = now() + Math.max(0, grace - 5000);
    group.forceAt = now() + Math.max(0, grace - 1000);
    group.deadline = now() + grace;
  }
}
process.once('disconnect', () => { ownerLost(); tick(); });
const scopeOwnerPid = Number(process.env.KUN_PROCESS_STACK_OWNER_PID || process.ppid);
const scopeOwnerBirth = process.env.KUN_PROCESS_STACK_OWNER_BIRTH || identity(scopeOwnerPid);
if (!scopeOwnerBirth) process.exit(1);
const timer = setInterval(tick, 100);
process.send({ ready: true, scopeOwnerPid, scopeOwnerBirth });
`;
