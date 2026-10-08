const fs=require('node:fs'),vm=require('node:vm'),test=require('node:test'),assert=require('node:assert/strict');
const source=fs.readFileSync(require('node:path').join(__dirname,'../docs/GoogleSheets.gs'),'utf8');
const makeTurn=()=>({id:'fixture',code:'T-20261008-001',opened_at:'2026-10-08T23:00:00Z',closed_at:'2026-10-09T02:00:00Z',sales_count:2,total_uyu:420,payment_totals:[{method:'Pix',currency:'BRL',amountMinor:3855,amountUYU:320,paymentsCount:1,missingCount:0},{method:'Efectivo UYU',currency:'UYU',amountMinor:10000,amountUYU:100,paymentsCount:1,missingCount:0}]});
function boot({localized=false}={}){
 const data=new Map(),formulas=new Map(),cajaFormulas=new Map(),acks=[],props={KEBBA_URL:'https://fixture.supabase.co',KEBBA_PUBLIC_KEY:'public',KEBBA_BRIDGE_TOKEN:'test-only',KEBBA_SHEET_ID:'sheet',KEBBA_WAKE_TOKEN:'wake'},turn=makeTurn();let failAck=true,locked=false,flushes=0;
 const range=(r,c,n=1,m=1)=>({getValues:()=>Array.from({length:n},(_,i)=>Array.from({length:m},(_,j)=>data.get((r+i)+','+(c+j))??'')),clearContent(){for(let i=0;i<n;i++)for(let j=0;j<m;j++){data.delete((r+i)+','+(c+j));formulas.delete((r+i)+','+(c+j));}return this;},setValues(rows){rows.forEach((row,i)=>row.forEach((v,j)=>data.set((r+i)+','+(c+j),v)));return this;},getFormula:()=>formulas.get(r+','+c)||'',setFormula(v){formulas.set(r+','+c,v);return this;},setFormulas(rows){rows.forEach((row,i)=>row.forEach((v,j)=>formulas.set((r+i)+','+(c+j),v)));return this;},setNumberFormat(){return this;}});
 const sheet={getLastRow:()=>Math.max(14,...[...data.keys()].map(k=>Number(k.split(',')[0]))),getMaxRows:()=>1006,insertRowsAfter(){},getRange(r,c,n,m){if(typeof r==='string')return range(19,15);return range(r,c,n,m);}};
 const caja={getRange:(r,c)=>({getFormula:()=>cajaFormulas.get(r+","+c)||"",setFormula:v=>cajaFormulas.set(r+","+c,v)})};
 for(let r=5;r<=8;r++){const formula=`=B${r}+SUMIFS('Turnos'!$G$7:$G$1006,'Turnos'!$J$7:$J$1006,A${r},'Turnos'!$A$7:$A$1006,">="&$E$11)`;cajaFormulas.set(r+',3',localized?formula.replace(/'Turnos'/g,'Turnos').replace(/,/g,';'):formula);}
 ['Fecha de cierre','Turno','Apertura','Cierre','Medio de pago','Moneda','Total cobrado','Venta UYU','Pagos','Cuenta','ID de envío'].forEach((v,i)=>data.set('6,'+(i+1),v));
 const book={getSheetByName:n=>n==='Caja'?caja:sheet,setSpreadsheetTimeZone(){}};
 const ctx={console,Date,Set,Map,PropertiesService:{getScriptProperties:()=>({getProperties:()=>props,setProperty(k,v){props[k]=v;return this;}})},Utilities:{formatDate:d=>new Date(d.getTime()-3*3600000).toISOString().slice(0,10)},LockService:{getScriptLock:()=>({tryLock(){if(locked)return false;locked=true;return true},releaseLock(){locked=false}})},SpreadsheetApp:{openById:id=>{assert.equal(id,'sheet');return book;},flush(){flushes++;}},UrlFetchApp:{fetch(url,opt){const body=JSON.parse(opt.payload);if(url.endsWith('_read'))return {getResponseCode:()=>200,getContentText:()=>JSON.stringify({spreadsheetId:'sheet',turns:[turn]})};acks.push(body);if(failAck)throw Error('Respuesta perdida');return {getResponseCode:()=>200,getContentText:()=>'{"ok":true}'};}}};
 vm.createContext(ctx);vm.runInContext(source,ctx);
 return {ctx,data,formulas,cajaFormulas,acks,turn,book,sheet,get flushes(){return flushes},set failAck(v){failAck=v},run:s=>vm.runInContext(s,ctx)};
}
test('puente carga solamente totales, con fecha uruguaya, y reintento no duplica filas',()=>{const a=boot();assert.throws(()=>a.run('sincronizarKebba()'),/Respuesta perdida/);assert.equal(a.data.get('7,7'),38.55);assert.equal(a.data.get('8,7'),100);assert.equal(a.data.get('7,1').toISOString(),'2026-10-08T03:00:00.000Z');const before=[...a.data.keys()].length;a.failAck=false;a.run('sincronizarKebba()');assert.equal([...a.data.keys()].length,before);assert.equal(a.acks.length,2);assert.deepEqual(a.acks[0].row_ids,['fixture:Efectivo UYU','fixture:Pix']);assert.ok(a.flushes>=2);});
test('importes modificados y IDs duplicados impiden confirmar un envío',()=>{const a=boot();assert.throws(()=>a.run('sincronizarKebba()'));a.failAck=false;a.data.set('7,7',999);assert.throws(()=>a.run('sincronizarKebba()'),/Importe/);assert.equal(a.acks.length,1);a.data.set('7,7',38.55);a.data.set('9,11','fixture:Pix');assert.throws(()=>a.run('sincronizarKebba()'),/duplicado/);assert.equal(a.acks.length,1);});
test('dato BRL faltante no crea filas ni confirma envío',()=>{const a=boot();a.turn.payment_totals[0].amountMinor=null;a.turn.payment_totals[0].missingCount=1;assert.throws(()=>a.run('sincronizarKebba()'),/Falta el importe/);assert.equal(a.data.get('7,11'),undefined);assert.equal(a.acks.length,0);});
test('la capacidad extiende el final de los rangos sin desplazar el inicio',()=>{const a=boot();a.ctx.fixtureBook=a.book;a.ctx.fixtureSheet=a.sheet;a.run('kebbaCapacidad_(fixtureBook,fixtureSheet,1012)');for(let r=5;r<=8;r++){assert.match(a.cajaFormulas.get(r+',3'),/\$G\$7:\$G\$1012/);assert.match(a.cajaFormulas.get(r+',3'),/\$J\$7:\$J\$1012/);assert.match(a.cajaFormulas.get(r+',3'),/\$A\$7:\$A\$1012/);}});
test('webhook sin clave válida no consulta ventas ni cambia planilla',()=>{const a=boot();a.ctx.ContentService={MimeType:{JSON:'json'},createTextOutput:t=>({setMimeType:()=>t})};assert.equal(a.run('doPost({postData:{contents:\'{"wakeToken":"incorrecta"}\'}})'),'{"ok":false}');assert.equal(a.acks.length,0);assert.equal(a.data.get('7,11'),undefined);});
test('reintento repara la fórmula de cuenta después de un envío parcialmente escrito',()=>{const a=boot();assert.throws(()=>a.run('sincronizarKebba()'));a.formulas.delete('7,10');a.failAck=false;a.run('sincronizarKebba()');assert.match(a.formulas.get('7,10'),/^=IF\(E7/);assert.equal(a.acks.length,2);assert.equal(a.data.get('9,11'),undefined);});
test('la planilla convertida conserva separadores y referencias nativas en español',()=>{const a=boot({localized:true});a.failAck=false;a.run('sincronizarKebba()');assert.equal(a.acks.length,1);assert.match(a.formulas.get('7,10'),/^=IF\(E7="";/);assert.ok(!a.formulas.get('7,10').includes(','));a.ctx.fixtureBook=a.book;a.ctx.fixtureSheet=a.sheet;a.run('kebbaCapacidad_(fixtureBook,fixtureSheet,1012)');for(let r=5;r<=8;r++)assert.match(a.cajaFormulas.get(r+',3'),/Turnos!\$G\$7:\$G\$1012;Turnos!/);assert.match(a.formulas.get('19,15'),/\$H\$1012;\$J\$/);});

test('eliminar un pedido corrige el importe y quita métodos que ya no existen sin tocar otro turno',()=>{
 const a=boot();a.failAck=false;a.run('sincronizarKebba()');
 a.data.set('12,11','otro:Efectivo UYU');a.data.set('12,7',999);
 a.turn.revision=2;a.turn.payment_totals=[{...a.turn.payment_totals[0],amountMinor:1000,amountUYU:83}];
 a.run('sincronizarKebba()');assert.equal(a.data.get('7,7'),10);assert.equal(a.data.get('8,11'),undefined);
 assert.equal(a.data.get('8,7'),undefined);assert.match(a.formulas.get('8,10'),/^=IF/);
 assert.equal(a.data.get('12,7'),999);assert.equal(a.acks.at(-1).expected_revision,2);
 assert.deepEqual(a.acks.at(-1).row_ids,['fixture:Pix']);
});
test('eliminar y restaurar turno con respuesta perdida es repetible y conserva BRL',()=>{
 const a=boot();a.failAck=false;a.run('sincronizarKebba()');a.turn.revision=2;a.turn.deleted_at='2026-10-09T03:00:00Z';
 a.failAck=true;assert.throws(()=>a.run('sincronizarKebba()'),/Respuesta perdida/);
 assert.equal(a.data.get('7,11'),undefined);assert.equal(a.data.get('8,11'),undefined);
 a.failAck=false;a.run('sincronizarKebba()');assert.deepEqual(a.acks.at(-1).row_ids,[]);
 a.turn.revision=3;a.turn.deleted_at=null;a.run('sincronizarKebba()');
 assert.equal(a.data.get('7,7'),38.55);assert.equal(a.data.get('8,7'),100);
 assert.equal([...a.data.values()].filter(v=>v==='fixture:Pix').length,1);
});
test('una revisión nueva vacía quita una fila que el usuario ya había borrado sin recrearla',()=>{
 const a=boot();a.failAck=false;a.run('sincronizarKebba()');for(let c=1;c<=11;c++)a.data.delete('7,'+c);
 a.turn.revision=2;a.turn.payment_totals=[];a.run('sincronizarKebba()');
 assert.equal(a.data.get('7,11'),undefined);assert.equal(a.data.get('8,11'),undefined);
 assert.deepEqual(a.acks.at(-1).row_ids,[]);
});
