const os = require('os');

/* eslint-disable no-console */
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
const srv = http.createServer(app);
const io = new Server(srv);
app.use(express.static('public'));

const YES = 'YES', NO = 'NO';

const cardsDir = path.join(__dirname, 'public', 'cards');
app.get('/cards/manifest.json', (req, res) => {
  fs.readdir(cardsDir, (err, files) => {
    if (err) return res.status(500).json({ error: 'Cannot list card files' });
    // Оставляем только изображения
    const imgs = files.filter(f => /\.(png|jpe?g|webp)$/i.test(f));
    res.json(imgs);
  });
});

/* ── вспомогательные ── */
const genCode = () => crypto.randomBytes(2).toString('hex').toUpperCase();
const shuffle = a => {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.random() * (i + 1) | 0;
    [a[i], a[j]] = [a[j], a[i]];
  }
};

// вверху server.js
const ALL_PAIRS = (() => {
  const dir = path.join(__dirname, 'public', 'cards');
  const g = {};                               // {'001':{Y:'001_Y.png',B:'001_B.png'}}
  fs.readdirSync(dir).forEach(f => {
    const m = f.match(/^(\d+)_([YB])\.(png|jpg|jpeg|webp)$/i);
    if (!m) return;
    const [, id, k] = m;
    (g[id] = g[id] || {})[k] = f;
  });
  return Object.entries(g)                  // массив только полных пар
    .filter(([, o]) => o.Y && o.B)  // [['001',{Y:'..',B:'..'}],…]
    .map(([id, o]) => ({ id, Y: o.Y, B: o.B }));
})();                                        // ALL_PAIRS.length может быть 50–100…

/* ── читаем ВСЕ картинки один раз при запуске ── */
const MASTER_PAIRS = (() => {
  const dir = path.join(__dirname, 'public', 'cards');
  const groups = {};                         // {'001':{Y:'001_Y.png',B:'001_B.png'}}
  fs.readdirSync(dir).forEach(f => {
    const m = f.match(/^(\d+)_([YB])\.(png|jpg|jpeg|webp)$/i);
    if (!m) return;
    const [, id, k] = m;
    (groups[id] = groups[id] || {})[k] = f;
  });
  return Object.entries(groups)            // [['001',{Y:'..',B:'..'}], …]
    .filter(([, o]) => o.Y && o.B)       // только полные пары
    .map(([id, o]) => ({ id, fileY: o.Y, fileN: o.B }));
})();

/* ── Класс Game ── */
class Game {
  constructor(code, adminId) {
    this.id = code; this.admin = adminId;
    this.started = false;
    this.players = [];       // {id,name,hand,score,claimed}
    this.removed = new Set();
    this.turnIdx = 0; this.table = []; this.revealed = false;
    this.buildDeck();
    this.finalRound = false;       // флаг последнего круга
    this.playersPassed = new Set(); // кто уже спасанул в финальном раунде
  }

  startRound() {                            // вызываем из 'start_game' и resetParty()
    const need = 3 * this.players.length + 1;            // 3 N + 1
    const shuffled = [...ALL_PAIRS];
    shuffle(shuffled);
    const picked = shuffled.slice(0, need);            // ровно нужное число пар

    this.deck = [];                                     // кладём обе половинки
    picked.forEach(p => {
      this.deck.push({ id: `Y${p.id}`, type: YES, file: p.Y, pair: p.id });
      this.deck.push({ id: `N${p.id}`, type: NO, file: p.B, pair: p.id });
    });
    shuffle(this.deck);
    this.left = this.deck.length;
  }

  buildDeck() {
    this.deck = [];
    MASTER_PAIRS.forEach(p => {
      if (this.removed.has(`Y${p.id}`) || this.removed.has(`N${p.id}`)) return;
      this.deck.push({ id: `Y${p.id}`, type: YES, file: p.fileY, pair: p.id });
      this.deck.push({ id: `N${p.id}`, type: NO, file: p.fileN, pair: p.id });
    });
    shuffle(this.deck);
    this.left = this.deck.length;            // карт в колоде
  }

  /* собрать новую, исключив id в exclude */
  freshDeck(exclude) {
    const d = [];
    MASTER_PAIRS.forEach(p => {
      const y = `Y${p.id}`, n = `N${p.id}`;
      if (!exclude.has(y) && !this.removed.has(y))
        d.push({ id: y, type: YES, file: p.fileY, pair: p.id });
      if (!exclude.has(n) && !this.removed.has(n))
        d.push({ id: n, type: NO, file: p.fileN, pair: p.id });
    });
    shuffle(d); return d;
  }

  player(id) { return this.players.find(p => p.id === id); }
  room() { return io.to(this.id); }

  deal(pl, n = 1) {
    let given = 0;
    while (n--) {
      if (!this.deck.length) {
        const inPlay = new Set(
          this.players.flatMap(p => p.hand.map(c => c.id))
            .concat(this.table.map(c => c.id))
        );
        this.deck = this.freshDeck(inPlay);
        if (!this.deck.length) break;        // колода пуста
      }
      const card = this.deck.pop();
      if (!card) break;
      pl.hand.push(card);
      given++; this.left = this.deck.length;
    }
    return given > 0;
  }

  nextTurn() { this.turnIdx = (this.turnIdx + 1) % this.players.length; this.emitState(); }

  emitLobby() {
    this.room().emit('lobby_state', {
      players: this.players.map(p => p.name),
      adminId: this.admin
    });
  }
  emitState() {
    this.room().emit('state', {
      players: this.players.map(p => ({ id: p.id, name: p.name, score: p.score, handCount: p.hand.length })),
      active: this.players[this.turnIdx]?.id,
      table: this.revealed ? this.table
        : this.table.map(c => ({ ...c, text: '???' })),
      left: this.left,
      revealed: this.revealed
    });
    this.players.forEach(p => io.to(p.id).emit('hand', p.hand));
  }

  resetParty() {
    // Сбрасываем всю логику финального раунда
    this.finalRound = false;
    this.playersPassed = new Set();

    this.turnIdx = 0; this.table = []; this.revealed = false; this.removed = new Set();
    this.startRound();
    this.players.forEach(p => { p.hand = []; p.score = 0; p.claimed = false; this.deal(p, 2); });
    this.emitState();
  }
}

/* ── хранилище комнат ── */
const rooms = new Map();

/* ── Socket.IO ── */
io.on('connection', sock => {

  sock.on('create_room', ({ name }) => {
    const code = genCode();
    const g = new Game(code, sock.id);
    rooms.set(code, g);
    sock.join(code);
    g.players.push({ id: sock.id, name, hand: [], score: 0, claimed: false });
    sock.emit('room_created', { code });
    g.emitLobby();
  });

  sock.on('join_room', ({ code, name }) => {
    const g = rooms.get(code);
    if (!g || g.started) { sock.emit('error_msg', 'Комната не найдена'); return; }
    sock.join(code);
    g.players.push({ id: sock.id, name, hand: [], score: 0, claimed: false });
    g.emitLobby();
  });

  sock.on('start_game', ({ code }) => {
    const g = rooms.get(code);
    if (!g || g.started || g.admin !== sock.id) return;
    g.started = true;
    g.startRound();
    g.players.forEach(p => g.deal(p, 2));
    g.emitState();
  });

  /* ---- gameplay ---- */
  sock.on('play_card', ({ code }) => {
    const g = rooms.get(code); if (!g || !g.started) return;
    if (!g || !g.started) return;
    if (g.players[g.turnIdx].id !== sock.id) return;
    const pl = g.player(sock.id);
    if (!pl.hand.length) return;
    if (g.revealed || g.table.length >= g.players.length) return;

    // 1) сыграли карту
    const card = pl.hand.shift();
    g.table.push({ ...card, owner: sock.id, taken: false });
    const allPlayed = g.table.length === g.players.length;

    // 2) сразу отдаем текущее состояние (карты всё ещё закрыты)
    g.emitState();

    if (allPlayed) {
      // начинаем отсчет (N секунд)
      const N = 3; // или любое другое время
      g.room().emit('start_countdown', { seconds: N });

      // через N секунд раскрываем карты и передаём ход
      setTimeout(() => {
        g.revealed = true;
        g.room().emit('reveal');
        g.emitState();
        //g.nextTurn();
      }, N * 1000);
    } else {
      // если не все выложили — сразу переход хода
      g.nextTurn();
    }
  });

  sock.on('claim_card', ({ code, cardId }) => {
    const g = rooms.get(code); if (!g || !g.started || !g.revealed) return;
    const pl = g.player(sock.id); if (pl.claimed) return;
    const card = g.table.find(c => c.id === cardId); if (!card || card.taken) return;

    card.taken = true; pl.claimed = true;
    pl.hand.push({ ...card, taken: false });
    g.room().emit('card_claimed', { cardId, byName: pl.name });

    const done = g.table.every(c => c.taken) || g.players.every(p => p.claimed);
    if (done) {
      g.players.forEach(p => { p.claimed = false; g.deal(p); });
      g.table = []; g.revealed = false;
      g.nextTurn();                      // ← теперь меняем ход
      g.emitState();
    }
  });

  sock.on('make_pair', ({ code, yesId, noId }) => {
    const g = rooms.get(code); if (!g || !g.started) return;
    if (g.players[g.turnIdx].id !== sock.id) return;
    const pl = g.player(sock.id);

    const tableFull = g.table.length >= g.players.length;
    if (g.revealed || tableFull) return;

    const yi = pl.hand.findIndex(c => c.id === yesId && c.type === YES);
    const ni = pl.hand.findIndex(c => c.id === noId && c.type === NO);
    if (yi === -1 || ni === -1) return;

    const yes = pl.hand.splice(yi, 1)[0];
    const no = pl.hand.splice(ni < yi ? ni : ni - 1, 1)[0];

    // 1) сразу показываем всем, какие две карты пытаются составить
    g.room().emit('pair_reveal', { byName: pl.name, yes, no });

    // 2) через секунду оцениваем и шлём успех или провал
    setTimeout(() => {
      if (yes.pair === no.pair) {
        pl.score++;
        g.removed.add(yes.id); g.removed.add(no.id);
        g.room().emit('pair_success', {
          byName : pl.name,
          playerId: pl.id,       // ← кому принадлежит пара
          score  : pl.score,
          yes,                    // обе карты
          no
        });
        if (pl.score >= 3 && !g.finalRound) {
          g.finalRound = true;              // активируем последний круг
          g.playersPassed = new Set();      // обнуляем тех, кто уже спасовал
          g.room().emit('final_round', { initiator: pl.name });
        }
        
        // проверка конца финального круга
        if (g.finalRound && (pl.score >= 3 || pl.hand.length === 0)) {
          g.playersPassed.add(pl.id);
          if (g.playersPassed.size === g.players.length) {
            g.started = false;  // окончательный конец игры
            const winners = g.players.filter(p => p.score >= 3).map(p => p.name);
            g.room().emit('game_over_final', {
              winners,
              adminId: g.admin
            });
            return;
          }
        }        
      } else {
        g.deck.push(yes, no); shuffle(g.deck);
        g.room().emit('pair_fail', { byName: pl.name });
      }

      // добор и передача хода как раньше
      while (pl.hand.length < 2 && g.deal(pl));
      if (pl.hand.length === 0) g.nextTurn();
      else g.emitState();
    }, 1000);
  });

  sock.on('pass_turn', ({ code }) => {
    const g = rooms.get(code); if (!g || !g.started) return;
    if (g.players[g.turnIdx].id !== sock.id) return;
  
    if (g.finalRound) {
      g.playersPassed.add(sock.id);
      if (g.playersPassed.size === g.players.length) {
        g.started = false;
        const winners = g.players.filter(p => p.score >= 3).map(p => p.name);
        g.room().emit('game_over_final', {
          winners,
          adminId: g.admin
        });
        return;
      }
    }
    
    g.nextTurn();
  });
  

  sock.on('continue_game', ({ code }) => {
    const g = rooms.get(code);
    if (!g || g.started || g.admin !== sock.id) return;   // только админ и только в паузе
    g.started = true;            // снова играем
    g.resetParty();              // формирует новую колоду, раздаёт карты и emitState()
    g.room().emit('reset_collected'); // Сброс истории собранных пар на клиентах
  });  

  /* ---- disconnect ---- */
  sock.on('disconnect', () => {
    rooms.forEach((g, code) => {
      const idx = g.players.findIndex(p => p.id === sock.id);
      if (idx === -1) return;
      const wasAdmin = g.admin === sock.id;
      g.players.splice(idx, 1);

      if (!g.started && g.players.length === 0) { rooms.delete(code); return; }
      if (!g.started && wasAdmin) { g.admin = g.players[0].id; }

      if (g.started && g.turnIdx >= g.players.length) g.turnIdx = 0;
      g.started ? g.emitState() : g.emitLobby();
    });
  });
});

/* ── run ── */
const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';

srv.listen(PORT, HOST, () => {
  // Собираем все сетевые IPv4-адреса, кроме internal
  const nets = os.networkInterfaces();
  const addresses = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        addresses.push(net.address);
      }
    }
  }

  console.log(`Yes-But server listening on port ${PORT}.`);
  console.log(`Accessible URLs:`);
  addresses.forEach(addr => {
    console.log(`  http://${addr}:${PORT}`);
  });
  console.log(`  http://localhost:${PORT}`);
});