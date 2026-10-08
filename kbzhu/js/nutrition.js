// Значения продукта хранятся на 100 г; итог = значение × масса / 100.
export const sum=items=>items.reduce((a,i)=>{const k=i.weight/100;a.kcal+=i.kcal*k;a.p+=i.p*k;a.f+=i.f*k;a.c+=i.c*k;return a},{kcal:0,p:0,f:0,c:0});
export const r=n=>Math.round(n);
