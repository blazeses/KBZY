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

const PROMPT = `Ты эксперт по компьютерному зрению и нутрициологической декомпозиции блюд. Проанализируй фотографию еды и разложи блюдо на компоненты.

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
    max_tokens: 2000,
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
