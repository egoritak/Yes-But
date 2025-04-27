/* eslint-disable no-console */
const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
const crypto  = require('crypto');

const app = express();
const srv = http.createServer(app);
const io  = new Server(srv);
app.use(express.static('public'));

/* ───── постоянные данные ───── */
const rawPairs = [
  ['Твой самолёт прилетает вовремя',  'Твой багаж задерживается'],
  ['Ты выигрываешь 100 €',            'Потерял кошелёк'],
  ['Получаешь повышение',             'Коллега ворчит рядом весь день'],
  ['Тебя угощают кофе',               'Облил рубашку этим кофе'],
  ['Погода идеальна для пикника',     'Забыл дома бутерброды']
];
const YES = 'YES', NO = 'NO';

/* ───── утилиты ───── */
const genCode = () => crypto.randomBytes(2).toString('hex').toUpperCase();
const shuffle = a => { for(let i=a.length-1;i>0;i--){const j=Math.random()*(i+1)|0;[a[i],a[j]]=[a[j],a[i]];} };

/* ───── класс Game (комната) ───── */
class Game{
  constructor(code, adminId){
    this.id      = code;
    this.admin   = adminId;        // socket.id создателя
    this.started = false;

    this.players = [];             // [{id,name,hand,score,claimed}]
    this.turnIdx = 0;
    this.table   = [];
    this.revealed=false;

    this.removed = new Set();      // карты, окончательно ушедшие из игры
    this.buildDeck();
  }

  /* ---------- подготовка / колода ---------- */
  buildDeck(){
    this.deck=[];
    rawPairs.forEach((p,i)=>{
      const y=`Y${i}`, n=`N${i}`;
      if(!this.removed.has(y)) this.deck.push({id:y,type:YES,text:p[0],pair:i});
      if(!this.removed.has(n)) this.deck.push({id:n,type:NO ,text:p[1],pair:i});
    });
    shuffle(this.deck);
  }
  freshDeck(exclude){
    const d=[];
    rawPairs.forEach((p,i)=>{
      const y=`Y${i}`, n=`N${i}`;
      if(!exclude.has(y) && !this.removed.has(y)) d.push({id:y,type:YES,text:p[0],pair:i});
      if(!exclude.has(n) && !this.removed.has(n)) d.push({id:n,type:NO ,text:p[1],pair:i});
    });
    shuffle(d); return d;
  }

  /* ---------- утил ---------- */
  player(id){ return this.players.find(p=>p.id===id); }
  room()  { return io.to(this.id); }

  /* ---------- раздача ---------- */
  deal(p,n=1){
    let given=0;
    while(n--){
      if(!this.deck.length){
        const inPlay=new Set(this.players.flatMap(pl=>pl.hand.map(c=>c.id))
                              .concat(this.table.map(c=>c.id)));
        this.deck=this.freshDeck(inPlay);
        if(!this.deck.length) break;
      }
      p.hand.push(this.deck.pop()); given++;
    }
    return given>0;
  }

  /* ---------- рестарт партии ---------- */
  resetParty(){
    this.turnIdx=0; this.table=[]; this.revealed=false; this.removed=new Set();
    this.buildDeck();
    this.players.forEach(p=>{ p.hand=[]; p.score=0; p.claimed=false; this.deal(p,2); });
    this.emitState();
  }

  /* ---------- перейти ходу ---------- */
  nextTurn(){
    this.turnIdx=(this.turnIdx+1)%this.players.length;
    this.emitState();
  }

  /* ---------- отправка состояний ---------- */
  emitLobby(){
    this.room().emit('lobby_state',{
      players:this.players.map(p=>p.name),
      adminId:this.admin
    });
  }
  emitState(){
    this.room().emit('state',{
      players:this.players.map(p=>({id:p.id,name:p.name,score:p.score,handCount:p.hand.length})),
      active :this.players[this.turnIdx]?.id,
      table  :this.revealed ? this.table
                            : this.table.map(c=>({...c,text:'???'}))
    });
    this.players.forEach(p=> io.to(p.id).emit('hand',p.hand));
  }
}

/* ───── хранилище комнат ───── */
const rooms = new Map();       // code => Game

/* ───── Socket.IO ───── */
io.on('connection',sock=>{

  /* ===== CREATE ROOM ===== */
  sock.on('create_room',({name})=>{
    const code=genCode();
    const g=new Game(code,sock.id);
    rooms.set(code,g);
    sock.join(code);
    g.players.push({id:sock.id,name,hand:[],score:0,claimed:false});
    sock.emit('room_created',{code});
    g.emitLobby();
  });

  /* ===== JOIN ROOM ===== */
  sock.on('join_room',({code,name})=>{
    const g=rooms.get(code);
    if(!g || g.started){ sock.emit('error_msg','Комната не найдена'); return; }
    sock.join(code);
    g.players.push({id:sock.id,name,hand:[],score:0,claimed:false});
    g.emitLobby();
  });

  /* ===== START GAME (admin) ===== */
  sock.on('start_game',({code})=>{
    const g=rooms.get(code);
    if(!g || g.started || g.admin!==sock.id) return;
    g.started=true;
    g.players.forEach(p=>g.deal(p,2));
    g.emitState();
  });

  /* ====== GAMEPLAY EVENTS (работают только в запущенной комнате) ====== */
  sock.on('play_card',({code})=>{
    const g=rooms.get(code); if(!g||!g.started) return;
    if(g.players[g.turnIdx].id!==sock.id) return;
    const pl=g.player(sock.id); if(!pl.hand.length) return;

    const card=pl.hand.shift();
    g.table.push({...card,owner:sock.id,taken:false});
    g.revealed=g.table.length===g.players.length;
    g.emitState();
    if(g.revealed) g.room().emit('reveal');
    g.nextTurn();
  });

  sock.on('claim_card',({code,cardId})=>{
    const g=rooms.get(code); if(!g||!g.started||!g.revealed) return;
    const pl=g.player(sock.id); if(pl.claimed) return;
    const card=g.table.find(c=>c.id===cardId); if(!card||card.taken) return;

    card.taken=true; pl.claimed=true;
    pl.hand.push({...card,taken:false});
    g.room().emit('card_claimed',{cardId,byName:pl.name});

    const end=g.table.every(c=>c.taken)||g.players.every(p=>p.claimed);
    if(end){
      g.players.forEach(p=>{p.claimed=false; g.deal(p);});
      g.table=[]; g.revealed=false; g.emitState();
    }
  });

  sock.on('make_pair',({code,yesId,noId})=>{
    const g=rooms.get(code); if(!g||!g.started) return;
    if(g.players[g.turnIdx].id!==sock.id) return;
    const pl=g.player(sock.id);

    const yi=pl.hand.findIndex(c=>c.id===yesId&&c.type===YES);
    const ni=pl.hand.findIndex(c=>c.id===noId &&c.type===NO );
    if(yi===-1||ni===-1) return;

    const yes=pl.hand.splice(yi,1)[0];
    const no =pl.hand.splice(ni<yi?ni:ni-1,1)[0];
    g.room().emit('pair_attempt',{byName:pl.name,yes,no});

    if(yes.pair===no.pair){
      pl.score++; g.removed.add(yes.id); g.removed.add(no.id);
      g.room().emit('pair_success',{byName:pl.name,score:pl.score});
      if(pl.score>=3){
        g.room().emit('game_over',{winnerName:pl.name});
        g.resetParty(); return;
      }
    }else{
      g.deck.push(yes,no); shuffle(g.deck);
      g.room().emit('pair_fail',{byName:pl.name});
    }

    while(pl.hand.length<2 && g.deal(pl));
    if(pl.hand.length===0) g.nextTurn(); else g.emitState();
  });

  /* ====== DISCONNECT ====== */
  sock.on('disconnect',()=>{
    rooms.forEach((g,code)=>{
      const idx=g.players.findIndex(p=>p.id===sock.id);
      if(idx===-1) return;

      const wasAdmin = g.admin===sock.id;
      g.players.splice(idx,1);

      /* если лобби и игроков нет — удаляем комнату */
      if(!g.started && g.players.length===0){ rooms.delete(code); return; }

      /* если лобби, но админ вышел → новый админ */
      if(!g.started && wasAdmin){ g.admin=g.players[0].id; }

      /* если партия, подвинем ход */
      if(g.started && g.turnIdx>=g.players.length) g.turnIdx=0;

      g.started ? g.emitState() : g.emitLobby();
    });
  });
});

/* ───── run ───── */
const PORT=process.env.PORT||3000;
srv.listen(PORT,()=>console.log('Yes-But server on',PORT));