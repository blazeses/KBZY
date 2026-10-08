// Cloudflare Worker: прячет ключ Gemini. Секрет GEMINI_API_KEY; переменные ALLOWED_ORIGIN (необязательно) и MODEL.
const PROMPT=`Ты нутрициолог. Определи все продукты на фото, учитывай количество одинаковых предметов. Для каждого оцени массу порции в граммах и значения на 100 г по справочным данным (USDA или аналог). Не изображай точность: если продукт или размер порции определить сложно, поставь низкую confidence и задай один уточняющий вопрос в поле question. Если на фото нет еды, верни is_food=false. Названия на русском.`;
const N={type:'NUMBER'},S={type:'STRING'};
const SCHEMA={type:'OBJECT',required:['is_food','foods'],properties:{is_food:{type:'BOOLEAN'},dish_name:S,note:S,question:{type:'STRING',nullable:true},
foods:{type:'ARRAY',items:{type:'OBJECT',required:['name','weight_g','kcal_100','protein_100','fat_100','carbs_100','confidence'],properties:{name:S,weight_g:N,kcal_100:N,protein_100:N,fat_100:N,carbs_100:N,confidence:N}}}}};
export default{async fetch(req,env){
  const o=req.headers.get('origin')||'',ok=!env.ALLOWED_ORIGIN||o===env.ALLOWED_ORIGIN;
  const h={'access-control-allow-origin':ok?o||'*':'null','access-control-allow-methods':'POST,OPTIONS','access-control-allow-headers':'content-type','content-type':'application/json'};
  const err=(m,s)=>new Response(JSON.stringify({error:m}),{status:s,headers:h});
  if(req.method==='OPTIONS')return new Response(null,{headers:h});
  if(req.method!=='POST'||!ok)return err('Доступ запрещён',403);
  let b;try{b=await req.json()}catch{return err('Неверный запрос',400)}
  if(!b.image||b.image.length>6e6)return err('Нет фото или оно слишком большое',400);
  const r=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${env.MODEL||'gemini-2.5-flash'}:generateContent`,{method:'POST',
    headers:{'content-type':'application/json','x-goog-api-key':env.GEMINI_API_KEY},
    body:JSON.stringify({contents:[{parts:[{text:PROMPT+(b.hint?'\n'+String(b.hint).slice(0,200):'')},{inline_data:{mime_type:b.mime||'image/jpeg',data:b.image}}]}],
      generationConfig:{responseMimeType:'application/json',responseSchema:SCHEMA,temperature:0.2}})}).catch(()=>null);
  if(!r)return err('AI недоступен',502);
  if(!r.ok)return err('Ошибка AI ('+r.status+'). Проверьте ключ и лимиты.',502);
  const t=(await r.json()).candidates?.[0]?.content?.parts?.[0]?.text;
  try{JSON.parse(t)}catch{return err('AI вернул неверный ответ. Повторите.',502)}
  return new Response(t,{headers:h});}};
