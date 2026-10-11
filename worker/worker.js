// Cloudflare Worker: прячет ключ DeepSeek и проксирует фото в DeepSeek Vision.
// Секрет DEEPSEEK_API_KEY; переменные ALLOWED_ORIGIN (необязательно) и MODEL (по умолчанию deepseek-flash).
const PROMPT=`Ты эксперт по компьютерному зрению и нутрициологической декомпозиции блюд. Проанализируй фотографию еды и разложи блюдо на компоненты.

ПРАВИЛА:
1. Скрытые ингредиенты: если виден глянец, масляная плёнка или корочка обжарки — ОБЯЗАТЕЛЬНО добавь отдельной позицией масло (растительное или сливочное), вес 8–12 г на 100 г обжаренного продукта. Листовые салаты с влажным блеском — добавь заправку/масло 15–20 г. Для пюре, каш и пасты учитывай скрытое сливочное масло/соус.
2. Масштаб и объём: используй ориентиры (обод тарелки 24–26 см, вилка ~20 см, руки), оцени примерный объём каждого компонента и его состояние (сырое/варёное/жарёное/запечённое).
3. Кулинарные потери: для круп и макарон указывай вес ГОТОВОГО продукта (с учётом впитанной воды); для мяса и рыбы — готовый вес (минус 25–35% ужарки/уварки).
4. Уверенность (confidence 0.0–1.0): если блюдо скрыто (глубокая миска, непрозрачный суп, закрытый бургер/пирог) — понижай confidence.

УТОЧНЯЮЩИЙ ВОПРОС — только если ответ реально изменит КБЖУ:
- needs_clarification=true и clarification_question — ОДИН короткий вопрос о составе, добавках или размере порции.
- clarification_options — 2–4 коротких варианта ответа ИМЕННО на заданный вопрос, словами пользователя. Пример: вопрос «Добавлены ли сыр или сливки?» → варианты ["Без сыра и сливок", "С сыром", "Со сливками"].
- Варианты «Маленькая/Средняя/Большая» допустимы ТОЛЬКО если вопрос про размер порции. Если вопрос про состав — предлагай варианты состава.
- Если уточнять нечего: needs_clarification=false, clarification_question=null, clarification_options=[].

Калории и БЖУ указывай НА 100 ГРАММ продукта (поля kcal_100, protein_100, fat_100, carbs_100). Массу порции указывай в граммах в weight_g.

Верни ТОЛЬКО валидный JSON без пояснений и без markdown, в таком формате (json):
{
  "is_food": true,
  "dish_name": "Курица с рисом",
  "cuisine_type": "home",
  "scale_reference_detected": "plate",
  "note": "Порция определена приблизительно",
  "needs_clarification": false,
  "clarification_question": null,
  "clarification_options": [],
  "foods": [
    {"name": "Куриная грудка жареная", "processing_state": "fried", "is_hidden_fat_or_sauce": false, "weight_g": 150, "kcal_100": 165, "protein_100": 31, "fat_100": 3.6, "carbs_100": 0, "confidence": 0.87},
    {"name": "Масло растительное (жарка)", "processing_state": "fried", "is_hidden_fat_or_sauce": true, "weight_g": 10, "kcal_100": 884, "protein_100": 0, "fat_100": 100, "carbs_100": 0, "confidence": 0.7}
  ]
}
Если на фото нет еды — верни is_food=false и пустой массив foods. Названия на русском.`;
export default{async fetch(req,env){
  const o=req.headers.get('origin')||'',ok=!env.ALLOWED_ORIGIN||o===env.ALLOWED_ORIGIN;
  const h={'access-control-allow-origin':ok?o||'*':'null','access-control-allow-methods':'POST,OPTIONS','access-control-allow-headers':'content-type','content-type':'application/json'};
  const err=(m,s)=>new Response(JSON.stringify({error:m}),{status:s,headers:h});
  if(req.method==='OPTIONS')return new Response(null,{headers:h});
  if(req.method!=='POST'||!ok)return err('Доступ запрещён',403);
  if(!env.DEEPSEEK_API_KEY)return err('Ключ DEEPSEEK_API_KEY не задан. Добавьте его в секреты воркера.',500);
  let b;try{b=await req.json()}catch{return err('Неверный запрос',400)}
  if(!b.image||b.image.length>6e6)return err('Нет фото или оно слишком большое',400);
  const MODEL=env.MODEL||'deepseek-flash';
  const body=JSON.stringify({model:MODEL,messages:[
    {role:'system',content:PROMPT},
    {role:'user',content:[
      {type:'text',text:b.hint?`Проанализируй это фото. Уточнение: ${String(b.hint).slice(0,200)}`:'Проанализируй это фото еды.'},
      {type:'image_url',image_url:{url:`data:${b.mime||'image/jpeg'};base64,${b.image}`}}
    ]}
  ],response_format:{type:'json_object'},max_tokens:2000,temperature:0.1});
  const r=await fetch('https://api.deepseek.com/chat/completions',{method:'POST',
    headers:{'content-type':'application/json','authorization':'Bearer '+(env.DEEPSEEK_API_KEY||'')},body}).catch(()=>null);
  if(!r)return err('AI недоступен',502);
  if(!r.ok){let m='Ошибка AI ('+r.status+')';try{const j=await r.json();m=j?.error?.message||m}catch{}return err(m+'. Проверьте ключ и баланс.',502)}
  const j=await r.json(),t=j?.choices?.[0]?.message?.content;
  if(!t)return err('AI вернул пустой ответ. Повторите.',502);
  try{JSON.parse(t)}catch{return err('AI вернул неверный ответ. Повторите.',502)}
  return new Response(t,{headers:h});
}};
