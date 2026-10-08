// Единственная точка интеграции с AI: меняйте адрес в настройках или логику в worker/worker.js.
export async function analyze(dataUrl,hint,url){
  if(!url)throw new Error('Не указан адрес сервера. Откройте «Настройки» и вставьте адрес Worker.');
  if(!navigator.onLine)throw new Error('Нет интернета. Подключитесь к сети и повторите.');
  let res;
  try{res=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({image:dataUrl.split(',')[1],mime:'image/jpeg',hint})})}
  catch{throw new Error('Не удалось связаться с сервером. Проверьте адрес в настройках.')}
  const d=await res.json().catch(()=>({}));
  if(!res.ok)throw new Error(d.error||'Ошибка сервера ('+res.status+')');
  return d;
}
