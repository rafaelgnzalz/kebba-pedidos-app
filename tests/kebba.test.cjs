// Ejecutar con: node --test tests/kebba.test.cjs (sin instalar dependencias).
// Ejecuta el JavaScript real del HTML. El DOM mínimo permite probar los flujos
// y los eventos de entrada sin escribir pedidos de prueba en el navegador del local.
const fs=require('node:fs');
const vm=require('node:vm');
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const source=html.slice(html.indexOf('<script>')+8,html.indexOf('</script>'));
const KEY='kebba-pedidos-v1';
function boot(storage=new Map()){
  const nodes=new Map(),events={},windowEvents={},intervals=[],downloads=[];
  let writes=0,failWrites=false,confirmation=true;
  function node(selector){
    if(!nodes.has(selector)){
      const classes=new Set();
      const el={innerHTML:'',textContent:'',value:'',dataset:{},style:{},scrollTop:0,disabled:false,inert:false,
        classList:{toggle(name,on){on?classes.add(name):classes.delete(name)},add(name){classes.add(name)},contains(name){return classes.has(name)}},
        addEventListener(type,fn){events[selector+':'+type]=fn},setAttribute(){},removeAttribute(){},focus(){document.activeElement=this},
        querySelector:node,querySelectorAll(){return[]},getBoundingClientRect(){return{top:250}},scrollIntoView(){},scrollTo(){},click(){},remove(){}};
      Object.defineProperty(el,'childElementCount',{get(){return el.innerHTML?1:0}});nodes.set(selector,el);
    }
    return nodes.get(selector);
  }
  const document={querySelector:node,getElementById:id=>node('#'+id),querySelectorAll(){return[]},addEventListener(type,fn){events[type]=fn},activeElement:null,body:{append(el){downloads.push(el)}},createElement(){return node('anchor-'+downloads.length)}};
  const context={document,window:{innerWidth:1366,innerHeight:768,scrollTo(){},addEventListener(type,fn){windowEvents[type]=fn},location:{reload(){}}},
    localStorage:{getItem:key=>storage.get(key)??null,setItem(key,value){if(failWrites)throw Error('Quota');writes++;storage.set(key,value)}},
    console,Blob,URL:{createObjectURL(){return'blob:local'},revokeObjectURL(){}},
    setTimeout(){return 1},clearTimeout(){},setInterval(fn){intervals.push(fn)},
    confirm(){return confirmation},prompt(){return'BORRAR'}};
  vm.createContext(context);vm.runInContext(source,context);
  const run=code=>vm.runInContext(code,context);
  return {run,events,windowEvents,intervals,nodes,storage,downloads,get writes(){return writes},set failWrites(value){failWrites=value},set confirmation(value){confirmation=value}};
}
function key(app,value,tag='BODY',extra={}){let prevented=false;app.events.keydown({key:value,target:{tagName:tag,isContentEditable:false},preventDefault(){prevented=true},...extra});return prevented;}
function type(app,id,value,line){const input={id,value,dataset:line?{line}:{},tagName:id==='line-note'?'TEXTAREA':'INPUT'};app.events.focusin({target:input});app.events.input({target:input});return input;}

test('las mesas admiten una referencia visible y persistente',()=>{
  const app=boot(),run=app.run;
  run('openSlot("m1");addProduct("papas")');
  assert.match(run('renderOrder()'),/Nombre o descripción de la mesa/);
  type(app,'customer-name','Pareja de azul');
  assert.match(run('renderHome()'),/Pareja de azul/);
  const reopened=boot(app.storage);
  assert.equal(reopened.run('data.orders.m1.name'),'Pareja de azul');
});

test('Cocina separa por enviar, preparar y cobrar; las ediciones quedan plegadas',()=>{
  const app=boot(),run=app.run;
  run('openSlot("m1");addProduct("papas");go("home");openSlot("m2");addProduct("kebab-carne");sendKitchen();go("home");openSlot("m3");addProduct("boniato");sendKitchen();markReady("m3")');
  assert.match(run('renderKitchen()'),/Por enviar a Cocina · 1/);
  assert.match(run('renderKitchen()'),/En preparación · 1/);
  assert.match(run('renderKitchen()'),/pendientes de cobro · 1/);
  run('openSlot("m2");modifyLine(current().lines[0].id,line=>line.note="Sin salsa");modifyLine(current().lines[0].id,line=>line.note="Sin salsa, bien dorado")');
  const card=run('kitchenLines(current())');
  assert.match(card,/<details class="k-change-log">/);
  assert.match(card,/Ver historial de 2 ediciones/);
  assert.equal((card.match(/class="k-line/g)||[]).length,1);
  assert.match(card,/Sin salsa, bien dorado/);
});

test('la cuenta se divide por producto y permite efectivo más Pix',()=>{
  const app=boot(),run=app.run;
  run('openSlot("m1");addProduct("kebab-carne");addProduct("papas");sendKitchen();markReady("m1");startClose();paymentParts=[newPaymentPart(),newPaymentPart()]');
  run('assignPaymentRest(current().lines[0].id,0);assignPaymentRest(current().lines[1].id,1);paymentParts[0].name="Mesa azul";paymentParts[0].method="Efectivo";paymentParts[0].cashReceived="500";paymentParts[1].method="Pix"');
  assert.equal(run('paymentStatus(current()).valid'),true);
  assert.match(run('renderPaymentModal(current())'),/R\$ 12,05/);
  run('confirmClose()');
  assert.equal(run('data.orders.m1'),undefined);
  assert.equal(run('data.history[0].total'),420);
  assert.equal(run('data.history[0].payment'),'Dividido');
  assert.equal(run('data.history[0].payments[0].cashChange'),180);
  assert.equal(run('data.history[0].payments[1].pixBrl'),12.05);
  assert.equal(run('data.history[0].payments[1].pixRate'),8.3);
  assert.doesNotThrow(()=>run('validateImport(deepCopy(data))'));
  assert.match(run('buildDayCsv()'),/Detalle de pagos/);
  assert.match(run('buildDayCsv()'),/Pix/);
});

test('dos unidades iguales pueden pagarlas personas distintas',()=>{
  const app=boot(),run=app.run;
  run('openSlot("p0");addProduct("papas");changeQty(current().lines[0].id,1);sendKitchen();markReady("p0");startClose();paymentParts=[newPaymentPart(),newPaymentPart()]');
  run('assignPaymentUnit(current().lines[0].id,0,1);assignPaymentUnit(current().lines[0].id,1,1);paymentParts[0].method="Transferencia";paymentParts[1].method="Efectivo";paymentParts[1].cashReceived="200"');
  assert.equal(run('paymentStatus(current()).valid'),true);
  run('confirmClose()');
  assert.equal(run('data.history[0].payments[0].amount'),100);
  assert.equal(run('data.history[0].payments[1].amount'),100);
  assert.equal(run('data.history[0].payments[1].cashChange'),100);
});

test('no cierra con productos sin asignar y conserva respaldos antiguos',()=>{
  const app=boot(),run=app.run;
  run('openSlot("m1");addProduct("papas");sendKitchen();markReady("m1");startClose();paymentParts=[newPaymentPart(),newPaymentPart()];paymentParts[0].method="Efectivo";paymentParts[0].cashReceived="100";paymentParts[1].method="Pix"');
  run('confirmClose()');
  assert.equal(run('data.history.length'),0);
  run('paymentParts=[newPaymentPart(Object.fromEntries(current().lines.map(line=>[line.id,line.qty])))];paymentParts[0].method="Efectivo";paymentParts[0].cashReceived="100";confirmClose()');
  assert.equal(run('data.history.length'),1);
  assert.doesNotThrow(()=>run('const old=deepCopy(data);delete old.history[0].payments;validateImport(old)'));
  assert.throws(()=>run('const wrong=deepCopy(data);wrong.history[0].payments[0].amount=99;validateImport(wrong)'));
});

test('Pix funciona como pago único y guarda pesos, reales y tasa',()=>{
  const app=boot(),run=app.run;
  run('openSlot("m1");addProduct("kebab-carne");sendKitchen();markReady("m1");startClose()');
  app.events.change({target:{dataset:{paymentMethod:'0'},value:'Pix'}});
  assert.match(run('renderPaymentModal(current())'),/R\$ 38,55/);
  run('confirmClose()');
  assert.equal(run('data.history[0].payment'),'Pix');
  assert.equal(run('data.history[0].payments[0].amount'),320);
  assert.equal(run('data.history[0].payments[0].pixBrl'),38.55);
  assert.doesNotThrow(()=>run('validateImport(deepCopy(data))'));
});

test('si falla el guardado de un cobro dividido, la comanda sigue abierta',()=>{
  const app=boot(),run=app.run;
  run('openSlot("m1");addProduct("papas");addProduct("boniato");sendKitchen();markReady("m1");startClose();paymentParts=[newPaymentPart(),newPaymentPart()]');
  run('assignPaymentRest(current().lines[0].id,0);assignPaymentRest(current().lines[1].id,1);paymentParts[0].method="Transferencia";paymentParts[1].method="Pix"');
  app.failWrites=true;run('confirmClose()');
  assert.equal(run('data.history.length'),0);
  assert.ok(run('data.orders.m1'));
  app.failWrites=false;run('confirmClose()');
  assert.equal(run('data.history.length'),1);
});

