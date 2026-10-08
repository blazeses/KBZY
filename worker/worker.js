// Cloudflare Worker: прячет ключ DeepSeek и проксирует фото в DeepSeek Vision.
// Секрет DEEPSEEK_API_KEY; переменные ALLOWED_ORIGIN (необязательно) и MODEL (по умолчанию deepseek-flash).
const PROMPT=`Ты нутрициолог. Определи все продукты на фото, учитывай количество одинаковых предметов. Для каждого продукта оцени массу порции в граммах и значения на 100 г по справочным данным (USDA или аналог). Не изображай точность: если продукт или размер порции определить сложно, поставь низкую confidence и задай один уточняющий вопрос в поле question. Если на фото нет еды, верни is_food=false. Названия на русском.

Верни ТОЛЬКО валидный JSON без пояснений и без markdown, строго в таком формате (json):
{
  "is_food": true,
  "dish_name": "Курица с рисом",
  "note": "Размер порции определён приблизительно",
  "question": null,
  "foods": [
    {"name": "Куриная грудка", "weight_g": 150, "kcal_100": 165, "protein_100": 31, "fat_100": 3.6, "carbs_100": 0, "confidence": 0.87}
  ]
}`;
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
