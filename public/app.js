const s = io();

/* DOM */
const el = {
  join     : document.getElementById('join'),
  room     : document.getElementById('room'),
  name     : document.getElementById('name'),
  joinBtn  : document.getElementById('joinBtn'),
  game     : document.getElementById('game'),
  info     : document.getElementById('info'),
  handCont : document.getElementById('hand'),
  playBtn  : document.getElementById('playBtn'),
  pairBtn  : document.getElementById('pairBtn'),
  table    : document.getElementById('table')
};

let roomId='', myId='', activeId='', names={}, hand=[];
let select=[];

/* ---------- подключение ---------- */
el.joinBtn.onclick=()=>{
  roomId = el.room.value.trim(); if(!roomId) return;
  s.emit('join',{roomId,name: el.name.value.trim()});
  el.join.hidden=true; el.game.hidden=false;
};

/* ---------- отрисовка руки ---------- */
s.on('hand', cards=>{
  hand=cards;
  el.handCont.innerHTML='';
  cards.forEach(c=>{
    const d=document.createElement('div');
    d.className='card '+c.type;
    d.textContent=(c.type==='YES'?'Да: ':'Но: ')+c.text;
    d.dataset.id=c.id;
    d.onclick=()=>chooseForPair(c.id);
    el.handCont.appendChild(d);
  });
});

/* ---------- состояние комнаты ---------- */
s.on('state', st=>{
  myId ||= s.id;
  activeId = st.active;
  names = Object.fromEntries(st.players.map(p=>[p.id,p.name]));

  el.info.textContent = (activeId===myId)
      ? 'Ваш ход'
      : `Ход игрока ${names[activeId]}`;

  // стол
  el.table.innerHTML='';
  st.table.forEach(c=>{
    const d=document.createElement('div');
    d.className='card '+c.type;
    d.textContent=(c.text==='???'?'?':(c.type==='YES'?'Да: ':'Но: ')+c.text);
    d.dataset.id=c.id;
    d.onclick=()=>s.emit('claim_card',{roomId,cardId:c.id});
    el.table.appendChild(d);
  });

  const myTurn = (activeId===myId);
  el.playBtn.disabled=!myTurn;
  el.pairBtn.disabled=!myTurn;
});

/* ---------- кнопки ---------- */
el.playBtn.onclick = ()=> s.emit('play_card',{roomId});
el.pairBtn.onclick = ()=> alert('Кликните по «Да» и «Но» в руке');

/* ---------- выбор пары ---------- */
function chooseForPair(id){
  if(activeId!==myId) return;
  if(select.includes(id)) return;
  select.push(id);
  document.querySelector(`[data-id="${id}"]`).style.outline='2px solid #007bff';
  if(select.length===2){
    const y=select.find(i=>i.startsWith('Y')), n=select.find(i=>i.startsWith('N'));
    if(y&&n) s.emit('make_pair',{roomId,yesId:y,noId:n});
    select.forEach(i=>{
      const el=document.querySelector(`[data-id="${i}"]`);
      if(el) el.style.outline='';
    });
    select=[];
  }
}

/* ---------- всплывашки ---------- */
s.on('reveal', ()=> alert('Карты вскрыты! Быстро выбирай карту на столе.'));
s.on('card_claimed',({cardId,byName})=>{
  const el = document.querySelector(`[data-id="${cardId}"]`);
  if(el) el.classList.add('taken');
});
s.on('pair_attempt',({byName,yes,no})=>{
  alert(`${byName} пытается составить пару:\n${yes.text}\n${no.text}`);
});
s.on('pair_success',({byName,score})=>{
  alert(`${byName} собрал пару! Счёт: ${score}`);
});
s.on('pair_fail',({byName})=>{
  alert(`${byName} ошибся – карты вернулись в колоду`);
});
s.on('game_over',({winnerName})=>{
  alert(`${winnerName} победил! Игра начинается заново.`);
});
