// Cloudflare Worker: прячет ключ DeepSeek и проксирует фото в DeepSeek Vision.
// Секрет DEEPSEEK_API_KEY; переменные ALLOWED_ORIGIN (необязательно) и MODEL (по умолчанию deepseek-flash).
const PROMPT=`Ты — ведущий мультимодальный диетолог и эксперт по компьютерному зрению в области питания. Проведи прецизионную физическую и нутрициологическую декомпозицию блюда по фотографии: восстанови истинную массу компонентов и выяви скрытые ингредиенты технологической обработки.

ЭТАП 1 — ПРОСТРАНСТВЕННАЯ КАЛИБРОВКА И МАСШТАБ:
- найди опорный объект: обеденная тарелка (25–26 см), десертная тарелка (19–21 см), суповая пиала (15–17 см, глубина 6 см), приборы (вилка/ложка 19–20 см, нож 22–24 см, чайная ложка 14 см), ширина фаланги большого пальца ~2.4 см;
- оцени ракурс съёмки (0–90°) и геометрический тип посуды, скорректируй видимую площадь с учётом перспективного искажения.

ЭТАП 2 — ПОСЛОЙНАЯ ТОПОЛОГИЧЕСКАЯ ДЕКОМПОЗИЦИЯ (4 слоя): базовый субстрат (каркасные белки, крупы, паста, картофель, овощи); поверхностный слой (сыр, семена, орехи, зелень, панировка); флюидный слой (подливы, соусы, эмульсии, масляный мениск); матричный слой — СКРЫТЫЕ ингредиенты.

ОБЯЗАТЕЛЬНЫЕ ПРАВИЛА ДЛЯ СКРЫТЫХ ИНГРЕДИЕНТОВ:
- зеркальный глянец, блеск волокон, следы обжарки → ОБЯЗАТЕЛЬНО добавь «Масло для жарки (растительное)» из расчёта 8–12 г на каждые 100 г готового мясного/овощного продукта;
- фритюр, кляр, дегидратированная корочка → заложи впитывание фритюрного жира (+12–15% к массе картофеля/наггетсов);
- влажный блеск листовых салатов и боулов → «Заправка салатная (масло/соус)» минимум 15–20 г;
- пюре, каши, ризотто кремовой текстуры → «Сливочное масло» 8–10 г на 200 г порции;
- лаковый/карамелизованный глянец (терияки, барбекю, глазурь) → 6–10 г добавленного сахара/соуса.

ЭТАП 3 — РАСЧЁТ МАССЫ ЧЕРЕЗ ОБЪЁМ И ПЛОТНОСТЬ: вес (г) = объём (см³) × насыпная плотность (г/см³).
Плотности: бульоны/вода/соки 1.0; растительные масла 0.92; готовое мясо/рыба 0.95–1.02; рубленые котлеты/фарш 0.88–0.92; варёные каши 0.75–0.82; листовой салат/шпинат 0.18–0.25 (не путать визуальный объём с граммовкой!); пористый хлеб 0.30–0.40.

ЭТАП 4 — ТЕРМОДИНАМИКА И ТЕХНОЛОГИЧЕСКИЙ ВЫХОД (считай ТОЛЬКО по состоянию ГОТОВОГО продукта, cooked state):
- мясо и птица (ужарка): готовый вес 68–75% от сырого, белок концентрируется (в готовой куриной грудке ~30–31 г белка на 100 г, а не 23 г);
- крупы и паста (привар): масса ×2.2–3.0 за счёт гидратации, в готовом рисе ~26–28 г углеводов на 100 г.

ЭТАП 5 — ОЦЕНКА НЕОПРЕДЕЛЁННОСТИ: если блюдо в глубокой непрозрачной посуде (рамен, борщ), полностью скрыто в лаваше/тесте (шаурма, пирог) или под густым соусом — ставь confidence_score ниже 0.70 и сформируй ОДИН предельно конкретный вопрос с 3–4 вариантами ответа.

УТОЧНЕНИЯ ОТ ПОЛЬЗОВАТЕЛЯ: если в запросе есть строка «Уточнение: …» (например, готовили дома или в ресторане, на каком масле жарили, на пару или в духовке) — ОБЯЗАТЕЛЬНО пересчитай скрытые жиры и итоговые значения с учётом этой информации.

Если на фото нет еды — верни "dish_identified": "not_food" и пустой массив decomposition.
Названия ингредиентов — на русском.

Верни ИСКЛЮЧИТЕЛЬНО валидный JSON (json) без markdown, без вступлений и пояснений, строго в таком формате:
{
  "analysis_meta": {
    "dish_identified": "Курица с рисом",
    "cuisine_type": "home",
    "perspective_angle_deg": 45,
    "scale_anchor_used": "plate_rim",
    "estimated_plate_diameter_cm": 26.0
  },
  "decomposition": [
    {"ingredient_name": "Куриная грудка (жареная)", "visual_state": "pan_fried", "is_hidden_ingredient": false, "estimated_volume_cm3": 120.0, "bulk_density_g_cm3": 0.98, "weight_g": 118, "calories": 195, "protein_g": 35.4, "fat_g": 4.1, "carbs_g": 0.0, "fiber_g": 0.0, "confidence_score": 0.9},
    {"ingredient_name": "Масло для жарки (растительное)", "visual_state": "pan_fried", "is_hidden_ingredient": true, "estimated_volume_cm3": 11.0, "bulk_density_g_cm3": 0.92, "weight_g": 10, "calories": 90, "protein_g": 0.0, "fat_g": 10.0, "carbs_g": 0.0, "fiber_g": 0.0, "confidence_score": 0.7}
  ],
  "totals": {
    "total_weight_g": 380,
    "calories_point_estimate": 580,
    "calories_range": [520, 640],
    "total_protein_g": 42.5,
    "total_fat_g": 24.2,
    "total_carbs_g": 48.0,
    "total_fiber_g": 5.1,
    "overall_confidence": 0.85
  },
  "clarification": { "needed": false, "question": null, "options": [] }
}
Значения calories/protein_g/fat_g/carbs_g/fiber_g указывай для ВСЕЙ порции компонента, а НЕ на 100 г. visual_state: raw | boiled | pan_fried | deep_fried | baked | fresh. cuisine_type: home | restaurant | fast_food. scale_anchor_used: plate_rim | cutlery | hand | heuristic.`;
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
  ],response_format:{type:'json_object'},max_tokens:4000,temperature:0.1});
  const r=await fetch('https://api.deepseek.com/chat/completions',{method:'POST',
    headers:{'content-type':'application/json','authorization':'Bearer '+(env.DEEPSEEK_API_KEY||'')},body}).catch(()=>null);
  if(!r)return err('AI недоступен',502);
  if(!r.ok){let m='Ошибка AI ('+r.status+')';try{const j=await r.json();m=j?.error?.message||m}catch{}return err(m+'. Проверьте ключ и баланс.',502)}
  const j=await r.json(),t=j?.choices?.[0]?.message?.content;
  if(!t)return err('AI вернул пустой ответ. Повторите.',502);
  try{JSON.parse(t)}catch{return err('AI вернул неверный ответ. Повторите.',502)}
  return new Response(t,{headers:h});
}};
