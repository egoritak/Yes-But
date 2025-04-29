// public/app.js

/* ─── Preload all card images ───────────────────────────── */
async function preloadCards() {
  try {
    const res = await fetch('/cards/manifest.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const files = await res.json();

    // создаём промис на каждую картинку
    const loaders = files.map(file => new Promise(resolve => {
      const img = new Image();
      img.onload  = () => resolve();
      img.onerror = () => {
        console.warn(`Не удалось загрузить /cards/${file}`);
        resolve();
      };
      img.src = `/cards/${file}`;
    }));

    // ждём, пока все картинки отработают onload/onerror
    await Promise.all(loaders);
    console.log(`✅ Preloaded ${files.length} card images`);
  } catch (err) {
    console.error('Ошибка при предзагрузке карточек:', err);
  }
}
/* ───────────────────────────────────────────────────────── */

/* ─── Инициализация приложения ─────────────────────────── */
function initApp() {
  const $ = id => document.getElementById(id);
  const s = io();

  /* ───── toast ───── */
  function toast(msg, color = '#334155') {
    const area = $('toastArea');
    const el = document.createElement('div');
    el.className = 'toast';
    el.style.background = color;
    el.textContent = msg;
    area.appendChild(el);
    setTimeout(() => el.remove(), 2500);
  }

  /* ───── DOM & state ───── */
  const landing   = $('landing');
  const lobby     = $('lobby');
  const gameSec   = $('game');

  const userName  = $('userName');
  const codeIn    = $('codeInput');
  const createBt  = $('createBtn');
  const joinBt    = $('joinBtn');

  const roomTxt   = $('roomCode');
  const copyBt    = $('copyBtn');
  const listUL    = $('playersList');
  const startBt   = $('startBtn');

  const bar       = $('playersBar');
  const infoP     = $('info');
  const handDiv   = $('hand');
  const tableDiv  = $('table');
  const playBt    = $('playBtn');
  const pairBt    = $('pairBtn');

  const pairOverlay  = $('pairOverlay');
  const pairYesEl    = $('pairYes');
  const pairNoEl     = $('pairNo');
  const pairResultEl = $('pairResult');

  const overlay      = $('countdownOverlay');

  let room = '';
  let myName = '';
  let myId = '';
  let active = '';
  let names = {};
  let selecting = [];

  /* ───── URL-параметр room ───── */
  const q = new URLSearchParams(location.search).get('room');
  if (q && /^[A-Z0-9]{4}$/.test(q.toUpperCase())) {
    codeIn.value = q.toUpperCase();
  }

  /* ───── QR helpers ───── */
  function roomUrl(code) {
    return `${location.origin}?room=${code}`;
  }
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
    } else {
      legacyCopy(text);
    }

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
    joinBt.disabled   = !(nameOK() && codeOK());
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

  /* ───── socket.io handlers ───── */
  s.on('room_created', ({ code }) => {
    room = code;
    landing.classList.add('hidden');
    lobby.classList.remove('hidden');
    roomTxt.textContent = code;
    showQR(code);
    copyBt.onclick = () => copyText(code);
    startBt.classList.remove('hidden');
  });

  s.on('lobby_state', ({ players, adminId }) => {
    listUL.innerHTML = players.map(n => `<li>${n}</li>`).join('');
    startBt.classList.toggle('hidden', adminId !== s.id);
    if (!lobby.classList.contains('hidden') || room === '') return;
    landing.classList.add('hidden');
    lobby.classList.remove('hidden');
    roomTxt.textContent = room;
    showQR(room);
    copyBt.onclick = () => copyText(room);
  });

  startBt.onclick = () => s.emit('start_game', { code: room });

  s.on('state', st => {
    lobby.classList.add('hidden');
    gameSec.classList.remove('hidden');

    myId ||= s.id;
    active = st.active;
    names = Object.fromEntries(st.players.map(p => [p.id, p.name]));

    // players bar
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

    // table
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
  });

  s.on('hand', cards => {
    handDiv.innerHTML = cards
      .map(c => cardHTML(c, { showTaken: false }))
      .join('');
    handDiv.querySelectorAll('.card').forEach(el => {
      el.onclick = () => choose(el.dataset.id);
    });
  });

  s.on('pair_reveal', ({ byName, yes, no }) => {
    pairYesEl.innerHTML = `<img src="/cards/${yes.file}" alt="">`;
    pairNoEl.innerHTML  = `<img src="/cards/${no.file}"  alt="">`;
    pairResultEl.textContent = '';
    pairOverlay.classList.remove('hidden');
  });

  s.on('pair_success', ({ byName, score }) => {
    pairResultEl.textContent = 'Успех!';
    pairResultEl.style.color = 'var(--c-green)';
    setTimeout(() => {
      pairOverlay.classList.add('hidden');
      toast(`${byName} правильно составил пару! (${score})`, '#22c55e');
    }, 2000);
  });

  s.on('pair_fail', ({ byName }) => {
    pairResultEl.textContent = 'Провал!';
    pairResultEl.style.color = 'var(--c-red)';
    setTimeout(() => {
      pairOverlay.classList.add('hidden');
      toast(`${byName} ошибся с парой`, '#ef4444');
    }, 2000);
  });

  s.on('start_countdown', ({ seconds }) => {
    overlay.textContent = seconds;
    overlay.classList.remove('hidden');
    let t = seconds;
    const iv = setInterval(() => {
      if (--t > 0) {
        overlay.textContent = t;
      } else {
        clearInterval(iv);
        overlay.classList.add('hidden');
      }
    }, 1000);
  });

  s.on('reveal', () => {
    overlay.classList.add('hidden');
    toast('Карты вскрыты', '#0ea5e9');
  });

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

  /* ───── render card HTML ───── */
  function cardHTML(c, { hidden = false, showTaken = true } = {}) {
    const takenCls = showTaken && c.taken ? ' taken' : '';
    const faceCls  = hidden ? ' face-down' : '';
    const inner    = hidden
      ? '???'
      : `<img src="/cards/${c.file}" alt="">`;
    return `
      <div class="card ${c.type}${takenCls}${faceCls}" data-id="${c.id}">
        ${inner}
      </div>`;
  }

  /* ───── initial state ───── */
  updateBtns();
}
/* ───────────────────────────────────────────────────────── */

/* ─── Запуск предзагрузки и initApp ─────────────────────── */
document.addEventListener('DOMContentLoaded', async () => {
  document.body.classList.add('preloading');
  await preloadCards();
  document.body.classList.remove('preloading');
  const ov = document.getElementById('loadingOverlay');
  if (ov) ov.style.display = 'none';
  initApp();
});
