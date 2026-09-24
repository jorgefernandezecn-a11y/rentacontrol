import http from 'node:http';import fs from 'node:fs/promises';
const source=await fs.readFile(new URL('../index.html',import.meta.url),'utf8');
const functions=source.slice(source.indexOf('function fiscalSummary('),source.indexOf('async function saveFiscalForm('));
const html=`<!doctype html><meta charset="utf-8"><pre id="results">Probando…</pre><div id="modal"><form id="form"><h2 id="ft"></h2><div id="fields"></div></form></div><script type="module">
import {fiscalFor,calculateFiscal,suggestFiscal} from '/fiscal.js';
const form=document.getElementById('form'),fields=document.getElementById('fields'),ft=document.getElementById('ft'),modal=document.getElementById('modal'),period={value:'2026-09'},currentSession={role:'Administrador'},MO=()=> '2026-09',C=()=>({id:'c',rent:10000,start:'2026-01-01'}),P=()=>({name:'Prueba'}),T=()=>({name:'Prueba'}),H=v=>String(v??''),M=v=>Number(v).toFixed(2);let FT,E,CTX;
${functions}
const set=(name,value)=>{const el=form.elements.namedItem(name);if(el.type==='checkbox')el.checked=value;else el.value=value;el.dispatchEvent(new Event('change',{bubbles:true}))};const check=(v,m)=>{if(!v)throw Error(m)};const lines=[],pass=m=>lines.push('PASS '+m);
try{
fiscalForm('c');document.getElementById('suggestFiscal').click();check(document.getElementById('fiscalHint').textContent.includes('Selecciona Arrendador'),'Falta guía');pass('Datos incompletos indican qué falta sin bloqueo');
for(const [k,v] of Object.entries({landlord:'PF',tenant:'PM',regime:'general',use:'commercial',resident:true}))set(k,v);
document.getElementById('suggestFiscal').click();check(document.getElementById('fiscalPreview').textContent.includes('9533.33'),'Neto PF/PM incorrecto');check(form.elements.retIvaValue.disabled,'Dos terceras partes no desactiva campo');pass('Botón calcula IVA, retenciones y neto 9533.33');
set('base','20000');check(document.getElementById('fiscalPreview').textContent.includes('19066.67'),'No recalcula base');pass('Renta modificada recalcula inmediatamente');
set('base','');document.getElementById('suggestFiscal').click();check(document.getElementById('fiscalHint').textContent.includes('no válido'),'Error sin tratar');set('base','10000');set('regime','resico');document.getElementById('suggestFiscal').click();check(document.getElementById('fiscalPreview').textContent.includes('10408.33'),'RESICO incorrecto');pass('Error recuperable y nuevo intento correcto');
set('landlord','PM');document.getElementById('suggestFiscal').click();check(!form.elements.retIvaValue.disabled,'Campo sigue desactivado');check(document.getElementById('fiscalPreview').textContent.includes('11600.00'),'PM incorrecto');check(form.elements.regime.closest('label').style.display==='none','Selector ISR visible sin retención');set('regime','unknown');document.getElementById('suggestFiscal').click();check(document.getElementById('fiscalPreview').textContent.includes('11600.00'),'Bloquea sin régimen');pass('Cambio de clasificación libera campo y calcula sin régimen');
set('use','mixed');document.getElementById('suggestFiscal').click();check(document.getElementById('fiscalHint').textContent.includes('captura manual'),'Uso mixto no explicado');pass('Tratamientos especiales no inventan impuestos');
results.textContent=lines.join('\\n')+'\\nTODAS LAS PRUEBAS PASARON';
}catch(e){results.textContent=lines.join('\\n')+'\\nFAIL '+e.stack}
</script>`;
http.createServer(async(req,res)=>{res.setHeader('Content-Type',req.url==='/fiscal.js'?'text/javascript':'text/html');res.end(req.url==='/fiscal.js'?await fs.readFile(new URL('../fiscal.js',import.meta.url)):html)}).listen(4187,'127.0.0.1',()=>console.log('http://127.0.0.1:4187'));
