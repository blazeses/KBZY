const get=(k,d)=>{try{return JSON.parse(localStorage.getItem(k))??d}catch{return d}};
const set=(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v));return true}catch{return false}};
export const store={
  entries:()=>get('kb.e',[]),save:v=>set('kb.e',v),
  goals:()=>get('kb.g',{kcal:2200,p:140,f:75,c:250}),setGoals:v=>set('kb.g',v),
  cfg:()=>get('kb.c',{url:'',theme:'auto'}),setCfg:v=>set('kb.c',v)};
