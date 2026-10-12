// Значения продукта хранятся на 100 г; итог = значение × масса / 100.
export const sum=items=>items.reduce((a,i)=>{const k=(i.weight||0)/100;a.kcal+=(i.kcal||0)*k;a.p+=(i.p||0)*k;a.f+=(i.f||0)*k;a.c+=(i.c||0)*k;a.fib+=(i.fib||0)*k;return a},{kcal:0,p:0,f:0,c:0,fib:0});
export const r=n=>Math.round(n);
