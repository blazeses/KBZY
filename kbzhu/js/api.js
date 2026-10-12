// Единственная точка интеграции с AI.
// Если адрес сервера не указан — используется текущий домен (локальный запуск, Render или Cloudflare Pages).
// Используется XMLHttpRequest, чтобы показывать РЕАЛЬНЫЙ прогресс отправки фотографии (а не анимацию).
export function analyze(dataUrl,hint,url,onProgress){
  const endpoint=(url&&url.trim())||`${location.origin}/api/analyze-food`;
  return new Promise((resolve,reject)=>{
    if(!navigator.onLine){reject(new Error('Нет интернета. Подключитесь к сети и повторите.'));return}
    let body;
    try{body=JSON.stringify({image:dataUrl.split(',')[1],mime:'image/jpeg',hint})}
    catch{reject(new Error('Не удалось подготовить фотографию.'));return}
    const xhr=new XMLHttpRequest();
    xhr.open('POST',endpoint,true);
    xhr.setRequestHeader('content-type','application/json');
    xhr.timeout=120000;
    if(xhr.upload&&onProgress)xhr.upload.onprogress=e=>{if(e.lengthComputable)onProgress(e.loaded/e.total)};
    xhr.onload=()=>{
      let d={};
      try{d=JSON.parse(xhr.responseText||'{}')}catch{}
      if(xhr.status<200||xhr.status>=300){reject(new Error(d.error||'Ошибка сервера ('+xhr.status+')'));return}
      resolve(d);
    };
    xhr.onerror=()=>reject(new Error('Не удалось связаться с сервером. Проверьте адрес в настройках.'));
    xhr.ontimeout=()=>reject(new Error('Превышено время ожидания. Попробуйте ещё раз.'));
    xhr.send(body);
  });
}
