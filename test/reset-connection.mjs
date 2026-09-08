import assert from 'node:assert/strict';
import pg from 'pg';
const original=pg.Pool.prototype.connect;
pg.Pool.prototype.connect=async()=>{throw new Error('Simulated database unavailable')};
const handler=(await import('../api/reset-password.js')).default;
const res={setHeader(){},status(code){this.code=code;return this},json(body){this.body=body;return this}};
const error=console.error;console.error=()=>{};
try{await handler({method:'POST',body:{action:'confirm',token:'test',password:'Valid-password'}},res);assert.equal(res.code,500);assert.equal(res.body.error,'Error al restablecer la contraseña.');console.log('PASS: connection failure returns structured error instead of uncaught rejection')}
finally{pg.Pool.prototype.connect=original;console.error=error}
