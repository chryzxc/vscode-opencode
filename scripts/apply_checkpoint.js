#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.resolve(__dirname, '..');
const checkpointPath = path.join(root, '.sisyphus', 'checkpoint.json');
const restoredStatePath = path.join(root, '.sisyphus', 'restored_workspace_state.json');
const notesPath = path.join(root, '.sisyphus', 'notes.md');

async function main() {
  if (!fs.existsSync(checkpointPath)) {
    console.error('No checkpoint file at', checkpointPath);
    process.exit(2);
  }

  const raw = await fs.promises.readFile(checkpointPath, 'utf8');
  const sha = crypto.createHash('sha256').update(raw, 'utf8').digest('hex');

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch (err) {
    console.error('Invalid JSON in checkpoint file:', err.message);
    process.exit(3);
  }

  const sessions = Array.isArray(payload.sessions) ? payload.sessions : [];
  const currentSessionId = typeof payload.currentSessionId === 'string' ? payload.currentSessionId : null;
  const messages = payload.messages && typeof payload.messages === 'object' ? payload.messages : {};

  if (sessions.length === 0 && Object.keys(messages).length === 0) {
    console.error('Checkpoint payload contains no sessions or messages; aborting');
    process.exit(4);
  }

  // Build a simple workspaceState representation
  const workspaceState = {};
  workspaceState['opencode.sessions'] = sessions;
  workspaceState['opencode.currentSessionId'] = currentSessionId;
  workspaceState['opencode.session.messages'] = {};

  for (const [sid, msgs] of Object.entries(messages)) {
    workspaceState['opencode.session.messages'][sid] = Array.isArray(msgs) ? msgs : [];
  }

  await fs.promises.writeFile(restoredStatePath, JSON.stringify({ restoredAt: Date.now(), sha256: sha, workspaceState }, null, 2), 'utf8');

  // Move checkpoint out of the way
  const stamped = Date.now();
  const restoredName = path.join(path.dirname(checkpointPath), `checkpoint.restored.${stamped}.json`);
  await fs.promises.rename(checkpointPath, restoredName);

  const note = `- Restored checkpoint: ${path.basename(restoredName)}\n  - timestamp: ${new Date(stamped).toISOString()}\n  - sha256: ${sha}\n  - sessions: ${sessions.length}\n  - messagesSessions: ${Object.keys(workspaceState['opencode.session.messages']).length}\n`;
  await fs.promises.appendFile(notesPath, `# Restore note\n\n${note}\n`, 'utf8');

  console.log('Restore applied. Restored workspace state written to', restoredStatePath);
  console.log('Checkpoint moved to', restoredName);
  process.exit(0);
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
