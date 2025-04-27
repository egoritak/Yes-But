const express  = require('express');
const http     = require('http');
const { Server } = require('socket.io');

const app  = express();
const srv  = http.createServer(app);
const io   = new Server(srv);

app.use(express.static('public'));

/* ---------- «База» пар ---------- */
const rawPairs = [
  ['Твой самолёт прилетает вовремя',  'Твой багаж задерживается'],
  ['Ты выигрываешь 100 €',           'Потерял кошелёк'],
  ['Получаешь повышение',            'Коллега ворчит рядом весь день'],
  ['Тебя угощают кофе',              'Облил рубашку этим кофе'],
  ['Погода идеальна для пикника',    'Забыл дома бутерброды']
];
const YES='YES', NO='NO';

/* ---------- Game (одна комната) ---------- */
class Game {
  constructor(roomId){ this.id=roomId; this.reset(); }
  reset(){
    this.players=[];                 // [{id,name,hand,score,claimedRound}]
    this.turnIdx=0;                  // чей ход (index в players)
    this.table=[];                   // карты раунда
    this.revealed=false;
    this.deck=[];
    this.buildDeck();
  }
  buildDeck(){
    this.deck.length=0;
    rawPairs.forEach((p,i)=>{
      this.deck.push({id:`Y${i}`,type:YES,text:p[0],pair:i});
      this.deck.push({id:`N${i}`,type:NO ,text:p[1],pair:i});
    });
    shuffle(this.deck);
  }
  player(id){ return this.players.find(p=>p.id===id);}
  deal(to,n=1){ while(n--){ if(!this.deck.length) this.buildDeck(); to.hand.push(this.deck.pop()); } }
  nextTurn(){ this.turnIdx=(this.turnIdx+1)%this.players.length; this.emitState(); }
  room(){ return io.to(this.id); }

  /* ---- отправка состояния ---- */
  emitState(){
    this.room().emit('state',{
      players:this.players.map(p=>({id:p.id,name:p.name,score:p.score,hand: p.id,handCount:p.hand.length})),
      active : this.players[this.turnIdx]?.id,
      table  : this.revealed ? this.table : this.table.map(c=>({...c,text:'???'}))
    });
    // каждому — реальную руку
    this.players.forEach(p=> io.to(p.id).emit('hand',p.hand));
  }
}

/* util */
function shuffle(a){for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}}

/* ---- комнаты ---- */
const games=new Map();
function getGame(roomId){
  if(!games.has(roomId)) games.set(roomId,new Game(roomId));
  return games.get(roomId);
}

/* ---- Socket.IO ---- */
io.on('connection',sock=>{

  /* -------- вход в комнату -------- */
  sock.on('join',({roomId,name})=>{
    if(!roomId) return;
    const g=getGame(roomId);
    sock.join(roomId);
    g.players.push({id:sock.id,name:name||sock.id.slice(0,5),hand:[],score:0,claimedRound:false});
    // выдаём стартовые 2 карты
    g.deal(g.player(sock.id),2);
    g.emitState();
  });

  /* -------- ЛЕВАЯ карта (play) -------- */
  sock.on('play_card',({roomId})=>{
    const g=games.get(roomId); if(!g) return;
    if(g.players[g.turnIdx].id!==sock.id) return;          // не твой ход
    const pl=g.player(sock.id);
    if(!pl.hand.length) return;
    const card=pl.hand.shift();
    g.table.push({...card,owner:sock.id,taken:false});
    g.revealed=(g.table.length===g.players.length);
    g.emitState();
    if(g.revealed) g.room().emit('reveal');
    g.nextTurn();
  });

  /* -------- гонка: каждый ONE click -------- */
  sock.on('claim_card',({roomId,cardId})=>{
    const g=games.get(roomId); if(!g||!g.revealed) return;
    const pl=g.player(sock.id); if(pl.claimedRound) return;
    const card=g.table.find(c=>c.id===cardId); if(!card||card.taken) return;
    card.taken=true;
    pl.claimedRound=true;
    pl.hand.push(card);
    g.room().emit('card_claimed',{cardId,by:sock.id,byName:pl.name});
    // проверяем конец раунда
    const allClaimed = g.players.every(p=>p.claimedRound);
    const allTaken   = g.table.every(c=>c.taken);
    if(allClaimed || allTaken){
      // добор + сброс флагов
      g.players.forEach(p=>{ p.claimedRound=false; g.deal(p); });
      g.table.length=0; g.revealed=false;
      g.emitState();
    }
  });

  /* -------- попытка пары -------- */
  sock.on('make_pair',({roomId,yesId,noId})=>{
    const g=games.get(roomId); if(!g) return;
    if(g.players[g.turnIdx].id!==sock.id) return;
    const pl=g.player(sock.id);
    const yesIdx=pl.hand.findIndex(c=>c.id===yesId&&c.type===YES);
    const noIdx =pl.hand.findIndex(c=>c.id===noId &&c.type===NO );
    if(yesIdx===-1||noIdx===-1) return;
    const yes=pl.hand.splice(yesIdx,1)[0];
    const no =pl.hand.splice(noIdx<yesIdx?noIdx:noIdx-1,1)[0];
    g.room().emit('pair_attempt',{by:sock.id,byName:pl.name,yes,no});

    if(yes.pair===no.pair){
      pl.score++;
      g.room().emit('pair_success',{by:sock.id,byName:pl.name,score:pl.score});
      if(pl.score>=3){
        g.room().emit('game_over',{winner:sock.id,winnerName:pl.name});
        g.reset(); g.emitState(); return;
      }
    }else{
      g.deck.push(yes,no); shuffle(g.deck);
      g.room().emit('pair_fail',{by:sock.id,byName:pl.name});
    }
    // добрать до 2
    while(pl.hand.length<2) g.deal(pl);
    g.emitState();
  });

  /* -------- выход -------- */
  sock.on('disconnect',()=>{
    games.forEach((g,roomId)=>{
      const idx=g.players.findIndex(p=>p.id===sock.id);
      if(idx!==-1){
        g.players.splice(idx,1);
        if(g.players.length===0) games.delete(roomId);
        else{
          if(g.turnIdx>=g.players.length) g.turnIdx=0;
          g.emitState();
        }
      }
    });
  });
});

/* ---- Run ---- */
const PORT=process.env.PORT||3000;
srv.listen(PORT,()=>console.log('Yes-But server on',PORT));