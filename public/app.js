const ioSock = io();

/* ========== DOM helpers ========== */
const $ = id => document.getElementById(id);
const lobby = $('lobby'), game = $('game');
const roomIn = $('room'), nameIn = $('name'), joinBtn=$('joinBtn');
const infoP = $('info'), playBtn=$('playBtn'), pairBtn=$('pairBtn');
const handDiv=$('hand'), tableDiv=$('table'), bar=$('playersBar');
const toastArea=$('toastArea');

/* ========== state ========== */
let room='', myId='', active='', nameMap={}, hand=[];
let selecting=[];

/* ========== toast ========== */
function toast(msg,color='#334155'){
  const el=document.createElement('div');
  el.className='toast'; el.style.background=color; el.textContent=msg;
  toastArea.appendChild(el);
  setTimeout(()=>el.remove(),2500);
}

function clearSelection() {
  selecting.forEach(id => {
    const el = document.querySelector(`[data-id="${id}"]`);
    if (el) el.style.outline = '';
  });
  selecting = [];
}

/* ========== renderers ========== */
function renderPlayers(list){
  bar.innerHTML='';
  list.forEach(p=>{
    const box=document.createElement('div');
    box.className='playerBox';
    box.innerHTML=`<div class="avatar ${p.id===active?'turn':''}">
                     ${p.name[0].toUpperCase()}</div>
                   <div>${p.name}</div>
                   <div>${p.score} пар</div>`;
    bar.appendChild(box);
  });
}

function cardMarkup(c, {hidden=false, showTaken=true} = {}){
  const takenCls = showTaken && c.taken ? ' taken' : '';
  const txt = hidden ? '???' : `${c.type==='YES'?'Да':'Но'}: ${c.text}`;
  return `<div class="card ${c.type}${takenCls}" data-id="${c.id}">${txt}</div>`;
}

/* ── join ── */
joinBtn.onclick=()=>{
  room=roomIn.value.trim(); if(!room) return;
  ioSock.emit('join',{roomId:room,name:nameIn.value.trim()});
  lobby.classList.add('hidden'); game.classList.remove('hidden');
};

/* ── server events ── */
ioSock.on('hand', cards=>{
  hand=cards;
  handDiv.innerHTML = cards.map(c=>cardMarkup(c,{showTaken:false})).join('');
  handDiv.querySelectorAll('.card').forEach(el=>{
    el.onclick=()=>choose(el.dataset.id);
  });
});

ioSock.on('state', s=>{
  myId ||= ioSock.id;
  active = s.active;
  nameMap = Object.fromEntries(s.players.map(p=>[p.id,p.name]));

  infoP.textContent = active===myId ? 'Ваш ход' : `Ход игрока ${nameMap[active]}`;
  if(active!==myId) clearSelection();
  renderPlayers(s.players);

  tableDiv.innerHTML = s.table.map(c=>cardMarkup(c,{hidden:c.text==='???',showTaken:true})).join('');
  tableDiv.querySelectorAll('.card').forEach(el=>{
    el.onclick=()=>ioSock.emit('claim_card',{roomId:room,cardId:el.dataset.id});
  });

  const myTurn=(active===myId);
  playBtn.disabled=!myTurn; pairBtn.disabled=!myTurn;
});

ioSock.on('reveal', ()=>toast('Карты вскрыты! Лови свою.','#0ea5e9'));
ioSock.on('card_claimed',({cardId,byName})=>{
  const el=tableDiv.querySelector(`[data-id="${cardId}"]`);
  if(el) el.classList.add('taken');
  toast(`${byName} забрал карту`);
});
ioSock.on('pair_attempt',({byName})=>toast(`${byName} пытается составить пару…`,'#f59e0b'));
ioSock.on('pair_success',({byName,score})=>toast(`${byName}: пара собрана (${score})`,'#22c55e'));
ioSock.on('pair_fail',({byName})=>toast(`${byName} ошибся с парой`,'#ef4444'));
ioSock.on('game_over',({winnerName})=>toast(`${winnerName} победил! Начинаем заново`,'#6366f1'));

/* ── actions ── */
playBtn.onclick = () => {
  clearSelection();                       // 💧 убрать контур
  ioSock.emit('play_card', { roomId: room });
};
pairBtn.onclick = ()=>toast('Кликните по «Да» и «Но» в руке','#f59e0b');

function choose(id){
  if(active!==myId) return;
  if(selecting.includes(id)) return;
  selecting.push(id);
  document.querySelector(`[data-id="${id}"]`).style.outline='3px solid #2563eb';
  if(selecting.length===2){
    const y=selecting.find(x=>x.startsWith('Y')), n=selecting.find(x=>x.startsWith('N'));
    if(y&&n) ioSock.emit('make_pair',{roomId:room,yesId:y,noId:n});
    clearSelection();
    selecting=[];
  }
}
