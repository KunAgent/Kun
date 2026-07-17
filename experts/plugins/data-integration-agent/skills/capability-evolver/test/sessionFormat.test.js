const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { formatSessionLog, formatCursorTranscript } = require('../src/evolve');

describe('formatSessionLog - multi-agent compatibility', () => {

  // -- OpenClaw ---------------------------------------------------------------
  describe('OpenClaw format', () => {
    it('parses message with toolCall content', () => {
      const jsonl = [
        JSON.stringify({ type: 'message', message: { role: 'user', content: [{ type: 'text', text: 'deploy the fix' }] } }),
        JSON.stringify({ type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: 'running deploy' }, { type: 'toolCall', name: 'shell' }] } }),
      ].join('\n');
      const out = formatSessionLog(jsonl);
      assert.ok(out.includes('**USER**: deploy the fix'));
      assert.ok(out.includes('**ASSISTANT**: running deploy [TOOL: shell]'));
    });

    it('captures errorMessage', () => {
      const jsonl = JSON.stringify({
        type: 'message',
        message: { role: 'assistant', content: 'ok', errorMessage: 'Unsupported MIME type: image/gif' },
      });
      const out = formatSessionLog(jsonl);
      assert.ok(out.includes('[LLM ERROR]'));
      assert.ok(out.includes('Unsupported MIME'));
    });

    it('filters HEARTBEAT_OK and NO_REPLY', () => {
      const jsonl = [
        JSON.stringify({ type: 'message', message: { role: 'user', content: 'HEARTBEAT_OK' } }),
        JSON.stringify({ type: 'message', message: { role: 'assistant', content: 'NO_REPLY' } }),
        JSON.stringify({ type: 'message', message: { role: 'user', content: 'real question' } }),
      ].join('\n');
      const out = formatSessionLog(jsonl);
      assert.ok(!out.includes('HEARTBEAT_OK'));
      assert.ok(!out.includes('NO_REPLY'));
      assert.ok(out.includes('real question'));
    });

    it('handles toolResult entries', () => {
      const jsonl = JSON.stringify({
        type: 'message',
        message: { role: 'toolResult' },
        content: 'Command exited with error code 1: ENOENT',
      });
      const out = formatSessionLog(jsonl);
      assert.ok(out.includes('[TOOL RESULT]'));
      assert.ok(out.includes('ENOENT'));
    });
  });

  // -- Claude Code ------------------------------------------------------------
  describe('Claude Code format', () => {
    it('parses user/assistant with tool_use', () => {
      const jsonl = [
        JSON.stringify({ type: 'user', uuid: 'u1', message: { role: 'user', content: [{ type: 'text', text: 'fix the bug' }] } }),
        JSON.stringify({ type: 'assistant', uuid: 'a1', message: { role: 'assistant', content: [{ type: 'text', text: 'analyzing' }, { type: 'tool_use', name: 'Bash', id: 't1', input: { command: 'ls' } }] } }),
      ].join('\n');
      const out = formatSessionLog(jsonl);
      assert.ok(out.includes('**USER**: fix the bug'));
      assert.ok(out.includes('**ASSISTANT**: analyzing [TOOL: Bash]'));
    });

    it('skips isMeta entries', () => {
      const jsonl = JSON.stringify({
        type: 'assistant', isMeta: true,
        message: { role: 'assistant', content: [{ type: 'text', text: 'internal meta' }] },
      });
      const out = formatSessionLog(jsonl);
      assert.equal(out.trim(), '');
    });

    it('handles tool_result with error', () => {
      const jsonl = JSON.stringify({
        type: 'tool_result',
        content: 'Error: EACCES permission denied',
      });
      const out = formatSessionLog(jsonl);
      assert.ok(out.includes('[TOOL RESULT]'));
      assert.ok(out.includes('EACCES'));
    });

    it('skips thinking blocks in content', () => {
      const jsonl = JSON.stringify({
        type: 'assistant',
        message: { role: 'assistant', content: [
          { type: 'thinking', thinking: 'let me think...' },
          { type: 'text', text: 'the answer is 42' },
        ]},
      });
      const out = formatSessionLog(jsonl);
      assert.ok(!out.includes('let me think'));
      assert.ok(out.includes('the answer is 42'));
    });
  });

  // -- Cursor -----------------------------------------------------------------
  describe('Cursor JSONL format', () => {
    it('parses role-based entries (no type field)', () => {
      const jsonl = [
        JSON.stringify({ role: 'user', message: { content: [{ type: 'text', text: 'check the logs' }] } }),
        JSON.stringify({ role: 'assistant', message: { content: [{ type: 'text', text: 'reading logs now' }, { type: 'tool_use', name: 'Shell', input: { command: 'tail -f' } }] } }),
      ].join('\n');
      const out = formatSessionLog(jsonl);
      assert.ok(out.includes('**USER**: check the logs'));
      assert.ok(out.includes('**ASSISTANT**: reading logs now [TOOL: Shell]'));
    });

    it('handles assistant-only tool_use entries', () => {
      const jsonl = JSON.stringify({
        role: 'assistant',
        message: { content: [
          { type: 'tool_use', name: 'Read', input: { path: '/tmp/file.txt' } },
          { type: 'tool_use', name: 'Grep', input: { pattern: 'error' } },
        ]},
      });
      const out = formatSessionLog(jsonl);
      assert.ok(out.includes('[TOOL: Read]'));
      assert.ok(out.includes('[TOOL: Grep]'));
    });
  });

  // -- Codex CLI --------------------------------------------------------------
  describe('Codex CLI format', () => {
    it('parses item.added user message', () => {
      const jsonl = JSON.stringify({
        type: 'item.added',
        item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'refactor the module' }] },
      });
      const out = formatSessionLog(jsonl);
      assert.ok(out.includes('**USER**: refactor the module'));
    });

    it('parses item.completed assistant message with output_text', () => {
      const jsonl = JSON.stringify({
        type: 'item.completed',
        item: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'done, 3 files changed' }] },
      });
      const out = formatSessionLog(jsonl);
      assert.ok(out.includes('**ASSISTANT**: done, 3 files changed'));
    });

    it('parses function_call items', () => {
      const jsonl = JSON.stringify({
        type: 'item.completed',
        item: { type: 'function_call', name: 'shell', call_id: 'call_123', arguments: '{"cmd":"ls"}' },
      });
      const out = formatSessionLog(jsonl);
      assert.ok(out.includes('[TOOL: shell]'));
    });

    it('parses function_call_output items', () => {
      const jsonl = JSON.stringify({
        type: 'item.completed',
        item: { type: 'function_call_output', output: 'README.md\npackage.json\nsrc/' },
      });
      const out = formatSessionLog(jsonl);
      assert.ok(out.includes('[TOOL RESULT]'));
      assert.ok(out.includes('README.md'));
    });

    it('skips short success function_call_output', () => {
      const jsonl = JSON.stringify({
        type: 'item.completed',
        item: { type: 'function_call_output', output: 'success' },
      });
      const out = formatSessionLog(jsonl);
      assert.equal(out.trim(), '');
    });

    it('skips session.created events gracefully', () => {
      const jsonl = JSON.stringify({
        type: 'session.created', session_id: 'sess_abc',
      });
      const out = formatSessionLog(jsonl);
      assert.equal(out.trim(), '');
    });

    it('handles content array with function_call type', () => {
      const jsonl = JSON.stringify({
        type: 'item.completed',
        item: { type: 'message', role: 'assistant', content: [
          { type: 'output_text', text: 'let me check' },
          { type: 'function_call', name: 'read_file' },
        ]},
      });
      const out = formatSessionLog(jsonl);
      assert.ok(out.includes('let me check'));
      assert.ok(out.includes('[TOOL: read_file]'));
    });
  });

  // -- Manus ------------------------------------------------------------------
  describe('Manus format', () => {
    it('parses user_message', () => {
      const jsonl = JSON.stringify({
        type: 'user_message',
        id: 'evt_1',
        timestamp: 1710000000,
        user_message: { content: 'build a landing page', message_type: 'text' },
      });
      const out = formatSessionLog(jsonl);
      assert.ok(out.includes('**USER**: build a landing page'));
    });

    it('parses assistant_message', () => {
      const jsonl = JSON.stringify({
        type: 'assistant_message',
        id: 'evt_2',
        timestamp: 1710000001,
        assistant_message: { content: 'Created index.html with responsive design', attachments: [] },
      });
      const out = formatSessionLog(jsonl);
      assert.ok(out.includes('**ASSISTANT**: Created index.html'));
    });

    it('parses tool_used', () => {
      const jsonl = JSON.stringify({
        type: 'tool_used',
        id: 'evt_3',
        tool_used: { name: 'browser', input: 'navigate to http://localhost:3000' },
      });
      const out = formatSessionLog(jsonl);
      assert.ok(out.includes('[TOOL: browser]'));
    });

    it('skips status_update events gracefully', () => {
      const jsonl = JSON.stringify({
        type: 'status_update',
        status_update: { agent_status: 'thinking' },
      });
      const out = formatSessionLog(jsonl);
      assert.equal(out.trim(), '');
    });
  });

  // -- Edge cases -------------------------------------------------------------
  describe('edge cases', () => {
    it('handles mixed formats in same JSONL', () => {
      const jsonl = [
        JSON.stringify({ type: 'message', message: { role: 'user', content: 'openclaw msg' } }),
        JSON.stringify({ role: 'user', message: { content: [{ type: 'text', text: 'cursor msg' }] } }),
        JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'claude msg' }] } }),
        JSON.stringify({ type: 'item.added', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'codex msg' }] } }),
        JSON.stringify({ type: 'user_message', user_message: { content: 'manus msg' } }),
      ].join('\n');
      const out = formatSessionLog(jsonl);
      assert.ok(out.includes('openclaw msg'));
      assert.ok(out.includes('cursor msg'));
      assert.ok(out.includes('claude msg'));
      assert.ok(out.includes('codex msg'));
      assert.ok(out.includes('manus msg'));
    });

    it('skips malformed JSON lines', () => {
      const jsonl = 'not json\n{"type":"user","message":{"content":[{"type":"text","text":"valid"}]}}\n{broken';
      const out = formatSessionLog(jsonl);
      assert.ok(out.includes('valid'));
    });

    it('deduplicates repeated entries', () => {
      const line = JSON.stringify({ type: 'user', message: { content: [{ type: 'text', text: 'same' }] } });
      const jsonl = [line, line, line, line].join('\n');
      const out = formatSessionLog(jsonl);
      assert.ok(out.includes('Repeated 3 times'));
    });

    it('handles empty content gracefully', () => {
      const jsonl = JSON.stringify({ role: 'assistant', message: { content: [] } });
      const out = formatSessionLog(jsonl);
      assert.equal(out.trim(), '');
    });

    it('handles string content in message', () => {
      const jsonl = JSON.stringify({ role: 'user', message: { content: 'plain string content' } });
      const out = formatSessionLog(jsonl);
      assert.ok(out.includes('plain string content'));
    });
  });
});

describe('formatCursorTranscript (plain text)', () => {
  it('parses user/assistant blocks', () => {
    const raw = 'user:\nhow do I fix this?\nA:\nYou need to update the config.\n';
    const out = formatCursorTranscript(raw);
    assert.ok(out.includes('user:'));
    assert.ok(out.includes('how do I fix this?'));
    assert.ok(out.includes('A:'));
    assert.ok(out.includes('update the config'));
  });

  it('keeps tool call markers, skips params', () => {
    const raw = 'A:\n[Tool call] Shell\n  command: ls -la\n  description: list files\n[Tool result]\nREADME.md\nA:\ndone\n';
    const out = formatCursorTranscript(raw);
    assert.ok(out.includes('[Tool call] Shell'));
    assert.ok(!out.includes('command: ls'));
    assert.ok(!out.includes('README.md'));
    assert.ok(out.includes('done'));
  });

  it('skips XML tags', () => {
    const raw = 'user:\n<user_query>\nwhat is this?\n</user_query>\n';
    const out = formatCursorTranscript(raw);
    assert.ok(!out.includes('<user_query>'));
    assert.ok(out.includes('what is this?'));
  });
});
