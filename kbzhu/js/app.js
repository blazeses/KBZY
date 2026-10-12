import {store} from './store.js';
import {analyze} from './api.js';
import {sum,r} from './nutrition.js';
const $=s=>document.querySelector(s),V=$('#v');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>'&#'+c.charCodeAt(0)+';');
const MEALS=['Завтрак','Обед','Ужин','Перекус'];
const TABS=[['home','Главная'],['diary','Дневник'],['history','История'],['stats','Статистика'],['set','Настройки']];
const N=[['Калории','kcal','ккал'],['Белки','p','г'],['Жиры','f','г'],['Углеводы','c','г']];
const COOK=[['oil_sunflower','Подсолнечное масло'],['oil_olive','Оливковое масло'],['butter','Сливочное масло'],['steam','На пару / без масла'],['oven','В духовке']];
const COOKHINT={oil_sunflower:'жарили на подсолнечном (растительном) масле',oil_olive:'жарили на оливковом масле',butter:'жарили на сливочном масле',steam:'готовили на пару, без добавления масла',oven:'запекали в духовке, масла минимум'};
const S={tab:'home',cur:null,img:null,thumb:null,id:null,ts:null,period:'week',place:null,cook:null,note:''};
const dk=t=>new Date(t).toDateString(),todays=()=>store.entries().filter(e=>dk(e.ts)===dk(Date.now()));
const tot=es=>sum(es.flatMap(e=>e.items)),macro=t=>`${r(t.p)}/${r(t.f)}/${r(t.c)}`;
const fmt=ts=>new Date(ts).toLocaleString('ru-RU',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
const guess=()=>{const h=new Date().getHours();return h<11?'Завтрак':h<16?'Обед':h<21?'Ужин':'Перекус'};
const bars=(t,g)=>N.map(([n,k,u])=>`<div class=bar><div><span>${n}</span><b>${r(t[k])} из ${g[k]} ${u}</b></div><i><u style="width:${Math.min(100,t[k]/g[k]*100)}%"></u></i></div>`).join('');
const card=e=>{const t=tot([e]);return `<button class=entry data-a=open data-id=${e.id}>${e.thumb?`<img src="${e.thumb}" alt="">`:'<div class=ph></div>'}<div><b>${esc(e.name)}</b><span>${fmt(e.ts)}, ${e.meal||''}</span><span>${r(t.kcal)} ккал, Б/Ж/У ${macro(t)}</span></div></button>`};
function toast(m){const t=document.createElement('div');t.className='toast';t.textContent=m;document.body.append(t);setTimeout(()=>t.remove(),3500)}
const theme=()=>{const t=store.cfg().theme,d=document.documentElement.dataset;t==='auto'?delete d.theme:d.theme=t};
const confAvg=it=>{const c=it.filter(i=>i.conf!=null).map(i=>i.conf);return c.length?c.reduce((a,b)=>a+b,0)/c.length:null};
const confLvl=c=>c==null?'':c>=.7?'hi':c>=.4?'mid':'lo';
const confTxt=c=>c==null?'':c>=.7?'Высокая уверенность':c>=.4?'Средняя уверенность':'Низкая уверенность';
const pm=(i,k)=>r(i[k]*i.weight/100);
const STL={raw:'сырое',boiled:'варёное',pan_fried:'жареное',deep_fried:'во фритюре',baked:'запечённое',fresh:'свежее',fried:'жареное',stewed:'тушёное',grilled:'гриль'},stL=s=>STL[s]||s;
const CUL={home:'🏠 домашнее',restaurant:'🍽 из заведения',fast_food:'🍔 фастфуд'};
const ANC={plate_rim:'по тарелке',cutlery:'по приборам',hand:'по руке',heuristic:'по пропорциям'};
const sizeQ=q=>/размер|порци|грамм|вес|сколько/i.test(String(q||''));
const askFallback=q=>sizeQ(q)?['Маленькая','Средняя','Большая']:['Да','Нет','Не знаю'];

// Разбор ответа AI: новый формат (абсолютные значения на компонент) и старый (значения на 100 г).
function toItems(d){
  const arr=Array.isArray(d.decomposition)?d.decomposition:(Array.isArray(d.foods)?d.foods:[]);
  return arr.map(f=>{
    if(f.ingredient_name!==undefined){
      const w=Number(f.weight_g)||0,k=w>0?100/w:1;
      return {name:f.ingredient_name||'Продукт',weight:w,
        kcal:(Number(f.calories)||0)*k,p:(Number(f.protein_g)||0)*k,f:(Number(f.fat_g)||0)*k,c:(Number(f.carbs_g)||0)*k,fib:(Number(f.fiber_g)||0)*k,
        conf:typeof f.confidence_score==='number'?f.confidence_score:null,state:f.visual_state||null,hidden:!!f.is_hidden_ingredient};
    }
    return {name:f.name||'Продукт',weight:Number(f.weight_g)||0,
      kcal:Number(f.kcal_100)||0,p:Number(f.protein_100)||0,f:Number(f.fat_100)||0,c:Number(f.carbs_100)||0,fib:0,
      conf:typeof f.confidence==='number'?f.confidence:null,state:f.processing_state||null,hidden:!!f.is_hidden_fat_or_sauce};
  });
}

// Собирает текст-уточнение из выбранного контекста (дом/ресторан, масло, комментарий).
function buildHint(){
  const p=[];
  if(S.place==='home')p.push('Блюдо приготовлено дома');
  if(S.place==='restaurant')p.push('Блюдо из ресторана или кафе: порции и количество масла обычно больше');
  if(S.cook&&COOKHINT[S.cook])p.push('Дома '+COOKHINT[S.cook]);
  const n=(S.note||'').trim();
  if(n)p.push('Комментарий пользователя по блюду: '+n);
  return p.join('. ');
}

// Карточка «Где готовили» на экране результата.
function placeCard(c){
  if(c.err||!c.items||!c.items.length)return '';
  const l=(COOK.find(x=>x[0]===S.cook)||[])[1];
  if(S.place===null&&!(c.userNote||'').trim()){
    return `<section class=card><h3>Где готовили это блюдо?</h3><p class=sub>Уточните — расчёт скрытого масла станет точнее.</p><div class=chips><button class=chip data-a=place data-v=home>🏠 Дома</button><button class=chip data-a=place data-v=restaurant>🍽 В ресторане / кафе</button></div></section>`;
  }
  if(S.place==='home'&&S.cook===null){
    return `<section class=card><h3>На чём готовили дома?</h3><div class=chips>${COOK.map(([v,n])=>`<button class=chip data-a=cook data-v="${v}">${n}</button>`).join('')}</div></section>`;
  }
  const parts=[];
  if(S.place==='home')parts.push('🏠 дома'+(l?', '+l.toLowerCase():''));
  if(S.place==='restaurant')parts.push('🍽 из заведения');
  if((c.userNote||'').trim())parts.push('комментарий: '+c.userNote.trim());
  return `<section class=card><h3>Учтено при расчёте</h3><p class=sub>${esc(parts.join(' · '))}</p><button class=link data-a=place data-v=reset>Изменить</button></section>`;
}

const views={
home:()=>`<h1>КБЖУ по фото</h1><p class=sub>Сфотографируй еду — AI оценит состав и пищевую ценность.</p>
<section class=card><h3>Где готовили блюдо?</h3>
<div class=seg><button class="${S.place==='home'?'on':''}" data-a=setplace data-v=home>🏠 Дома</button><button class="${S.place==='restaurant'?'on':''}" data-a=setplace data-v=restaurant>🍽 В ресторане</button></div>
${S.place==='home'?`<div class=chips>${COOK.map(([v,n])=>`<button class="chip${S.cook===v?' sel':''}" data-a=setcook data-v="${v}">${n}</button>`).join('')}</div>`:''}
</section>
<section class=card><h3>Детали блюда</h3><p class=sub>Опишите словами — AI учтёт это при расчёте. Поле необязательное.</p>
<div class=note><textarea id=note maxlength=300 placeholder="Например: жарила на оливковом масле, без соли, порция большая">${esc(S.note)}</textarea><span class=cnt id=cnt>${(S.note||'').length}/300</span></div>
</section>
<button class="btn big" data-a=shot>📷 Сфотографировать</button><button class="btn big alt" data-a=gal>🖼 Загрузить из галереи</button>
<section class=card><h3>Сегодня</h3>${bars(tot(todays()),store.goals())}</section><button class=link data-a=go data-t=history>Открыть историю</button>`,
busy:()=>`<img class=pv src="${S.img}" alt=""><section class=card><h3 id=bt>Отправляем фотографию…</h3><div class=prog><i id=pb></i></div><p class=sub id=ps></p></section>`,
result(){const c=S.cur,t=sum(c.items),avg=c.overall!=null?c.overall:confAvg(c.items),lvl=confLvl(avg);
const meta=[CUL[c.cuisine]||null,c.anchor?('масштаб: '+(ANC[c.anchor]||c.anchor)):null,c.plate?('≈'+r(c.plate)+' см'):null].filter(Boolean).join(' · ');
return `${S.img?`<img class=pv src="${S.img}" alt="">`:''}<h2 class=mealname>${esc(c.name)}</h2><div class=badge>Примерная оценка. Точность зависит от фотографии и размера порции</div>
${c.err?`<div class="card warn">${esc(c.err)}</div>`:''}${c.note?`<p class=sub>${esc(c.note)}</p>`:''}
${meta?`<p class=sub>${esc(meta)}</p>`:''}
${avg!=null?`<div class="conf head ${lvl}"><i></i>${confTxt(avg)} · ${r(avg*100)}%</div>`:''}
${placeCard(c)}
${c.ask?`<section class=card><h3>${esc(c.ask)}</h3><div class=chips>${(c.askOpts&&c.askOpts.length?c.askOpts:askFallback(c.ask)).map(x=>`<button class=chip data-a=ask data-v="${esc(x)}">${esc(x)}</button>`).join('')}<button class=chip data-a=ask data-v=custom>Свой ответ</button>${sizeQ(c.ask)?'<button class=chip data-a=ask data-v=manual>Указать вес</button>':''}</div></section>`:''}
${c.items.map((i,n)=>`<button class=item data-a=edit data-i=${n}><span class=it><span class=ig><b>${esc(i.name)}</b>${(i.state||i.hidden)?`<span class=tags>${i.state?`<i>${stL(i.state)}</i>`:''}${i.hidden?'<i>скрытый жир/соус</i>':''}</span>`:''}<span>${r(i.weight)} г · ${r(i.kcal*i.weight/100)} ккал</span><span class=mac>Б ${pm(i,'p')} · Ж ${pm(i,'f')} · У ${pm(i,'c')} г${i.fib?` · клетчатка ${pm(i,'fib')} г`:''}${i.conf!=null?` · ${i.conf<.5?'AI не уверен':'уверенность'} ${r(i.conf*100)}%`:''}</span></span><span class=ir>${i.conf!=null?`<span class="conf ${confLvl(i.conf)}">${r(i.conf*100)}%</span>`:''}<em>▾</em></span></span></button>`).join('')}
<button class="btn alt" data-a=edit data-i=-1>+ Добавить продукт</button>
<section class="card total"><h3>Итого</h3><div class=kcal>${r(t.kcal)}<small> ккал</small></div>
${c.range?`<p class=sub>Возможный диапазон: ${r(c.range[0])}–${r(c.range[1])} ккал</p>`:''}
<div class=mac><span>Белки ${r(t.p)} г</span><span>Жиры ${r(t.f)} г</span><span>Углеводы ${r(t.c)} г</span>${t.fib?`<span>Клетчатка ${r(t.fib)} г</span>`:''}</div>
${c.weight?`<p class=sub>Общая масса ≈ ${r(c.weight)} г</p>`:''}</section>
${c.items.length?`<select id=meal>${MEALS.map(m=>`<option ${m===c.meal?'selected':''}>${m}</option>`).join('')}</select><button class="btn big" data-a=save>${S.id?'Сохранить изменения':'Сохранить в дневник'}</button>`:''}
${S.id?`<button class="btn danger" data-a=del data-id=${S.id}>Удалить запись</button>`:''}`},
diary(){const es=todays(),t=tot(es),g=store.goals();return `<h1>Дневник</h1><section class=card><div class=sum>${r(t.kcal)} / ${g.kcal} ккал</div>${bars(t,g)}</section>
${MEALS.map(m=>{const x=es.filter(e=>e.meal===m);return `<h3 class=mh>${m}<span>${r(tot(x).kcal)} ккал</span></h3>${x.map(card).join('')||'<p class=sub>Пока пусто. Сфотографируйте еду на главной.</p>'}`}).join('')}
<details class=card><summary>Дневные цели</summary><div class=goals>${N.map(([n,k,u])=>`<label>${n}, ${u}<input type=number min=1 data-g=${k} value=${store.goals()[k]}></label>`).join('')}</div></details>`},
history:()=>`<h1>История</h1>${store.entries().map(card).join('')||'<p class=sub>Анализов пока нет.</p>'}`,
stats(){const es=store.entries(),g=store.goals(),p=S.period||'week',days=p==='today'?1:p==='month'?30:7;
const rows=[...Array(days)].map((_,i)=>{const d=new Date();d.setDate(d.getDate()-(days-1-i));return {d,t:tot(es.filter(e=>dk(e.ts)===d.toDateString()))}});
const act=rows.filter(x=>x.t.kcal>0),avg=k=>act.length?r(act.reduce((a,x)=>a+x.t[k],0)/act.length):0,mx=Math.max(1,g.kcal,...rows.map(x=>x.t.kcal));
const lbl=x=>p==='month'?x.d.toLocaleDateString('ru-RU',{day:'numeric'}):x.d.toLocaleDateString('ru-RU',{weekday:'short'});
const head=p==='today'?'Сегодня':p==='month'?'Калории за 30 дней':'Калории за 7 дней';
const body=p==='today'?`<div class=kcal>${r(rows[0].t.kcal)}<small> ккал</small></div><div class=mac><span>Белки ${r(rows[0].t.p)} г</span><span>Жиры ${r(rows[0].t.f)} г</span><span>Углеводы ${r(rows[0].t.c)} г</span></div>`:`<div class=chart>${rows.map(x=>`<div><u style="height:${x.t.kcal/mx*100}%"></u><small>${lbl(x)}</small></div>`).join('')}</div>`;
return `<h1>Статистика</h1><div class=tabs>${[['today','Сегодня'],['week','Неделя'],['month','Месяц']].map(([k,n])=>`<button data-a=per data-v=${k} class="${p===k?'on':''}">${n}</button>`).join('')}</div>
<section class=card><h3>${head}</h3>${body}<p class=sub>${p==='today'?`Цель: ${g.kcal} ккал в день.`:p==='month'?`За 30 дней ${r(rows.reduce((a,x)=>a+x.t.kcal,0))} ккал, в среднем ${avg('kcal')} ккал/день.`:`За неделю ${r(rows.reduce((a,x)=>a+x.t.kcal,0))} ккал, в среднем ${avg('kcal')} ккал/день.`}</p></section>
<section class=card><h3>В среднем за день</h3><div class=mac><span>Калории ${avg('kcal')}</span><span>Белки ${avg('p')} г</span><span>Жиры ${avg('f')} г</span><span>Углеводы ${avg('c')} г</span></div><p class=sub>Учитываются только дни с записями.</p></section>`},
set(){const c=store.cfg();return `<h1>Настройки</h1><section class=card><label>Адрес сервера (необязательно)<input id=url type=url placeholder="https://имя.аккаунт.workers.dev" value="${esc(c.url)}"></label><label>Тема<select id=theme>${[['auto','Как в системе'],['light','Светлая'],['dark','Тёмная']].map(([v,n])=>`<option value=${v} ${c.theme===v?'selected':''}>${n}</option>`).join('')}</select></label><button class=btn data-a=cfg>Сохранить настройки</button></section><p class=sub>Оставьте поле пустым — приложение само использует свой адрес (Cloudflare Pages или локальный запуск). Ключ DeepSeek хранится только на сервере, в приложении его нет.</p>`}};

function render(){const t=S.tab;V.innerHTML=views[t]();$('#nav').innerHTML=TABS.map(([k,n])=>`<button data-a=go data-t=${k} class="${k===t?'on':''}">${n}</button>`).join('');$('#nav').hidden=t==='busy';scrollTo(0,0)}
const load=f=>new Promise((ok,no)=>{const u=URL.createObjectURL(f),i=new Image();i.onload=()=>{URL.revokeObjectURL(u);ok(i)};i.onerror=()=>no(new Error('Не удалось открыть изображение. Выберите JPG или PNG.'));i.src=u});
const shrink=(i,m,q)=>{const k=Math.min(1,m/Math.max(i.width,i.height)),c=document.createElement('canvas');c.width=i.width*k;c.height=i.height*k;c.getContext('2d').drawImage(i,0,0,c.width,c.height);return c.toDataURL('image/jpeg',q)};
async function pick(f){if(!f)return;if(!f.type.startsWith('image/'))return toast('Выберите файл изображения');
  try{const i=await load(f);S.img=shrink(i,1024,.8);S.thumb=shrink(i,480,.6)}catch(e){return toast(e.message)}
  S.id=null;S.ts=null;run(buildHint())}

// Реальная загрузка: прогресс берётся из события отправки файла, а не из таймера.
async function run(hint){
  S.tab='busy';render();
  const bar=$('#pb'),title=$('#bt'),sub=$('#ps'),t0=Date.now();let sent=false;
  const paint=()=>{const s=Math.round((Date.now()-t0)/1000);
    if(sent&&sub)sub.textContent=`Фото отправлено. AI анализирует… ${s} с`;
    else if(sub)sub.textContent=`Отправляем фотографию… ${s} с`;};
  paint();
  const tick=setInterval(paint,500);
  const onProgress=f=>{
    if(bar)bar.style.width=Math.max(6,Math.round(f*100))+'%';
    if(f>=1){sent=true;if(title)title.textContent='AI анализирует фотографию…';paint();}
  };
  let d=null,err=null;
  try{d=await analyze(S.img,hint,store.cfg().url,onProgress)}catch(e){err=e.message}
  clearInterval(tick);
  if(bar)bar.style.width='100%';
  if(err||!d){S.cur={items:[],meal:guess(),name:'Блюдо',err:err||'Пустой ответ сервера.'}}
  else{
    const meta=d.analysis_meta||{},tt=d.totals||{},clar=d.clarification||{},items=toItems(d);
    if(meta.dish_identified==='not_food'||!items.length){
      S.cur={items:[],meal:guess(),name:'Блюдо',err:'Еда на фото не найдена. Попробуйте другой снимок при хорошем освещении или добавьте продукты вручную.'};
    }else{
      S.cur={name:meta.dish_identified||d.dish_name||'Блюдо',items,meal:guess(),userNote:(S.note||'').trim(),
        cuisine:meta.cuisine_type||null,anchor:meta.scale_anchor_used||null,
        plate:Number(meta.estimated_plate_diameter_cm)||null,
        range:Array.isArray(tt.calories_range)&&tt.calories_range.length===2?tt.calories_range:null,
        weight:Number(tt.total_weight_g)||null,
        overall:typeof tt.overall_confidence==='number'?tt.overall_confidence:null,
        ask:clar.needed?clar.question:null,
        askOpts:Array.isArray(clar.options)&&clar.options.length?clar.options:null};
    }
  }
  S.tab='result';render();
}

const close=()=>{$('#m').hidden=true};
const val=k=>Math.max(0,parseFloat($('#e_'+k).value)||0);
function upd(){const w=val('weight');$('#e_sum').textContent=`На ${w} г: ${r(val('kcal')*w/100)} ккал, белки ${r(val('p')*w/100)} г, жиры ${r(val('f')*w/100)} г, углеводы ${r(val('c')*w/100)} г`}
function edit(i){const it=i<0?{name:'',weight:100,kcal:0,p:0,f:0,c:0}:S.cur.items[i];$('#m').hidden=false;
  $('#m').innerHTML=`<div class=sheet><h3>${i<0?'Новый продукт':'Редактирование'}</h3><label>Название<input id=e_name value="${esc(it.name)}"></label><label>Масса, г<input id=e_weight type=number min=0 value=${it.weight}></label><p class=sub>Значения на 100 г</p><div class=g4>${N.map(([n,k])=>`<label>${n}<input id=e_${k} type=number min=0 step=any value=${Math.round(it[k]*10)/10}></label>`).join('')}</div><p id=e_sum class=sub></p><button class=btn data-a=esave data-i=${i}>Готово</button>${i>=0?`<button class="btn danger" data-a=erm data-i=${i}>Удалить продукт</button>`:''}<button class=link data-a=eclose>Отмена</button></div>`;upd()}
const persist=rec=>{const e=store.entries(),mk=()=>S.id?e.map(x=>x.id===S.id?rec:x):[rec,...e];if(store.save(mk()))return true;rec.thumb=null;return store.save(mk())};
const A={
  shot:()=>$('#c').click(),gal:()=>$('#f').click(),go:({t})=>{S.tab=t;render()},per:({v})=>{S.period=v;render()},
  setplace({v}){S.place=S.place===v?null:v;if(S.place!=='home')S.cook=null;render()},
  setcook({v}){S.cook=S.cook===v?null:v;render()},
  place({v}){if(v==='reset'){S.place=null;S.cook=null;render();return}
    S.place=v;S.cook=null;
    if(v==='restaurant')run('Блюдо из ресторана или кафе: порции и количество масла обычно больше, соусы жирнее.');
    else render()},
  cook({v}){S.cook=v;run(`Домашняя еда: ${COOKHINT[v]||v}.`)},
  ask({v}){let a;if(v==='manual'){const w=parseFloat(prompt('Общий вес порции, г'));if(!w)return;a=`общий вес порции ${w} г`}else if(v==='custom'){const t=(prompt('Ваш ответ')||'').trim();if(!t)return;a=t}else a=v;run(S.cur.ask?`Ответ на уточняющий вопрос «${S.cur.ask}»: ${a}.`:`Уточнение: ${a}.`)},
  edit:({i})=>edit(+i),eclose:close,
  esave({i}){const o={name:$('#e_name').value.trim()||'Продукт',weight:val('weight'),kcal:val('kcal'),p:val('p'),f:val('f'),c:val('c')};i=+i;i<0?S.cur.items.push(o):S.cur.items[i]={...S.cur.items[i],...o};close();render()},
  erm({i}){S.cur.items.splice(+i,1);close();render()},
  save(){const rec={id:S.id||Date.now(),ts:S.ts||Date.now(),meal:$('#meal').value,name:S.cur.name,thumb:S.thumb,items:S.cur.items};
    if(!persist(rec))return toast('Не хватило места в памяти браузера. Удалите старые записи.');toast('Сохранено');S.id=null;S.tab='diary';render()},
  open({id}){const e=store.entries().find(x=>x.id==id);if(!e)return;S.cur={name:e.name,meal:e.meal,items:structuredClone(e.items)};S.img=S.thumb=e.thumb;S.id=e.id;S.ts=e.ts;S.place=null;S.cook=null;S.tab='result';render()},
  del({id}){if(!confirm('Удалить запись?'))return;store.save(store.entries().filter(x=>x.id!=id));S.id=null;S.tab='history';render()},
  cfg(){store.setCfg({url:$('#url').value.trim(),theme:$('#theme').value});theme();toast('Настройки сохранены')}};
document.addEventListener('click',e=>{const b=e.target.closest('[data-a]');if(b)A[b.dataset.a]?.(b.dataset)});
document.addEventListener('input',e=>{if(e.target.id==='note'){S.note=e.target.value;const c=$('#cnt');if(c)c.textContent=S.note.length+'/300';return}if(e.target.id?.startsWith('e_'))upd()});
document.addEventListener('change',e=>{const k=e.target.dataset.g;if(k)store.setGoals({...store.goals(),[k]:Math.max(1,+e.target.value||1)})});
$('#f').onchange=$('#c').onchange=e=>{pick(e.target.files[0]);e.target.value=''};
theme();render();requestAnimationFrame(()=>{const s=$('#splash');if(s){s.classList.add('off');setTimeout(()=>s.remove(),450)}});navigator.serviceWorker?.register('sw.js');
