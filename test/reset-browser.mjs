import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
try{
 const page=await browser.newPage();let calls=0;let response={status:200,body:{ok:true}};
 const html=await fs.readFile(new URL('../index.html',import.meta.url),'utf8');
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.pathname==='/')return route.fulfill({contentType:'text/html',body:html});
  if(url.pathname==='/api/reset-password'){calls++;const payload=route.request().postDataJSON();assert.equal(payload.token,'test-token');assert.equal(payload.action,'confirm');return route.fulfill({status:response.status,contentType:'application/json',body:JSON.stringify(response.body)})}
  return route.fulfill({status:404,body:'{}'});
 });
 await page.goto('http://rentacontrol.test/?reset=test-token');
 await page.locator('#authPassword').fill('Valid-password-123');
 await page.locator('#authEmail').evaluate(el=>el.disabled=false);
 await page.locator('#authSubmit').click();assert.equal(calls,0);assert.equal(await page.locator('#authForm').evaluate(el=>el.checkValidity()),false);
 await page.locator('#authEmail').evaluate(el=>el.disabled=true);
 await page.locator('#authSubmit').click();await page.getByText('Contraseña actualizada. Ya puedes iniciar sesión.').waitFor();assert.equal(calls,1);
 console.log('PASS original failure reproduced; corrected browser submits with empty hidden email and shows success');
 await page.goto('http://rentacontrol.test/?reset=test-token');response={status:400,body:{error:'El enlace es inválido o ya expiró.'}};
 await page.locator('#authPassword').fill('Valid-password-123');await page.locator('#authSubmit').click();await page.getByText(response.body.error).waitFor();assert(await page.locator('#authSubmit').isEnabled());
 response={status:200,body:{}};await page.locator('#authSubmit').click();await page.getByText('No fue posible cambiar la contraseña.').waitFor();
 console.log('PASS API errors visible, retry enabled, malformed success rejected');
 await page.goto('http://rentacontrol.test/');assert(await page.locator('#authEmail').isEnabled());assert.equal(await page.locator('#authEmail').getAttribute('required'),'');
 console.log('PASS normal login retains required enabled email');
}finally{await browser.close()}
