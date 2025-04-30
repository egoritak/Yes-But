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

/* ─── фоновая под-загрузка картинок ───────────────────── */
async function preloadCards(concurrency = 3) {
  try {
    const res = await fetch('/cards/manifest.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const files = await res.json();

    let idx = 0;
    function loadNext() {
      if (idx >= files.length) return;
      const img = new Image();
      img.onload = img.onerror = loadNext;
      img.decoding = 'async';
      img.src = `/cards/${files[idx++]}`;
    }
    for (let i = 0; i < concurrency; i++) loadNext();
    console.log(`🔄 Preloading ${files.length} cards (${concurrency} at once)…`);
  } catch (e) {
    console.error('preloadCards:', e);
  }
}

/* ─── Инициализация приложения ────────────────────────── */
function initApp() {
  const $ = id => document.getElementById(id);
  const s = io();

  /* ───── DOM & state ───── */
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

  const pairOverlay = $('pairOverlay');
  const pairYesEl = $('pairYes');
  const pairNoEl = $('pairNo');
  const pairResultEl = $('pairResult');

  const overlay = $('countdownOverlay');
  let countdownInterval = null;

  const gameOver = $('gameOverOverlay');
  const winnerAvatar = $('winnerAvatar');
  const winnerNameEl = $('winnerName');
  const continueBtn = $('continueBtn');

  const collectionOverlay = $('collectionOverlay');
  const collectionTitle = $('collectionTitle');
  const pairsGrid = $('pairsGrid');
  const collected = {};      // {playerId: [ {yes,no} , … ]}


  let room = '', myName = '', myId = '', active = '', names = {}, selecting = [];
  let adminId = '';    // кто нажимает «Продолжить»

  /* ───── URL-параметр room ───── */
  const q = new URLSearchParams(location.search).get('room');
  if (q && /^[A-Z0-9]{4}$/.test(q.toUpperCase())) {
    codeIn.value = q.toUpperCase();
  }

  /* ───── QR helpers ───── */
  function roomUrl(code) { return `${location.origin}?room=${code}`; }
  function showQR(code) {
    const qr = $('qrImg');
    if (!qr) return;
    qr.src = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(roomUrl(code))}`;
    $('qrBox').classList.remove('hidden');
  }

  /* ───── clipboard helper ───── */
  function copyText(text) {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text)
        .then(() => toast('Код скопирован'))
        .catch(() => legacyCopy(text));
    } else legacyCopy(text);

    function legacyCopy(t) {
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
  codeIn.oninput = () => { codeIn.value = codeIn.value.toUpperCase(); updateBtns(); };

  createBt.onclick = () => {
    myName = userName.value.trim();
    s.emit('create_room', { name: myName });
  };
  joinBt.onclick = () => {
    myName = userName.value.trim();
    room = codeIn.value.trim().toUpperCase();
    if (!codeOK()) { toast('Код из 4 символов'); return; }
    s.emit('join_room', { code: room, name: myName });
    joinBt.disabled = true;                    // чтобы не спамили
  };

  /* ───── socket.io handlers ───── */
  s.on('room_created', ({ code }) => {
    room = code;
    landing.classList.add('hidden');
    lobby.classList.remove('hidden');
    roomTxt.textContent = code;
    showQR(code);
    copyBt.onclick = () => copyText(code);
    startBt.classList.remove('hidden');        // я — админ
  });

  s.on('lobby_state', ({ players, adminId: adm }) => {
    adminId = adm;
    listUL.innerHTML = players.map(n => `<li>${n}</li>`).join('');
    startBt.classList.toggle('hidden', adminId !== s.id);

    /* гость впервые вошёл → показать лобби */
    if (!landing.classList.contains('hidden')) {
      landing.classList.add('hidden');
      lobby.classList.remove('hidden');
      roomTxt.textContent = room;
      showQR(room);
      copyBt.onclick = () => copyText(room);
    }
  });

  startBt.onclick = () => s.emit('start_game', { code: room });

  /* === ЭКРАН ПОБЕДЫ === */
  s.on('game_over', ({ winnerName, winnerId, adminId: adm }) => {
    adminId = adm ?? adminId;
    // буква аватара = первая буква имени
    winnerAvatar.textContent = (names[winnerId] || winnerName)[0];
    winnerNameEl.textContent = winnerName;
    continueBtn.classList.toggle('hidden', s.id !== adminId); // кнопку видит только админ
    gameOver.classList.remove('hidden');
  });

    continueBtn.onclick = () => {
       // Очистить историю собранных пар после рестарта игры
       Object.keys(collected).forEach(pid => delete collected[pid]);
       // Запустить новую партию на сервере
       s.emit('continue_game', { code: room });
   };

  // Сброс истории при рестарте игры
  s.on('reset_collected', () => {
    Object.keys(collected).forEach(pid => delete collected[pid]);
   });


  /* ───── gameplay events ───── */
  s.on('state', st => {
    lobby.classList.add('hidden');
    gameSec.classList.remove('hidden');

    myId ||= s.id;
    active = st.active;
    names = Object.fromEntries(st.players.map(p => [p.id, p.name]));

    /* players bar */
    bar.innerHTML = st.players.map(p => `
         <div class="playerBox" data-id="${p.id}">
           <div class="avatar ${p.id === active ? 'turn' : ''}">${p.name[0]}</div>
           <div>${p.name}</div>
           <div>${p.score} пар</div>
         </div>
      `).join('');

    bar.onclick = e => {
      const box = e.target.closest('.playerBox');
      if (!box) return;

      const pid = box.dataset.id;
      const pairs = collected[pid] || [];
      if (!pairs.length) return;                    // ещё ничего не собрал

      const playerName = box.children[1].textContent;
      collectionTitle.textContent = `${playerName} — собранные пары`;

      pairsGrid.innerHTML = pairs.map(p => `
          <div class="pairItem">
            <div class="card large YES"><img src="/cards/${p.yes.file}" alt=""></div>
            <div class="card large NO"><img  src="/cards/${p.no.file}"  alt=""></div>
          </div>`).join('');

      collectionOverlay.classList.remove('hidden');
    };

    collectionOverlay.onclick = () => collectionOverlay.classList.add('hidden');


    infoP.textContent = active
      ? (active === myId ? 'Ваш ход' : `Ход ${names[active]}`)
      : 'Ожидаем начала партии…';

    /* стол */
    tableDiv.innerHTML = st.table
      .map(c => cardHTML(c, { hidden: c.text === '???', showTaken: true }))
      .join('');
    tableDiv.querySelectorAll('.card').forEach(el => {
      el.onclick = () => s.emit('claim_card', { code: room, cardId: el.dataset.id });
    });

    $('deckLeft').textContent = `В колоде – ${st.left} карт`;

    const myTurn = active === myId;
    const tableFull = st.table.length >= st.players.length;
    playBt.disabled = !myTurn || st.revealed || tableFull;
    pairBt.disabled = playBt.disabled;
    if (!myTurn) clearSel();
    if (!gameOver.classList.contains('hidden')) gameOver.classList.add('hidden');
  });

  s.on('hand', cards => {
    handDiv.innerHTML = cards.map(c => cardHTML(c, { showTaken: false })).join('');
    handDiv.querySelectorAll('.card').forEach(el => {
      el.onclick = () => choose(el.dataset.id);
    });
  });

  /* ───── пара / тосты / обратный отсчёт ───── */
  s.on('start_countdown', ({ seconds }) => {
    overlay.textContent = seconds;
    overlay.classList.remove('hidden');

    clearInterval(countdownInterval);
    let t = seconds;
    countdownInterval = setInterval(() => {
      t--;
      if (t > 0) overlay.textContent = t;
      else {
        clearInterval(countdownInterval);
        overlay.classList.add('hidden');
      }
    }, 1000);                                // как в оригинале
  });

  s.on('reveal', () => {
    clearInterval(countdownInterval);
    overlay.classList.add('hidden');
    toast('Карты вскрыты', '#0ea5e9');
  });

  s.on('pair_reveal', ({ yes, no }) => {
    pairYesEl.innerHTML = `<img src="/cards/${yes.file}" alt="">`;
    pairNoEl.innerHTML = `<img src="/cards/${no.file}"  alt="">`;
    pairResultEl.textContent = '';
    pairOverlay.classList.remove('hidden');
  });

  s.on('pair_success', ({ byName, playerId, score, yes, no }) => {
    pairResultEl.textContent = 'Успех!';
    pairResultEl.style.color = 'var(--c-green)';
    setTimeout(() => { pairOverlay.classList.add('hidden'); }, 1800);
    toast(`${byName} правильно составил пару! (${score})`, '#22c55e');

    collected[playerId] = collected[playerId] || [];
    collected[playerId].push({ yes, no });

  });

  s.on('pair_fail', ({ byName }) => {
    pairResultEl.textContent = 'Провал!';
    pairResultEl.style.color = 'var(--c-red)';
    setTimeout(() => { pairOverlay.classList.add('hidden'); }, 1800);
    toast(`${byName} ошибся с парой`, '#ef4444');
  });

  /* ───── прочие уведомления ───── */
  s.on('card_claimed', ({ cardId, byName }) => {
    const el = tableDiv.querySelector(`[data-id="${cardId}"]`);
    if (el) el.classList.add('taken');
    toast(`${byName} забрал карту`);
  });
  s.on('pair_attempt', ({ byName }) => toast(`${byName} пытается составить пару…`, '#f59e0b'));
  s.on('game_over', ({ winnerName }) => toast(`${winnerName} победил! Новая партия…`, '#6366f1'));
  s.on('error_msg', msg => toast(msg, '#ef4444'));

  /* ───── действия ───── */
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

  /* ───── карточка ───── */
  function cardHTML(c, { hidden = false, showTaken = true } = {}) {
    const takenCls = showTaken && c.taken ? ' taken' : '';
    const faceCls = hidden ? ' face-down' : '';
    const inner = hidden ? '???' : `<img src="/cards/${c.file}" alt="">`;
    return `<div class="card ${c.type}${takenCls}${faceCls}" data-id="${c.id}">${inner}</div>`;
  }

  updateBtns();
}

/* ─── Старт: UI сразу, картинки в фоне ─────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  initApp();                      // UI + Socket.IO
  setTimeout(preloadCards, 1000); // через секунду — фоновый preload
});