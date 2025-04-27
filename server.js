/* eslint-disable no-console */
const express  = require('express');
const http     = require('http');
const { Server } = require('socket.io');

const app = express();
const srv = http.createServer(app);
const io  = new Server(srv);

app.use(express.static('public'));

/* ---------- «база» пар ---------- */
const rawPairs = [
  ['Твой самолёт прилетает вовремя',  'Твой багаж задерживается'],
  ['Ты выигрываешь 100 €',            'Потерял кошелёк'],
  ['Получаешь повышение',             'Коллега ворчит рядом весь день'],
  ['Тебя угощают кофе',               'Облил рубашку этим кофе'],
  ['Погода идеальна для пикника',     'Забыл дома бутерброды']
];
const YES = 'YES', NO = 'NO';

/* ---------- вспомогательное ---------- */
function shuffle(a){
  for (let i = a.length - 1; i > 0; i--){
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
}

/* ---------- класс Game (одна комната) ---------- */
class Game{
  constructor(roomId){
    this.id = roomId;
    this.players = [];                 // [{id,name,hand,score,claimedRound}]
    this.reset();                      // инициализировать поля партии
  }

  /* сброс партии: руки/счёт/колода,   но игроки остаются */
  reset(){
    this.turnIdx  = 0;
    this.table    = [];
    this.revealed = false;

    /* карты, выбывшие после удачных пар – никогда не раздаём снова */
    this.removed  = new Set();

    this.buildDeckFull();

    /* очистить руки и счёт, раздать по 2 карты */
    this.players.forEach(p=>{
      p.hand = [];
      p.score = 0;
      p.claimedRound = false;
      this.deal(p, 2);
    });
    this.emitState();
  }

  /* сформировать «полную» колоду, исключая removed */
  buildDeckFull(){
    this.deck = [];
    rawPairs.forEach((p,i)=>{
      const y = `Y${i}`, n = `N${i}`;
      if(!this.removed.has(y)) this.deck.push({id:y,type:YES,text:p[0],pair:i});
      if(!this.removed.has(n)) this.deck.push({id:n,type:NO ,text:p[1],pair:i});
    });
    shuffle(this.deck);
  }

  /* собрать новую колоду, исключив id в exclude */
  freshDeck(exclude){
    const deck = [];
    rawPairs.forEach((p,i)=>{
      const y=`Y${i}`, n=`N${i}`;
      if(!exclude.has(y) && !this.removed.has(y))
        deck.push({id:y,type:YES,text:p[0],pair:i});
      if(!exclude.has(n) && !this.removed.has(n))
        deck.push({id:n,type:NO ,text:p[1],pair:i});
    });
    shuffle(deck);
    return deck;
  }

  player(id){ return this.players.find(p=>p.id === id); }

  /* раздать n карт; если колода кончилась – пересобрать без дубликатов */
  deal(to, n = 1){
    let dealt = 0;
    while(n--){
      if(!this.deck.length){
        const inPlay = new Set(
          this.players.flatMap(p=>p.hand.map(c=>c.id))
            .concat(this.table.map(c=>c.id))
        );
        this.deck = this.freshDeck(inPlay);
        if(!this.deck.length) break;             // всё закончилось
      }
      to.hand.push(this.deck.pop());
      dealt++;
    }
    return dealt > 0;
  }

  nextTurn(){
    this.turnIdx = (this.turnIdx + 1) % this.players.length;
    this.emitState();
  }

  room(){ return io.to(this.id); }

  /* отправить состояние всем в комнате */
  emitState(){
    this.room().emit('state',{
      players : this.players.map(p=>({
        id:p.id, name:p.name, score:p.score, handCount:p.hand.length
      })),
      active  : this.players[this.turnIdx]?.id,
      table   : this.revealed
                ? this.table
                : this.table.map(c=>({...c,text:'???'}))
    });
    /* каждому – реальную руку */
    this.players.forEach(p=> io.to(p.id).emit('hand', p.hand));
  }
}

/* ---------- комнаты ---------- */
const games = new Map();
function game(roomId){
  if(!games.has(roomId)) games.set(roomId, new Game(roomId));
  return games.get(roomId);
}

/* ---------- Socket.IO ---------- */
io.on('connection', sock => {

  /* ---- JOIN ---- */
  sock.on('join', ({roomId, name}) => {
    if(!roomId) return;
    const g = game(roomId);
    sock.join(roomId);

    /* если игрок переподключился – не дублируем */
    if(!g.player(sock.id)){
      g.players.push({
        id:sock.id, name:name||sock.id.slice(0,5),
        hand:[], score:0, claimedRound:false
      });
      g.deal(g.player(sock.id), 2);
    }
    g.emitState();
  });

  /* ---- PLAY CARD ---- */
  sock.on('play_card', ({roomId})=>{
    const g = games.get(roomId); if(!g) return;
    if(g.players[g.turnIdx].id !== sock.id) return;   // не твой ход
    const pl = g.player(sock.id);
    if(!pl.hand.length) return;

    const card = pl.hand.shift();
    g.table.push({...card, owner:sock.id, taken:false});
    g.revealed = (g.table.length === g.players.length);
    g.emitState();
    if(g.revealed) g.room().emit('reveal');
    g.nextTurn();
  });

  /* ---- CLAIM CARD ---- */
  sock.on('claim_card', ({roomId, cardId})=>{
    const g = games.get(roomId); if(!g || !g.revealed) return;
    const pl = g.player(sock.id); if(pl.claimedRound) return;

    const card = g.table.find(c=>c.id === cardId); if(!card || card.taken) return;
    card.taken = true;
    pl.claimedRound = true;
    pl.hand.push({...card, taken:false});            // копия без флага
    g.room().emit('card_claimed',{cardId,byName:pl.name});

    /* конец раунда? */
    const roundDone = g.table.every(c=>c.taken) || g.players.every(p=>p.claimedRound);
    if(roundDone){
      g.players.forEach(p=>{ p.claimedRound=false; g.deal(p); });
      g.table.length = 0; g.revealed = false;
      g.emitState();
    }
  });

  /* ---- MAKE PAIR ---- */
  sock.on('make_pair', ({roomId, yesId, noId})=>{
    const g = games.get(roomId); if(!g) return;
    if(g.players[g.turnIdx].id !== sock.id) return;
    const pl = g.player(sock.id);

    const yesIdx = pl.hand.findIndex(c=>c.id===yesId && c.type===YES);
    const noIdx  = pl.hand.findIndex(c=>c.id===noId  && c.type===NO );
    if(yesIdx===-1 || noIdx===-1) return;

    const yes = pl.hand.splice(yesIdx,1)[0];
    const no  = pl.hand.splice(noIdx < yesIdx ? noIdx : noIdx-1,1)[0];

    g.room().emit('pair_attempt',{byName:pl.name,yes,no});

    if(yes.pair === no.pair){                    // успех
      pl.score++;
      g.removed.add(yes.id);
      g.removed.add(no.id);
      g.room().emit('pair_success',{byName:pl.name,score:pl.score});
      if(pl.score >= 3){
        g.room().emit('game_over',{winnerName:pl.name});
        g.reset();                               // новая партия
        return;
      }
    }else{                                       // промах
      g.deck.push(yes, no); shuffle(g.deck);
      g.room().emit('pair_fail',{byName:pl.name});
    }

    /* добрать до 2 */
    while (pl.hand.length < 2 && g.deal(pl));

    /* если карт нет – пасуем; иначе игрок продолжает ход */
    if(pl.hand.length === 0) g.nextTurn();
    else                     g.emitState();
  });

  /* ---- DISCONNECT ---- */
  sock.on('disconnect', ()=>{
    games.forEach((g, roomId)=>{
      const idx = g.players.findIndex(p=>p.id === sock.id);
      if(idx !== -1){
        g.players.splice(idx,1);
        if(g.players.length === 0) games.delete(roomId);
        else{
          if(g.turnIdx >= g.players.length) g.turnIdx = 0;
          g.emitState();
        }
      }
    });
  });
});

/* ---------- run ---------- */
const PORT = process.env.PORT || 3000;
srv.listen(PORT, ()=> console.log('Yes-But server on', PORT));