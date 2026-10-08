// Локальный сервер «КБЖУ по фото».
// 1) Отдаёт статику из ../kbzhu по адресу http://localhost:3000
// 2) Принимает POST /api/analyze-food (или /) и проксирует фото в Gemini.
// Ключ хранится в переменной окружения GEMINI_API_KEY (файл .env подхватывается автоматически).
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
const MODEL = process.env.MODEL || 'gemini-2.5-flash';

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

const PROMPT = `Ты нутрициолог. Определи все продукты на фото, учитывай количество одинаковых предметов. Для каждого оцени массу порции в граммах и значения на 100 г по справочным данным (USDA или аналог). Не изображай точность: если продукт или размер порции определить сложно, поставь низкую confidence и задай один уточняющий вопрос в поле question. Если на фото нет еды, верни is_food=false. Названия на русском.`;
const N = { type: 'NUMBER' }, S = { type: 'STRING' };
const SCHEMA = {
  type: 'OBJECT',
  required: ['is_food', 'foods'],
  properties: {
    is_food: { type: 'BOOLEAN' },
    dish_name: S,
    note: S,
    question: { type: 'STRING', nullable: true },
    foods: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        required: ['name', 'weight_g', 'kcal_100', 'protein_100', 'fat_100', 'carbs_100', 'confidence'],
        properties: { name: S, weight_g: N, kcal_100: N, protein_100: N, fat_100: N, carbs_100: N, confidence: N }
      }
    }
  }
};

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

function callGemini(image, mime, hint) {
  if (!process.env.GEMINI_API_KEY) {
    return Promise.reject({ status: 500, msg: 'Ключ GEMINI_API_KEY не задан. Добавьте его в файл .env.' });
  }
  const body = JSON.stringify({
    contents: [{ parts: [{ text: PROMPT + (hint ? '\n' + String(hint).slice(0, 200) : '') }, { inline_data: { mime_type: mime || 'image/jpeg', data: image } }] }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: SCHEMA, temperature: 0.2 }
  });
  return new Promise((resolve, reject) => {
    const rq = https(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY, 'Content-Length': Buffer.byteLength(body) }
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode !== 200) {
          let msg = `Ошибка AI (${res.statusCode})`;
          try { msg = JSON.parse(data)?.error?.message || msg; } catch {}
          return reject({ status: 502, msg: msg + '. Проверьте ключ и лимиты.' });
        }
        try {
          const j = JSON.parse(data);
          const t = j.candidates?.[0]?.content?.parts?.[0]?.text;
          if (!t) return reject({ status: 502, msg: 'AI вернул пустой ответ.' });
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
        const t = await callGemini(b.image, b.mime, b.hint);
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
