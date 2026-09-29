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
    console,Blob,AbortController,URL:{createObjectURL(){return'blob:local'},revokeObjectURL(){}},
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
  assert.match(run('renderHome()'),/Mesas <small>1 ocupado \/ 9<\/small>/);
  run('handleAction({dataset:{action:"home-group",group:"p"}},{detail:1})');
  assert.match(run('renderHome()'),/Pedido A/);
  assert.doesNotMatch(run('renderHome()'),/data-slot="m1"/);
});

test('Cocina separa por enviar, preparar y cobrar; las ediciones quedan plegadas',()=>{
  const app=boot(),run=app.run;
  run('openSlot("m1");addProduct("papas");go("home");openSlot("m2");addProduct("kebab-carne");sendKitchen();go("home");openSlot("m3");addProduct("boniato");sendKitchen();markReady("m3")');
  assert.match(run('renderKitchen()'),/En preparación · 1/);
  run('handleAction({dataset:{action:"kitchen-group",group:"drafts"}},{detail:1})');
  assert.match(run('renderKitchen()'),/Por enviar a Cocina · 1/);
  run('handleAction({dataset:{action:"kitchen-group",group:"ready"}},{detail:1})');
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

test('los combos de shawarma y kebab se agregan con precio final y contenido para Cocina',()=>{
  const app=boot(),run=app.run;
  assert.equal(run('data.catalog.filter(product=>product.incluyeCombo).length'),8);
  assert.match(run('renderMenu()'),/Combo Shawarma Pollo/);
  run('openSlot("m1");addProduct("combo-shawarma-pollo");addProduct("combo-kebab-carne")');
  assert.equal(run('orderTotal(current())'),720);
  assert.equal(run('current().lines[0].unitPrice'),330);
  assert.equal(run('current().lines[1].unitPrice'),390);
  assert.equal(run('allowsCombo(current().lines[0])'),false);
  assert.match(run('kitchenItem(current().lines[0])'),/Papas fritas \+ Coca-Cola/);
  assert.doesNotThrow(()=>run('validateImport(deepCopy(data))'));
});

test('una cuenta grande se asigna por líneas completas a cuatro personas',()=>{
  const app=boot(),run=app.run;
  run('openSlot("m1");for(let i=0;i<18;i++)addProduct("papas");startClose();paymentParts=[newPaymentPart(),newPaymentPart(),newPaymentPart(),newPaymentPart()]');
  const initial=run('renderPaymentAllocation(current())');
  assert.equal((initial.match(/data-action="payment-rest"/g)||[]).length,18);
  run('for(let i=0;i<4;i++)assignPaymentRest(current().lines[i].id,0);for(let i=4;i<8;i++)assignPaymentRest(current().lines[i].id,1);for(let i=8;i<12;i++)assignPaymentRest(current().lines[i].id,2);selectedPaymentPart=3;assignAllRemaining(3)');
  assert.equal(run('current().lines.reduce((sum,line)=>sum+remainingUnits(line),0)'),0);
  assert.match(run('renderPaymentAllocation(current())'),/Todos los productos están asignados/);
  run('paymentParts.forEach(part=>part.method="Transferencia");confirmClose()');
  assert.equal(run('data.history[0].payments.length'),4);
  assert.equal(run('data.history[0].payments[3].amount'),600);
  assert.equal(run('data.history[0].total'),1800);
});

test('el reparto agrupa kebabs, shawarmas y acompañamientos antes del resto',()=>{
  const app=boot(),run=app.run;
  run('openSlot("m1");["bebida-sprite-350","shawarma-pollo","papas","kebab-pollo","shawarma-carne","kebab-carne","plato-pollo","boniato","coxinha-pollo-1"].forEach(addProduct);startClose();paymentParts=[newPaymentPart(),newPaymentPart()]');
  assert.equal(run('paymentSortedLines(current().lines).map(item=>item.line.name).join(" | ")'),
    'Kebab Carne | Kebab Pollo | Kebab al Plato Pollo | Shawarma Carne | Shawarma Pollo | Boniato frito | Papas fritas | Sprite · lata 350 ml | Coxinha de Pollo · 1 unidad');
  const rendered=run('renderPaymentAllocation(current())');
  assert.ok(rendered.indexOf('class="allocation-group">Kebabs')<rendered.indexOf('class="allocation-group">Shawarmas'));
  assert.ok(rendered.indexOf('class="allocation-group">Shawarmas')<rendered.indexOf('class="allocation-group">Acompañamientos'));
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

test('cancelar el aviso de Cocina y luego marcar listo registra una sola venta',()=>{
  const app=boot(),run=app.run;
  run('openSlot("m1");addProduct("papas");sendKitchen();startClose();paymentParts[0].method="Transferencia"');
  app.confirmation=false;run('confirmClose()');
  assert.equal(run('data.history.length'),0);
  assert.equal(run('data.orders.m1.lines.length'),1);
  run('closeModal();go("kitchen");markReady("m1");openSlot("m1");startClose();paymentParts[0].method="Transferencia"');
  app.confirmation=true;run('confirmClose();confirmClose()');
  assert.equal(run('data.history.length'),1);
  assert.equal(run('data.history[0].lines.length'),1);
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

test('un cobro dividido registra efectivo en reales y PREX sin convertir el total',()=>{
  const app=boot(),run=app.run;
  run('openSlot("m1");addProduct("papas");addProduct("kebab-carne");sendKitchen();markReady("m1");startClose();paymentParts=[newPaymentPart(),newPaymentPart()]');
  run('assignPaymentRest(current().lines[0].id,0);assignPaymentRest(current().lines[1].id,1);paymentParts[0].method="Efectivo BRL";paymentParts[0].brlCharged="15,50";paymentParts[0].brlReceived="20";paymentParts[1].method="PREX"');
  assert.equal(run('paymentStatus(current()).valid'),true);
  assert.match(run('renderPaymentModal(current())'),/R\$ 4,50/);
  run('confirmClose()');
  assert.equal(run('data.history[0].payment'),'Dividido');
  assert.equal(run('data.history[0].payments[0].brlChargedMinor'),1550);
  assert.equal(run('data.history[0].payments[0].brlChangeMinor'),450);
  assert.match(run('paymentExport(data.history[0])'),/R\$ 4,50/);
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

test('un fallo de guardado no agrega productos ni consume deshacer',()=>{
  const app=boot(),run=app.run;
  run('openSlot("m1");addProduct("papas")');
  app.failWrites=true;
  run('addProduct("boniato")');
  assert.equal(run('current().lines.length'),1);
  assert.equal(run('stackFor(current()).length'),1);
  run('undo()');
  assert.equal(run('current().lines.length'),1);
  assert.equal(run('stackFor(current()).length'),1);
  app.failWrites=false;run('undo()');
  assert.equal(run('current().lines.length'),0);
});

test('no abre una mesa ni consume un número si no puede guardarla',()=>{
  const app=boot();app.failWrites=true;app.run('openSlot("m1")');
  assert.equal(app.run('data.orders.m1'),undefined);
  assert.equal(app.run('data.nextNumber'),1);
  assert.equal(app.run('selectedSlot'),null);
});

test('una observación fallida no modifica Cocina ni el pedido guardado',()=>{
  const app=boot(),run=app.run;
  run('openSlot("m1");addProduct("papas");sendKitchen();markReady("m1")');
  app.failWrites=true;
  const input=type(app,'line-note','Sin sal',run('current().lines[0].id'));
  assert.equal(run('current().lines[0].note'),'');
  assert.equal(run('current().status'),'LISTO');
  assert.equal(run('current().kitchenEvents.length'),0);
  assert.equal(input.value,'');
});

test('una lectura atrasada no reemplaza cambios realizados mientras esperaba',async()=>{
  const app=boot(),run=app.run;
  run('openSlot("m1");sharedReady=true;sharedVersion=1;globalThis.oldState=deepCopy(data);sharedRpc=()=>new Promise(resolve=>{globalThis.resolveRead=resolve});globalThis.readTask=refreshShared()');
  run('addProduct("papas");resolveRead({version:2,state:oldState})');
  await run('readTask');
  assert.equal(run('data.orders.m1.lines.length'),1);
});

test('la sincronización conserva un conflicto hasta que se resuelva',async()=>{
  const app=boot(),run=app.run;
  run('storageConflict=true;globalThis.reads=0;sharedRpc=async()=>{reads++;return {version:1,state:emptyData()}}');
  await run('refreshShared()');
  assert.equal(run('reads'),0);
  assert.equal(run('storageConflict'),true);
});

test('recuperar la respuesta de un guardado actualiza la base de sincronización',async()=>{
  const app=boot(),run=app.run;
  run('openSlot("m1");addProduct("papas");sharedReady=true;sharedVersion=1;sharedBase=emptyData();sharedPending=deepCopy(data);globalThis.sent=deepCopy(data);function reorder(value){return Array.isArray(value)?value.map(reorder):value&&typeof value==="object"?Object.fromEntries(Object.entries(value).reverse().map(([key,item])=>[key,reorder(item)])):value;}sharedRpc=async(name)=>{if(name==="kebba_write")throw Error("Respuesta perdida");return {version:2,state:reorder(sent)}}');
  await run('flushShared()');
  assert.equal(run('JSON.stringify(sharedBase)'),run('JSON.stringify(validateImport(deepCopy(sent)))'));
});

test('terminar el nombre de un pagador no reconstruye el diálogo y conserva el siguiente clic',()=>{
  const app=boot(),run=app.run;
  run('openSlot("m1");addProduct("papas");startClose();globalThis.modalRenders=0;renderModal=()=>{modalRenders++}');
  app.events.input({target:{dataset:{payerName:'0'},value:'Ana'}});
  app.events.change({target:{dataset:{payerName:'0'}}});
  assert.equal(run('paymentParts[0].name'),'Ana');
  assert.equal(run('modalRenders'),0);
});

test('varias teclas de una observación generan una corrección y se pueden deshacer',()=>{
  const app=boot(),run=app.run;
  run('openSlot("m1");addProduct("papas");sendKitchen()');
  const input=type(app,'line-note','Sin',run('current().lines[0].id'));
  input.value='Sin sal';app.events.input({target:input});
  assert.equal(run('current().kitchenEvents.length'),1);
  assert.equal(run('current().kitchenEvents[0].after.note'),'Sin sal');
  assert.doesNotThrow(()=>run('validateImport(deepCopy(data))'));
  run('undo()');assert.equal(run('current().lines[0].note'),'');
});

test('una cuenta no cierra con asignaciones de productos que ya no existen',()=>{
  const app=boot(),run=app.run;
  run('openSlot("m1");addProduct("papas");startClose();paymentParts[0].method="Pix";paymentParts[0].assigned.removed=1;confirmClose()');
  assert.equal(run('data.history.length'),0);
  assert.equal(run('paymentStatus(current()).valid'),false);
});

test('el foco del botón de cantidad se conserva después de actualizar la comanda',()=>{
  const app=boot(),run=app.run;
  run('openSlot("m1");addProduct("papas");globalThis.focusRestored=false;document.activeElement={dataset:{action:"qty",line:current().lines[0].id,delta:"1"}};const mainNode=document.querySelector("#main");mainNode.contains=()=>true;mainNode.querySelectorAll=()=>[{dataset:{...document.activeElement.dataset},focus(){focusRestored=true}}];changeQty(current().lines[0].id,1)');
  assert.equal(run('focusRestored'),true);
  assert.equal(run('current().lines[0].qty'),2);
});

test('si no puede liberar un borrador vacío permite acceder a Configuración',()=>{
  const app=boot(),run=app.run;run('openSlot("m1")');app.failWrites=true;
  run('go("settings")');assert.equal(run('view'),'settings');
  assert.ok(run('data.orders.m1'));
});

test('Cocina muestra la cancelación de un producto agregado después del envío',()=>{
  const app=boot(),run=app.run;
  run('openSlot("m1");addProduct("papas");sendKitchen();addProduct("boniato");removeLine(current().lines[1].id)');
  assert.match(run('kitchenLines(current())'),/<strong>Cancelado:<\/strong> 1 × Boniato frito/);
  run('undo()');assert.doesNotMatch(run('kitchenLines(current())'),/<strong>Cancelado:<\/strong>/);
});

test('la combinación conserva cambios de distintas mesas y detecta cambios incompatibles',()=>{
  const app=boot(),run=app.run;
  run('openSlot("m1");addProduct("papas");go("home");openSlot("m2");addProduct("boniato");const base=deepCopy(data),local=deepCopy(data),remote=deepCopy(data);local.orders.m1.name="Ana";remote.orders.m2.name="Luis";globalThis.merged=mergeSharedState(base,local,remote)');
  assert.equal(run('merged.orders.m1.name'),'Ana');assert.equal(run('merged.orders.m2.name'),'Luis');
  run('remote.orders.m1.name="Otro"');assert.equal(run('mergeSharedState(base,local,remote)'),null);
  run('remote.orders.m1.name="Ana"');assert.ok(run('mergeSharedState(base,local,remote)'));
});

test('una conexión colgada termina para permitir reintentar',async()=>{
  const app=boot(),run=app.run;
  run('globalThis.timeoutCleared=false;setTimeout=(callback)=>{globalThis.expireRequest=callback;return 99};clearTimeout=id=>{timeoutCleared=id===99};globalThis.fetch=async(url,options)=>new Promise((resolve,reject)=>{options.signal.addEventListener("abort",()=>reject(Error("Timeout")))});globalThis.requestTask=sharedRpc("kebba_read",{});expireRequest()');
  await assert.rejects(run('requestTask'),/Timeout/);
  assert.equal(run('timeoutCleared'),true);
});
