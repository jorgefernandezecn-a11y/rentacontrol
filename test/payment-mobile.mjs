import fs from 'node:fs/promises';import http from 'node:http';
const source=await fs.readFile(new URL('../index.html',import.meta.url),'utf8');const fn=source.slice(source.indexOf('function paymentCorrectionCards('),source.indexOf('function acct(cid)'));
const page=`<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><style>${source.split('<style>')[1].split('</style>')[0]}</style><pre id=result></pre><div style="width:350px;max-width:100%;padding:16px" id=cards></div><script>
let allowed=true;const canDeleteEntity=()=>allowed,C=()=>({tenantId:'t',propertyId:'p'}),T=()=>({name:'Inquilino de prueba'}),P=()=>({name:'Inmueble de prueba'}),H=v=>String(v??''),M=v=>'$'+v;
${fn}
const records=[{id:'payment-a',contractId:'c',amount:1000,date:'2026-09-24',method:'Transferencia'}];
cards.innerHTML=paymentCorrectionCards(records);
const buttons=[...cards.querySelectorAll('button')];
try{if(buttons.length!==2)throw Error('Faltan botones');for(const b of buttons){const r=b.getBoundingClientRect();if(r.right>cards.getBoundingClientRect().right||r.width<=0)throw Error('Botón fuera del contenedor móvil');}if(buttons[0].dataset.editPayment!=='payment-a'||buttons[1].dataset.deletePayment!=='payment-a')throw Error('ID incorrecto');allowed=false;if(paymentCorrectionCards(records)!=='')throw Error('Permisos');allowed=true;if(!paymentCorrectionCards([]).includes('No hay pagos'))throw Error('Periodo vacío');result.textContent='PASS: botones visibles en ancho móvil, ID correcto, permisos y periodo vacío';}catch(e){result.textContent='FAIL '+e.message}
</script>`;
http.createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end(page)}).listen(4190,'127.0.0.1',()=>console.log('http://127.0.0.1:4190'));
