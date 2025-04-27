/* ───── toast ───── */
function toast(msg, color = '#334155') {
  const area = document.getElementById('toastArea');
  const el   = document.createElement('div');
  el.className = 'toast';
  el.style.background = color;
  el.textContent = msg;
  area.appendChild(el);
  setTimeout(() => el.remove(), 2500);
}

/* ───── DOM & state ───── */
const $        = id => document.getElementById(id);
const s        = io();

const landing  = $('landing');
const lobby    = $('lobby');
const gameSec  = $('game');

const userName = $('userName');
const codeIn   = $('codeInput');
const createBt = $('createBtn');
const joinBt   = $('joinBtn');

const roomTxt  = $('roomCode');
const copyBt   = $('copyBtn');
const listUL   = $('playersList');
const startBt  = $('startBtn');

const bar      = $('playersBar');
const infoP    = $('info');
const handDiv  = $('hand');
const tableDiv = $('table');
const playBt   = $('playBtn');
const pairBt   = $('pairBtn');

let room='', myName='', myId='', active='', names={}, selecting=[];

/* ───── validators ───── */
const nameOK = () => userName.value.trim().length > 0;
const codeOK = () => /^[A-Z0-9]{4}$/.test(codeIn.value.trim().toUpperCase());
function updateBtns(){
  createBt.disabled = !nameOK();
  joinBt.disabled   = !(nameOK() && codeOK());
}

/* ───── landing actions ───── */
userName.oninput = updateBtns;
codeIn.oninput   = () =>{
  codeIn.value   = codeIn.value.toUpperCase();
  updateBtns();
};

createBt.onclick = () =>{
  myName = userName.value.trim();
  s.emit('create_room',{name:myName});
};

joinBt.onclick   = () =>{
  myName = userName.value.trim();
  room   = codeIn.value.trim().toUpperCase();
  if(!codeOK()) { toast('Код из 4 символов'); return; }
  s.emit('join_room',{code:room,name:myName});
};

/* ───── lobby events ───── */
s.on('room_created',({code})=>{
  room = code;
  landing.classList.add('hidden');
  lobby.classList.remove('hidden');
  roomTxt.textContent = code;
  copyBt.onclick = () => {
    navigator.clipboard.writeText(code);
    toast('Код скопирован');
  };
  startBt.classList.remove('hidden');           // я — админ
});

s.on('lobby_state',({players,adminId})=>{
  listUL.innerHTML = players.map(n=>`<li>${n}</li>`).join('');
  startBt.classList.toggle('hidden', adminId!==s.id);

  /* гость впервые вошёл → показать лобби */
  if(!lobby.classList.contains('hidden') || room==='') return;
  landing.classList.add('hidden');
  lobby.classList.remove('hidden');
  roomTxt.textContent = room;
  copyBt.onclick = () => { navigator.clipboard.writeText(room); toast('Код скопирован'); };
});

startBt.onclick = () => s.emit('start_game',{code:room});

/* ───── gameplay events ───── */
s.on('state', st=>{
  lobby.classList.add('hidden'); gameSec.classList.remove('hidden');

  myId ||= s.id;
  active = st.active;
  names  = Object.fromEntries(st.players.map(p=>[p.id,p.name]));

  /* players bar */
  bar.innerHTML='';
  st.players.forEach(p=>{
    bar.insertAdjacentHTML('beforeend',
      `<div class="playerBox">
         <div class="avatar ${p.id===active?'turn':''}">${p.name[0]}</div>
         <div>${p.name}</div><div>${p.score} пар</div>
       </div>`);
  });

  infoP.textContent = active
      ? (active===myId ? 'Ваш ход' : `Ход ${names[active]}`)
      : 'Ожидаем начала партии…';

  /* стол */
  tableDiv.innerHTML = st.table.map(c=>cardHTML(c,{hidden:c.text==='???',showTaken:true})).join('');
  tableDiv.querySelectorAll('.card').forEach(el=>{
    el.onclick = () => s.emit('claim_card',{code:room,cardId:el.dataset.id});
  });

  const myTurn = active===myId;
  playBt.disabled = !myTurn;
  pairBt.disabled = !myTurn;
  if(!myTurn) clearSel();
});

s.on('hand', cards=>{
  handDiv.innerHTML = cards.map(c=>cardHTML(c,{showTaken:false})).join('');
  handDiv.querySelectorAll('.card').forEach(el=>{
    el.onclick = () => choose(el.dataset.id);
  });
});

/* ───── действия ───── */
playBt.onclick = () => { clearSel(); s.emit('play_card',{code:room}); };
pairBt.onclick = () => toast('Выберите «Да» и «Но» в руке','#f59e0b');

function choose(id){
  if(active!==myId || selecting.includes(id)) return;
  selecting.push(id);
  document.querySelector(`[data-id="${id}"]`).style.outline='3px solid #2563eb';
  if(selecting.length===2){
    const y=selecting.find(i=>i.startsWith('Y')), n=selecting.find(i=>i.startsWith('N'));
    if(y&&n) s.emit('make_pair',{code:room,yesId:y,noId:n});
    clearSel();
  }
}
function clearSel(){
  selecting.forEach(i=>{
    const el=document.querySelector(`[data-id="${i}"]`);
    if(el) el.style.outline='';
  });
  selecting=[];
}

/* ───── вспомогательные уведомления ───── */
s.on('reveal', ()=>toast('Карты вскрыты','#0ea5e9'));
s.on('card_claimed',({cardId,byName})=>{
  const el=tableDiv.querySelector(`[data-id="${cardId}"]`);
  if(el) el.classList.add('taken');
  toast(`${byName} забрал карту`);
});
s.on('pair_attempt',({byName})=>toast(`${byName} пытается составить пару…`,'#f59e0b'));
s.on('pair_success',({byName,score})=>toast(`${byName}: пара (${score})`,'#22c55e'));
s.on('pair_fail',({byName})=>toast(`${byName} ошибся с парой`,'#ef4444'));
s.on('game_over',({winnerName})=>toast(`${winnerName} победил! Новая партия…`,'#6366f1'));
s.on('error_msg',msg=>toast(msg,'#ef4444'));

/* ───── карточки ───── */
function cardHTML(c,{hidden=false,showTaken=true}={}){
  const takenCls=showTaken&&c.taken?' taken':'';
  const txt=hidden?'???':(c.type==='YES'?'Да':'Но')+': '+c.text;
  return `<div class="card ${c.type}${takenCls}" data-id="${c.id}">${txt}</div>`;
}

/* init */
updateBtns();