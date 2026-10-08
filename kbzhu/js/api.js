// Единственная точка интеграции с AI.
// Если адрес сервера не указан — используется текущий домен (локальный запуск или Render).
export async function analyze(dataUrl,hint,url){
  const endpoint=(url&&url.trim())||`${location.origin}/api/analyze-food`;
  if(!navigator.onLine)throw new Error('Нет интернета. Подключитесь к сети и повторите.');
  let res;
  try{res=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({image:dataUrl.split(',')[1],mime:'image/jpeg',hint})})}
  catch{throw new Error('Не удалось связаться с сервером. Проверьте адрес в настройках.')}
  const d=await res.json().catch(()=>({}));
  if(!res.ok)throw new Error(d.error||'Ошибка сервера ('+res.status+')');
  return d;
}
