const express = require('express');
const http = require('http');
const https = require('https');
const net = require('net');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer, WebSocket } = require('ws');

const PORT = Number(process.env.PORT) || 3000;
const TLS_CERT_FILE = process.env.TLS_CERT_FILE;
const TLS_KEY_FILE = process.env.TLS_KEY_FILE;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'timers.json');
const MAX_TIMERS = 1000;
const MAX_GROUPS = 100;
const MAX_DURATION_MS = 9999 * 60 * 60 * 1000;

const defaultState = {
  revision: 0,
  groups: [{ id: crypto.randomUUID(), name: 'Основные', color: '#7c5cff' }],
  timers: []
};

function loadState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    if (Array.isArray(parsed.groups) && Array.isArray(parsed.timers)) return parsed;
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('Cannot read data:', error.message);
  }
  return defaultState;
}

let state = loadState();
let saveTimer;

function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const temporary = `${DATA_FILE}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(state, null, 2));
    fs.renameSync(temporary, DATA_FILE);
  }, 80);
}

function timerRemaining(timer, now = Date.now()) {
  if (!timer.running || !timer.startedAt) return timer.remainingMs;
  return Math.max(0, timer.remainingMs - (now - timer.startedAt));
}

function normalizeExpired(now = Date.now()) {
  let changed = false;
  state.timers = state.timers.map((timer) => {
    if (timer.running && timerRemaining(timer, now) <= 0) {
      changed = true;
      return { ...timer, running: false, remainingMs: 0, startedAt: null, completedAt: now, updatedAt: now };
    }
    return timer;
  });
  return changed;
}

function publicState() {
  const now = Date.now();
  normalizeExpired(now);
  return { type: 'state', serverNow: now, ...state };
}

function broadcast() {
  const payload = JSON.stringify(publicState());
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(payload);
  }
}

function cleanText(value, fallback, max = 80) {
  const result = String(value ?? '').trim().slice(0, max);
  return result || fallback;
}

function cleanDuration(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) throw new Error('Некорректное время');
  return Math.min(Math.max(Math.round(numeric), 1000), MAX_DURATION_MS);
}

function applyAction(action) {
  const now = Date.now();
  normalizeExpired(now);

  switch (action.type) {
    case 'group.create': {
      if (state.groups.length >= MAX_GROUPS) throw new Error(`Достигнут лимит: ${MAX_GROUPS} групп`);
      const colors = ['#7c5cff', '#ff6b6b', '#25b99a', '#f6ad55', '#4e8cff', '#d65db1'];
      state.groups.push({
        id: crypto.randomUUID(),
        name: cleanText(action.name, 'Новая группа'),
        color: colors[state.groups.length % colors.length]
      });
      break;
    }
    case 'group.update': {
      const group = state.groups.find((item) => item.id === action.id);
      if (!group) throw new Error('Группа не найдена');
      group.name = cleanText(action.name, group.name);
      if (/^#[0-9a-f]{6}$/i.test(action.color || '')) group.color = action.color;
      break;
    }
    case 'group.delete': {
      if (state.groups.length === 1) throw new Error('Нельзя удалить единственную группу');
      const index = state.groups.findIndex((item) => item.id === action.id);
      if (index < 0) throw new Error('Группа не найдена');
      state.groups.splice(index, 1);
      const target = state.groups[0].id;
      state.timers.forEach((timer) => { if (timer.groupId === action.id) timer.groupId = target; });
      break;
    }
    case 'timer.create': {
      if (state.timers.length >= MAX_TIMERS) throw new Error(`Достигнут лимит: ${MAX_TIMERS} таймеров`);
      if (!state.groups.some((group) => group.id === action.groupId)) throw new Error('Группа не найдена');
      const durationMs = cleanDuration(action.durationMs);
      state.timers.push({
        id: crypto.randomUUID(), groupId: action.groupId,
        name: cleanText(action.name, 'Новый таймер'),
        durationMs, remainingMs: durationMs,
        running: true, startedAt: now, completedAt: null, createdAt: now, updatedAt: now
      });
      break;
    }
    case 'timer.update': {
      const timer = state.timers.find((item) => item.id === action.id);
      if (!timer) throw new Error('Таймер не найден');
      if (action.name !== undefined) timer.name = cleanText(action.name, timer.name);
      if (action.groupId !== undefined && state.groups.some((group) => group.id === action.groupId)) timer.groupId = action.groupId;
      const changedTime = action.durationMs !== undefined || action.remainingMs !== undefined;
      if (action.durationMs !== undefined) timer.durationMs = cleanDuration(action.durationMs);
      if (action.remainingMs !== undefined) {
        timer.remainingMs = cleanDuration(action.remainingMs);
        timer.completedAt = null;
      }
      if (changedTime) Object.assign(timer, { running: true, startedAt: now, completedAt: null });
      timer.updatedAt = now;
      break;
    }
    case 'timer.toggle': {
      const timer = state.timers.find((item) => item.id === action.id);
      if (!timer) throw new Error('Таймер не найден');
      if (timer.running) {
        timer.remainingMs = timerRemaining(timer, now);
        timer.running = false;
        timer.startedAt = null;
      } else {
        if (timer.remainingMs <= 0) timer.remainingMs = timer.durationMs;
        timer.running = true;
        timer.startedAt = now;
        timer.completedAt = null;
      }
      timer.updatedAt = now;
      break;
    }
    case 'timer.reset': {
      const timer = state.timers.find((item) => item.id === action.id);
      if (!timer) throw new Error('Таймер не найден');
      timer.remainingMs = timer.durationMs;
      timer.running = false;
      timer.startedAt = null;
      timer.completedAt = null;
      timer.updatedAt = now;
      break;
    }
    case 'timer.move': {
      const sourceIndex = state.timers.findIndex((item) => item.id === action.id);
      if (sourceIndex < 0) throw new Error('Таймер не найден');
      if (!state.groups.some((group) => group.id === action.groupId)) throw new Error('Группа не найдена');
      const [timer] = state.timers.splice(sourceIndex, 1);
      timer.groupId = action.groupId;
      timer.updatedAt = now;
      const beforeIndex = action.beforeId ? state.timers.findIndex((item) => item.id === action.beforeId && item.groupId === action.groupId) : -1;
      state.timers.splice(beforeIndex < 0 ? state.timers.length : beforeIndex, 0, timer);
      break;
    }
    case 'timer.delete': {
      const index = state.timers.findIndex((item) => item.id === action.id);
      if (index < 0) throw new Error('Таймер не найден');
      state.timers.splice(index, 1);
      break;
    }
    default: throw new Error('Неизвестное действие');
  }

  state.revision = (state.revision || 0) + 1;
  persist();
}

const app = express();
app.disable('x-powered-by');
app.use(express.static(path.join(__dirname, 'public')));
app.get('/api/health', (_request, response) => response.json({ ok: true, revision: state.revision }));
app.get('/api/state', (_request, response) => response.json(publicState()));
app.get('*', (_request, response) => response.sendFile(path.join(__dirname, 'public', 'index.html')));

const tlsEnabled = TLS_CERT_FILE && TLS_KEY_FILE;
const applicationServer = tlsEnabled
  ? https.createServer({
      cert: fs.readFileSync(TLS_CERT_FILE),
      key: fs.readFileSync(TLS_KEY_FILE)
    }, app)
  : http.createServer(app);

// When TLS is enabled, keep the current public port usable for HTTP too:
// plaintext requests receive a redirect, while TLS requests are handled normally.
const redirectServer = http.createServer((request, response) => {
  const host = request.headers.host || `localhost:${PORT}`;
  response.writeHead(308, { Location: `https://${host}${request.url}` });
  response.end();
});
const server = tlsEnabled
  ? net.createServer((socket) => {
      socket.once('data', (chunk) => {
        socket.unshift(chunk);
        const target = chunk[0] === 0x16 ? applicationServer : redirectServer;
        target.emit('connection', socket);
      });
    })
  : applicationServer;

const wss = new WebSocketServer({ server: applicationServer, path: '/ws', maxPayload: 16 * 1024 });
wss.on('connection', (socket) => {
  socket.send(JSON.stringify(publicState()));
  socket.on('message', (raw) => {
    try {
      const message = JSON.parse(raw.toString());
      if (message.type !== 'action' || !message.action) throw new Error('Некорректное сообщение');
      applyAction(message.action);
      broadcast();
    } catch (error) {
      socket.send(JSON.stringify({ type: 'error', message: error.message }));
    }
  });
});

setInterval(() => {
  if (normalizeExpired()) {
    state.revision = (state.revision || 0) + 1;
    persist();
    broadcast();
  }
}, 500);

const protocol = tlsEnabled ? 'https' : 'http';
server.listen(PORT, '0.0.0.0', () => console.log(`Sync Timers listening on ${protocol}://0.0.0.0:${PORT}`));

function shutdown() {
  clearTimeout(saveTimer);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2));
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 3000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
