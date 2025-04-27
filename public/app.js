/* ───── toast ───── */
function toast(msg, color = '#334155') {
  const area = document.getElementById('toastArea');
  const el = document.createElement('div');
  el.className = 'toast';
  el.style.background = color;
  el.textContent = msg;
  area.appendChild(el);
  setTimeout(() => el.remove(), 2500);
}


/* ───── DOM & state ───── */
const $ = id => document.getElementById(id);
const s = io();

const landing = $('landing');
const lobby = $('lobby');
const gameSec = $('game');

const userName = $('userName');
const codeIn = $('codeInput');
const createBt = $('createBtn');
const joinBt = $('joinBtn');

const roomTxt = $('roomCode');
const copyBt = $('copyBtn');
const listUL = $('playersList');
const startBt = $('startBtn');

const bar = $('playersBar');
const infoP = $('info');
const handDiv = $('hand');
const tableDiv = $('table');
const playBt = $('playBtn');
const pairBt = $('pairBtn');

const pairOverlay = document.getElementById('pairOverlay');
const pairYesEl = document.getElementById('pairYes');
const pairNoEl = document.getElementById('pairNo');
const pairResultEl = document.getElementById('pairResult');

let room = '', myName = '', myId = '', active = '', names = {}, selecting = [];

const q = new URLSearchParams(location.search).get('room');
if (q && /^[A-Z0-9]{4}$/.test(q.toUpperCase())) {
  codeIn.value = q.toUpperCase();
}

// ---- QR helpers ----
function roomUrl(code) {
  return `${location.origin}?room=${code}`;
}
function showQR(code) {
  const qr = $('qrImg');
  if (!qr) return;
  const url = roomUrl(code);
  // берём готовую картинку с публичного API (200×200 px)
  qr.src = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(url)}`;
  $('qrBox').classList.remove('hidden');
}

/* ---- clipboard helper ----------------------------------- */
function copyText(text) {
  if (navigator.clipboard?.writeText) {          // HTTPS или localhost
    navigator.clipboard.writeText(text)
      .then(() => toast('Код скопирован'))
      .catch(() => legacyCopy(text));
  } else {
    legacyCopy(text);                            // fallback
  }

  function legacyCopy(t) {                       // execCommand
    const tmp = document.createElement('input');
    tmp.value = t;
    document.body.appendChild(tmp);
    tmp.select();
    document.execCommand('copy');
    tmp.remove();
    toast('Код скопирован');
  }
}

/* ───── validators ───── */
const nameOK = () => userName.value.trim().length > 0;
const codeOK = () => /^[A-Z0-9]{4}$/.test(codeIn.value.trim().toUpperCase());
function updateBtns() {
  createBt.disabled = !nameOK();
  joinBt.disabled = !(nameOK() && codeOK());
}

/* ───── landing actions ───── */
userName.oninput = updateBtns;
codeIn.oninput = () => {
  codeIn.value = codeIn.value.toUpperCase();
  updateBtns();
};

createBt.onclick = () => {
  myName = userName.value.trim();
  s.emit('create_room', { name: myName });
};

joinBt.onclick = () => {
  myName = userName.value.trim();
  room = codeIn.value.trim().toUpperCase();
  if (!codeOK()) { toast('Код из 4 символов'); return; }
  s.emit('join_room', { code: room, name: myName });
};

// 1) Показываем карты, скрываем старый текст
s.on('pair_reveal', ({ byName, yes, no }) => {
  pairYesEl.innerHTML = `<img src="cards/${yes.file}" alt="">`;
  pairNoEl.innerHTML = `<img src="cards/${no.file}"  alt="">`;
  pairResultEl.textContent = '';
  pairOverlay.classList.remove('hidden');
});

// 2) При успехе — показываем “Успех!”, ждём 2 секундs, затем прячем и toast
s.on('pair_success', ({ byName, score }) => {
  pairResultEl.textContent = 'Успех!';
  pairResultEl.style.color = 'var(--c-green)';
  setTimeout(() => {
    pairOverlay.classList.add('hidden');
    toast(`${byName} правильно составил пару! (${score})`, '#22c55e');
  }, 2000);
});

// 3) При провале — показываем “Провал!”, ждём 2 секундs, затем прячем и toast
s.on('pair_fail', ({ byName }) => {
  pairResultEl.textContent = 'Провал!';
  pairResultEl.style.color = 'var(--c-red)';
  setTimeout(() => {
    pairOverlay.classList.add('hidden');
    toast(`${byName} ошибся с парой`, '#ef4444');
  }, 2000);
});

/* ───── lobby events ───── */
s.on('room_created', ({ code }) => {
  room = code;
  landing.classList.add('hidden');
  lobby.classList.remove('hidden');
  roomTxt.textContent = code;

  showQR(code);

  copyBt.onclick = () => copyText(code);
  startBt.classList.remove('hidden');           // я — админ
});

s.on('lobby_state', ({ players, adminId }) => {
  listUL.innerHTML = players.map(n => `<li>${n}</li>`).join('');
  startBt.classList.toggle('hidden', adminId !== s.id);

  /* гость впервые вошёл → показать лобби */
  if (!lobby.classList.contains('hidden') || room === '') return;
  landing.classList.add('hidden');
  lobby.classList.remove('hidden');
  roomTxt.textContent = room;
  showQR(room);
  copyBt.onclick = () => copyText(code);
});

startBt.onclick = () => s.emit('start_game', { code: room });

/* ───── gameplay events ───── */
s.on('state', st => {
  lobby.classList.add('hidden'); gameSec.classList.remove('hidden');

  myId ||= s.id;
  active = st.active;
  names = Object.fromEntries(st.players.map(p => [p.id, p.name]));

  /* players bar */
  bar.innerHTML = '';
  st.players.forEach(p => {
    bar.insertAdjacentHTML('beforeend',
      `<div class="playerBox">
         <div class="avatar ${p.id === active ? 'turn' : ''}">${p.name[0]}</div>
         <div>${p.name}</div><div>${p.score} пар</div>
       </div>`);
  });

  infoP.textContent = active
    ? (active === myId ? 'Ваш ход' : `Ход ${names[active]}`)
    : 'Ожидаем начала партии…';

  /* стол */
  tableDiv.innerHTML = st.table.map(c => cardHTML(c, { hidden: c.text === '???', showTaken: true })).join('');
  tableDiv.querySelectorAll('.card').forEach(el => {
    el.onclick = () => s.emit('claim_card', { code: room, cardId: el.dataset.id });
  });

  $('deckLeft').textContent = `В колоде – ${st.left} карт`;

  const myTurn = active === myId;
  const tableFull = st.table.length >= st.players.length;
  const canPlay = myTurn && !st.revealed && !tableFull;
  const canPair = myTurn && !st.revealed && !tableFull;

  playBt.disabled = !canPlay;
  pairBt.disabled = !canPair;
  if (!myTurn) clearSel();
});

s.on('hand', cards => {
  handDiv.innerHTML = cards.map(c => cardHTML(c, { showTaken: false })).join('');
  handDiv.querySelectorAll('.card').forEach(el => {
    el.onclick = () => choose(el.dataset.id);
  });
});

/* ───── действия ───── */
playBt.onclick = () => { clearSel(); s.emit('play_card', { code: room }); };
pairBt.onclick = () => toast('Выберите «Да» и «Но» в руке', '#f59e0b');

function choose(id) {
  if (active !== myId || selecting.includes(id)) return;
  selecting.push(id);
  document.querySelector(`[data-id="${id}"]`).style.outline = '3px solid #2563eb';
  if (selecting.length === 2) {
    const y = selecting.find(i => i.startsWith('Y')), n = selecting.find(i => i.startsWith('N'));
    if (y && n) s.emit('make_pair', { code: room, yesId: y, noId: n });
    clearSel();
  }
}
function clearSel() {
  selecting.forEach(i => {
    const el = document.querySelector(`[data-id="${i}"]`);
    if (el) el.style.outline = '';
  });
  selecting = [];
}

const overlay = document.getElementById('countdownOverlay');
let countdownInterval;

// старт отсчёта
s.on('start_countdown', ({ seconds }) => {
  overlay.textContent = seconds;
  overlay.classList.remove('hidden');

  let t = seconds;
  clearInterval(countdownInterval);
  countdownInterval = setInterval(() => {
    t--;
    if (t > 0) {
      overlay.textContent = t;
    } else {
      clearInterval(countdownInterval);
      overlay.classList.add('hidden');
    }
  }, 2000);
});

// на событие reveal оверлей уже скрыт в setTimeout,
// но подстрахуем
s.on('reveal', () => {
  clearInterval(countdownInterval);
  overlay.classList.add('hidden');
  // ваш существующий toast или прочие реакции
  toast('Карты вскрыты! Быстрее кликай.');
});

/* ───── вспомогательные уведомления ───── */
s.on('reveal', () => toast('Карты вскрыты', '#0ea5e9'));
s.on('card_claimed', ({ cardId, byName }) => {
  const el = tableDiv.querySelector(`[data-id="${cardId}"]`);
  if (el) el.classList.add('taken');
  toast(`${byName} забрал карту`);
});
s.on('pair_attempt', ({ byName }) => toast(`${byName} пытается составить пару…`, '#f59e0b'));
s.on('pair_success', ({ byName, score }) => toast(`${byName}: пара (${score})`, '#22c55e'));
s.on('pair_fail', ({ byName }) => toast(`${byName} ошибся с парой`, '#ef4444'));
s.on('game_over', ({ winnerName }) => toast(`${winnerName} победил! Новая партия…`, '#6366f1'));
s.on('error_msg', msg => toast(msg, '#ef4444'));

/* ───── карточки ───── */
function cardHTML(c, { hidden = false, showTaken = true } = {}) {
  const takenCls = (showTaken && c.taken) ? ' taken' : '';
  const faceCls = hidden ? ' face-down' : '';    // ← новая метка
  const inner = hidden
    ? '???'
    : `<img src="cards/${c.file}" alt="">`;

  return `
    <div class="card ${c.type}${takenCls}${faceCls}"
         data-id="${c.id}">
      ${inner}
    </div>`;
}

/* init */
updateBtns();