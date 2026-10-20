#!/usr/bin/env node
// Claude Code hooks that keep the owner informed during long unattended runs.
// "Unattended" = time since the owner last typed a prompt in this session.
//   node hook.js prompt   UserPromptSubmit: owner is here, restart the clock
//   node hook.js tool     PostToolUse: remind Claude to send a progress summary
//                         every SANDBOX_SUMMARY_MINUTES (default 1440 = daily)
//   node hook.js stop     Stop: after a run of SANDBOX_DONE_MINUTES (default 20),
//                         make Claude send a done/escalation message before stopping
//   node hook.js notify   Notification: forward permission prompts to Slack
//                         after SANDBOX_DONE_MINUTES unattended (Claude cannot)
'use strict';
const fs = require('fs');
const { sendToOwner, lastSent, STATE } = require('./relay-client');

const minutes = (name, dflt) => (parseFloat(process.env[name]) || dflt) * 60000;
const SUMMARY = minutes('SANDBOX_SUMMARY_MINUTES', 1440);
const LONG_RUN = minutes('SANDBOX_DONE_MINUTES', 20);

function emit(obj) { process.stdout.write(JSON.stringify(obj)); }

async function main() {
  const event = process.argv[2];
  let input = {};
  try { input = JSON.parse(fs.readFileSync(0, 'utf8')); } catch { /* no input */ }
  const sid = String(input.session_id || 'unknown').replace(/[^\w-]/g, '');
  const file = `${STATE}/session-${sid}.json`;
  let st = {};
  try { st = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* new session */ }
  const save = () => { fs.mkdirSync(STATE, { recursive: true }); fs.writeFileSync(file, JSON.stringify(st)); };
  const now = Date.now();

  if (event === 'prompt' || !st.prompt) { st = { prompt: now }; save(); return; }
  const mins = (t) => Math.round((now - t) / 60000);

  if (event === 'tool') {
    const last = Math.max(st.prompt, lastSent(), st.reminded || 0);
    if (now - last < SUMMARY) return;
    st.reminded = now; save();
    emit({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext:
      `You have been working unattended for ${mins(st.prompt)} min and the owner has not had an ` +
      `update for ${mins(Math.max(st.prompt, lastSent()))} min. At the next sensible point, send a short interim ` +
      'summary with notify_owner (kind "progress"): done so far, current step, next steps, problems.' } });
  } else if (event === 'stop') {
    if (input.stop_hook_active || now - st.prompt < LONG_RUN) return;
    if (now - lastSent() < 3 * 60000 || (st.stopNudged || 0) > st.prompt) return;
    st.stopNudged = now; save();
    emit({ decision: 'block', reason:
      `This run took ${mins(st.prompt)} min without the owner. Before stopping, send them one notify_owner ` +
      'message: kind "done" with the outcome and where to look, or kind "escalation" if you are stopping ' +
      'because you need their input. Then end your turn.' });
  } else if (event === 'notify') {
    if (input.notification_type !== 'permission_prompt' || now - st.prompt < LONG_RUN) return;
    await sendToOwner('waiting', `Session is waiting for a permission prompt: ${input.message || ''}\n` +
      `(unattended for ${mins(st.prompt)} min; answer in the sandbox terminal)`);
  }
}

main().catch(() => {}).finally(() => process.exit(0));
