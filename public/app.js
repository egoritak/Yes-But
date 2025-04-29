// public/app.js
/* ───── toast ───── */
function toast(msg, color = '#334155') {
  const area = document.getElementById('toastArea');
  const el   = document.createElement('div');
  el.className     = 'toast';
  el.style.background = color;
  el.textContent   = msg;
  area.appendChild(el);
  setTimeout(() => el.remove(), 2500);
}

/* ─── фоновая под-загрузка картинок ─────────────────────── */
async function preloadCards(concurrency = 3) {
  try {
    const res = await fetch('/cards/manifest.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const files = await res.json();

    let index = 0;
    function loadNext() {
      if (index >= files.length) return;
      const img = new Image();
      img.onload  = img.onerror = loadNext;      // когда текущая закончится — грузим следующую
      img.decoding = 'async';
      img.src = `/cards/${files[index++]}`;
    }
    // стартуем первые N потоков
    for (let i = 0; i < concurrency; i++) loadNext();

    console.log(`🔄 Card preloading started (${files.length} files, ${concurrency} at once)`);
  } catch (e) {
    console.error('preloadCards:', e);
  }
}

/* ─── основной код приложения ───────────────────────────── */
function initApp() {
  const $ = id => document.getElementById(id);
  const s = io();                        // Socket.IO сразу!

  /* --- DOM & state (без изменений) ------------------------------------- */
  const landing = $('landing'), lobby = $('lobby'), gameSec = $('game');
  const userName = $('userName'), codeIn = $('codeInput');
  const createBt = $('createBtn'), joinBt = $('joinBtn');
  const roomTxt = $('roomCode'), copyBt = $('copyBtn'), listUL = $('playersList');
  const startBt = $('startBtn'), bar = $('playersBar'), infoP = $('info');
  const handDiv = $('hand'), tableDiv = $('table'), playBt = $('playBtn'), pairBt = $('pairBtn');
  const pairOverlay = $('pairOverlay'), pairYesEl = $('pairYes'), pairNoEl = $('pairNo'), pairResultEl = $('pairResult');
  const overlay = $('countdownOverlay');

  let room = '', myName = '', myId = '', active = '', names = {}, selecting = [];

  /* --- URL-параметр room ------------------------------------------------ */
  const q = new URLSearchParams(location.search).get('room');
  if (q && /^[A-Z0-9]{4}$/.test(q)) codeIn.value = q.toUpperCase();

  /* --- helpers ---------------------------------------------------------- */
  const nameOK = () => userName.value.trim().length > 0;
  const codeOK = () => /^[A-Z0-9]{4}$/.test(codeIn.value.trim());
  function updateBtns() {
    createBt.disabled = !nameOK();
    joinBt.disabled   = !(nameOK() && codeOK());
  }

  /* --- Landing ---------------------------------------------------------- */
  userName.oninput = updateBtns;
  codeIn.oninput   = () => { codeIn.value = codeIn.value.toUpperCase(); updateBtns(); };

  createBt.onclick = () => {
    myName = userName.value.trim();
    s.emit('create_room', { name: myName });
  };
  joinBt.onclick = () => {
    myName = userName.value.trim();
    room   = codeIn.value.trim().toUpperCase();
    if (!codeOK()) { toast('Код из 4 символов'); return; }
    s.emit('join_room', { code: room, name: myName });
  };

  /* --- Socket.IO события (без изменений логики) ------------------------ */
  s.on('room_created', ({ code }) => {
    room = code;
    landing.classList.add('hidden');
    lobby.classList.remove('hidden');
    roomTxt.textContent = code;
    copyBt.onclick = () => navigator.clipboard.writeText(code).then(() => toast('Код скопирован'));
    startBt.classList.remove('hidden');
  });

  s.on('lobby_state', ({ players, adminId }) => {
    listUL.innerHTML = players.map(n => `<li>${n}</li>`).join('');
    startBt.classList.toggle('hidden', adminId !== s.id);
  });

  startBt.onclick = () => s.emit('start_game', { code: room });

  s.on('state', st => {
    lobby.classList.add('hidden');
    gameSec.classList.remove('hidden');

    myId ||= s.id;
    active = st.active;
    names  = Object.fromEntries(st.players.map(p => [p.id, p.name]));

    /* players bar */
    bar.innerHTML = st.players.map(p => `
      <div class="playerBox">
        <div class="avatar ${p.id === active ? 'turn' : ''}">${p.name[0]}</div>
        <div>${p.name}</div><div>${p.score} пар</div>
      </div>`).join('');

    infoP.textContent = active
      ? (active === myId ? 'Ваш ход' : `Ход ${names[active]}`)
      : 'Ожидаем начала партии…';

    /* стол */
    tableDiv.innerHTML = st.table.map(c => cardHTML(c, { hidden: c.text === '???', showTaken: true })).join('');
    tableDiv.querySelectorAll('.card').forEach(el => {
      el.onclick = () => s.emit('claim_card', { code: room, cardId: el.dataset.id });
    });

    $('deckLeft').textContent = `В колоде – ${st.left} карт`;

    const myTurn   = active === myId;
    const tableFull = st.table.length >= st.players.length;
    playBt.disabled = !myTurn || st.revealed || tableFull;
    pairBt.disabled = playBt.disabled;
    if (!myTurn) clearSel();
  });

  s.on('hand', cards => {
    handDiv.innerHTML = cards.map(c => cardHTML(c, { showTaken: false })).join('');
    handDiv.querySelectorAll('.card').forEach(el => {
      el.onclick = () => choose(el.dataset.id);
    });
  });

  /* --- пара/тосты/прочее (оставлено без изменений) --------------------- */
  s.on('pair_reveal', ({ yes, no }) => {
    pairYesEl.innerHTML = `<img src="/cards/${yes.file}" alt="">`;
    pairNoEl.innerHTML  = `<img src="/cards/${no.file}"  alt="">`;
    pairOverlay.classList.remove('hidden');
    pairResultEl.textContent = '';
  });
  s.on('pair_success', ({ byName, score }) => {
    pairResultEl.textContent = 'Успех!';
    pairResultEl.style.color = 'var(--c-green)';
    setTimeout(() => { pairOverlay.classList.add('hidden'); }, 1800);
    toast(`${byName}: пара (${score})`, '#22c55e');
  });
  s.on('pair_fail',   ({ byName }) => {
    pairResultEl.textContent = 'Провал!';
    pairResultEl.style.color = 'var(--c-red)';
    setTimeout(() => { pairOverlay.classList.add('hidden'); }, 1800);
    toast(`${byName} ошибся с парой`, '#ef4444');
  });

  /* --- действия --------------------------------------------------------- */
  playBt.onclick = () => { clearSel(); s.emit('play_card', { code: room }); };
  pairBt.onclick = () => toast('Выберите «Да» и «Но» в руке', '#f59e0b');

  function choose(id) {
    if (active !== myId || selecting.includes(id)) return;
    selecting.push(id);
    document.querySelector(`[data-id="${id}"]`).style.outline = '3px solid #2563eb';
    if (selecting.length === 2) {
      const y = selecting.find(i => i.startsWith('Y'));
      const n = selecting.find(i => i.startsWith('N'));
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

  function cardHTML(c, { hidden = false, showTaken = true } = {}) {
    const takenCls = showTaken && c.taken ? ' taken' : '';
    const faceCls  = hidden ? ' face-down' : '';
    const inner    = hidden ? '???' : `<img src="/cards/${c.file}" alt="">`;
    return `<div class="card ${c.type}${takenCls}${faceCls}" data-id="${c.id}">${inner}</div>`;
  }

  updateBtns();
}

/* ─── Старт: UI сразу, картинки в фоне ─────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  initApp();              // 1) поднимаем сокет и всю логику
  setTimeout(preloadCards, 1000); // 2) через секунду начинаем фон-загрузку
});
