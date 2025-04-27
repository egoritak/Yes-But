/* ===== простое всплывающее сообщение ===== */
function toast(msg, color = '#334155') {
  const area = document.getElementById('toastArea');
  const el = document.createElement('div');
  el.className = 'toast';
  el.style.background = color;
  el.textContent = msg;
  area.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

/* ===== вспомогалки DOM + состояние ===== */
const $ = id => document.getElementById(id);

const landing = $('landing');
const lobby   = $('lobby');
const gameSec = $('game');

const playersList = $('playersList');
const roomCodeTxt = $('roomCode');
const copyBtn     = $('copyBtn');
const btnStart    = $('btnStart');

const playersBar  = $('playersBar');
const infoP       = $('info');
const handDiv     = $('hand');
const tableDiv    = $('table');
const playBtn     = $('playBtn');
const pairBtn     = $('pairBtn');

/* ===== Socket.IO ===== */
const s = io();

let room     = '';      // код комнаты
let myId     = '';      // socket.id
let myName   = '';
let activeId = '';
let namesMap = {};
let selecting = [];

/* ---------- LANDING кнопки ---------- */
$('btnCreate').onclick = () => {
  myName = $('creatorName').value.trim() || 'Игрок';
  s.emit('create_room', { name: myName });
};

$('btnJoin').onclick = () => {
  myName = $('joinName').value.trim()   || 'Игрок';
  room   = $('joinCode').value.trim().toUpperCase();
  if (room) s.emit('join_room', { code: room, name: myName });
};

/* ---------- LOBBY события ---------- */
s.on('room_created', ({ code }) => {
  room = code;
  landing.classList.add('hidden');
  lobby.classList.remove('hidden');
  roomCodeTxt.textContent = code;
  copyBtn.onclick = () => {
    navigator.clipboard.writeText(code);
    toast('Скопировано!');
  };
  btnStart.classList.remove('hidden'); // я — админ
});

s.on('lobby_state', ({ players, adminId }) => {
  playersList.innerHTML = players.map(n => `<li>${n}</li>`).join('');
  // показать/скрыть кнопку «Начать»
  btnStart.classList.toggle('hidden', adminId !== s.id);
  if (landing.classList.contains('hidden') === false) {
    // я присоединился: переключаемся на лобби
    landing.classList.add('hidden');
    lobby.classList.remove('hidden');
    roomCodeTxt.textContent = room;
  }
});

btnStart.onclick = () => s.emit('start_game', { code: room });

/* ---------- ИГРОВАЯ часть (state / hand / etc.) ---------- */
function renderPlayersBar(list) {
  playersBar.innerHTML = '';
  list.forEach(p => {
    const box = document.createElement('div');
    box.className = 'playerBox';
    box.innerHTML = `
      <div class="avatar ${p.id === activeId ? 'turn' : ''}">
        ${p.name[0].toUpperCase()}
      </div>
      <div>${p.name}</div>
      <div>${p.score} пар</div>`;
    playersBar.appendChild(box);
  });
}

function cardHTML(c, { hidden = false, showTaken = true } = {}) {
  const takenCls = showTaken && c.taken ? ' taken' : '';
  const text = hidden ? '???' : `${c.type === 'YES' ? 'Да' : 'Но'}: ${c.text}`;
  return `<div class="card ${c.type}${takenCls}" data-id="${c.id}">${text}</div>`;
}

s.on('state', st => {
  // перешли из лобби в игру
  lobby.classList.add('hidden');
  gameSec.classList.remove('hidden');

  myId     ||= s.id;
  activeId  = st.active;
  namesMap  = Object.fromEntries(st.players.map(p => [p.id, p.name]));

  infoP.textContent = !activeId
      ? 'Ожидаем начала партии…'
      : (activeId === myId ? 'Ваш ход' : `Ход игрока ${namesMap[activeId]}`);

  renderPlayersBar(st.players);

  // стол
  tableDiv.innerHTML = st.table.map(
    c => cardHTML(c, { hidden: c.text === '???', showTaken: true })
  ).join('');
  tableDiv.querySelectorAll('.card').forEach(el => {
    el.onclick = () => s.emit('claim_card', { code: room, cardId: el.dataset.id });
  });

  const myTurn = activeId === myId;
  playBtn.disabled = !myTurn;
  pairBtn.disabled = !myTurn;
});

/* ----- рука ----- */
s.on('hand', cards => {
  handDiv.innerHTML = cards.map(c => cardHTML(c, { showTaken: false })).join('');
  handDiv.querySelectorAll('.card').forEach(el => {
    el.onclick = () => chooseForPair(el.dataset.id);
  });
});

/* ----- gameplay helpers ----- */
playBtn.onclick = () => {
  clearSelection();
  s.emit('play_card', { code: room });
};

pairBtn.onclick = () => toast('Выберите «Да» и «Но» в руке', '#f59e0b');

function chooseForPair(id) {
  if (activeId !== myId) return;
  if (selecting.includes(id)) return;
  selecting.push(id);
  document
    .querySelector(`[data-id="${id}"]`)
    .style.outline = '3px solid #2563eb';

  if (selecting.length === 2) {
    const y = selecting.find(i => i.startsWith('Y'));
    const n = selecting.find(i => i.startsWith('N'));
    if (y && n) s.emit('make_pair', { code: room, yesId: y, noId: n });
    clearSelection();
  }
}

function clearSelection() {
  selecting.forEach(id => {
    const el = document.querySelector(`[data-id="${id}"]`);
    if (el) el.style.outline = '';
  });
  selecting = [];
}

/* ----- прочие уведомления ----- */
s.on('reveal', () => toast('Карты вскрыты! Быстрее кликай.', '#0ea5e9'));
s.on('card_claimed', ({ cardId, byName }) => {
  const el = tableDiv.querySelector(`[data-id="${cardId}"]`);
  if (el) el.classList.add('taken');
  toast(`${byName} забрал карту`);
});
s.on('pair_attempt', ({ byName }) => toast(`${byName} пытается составить пару…`, '#f59e0b'));
s.on('pair_success', ({ byName, score }) => toast(`${byName}: пара собрана (${score})`, '#22c55e'));
s.on('pair_fail', ({ byName }) => toast(`${byName} ошибся с парой`, '#ef4444'));
s.on('game_over', ({ winnerName }) => toast(`${winnerName} победил! Новая партия…`, '#6366f1'));

/* ----- ошибка: комната не найдена ----- */
s.on('error_msg', msg => toast(msg, '#ef4444'));
