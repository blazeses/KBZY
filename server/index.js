// Локальный сервер «КБЖУ по фото».
// 1) Отдаёт статику из ../kbzhu по адресу http://localhost:3000
// 2) Принимает POST /api/analyze-food (или /) и проксирует фото в DeepSeek Vision.
// Ключ хранится в переменной окружения DEEPSEEK_API_KEY (файл .env подхватывается автоматически).
// Запуск: node index.js   (нужен Node.js 18+)
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, normalize, sep } from 'node:path';
import { request as https } from 'node:https';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = normalize(join(__dirname, '..', 'kbzhu'));
const PORT = Number(process.env.PORT || 3000);
const MODEL = process.env.MODEL || 'deepseek-flash';

// Минимальный загрузчик .env без зависимостей (не перезаписывает существующие переменные).
function loadEnv(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) {
      let v = m[2];
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      process.env[m[1]] = v;
    }
  }
}
loadEnv(join(__dirname, '..', '.env'));

const PROMPT = `Ты — ведущий мультимодальный диетолог и эксперт по компьютерному зрению в области питания. Проведи прецизионную физическую и нутрициологическую декомпозицию блюда по фотографии: восстанови истинную массу компонентов и выяви скрытые ингредиенты технологической обработки.

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

const MIME = {
  '.html': 'text/html;charset=utf-8', '.css': 'text/css;charset=utf-8', '.js': 'text/javascript;charset=utf-8',
  '.json': 'application/json;charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.webmanifest': 'application/manifest+json', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp'
};

function corsHeaders(req) {
  const o = req.headers.origin || '';
  const allow = process.env.ALLOWED_ORIGIN || '';
  const ok = !allow || allow === '*' || allow === o;
  return {
    'Access-Control-Allow-Origin': ok ? (o || '*') : 'null',
    'Access-Control-Allow-Methods': 'POST,OPTIONS,GET',
    'Access-Control-Allow-Headers': 'content-type'
  };
}
const send = (req, res, status, obj) => {
  res.writeHead(status, { 'Content-Type': 'application/json;charset=utf-8', ...corsHeaders(req) });
  res.end(JSON.stringify(obj));
};

function callDeepSeek(image, mime, hint) {
  if (!process.env.DEEPSEEK_API_KEY) {
    return Promise.reject({ status: 500, msg: 'Ключ DEEPSEEK_API_KEY не задан. Добавьте его в файл .env.' });
  }
  const body = JSON.stringify({
    model: MODEL,
    messages: [
      { role: 'system', content: PROMPT },
      {
        role: 'user',
        content: [
          { type: 'text', text: hint ? `Проанализируй это фото. Уточнение: ${String(hint).slice(0, 200)}` : 'Проанализируй это фото еды.' },
          { type: 'image_url', image_url: { url: `data:${mime || 'image/jpeg'};base64,${image}` } }
        ]
      }
    ],
    response_format: { type: 'json_object' },
    max_tokens: 4000,
    temperature: 0.1
  });
  return new Promise((resolve, reject) => {
    const rq = https('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + process.env.DEEPSEEK_API_KEY, 'Content-Length': Buffer.byteLength(body) }
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode !== 200) {
          let msg = `Ошибка AI (${res.statusCode})`;
          try { msg = JSON.parse(data)?.error?.message || msg; } catch {}
          return reject({ status: 502, msg: msg + '. Проверьте ключ и баланс.' });
        }
        try {
          const j = JSON.parse(data);
          const t = j.choices?.[0]?.message?.content;
          if (!t) return reject({ status: 502, msg: 'AI вернул пустой ответ. Повторите.' });
          JSON.parse(t);
          resolve(t);
        } catch { reject({ status: 502, msg: 'AI вернул неверный ответ. Повторите.' }); }
      });
    });
    rq.on('error', () => reject({ status: 502, msg: 'AI недоступен. Проверьте интернет.' }));
    rq.write(body);
    rq.end();
  });
}

const server = createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  const path = decodeURIComponent(u.pathname);

  if (req.method === 'OPTIONS') { res.writeHead(204, corsHeaders(req)); return res.end(); }

  if (req.method === 'POST' && (path === '/' || path === '/api/analyze-food' || path === '/api/analyze-food/')) {
    let raw = '';
    req.on('data', c => { raw += c; if (raw.length > 7e6) req.destroy(); });
    req.on('end', async () => {
      let b;
      try { b = JSON.parse(raw || '{}'); } catch { return send(req, res, 400, { error: 'Неверный запрос' }); }
      if (!b.image || b.image.length > 6e6) return send(req, res, 400, { error: 'Нет фото или оно слишком большое' });
      try {
        const t = await callDeepSeek(b.image, b.mime, b.hint);
        res.writeHead(200, { 'Content-Type': 'application/json;charset=utf-8', ...corsHeaders(req) });
        res.end(t);
      } catch (e) { send(req, res, e.status || 500, { error: e.msg || 'Ошибка сервера' }); }
    });
    return;
  }

  if (req.method !== 'GET') return send(req, res, 405, { error: 'Метод не поддерживается' });

  let fp = normalize(join(ROOT, path === '/' ? 'index.html' : path));
  if (fp !== ROOT && !fp.startsWith(ROOT + sep)) return send(req, res, 403, { error: 'Доступ запрещён' });
  try {
    const st = await stat(fp);
    if (st.isDirectory()) fp = join(fp, 'index.html');
    const data = await readFile(fp);
    res.writeHead(200, { 'Content-Type': MIME[extname(fp).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  } catch {
    // SPA-фолбэк на index.html
    try {
      const data = await readFile(join(ROOT, 'index.html'));
      res.writeHead(200, { 'Content-Type': 'text/html;charset=utf-8' });
      res.end(data);
    } catch { send(req, res, 500, { error: 'Ошибка сервера' }); }
  }
});

server.listen(PORT, () => console.log(`КБЖУ по фото: http://localhost:${PORT}`));
