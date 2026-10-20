#!/usr/bin/env node
// Minimal MCP server (stdio, no dependencies) with one tool, notify_owner,
// which DMs the sandbox owner on Slack through the host relay.
'use strict';
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { sendToOwner } = require('./relay-client');

const MAX_FILE = 5 * 1024 * 1024;

const INSTRUCTIONS = `notify_owner sends a Slack DM to the owner of this sandbox (the only possible recipient). The owner is often away while you work; this is how you reach them. Replies do NOT come back through Slack: the owner answers in this session's terminal.

When to use it:
- kind "escalation": you are blocked on something only the owner can decide or provide (unclear or conflicting instructions where you would otherwise guess big, missing access/credentials/data, a needed action that is risky or irreversible), or you found something they must know now (data loss, a security problem, broken master, a task that cannot be done as asked). Say what you need, the options, your recommendation, and what you will do meanwhile. Then continue with work that does not depend on the answer; stop only if nothing is left. Before ending your turn with a question to the owner during a long unattended run, send an escalation first.
- kind "progress": interim summary during long runs (when a hook reminds you, by default once a day of unattended work). 3-6 lines: done so far, current step, next steps, problems.
- kind "done": when a long unattended run finishes. Outcome first, then where to look (branch, files, log).

Keep messages short (Slack mrkdwn: *bold*, \`code\`, bullet lines). One message per issue; no routine chatter. Never include secrets, tokens or the contents of private data. file_path attaches one file (max 5 MB), e.g. a plot or report.`;

const TOOL = {
  name: 'notify_owner',
  description: 'Send a short Slack DM to the sandbox owner: an escalation (you need their input), ' +
    'an interim progress summary, or a finished-run summary. Optionally attach one file.',
  inputSchema: {
    type: 'object',
    properties: {
      kind: { type: 'string', enum: ['escalation', 'progress', 'done'] },
      message: { type: 'string', description: 'The message (Slack mrkdwn), short.' },
      file_path: { type: 'string', description: 'Optional file to attach (max 5 MB).' },
    },
    required: ['kind', 'message'],
  },
};

const out = (obj) => process.stdout.write(JSON.stringify(obj) + '\n');
const text = (t, isError = false) => ({ content: [{ type: 'text', text: t }], isError });

async function notify(args) {
  const kind = args.kind;
  const message = String(args.message || '').trim();
  if (!['escalation', 'progress', 'done'].includes(kind)) return text('kind must be escalation, progress or done', true);
  if (!message) return text('message is empty', true);
  let file;
  if (args.file_path) {
    const p = path.resolve(String(args.file_path));
    let st;
    try { st = fs.statSync(p); } catch { return text(`cannot read ${p}`, true); }
    if (!st.isFile()) return text(`${p} is not a file`, true);
    if (st.size > MAX_FILE) return text(`${p} is larger than 5 MB`, true);
    file = { name: path.basename(p), b64: fs.readFileSync(p).toString('base64') };
  }
  const r = await sendToOwner(kind, message, file);
  if (!r.ok) return text(`Not sent: ${r.error}`, true);
  return text('Sent to the owner on Slack. Replies come in this terminal, not via Slack.');
}

async function handle(msg) {
  const { id, method, params } = msg;
  if (id === undefined) return;   // notification
  try {
    if (method === 'initialize') {
      return out({ jsonrpc: '2.0', id, result: {
        protocolVersion: (params && params.protocolVersion) || '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'sandbox-notify', version: '1.0.0' },
        instructions: INSTRUCTIONS,
      } });
    }
    if (method === 'ping') return out({ jsonrpc: '2.0', id, result: {} });
    if (method === 'tools/list') return out({ jsonrpc: '2.0', id, result: { tools: [TOOL] } });
    if (method === 'tools/call') {
      if (params.name !== TOOL.name) return out({ jsonrpc: '2.0', id, error: { code: -32602, message: 'unknown tool' } });
      return out({ jsonrpc: '2.0', id, result: await notify(params.arguments || {}) });
    }
    out({ jsonrpc: '2.0', id, error: { code: -32601, message: `method not found: ${method}` } });
  } catch (e) {
    out({ jsonrpc: '2.0', id, error: { code: -32603, message: String(e) } });
  }
}

readline.createInterface({ input: process.stdin }).on('line', (line) => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  handle(msg);
});
