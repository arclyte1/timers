const elements = {
  groups: document.querySelector('#groups'), connection: document.querySelector('#connection'),
  timerCount: document.querySelector('#timerCount'), runningCount: document.querySelector('#runningCount'), groupCount: document.querySelector('#groupCount'),
  timerDialog: document.querySelector('#timerDialog'), timerForm: document.querySelector('#timerForm'), timerId: document.querySelector('#timerId'),
  timerName: document.querySelector('#timerName'), timerGroup: document.querySelector('#timerGroup'), hours: document.querySelector('#hours'), minutes: document.querySelector('#minutes'), seconds: document.querySelector('#seconds'),
  currentTimeFields: document.querySelector('#currentTimeFields'), currentHours: document.querySelector('#currentHours'), currentMinutes: document.querySelector('#currentMinutes'), currentSeconds: document.querySelector('#currentSeconds'),
  groupDialog: document.querySelector('#groupDialog'), groupForm: document.querySelector('#groupForm'), groupName: document.querySelector('#groupName'), toast: document.querySelector('#toast')
};

let state = { groups: [], timers: [], serverNow: Date.now() };
let socket;
let reconnectDelay = 500;
let serverOffset = 0;
let renderPending = false;
let dialogScrollY = 0;

const escapeHtml = (value) => String(value).replace(/[&<>'"]/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[char]));
const now = () => Date.now() + serverOffset;
const remaining = (timer) => timer.running ? Math.max(0, timer.remainingMs - (now() - timer.startedAt)) : timer.remainingMs;

function formatTime(milliseconds) {
  const total = Math.max(0, Math.ceil(milliseconds / 1000));
  const days = Math.floor(total / 86400);
  const hours = Math.floor(total / 3600) % 24;
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const time = `${String(hours).padStart(2,'0')}:${String(minutes).padStart(2,'0')}:${String(seconds).padStart(2,'0')}`;
  return days ? `${days}д ${time}` : hours ? time : `${String(minutes).padStart(2,'0')}:${String(seconds).padStart(2,'0')}`;
}

function formatCompletedAt(timestamp) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  const time = date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  return sameDay ? `в ${time}` : `${date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })} в ${time}`;
}

function connect() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  socket = new WebSocket(`${protocol}//${location.host}/ws`);
  socket.addEventListener('open', () => { reconnectDelay = 500; setConnection('online', 'Синхронизировано'); });
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.type === 'state') {
      serverOffset = message.serverNow - Date.now();
      state = message;
      if ([...document.querySelectorAll('dialog')].some((dialog) => dialog.open)) renderPending = true;
      else render();
    } else if (message.type === 'error') showToast(message.message);
  });
  socket.addEventListener('close', () => {
    setConnection('offline', 'Нет связи');
    setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 1.6, 8000);
  });
  socket.addEventListener('error', () => socket.close());
}

function setConnection(status, label) {
  elements.connection.className = `connection ${status}`;
  elements.connection.querySelector('b').textContent = label;
}

function send(action) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return showToast('Нет соединения с сервером');
  socket.send(JSON.stringify({ type: 'action', action }));
}

function render() {
  elements.timerCount.textContent = state.timers.length;
  elements.runningCount.textContent = state.timers.filter((timer) => timer.running).length;
  elements.groupCount.textContent = state.groups.length;
  elements.timerGroup.innerHTML = state.groups.map((group) => `<option value="${group.id}">${escapeHtml(group.name)}</option>`).join('');
  elements.groups.innerHTML = state.groups.map(renderGroup).join('');
}

function renderGroup(group) {
  const timers = state.timers.filter((timer) => timer.groupId === group.id);
  const content = timers.length ? `<div class="timer-grid">${timers.map(renderTimer).join('')}</div>` : `<div class="empty">В этой группе пока нет таймеров<br><button class="ghost-button" data-action="add" data-group="${group.id}">＋ Добавить таймер</button></div>`;
  return `<article class="group" data-group-id="${group.id}"><header class="group-header"><div class="group-title"><span class="group-dot" style="background:${group.color}"></span><div><h3>${escapeHtml(group.name)}</h3><small>${timers.length} ${plural(timers.length, 'таймер', 'таймера', 'таймеров')}</small></div></div><div class="group-actions"><button class="icon-button" title="Добавить таймер" data-action="add" data-group="${group.id}">＋</button><button class="icon-button" title="Переименовать" data-action="rename-group" data-id="${group.id}">✎</button><button class="icon-button" title="Удалить группу" data-action="delete-group" data-id="${group.id}">×</button></div></header>${content}</article>`;
}

function renderTimer(timer) {
  const left = remaining(timer);
  const progress = timer.durationMs ? Math.max(0, Math.min(100, left / timer.durationMs * 100)) : 0;
  const urgency = left <= 0 ? 'completed' : left <= 30000 ? 'urgent' : '';
  const endedAt = left <= 0 && timer.completedAt ? `<small>Завершён ${formatCompletedAt(timer.completedAt)}</small>` : '';
  return `<article class="timer-card ${timer.running ? 'running' : ''} ${urgency}" data-timer="${timer.id}" draggable="true"><div class="timer-top"><span class="timer-name">${escapeHtml(timer.name)}</span><div class="timer-menu"><button class="icon-button" title="Изменить" data-action="edit" data-id="${timer.id}">✎</button><button class="icon-button" title="Удалить" data-action="delete" data-id="${timer.id}">×</button></div></div><div class="timer-display" data-display>${formatTime(left)}</div><div class="progress"><i data-progress style="width:${progress}%"></i></div><div class="timer-bottom"><div class="timer-state">${endedAt}</div><div style="display:flex;gap:5px"><button class="control" data-action="reset" data-id="${timer.id}" title="Сбросить">↺</button><button class="control" data-action="toggle" data-id="${timer.id}" title="${timer.running ? 'Пауза' : 'Запустить'}">${timer.running ? 'Ⅱ' : '▶'}</button></div></div></article>`;
}

function plural(number, one, few, many) {
  const mod10 = number % 10, mod100 = number % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

function openTimer(groupId, timerId) {
  const timer = state.timers.find((item) => item.id === timerId);
  elements.timerId.value = timer?.id || '';
  elements.timerName.value = timer?.name || '';
  elements.timerGroup.value = timer?.groupId || groupId || state.groups[0]?.id;
  const duration = timer?.durationMs || 25 * 60000;
  elements.hours.value = Math.floor(duration / 3600000);
  elements.minutes.value = Math.floor((duration % 3600000) / 60000);
  elements.seconds.value = Math.floor((duration % 60000) / 1000);
  elements.currentTimeFields.hidden = !timer;
  if (timer) {
    const currentSeconds = Math.ceil(remaining(timer) / 1000);
    elements.currentHours.value = Math.floor(currentSeconds / 3600);
    elements.currentMinutes.value = Math.floor((currentSeconds % 3600) / 60);
    elements.currentSeconds.value = currentSeconds % 60;
  }
  dialogScrollY = window.scrollY;
  document.querySelector('#timerDialogTitle').textContent = timer ? 'Изменить таймер' : 'Новый таймер';
  elements.timerDialog.showModal();
  elements.timerName.focus();
}

elements.groups.addEventListener('click', (event) => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const { action, id, group } = button.dataset;
  if (action === 'add') openTimer(group);
  if (action === 'toggle' || action === 'reset') send({ type: `timer.${action}`, id });
  if (action === 'edit') openTimer(null, id);
  if (action === 'delete' && confirm('Удалить этот таймер?')) send({ type: 'timer.delete', id });
  if (action === 'rename-group') {
    const current = state.groups.find((item) => item.id === id);
    const name = prompt('Название группы', current.name);
    if (name?.trim()) send({ type: 'group.update', id, name });
  }
  if (action === 'delete-group' && confirm('Удалить группу? Таймеры переместятся в первую группу.')) send({ type: 'group.delete', id });
});

let draggedTimerId = null;
elements.groups.addEventListener('dragstart', (event) => {
  const card = event.target.closest('.timer-card');
  if (!card || event.target.closest('button')) return event.preventDefault();
  draggedTimerId = card.dataset.timer;
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', draggedTimerId);
  requestAnimationFrame(() => card.classList.add('dragging'));
});
elements.groups.addEventListener('dragend', () => {
  document.querySelectorAll('.dragging,.drag-over').forEach((item) => item.classList.remove('dragging', 'drag-over'));
  draggedTimerId = null;
});
elements.groups.addEventListener('dragover', (event) => {
  if (!draggedTimerId) return;
  const group = event.target.closest('[data-group-id]');
  if (!group) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  document.querySelectorAll('.drag-over').forEach((item) => item.classList.remove('drag-over'));
  (event.target.closest('.timer-card') || group).classList.add('drag-over');
});
elements.groups.addEventListener('drop', (event) => {
  if (!draggedTimerId) return;
  const group = event.target.closest('[data-group-id]');
  if (!group) return;
  event.preventDefault();
  const target = event.target.closest('.timer-card');
  const beforeId = target?.dataset.timer === draggedTimerId ? undefined : target?.dataset.timer;
  send({ type: 'timer.move', id: draggedTimerId, groupId: group.dataset.groupId, beforeId });
});

elements.timerForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const durationMs = (+elements.hours.value * 3600 + +elements.minutes.value * 60 + +elements.seconds.value) * 1000;
  if (durationMs < 1000) return showToast('Укажите время больше нуля');
  const id = elements.timerId.value;
  const currentMs = (+elements.currentHours.value * 3600 + +elements.currentMinutes.value * 60 + +elements.currentSeconds.value) * 1000;
  if (id && currentMs < 1000) return showToast('Текущее время должно быть больше нуля');
  send({ type: id ? 'timer.update' : 'timer.create', ...(id && { id, remainingMs: currentMs }), name: elements.timerName.value, groupId: elements.timerGroup.value, durationMs });
  elements.timerDialog.close();
});

elements.groupForm.addEventListener('submit', (event) => {
  event.preventDefault();
  send({ type: 'group.create', name: elements.groupName.value });
  elements.groupDialog.close();
  elements.groupForm.reset();
});

document.querySelector('#addTimer').addEventListener('click', () => openTimer());
document.querySelector('#addGroup').addEventListener('click', () => { elements.groupDialog.showModal(); elements.groupName.focus(); });
document.querySelectorAll('.close-dialog').forEach((button) => button.addEventListener('click', () => button.closest('dialog').close()));
// Не закрываем окно по клику на затемнении: такое событие может возникнуть после
// выделения текста или окончания drag-жеста за границами формы.
document.querySelectorAll('dialog').forEach((dialog) => {
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) event.stopPropagation();
  });
  dialog.addEventListener('close', () => {
    if (renderPending) {
      renderPending = false;
      render();
    }
    requestAnimationFrame(() => window.scrollTo(0, dialogScrollY));
  });
});

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add('show');
  clearTimeout(showToast.timeout);
  showToast.timeout = setTimeout(() => elements.toast.classList.remove('show'), 2800);
}

setInterval(() => {
  for (const timer of state.timers.filter((item) => item.running)) {
    const card = document.querySelector(`[data-timer="${timer.id}"]`);
    if (!card) continue;
    const left = remaining(timer);
    card.querySelector('[data-display]').textContent = formatTime(left);
    card.querySelector('[data-progress]').style.width = `${Math.max(0, left / timer.durationMs * 100)}%`;
    card.classList.toggle('urgent', left > 0 && left <= 30000);
    card.classList.toggle('completed', left <= 0);
  }
}, 200);

connect();
