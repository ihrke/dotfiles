// Sends one message to the host relay (notify-relay.py) over its unix socket.
// The relay holds the Slack token and can only DM the sandbox owner.
'use strict';
const fs = require('fs');
const net = require('net');

const SOCK = process.env.SANDBOX_NOTIFY_SOCKET || '/run/sandbox-notify/relay.sock';
const STATE = '/tmp/sandbox-notify';
const LAST_SENT = STATE + '/last-sent';

function sendToOwner(kind, message, file) {
  const req = { sandbox: process.env.SANDBOX_NAME || 'sandbox', kind, message, file };
  return new Promise((resolve) => {
    let buf = '';
    const s = net.createConnection(SOCK);
    s.setTimeout(90000);
    s.on('connect', () => s.end(JSON.stringify(req) + '\n'));
    s.on('data', (d) => { buf += d; });
    s.on('end', () => {
      let r;
      try { r = JSON.parse(buf); } catch { r = { ok: false, error: 'no valid reply from relay' }; }
      if (r.ok) markSent();
      resolve(r);
    });
    s.on('timeout', () => { s.destroy(); resolve({ ok: false, error: 'relay timed out' }); });
    s.on('error', (e) => resolve({
      ok: false,
      error: `relay not reachable (${e.code}); the sandbox must be started with ` +
             'claude-sandbox / claude-sci-sandbox, which starts the relay on the host',
    }));
  });
}

function markSent() {
  try {
    fs.mkdirSync(STATE, { recursive: true });
    fs.writeFileSync(LAST_SENT, String(Date.now()));
  } catch { /* only used for reminders */ }
}

function lastSent() {
  try { return Number(fs.readFileSync(LAST_SENT, 'utf8')) || 0; } catch { return 0; }
}

module.exports = { sendToOwner, lastSent, STATE };
