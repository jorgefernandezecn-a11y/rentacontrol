// Shared by browser, state API and reports. Amounts are rounded to MXN cents.
export const validMonth = v => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(v));
const bad = message => { throw Object.assign(new Error(message), {status:400}); };
export const roundMoney = v => Math.round((Number(v)+Number.EPSILON)*100)/100;
function number(v,max=1e10){if(v===''||v===null||typeof v==='boolean'||!Number.isFinite(Number(v))||Number(v)<0||Number(v)>max)bad('Importe o porcentaje fiscal no válido.');return Number(v)}
function choice(v,choices){if(!choices.includes(v))bad('Clasificación fiscal no válida.');return v}
function tax(input,base,vat=false){
 const mode=choice(input?.mode,vat?['percent','amount','twoThirds']:['percent','amount']);
 const value=mode==='twoThirds'?0:number(input.value,mode==='percent'?100:1e10);
 return {mode,value,amount:roundMoney(mode==='twoThirds'?base*2/3:mode==='percent'?base*value/100:value)};
}
export function calculateFiscal(v){
 if(!validMonth(v.from))bad('Selecciona un mes de aplicación válido.');
 const base=roundMoney(number(v.base));
 const landlord=choice(v.landlord,['PF','PM','unknown']),tenant=choice(v.tenant,['PF','PM','unknown']);
 const regime=choice(v.regime,['general','resico','other','unknown']);
 const use=choice(v.use,['commercial','housing','furnished','mixed','other','unknown']);
 const resident=v.resident===true;
 const iva=tax(v.iva,base),retIva=tax(v.retIva,iva.amount,true),retIsr=tax(v.retIsr,base);
 const net=roundMoney(base+iva.amount-retIva.amount-retIsr.amount);
 if(retIva.amount>iva.amount)bad('La retención de IVA no puede superar el IVA trasladado.');
 if(net<0)bad('Las retenciones no pueden producir una renta neta negativa.');
 return {from:v.from,base,landlord,tenant,regime,use,resident,iva,retIva,retIsr,net,note:String(v.note||'').slice(0,1000)};
}
export function fiscalFor(c,period){
 const fiscal=c.fiscal??c.rent_fiscal;
 const version=fiscal?.versions?.filter(x=>x.from<=period).sort((a,b)=>b.from.localeCompare(a.from))[0];
 if(version)return {...calculateFiscal(version),configured:true};
 const net=Number(fiscal?.legacyNet??c.rent)||0;
 return {base:null,iva:{amount:0},retIva:{amount:0},retIsr:{amount:0},net,configured:false};
}
export const netRent=(c,period)=>fiscalFor(c,period).net;
export function normalizeFiscal(f){
 if(f==null)return null;
 if(!Array.isArray(f.versions)||!f.versions.length||f.versions.length>240)bad('Historial fiscal no válido.');
 const versions=f.versions.map(calculateFiscal).sort((a,b)=>a.from.localeCompare(b.from));
 if(new Set(versions.map(v=>v.from)).size!==versions.length)bad('Existe más de una configuración para el mismo mes.');
 return {legacyNet:number(f.legacyNet),versions};
}
export function validateFiscalChange(before,after,currentMonth){
 const previous=before?.fiscal||null,next=after.fiscal;
 if(previous&&!next)bad('No se puede quitar el historial fiscal. Actualiza la app.');
 if(!previous&&!next)return;
 if(next.legacyNet!==Number(before?.rent??after.rent)||Number(after.rent)!==Number(before?.rent??after.rent))bad('La renta anterior debe conservarse; cambia la renta desde Impuestos del contrato.');
 const old=previous?.versions||[],versions=next.versions;
 for(const entry of old)if(!versions.some(v=>v.from===entry.from))bad('No se pueden quitar periodos del historial fiscal.');
 for(const entry of versions){
  const existing=old.find(v=>v.from===entry.from);
  if(JSON.stringify(existing)===JSON.stringify(entry))continue;
  if(entry.from<currentMonth||entry.from<String(after.start).slice(0,7))bad('Los cambios fiscales se aplican desde el mes actual o uno posterior a partir del inicio del contrato.');
 }
}
// Suggestions require an explicit confirmation of Mexican residence and ordinary rules.
export function suggestFiscal(v){
 if(!v.resident||!['PF','PM'].includes(v.landlord)||!['PF','PM'].includes(v.tenant)||!['commercial','housing','furnished'].includes(v.use))return null;
 const taxable=v.use!=='housing',withheld=v.landlord==='PF'&&v.tenant==='PM';
 if(withheld&&!['general','resico'].includes(v.regime))return null;
 return {iva:{mode:'percent',value:taxable?16:0},retIva:{mode:withheld&&taxable?'twoThirds':'percent',value:0},retIsr:{mode:'percent',value:withheld?(v.regime==='resico'?1.25:10):0}};
}
