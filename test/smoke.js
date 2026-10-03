const { spawn } = require('child_process');
const { mkdtempSync, rmSync } = require('fs');
const { tmpdir } = require('os');
const path = require('path');
const WebSocket = require('ws');

const port = 3187;
const dataDir = mkdtempSync(path.join(tmpdir(), 'sync-timers-'));
const child = spawn(process.execPath, ['server.js'], {
  cwd: path.join(__dirname, '..'),
  env: { ...process.env, PORT: String(port), DATA_DIR: dataDir },
  stdio: ['ignore', 'pipe', 'pipe']
});

const timeout = setTimeout(() => finish(new Error('Smoke test timeout')), 8000);
let finished = false;
let a;
let b;

function nextState(socket, predicate = () => true) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('State message timeout')), 3000);
    const handler = (raw) => {
      const message = JSON.parse(raw.toString());
      if (message.type === 'state' && predicate(message)) {
        clearTimeout(timer);
        socket.off('message', handler);
        resolve(message);
      }
    };
    socket.on('message', handler);
  });
}

async function run() {
  await new Promise((resolve, reject) => {
    child.stdout.on('data', (chunk) => chunk.toString().includes('listening') && resolve());
    child.once('exit', (code) => reject(new Error(`Server exited with ${code}`)));
  });
  const health = await fetch(`http://127.0.0.1:${port}/api/health`).then((response) => response.json());
  if (!health.ok) throw new Error('Health check failed');

  a = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  b = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const [initialA, initialB] = await Promise.all([nextState(a), nextState(b)]);
  if (initialA.groups.length !== 1 || initialB.groups.length !== 1) throw new Error('Initial state mismatch');

  const groupId = initialA.groups[0].id;
  const synced = nextState(b, (message) => message.timers.length === 1);
  a.send(JSON.stringify({ type: 'action', action: { type: 'timer.create', groupId, name: 'Smoke timer', durationMs: 5000 } }));
  const created = await synced;
  if (created.timers[0].name !== 'Smoke timer' || !created.timers[0].running || !created.timers[0].startedAt) {
    throw new Error('New timer did not start');
  }

  const adjustedState = nextState(b, (message) => message.timers[0]?.remainingMs === 9000);
  a.send(JSON.stringify({ type: 'action', action: { type: 'timer.update', id: created.timers[0].id, remainingMs: 9000 } }));
  const adjusted = await adjustedState;
  if (adjusted.timers[0].durationMs !== 5000) throw new Error('Adjusting current time changed original duration');
  if (!adjusted.timers[0].running || !adjusted.timers[0].startedAt) throw new Error('Adjusting current time stopped running timer');

  const newGroupState = nextState(a, (message) => message.groups.length === 2);
  b.send(JSON.stringify({ type: 'action', action: { type: 'group.create', name: 'Moved' } }));
  const withNewGroup = await newGroupState;
  const destinationGroup = withNewGroup.groups.find((group) => group.name === 'Moved');
  const movedState = nextState(b, (message) => message.timers[0]?.groupId === destinationGroup.id);
  a.send(JSON.stringify({ type: 'action', action: { type: 'timer.move', id: created.timers[0].id, groupId: destinationGroup.id } }));
  await movedState;
  finish();
}

function finish(error) {
  if (finished) return;
  finished = true;
  clearTimeout(timeout);
  a?.close();
  b?.close();
  child.kill('SIGTERM');
  setTimeout(() => {
    rmSync(dataDir, { recursive: true, force: true });
    if (error) {
      console.error(error);
      process.exit(1);
    }
    console.log('Smoke test passed: HTTP health and two-client WebSocket sync');
  }, 200);
}

run().catch(finish);
