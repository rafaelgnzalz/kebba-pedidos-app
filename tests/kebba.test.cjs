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
function action(app,name,data={},detail=1){app.run(`handleAction({dataset:${JSON.stringify({action:name,...data})}},{detail:${detail}})`);}

test('Excel del historial elige día o rango y descarga una copia sin modificar ventas',async()=>{
  const app=boot(),run=app.run;
  run('historyDate="2026-10-07";openHistoryExport()');
  assert.match(run('renderHistory()'),/EXPORTAR EXCEL DETALLADO/);
  assert.equal(run('historyExportFrom'),'2026-10-07');
  assert.match(run('renderHistoryExport()'),/Día seleccionado/);
  app.events.change({target:{dataset:{historyExport:'scope'},value:'range'}});
  app.events.change({target:{dataset:{historyExport:'from'},value:'2026-10-01'}});
  app.events.change({target:{dataset:{historyExport:'to'},value:'2026-10-07'}});
  const before=run('JSON.stringify(data)'),writes=app.writes;
  run('globalThis.exportedSource=null;globalThis.exportedOptions=null;globalThis.downloaded=null;window.KebbaHistoryExcel={createExport:async(source,options)=>{exportedSource=source;exportedOptions=options;return {buffer:"EXCEL",fileName:"historial.xlsx",mime:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}}};download=async(buffer,name,mime)=>{downloaded={buffer,name,mime};return true}');
  await run('exportHistoryExcel()');
  assert.equal(run('exportedOptions.from'),'2026-10-01');assert.equal(run('exportedOptions.to'),'2026-10-07');
  assert.equal(run('downloaded.name'),'historial.xlsx');assert.equal(run('downloaded.buffer'),'EXCEL');
  assert.equal(run('JSON.stringify(data)'),before);assert.equal(app.writes,writes);
  assert.equal(run('modal'),null);assert.equal(run('historyExportBusy'),false);
});

test('el error de exportación conserva el rango y permite reintentar',async()=>{
  const app=boot(),run=app.run;
  run('openHistoryExport();historyExportScope="range";historyExportFrom="2026-10-08";historyExportTo="2026-10-07";window.KebbaHistoryExcel={createExport:async()=>{throw Error("La fecha desde debe ser anterior o igual a la fecha hasta.")}}');
  await run('exportHistoryExcel()');
  assert.equal(run('modal'),'history-export');assert.equal(run('historyExportFrom'),'2026-10-08');
  assert.match(run('renderHistoryExport()'),/anterior o igual/);assert.equal(run('historyExportBusy'),false);
});

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
  action(app,'payment-step',{step:'pay'});
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

test('repetir un producto desde la carta o el teclado suma cantidades y conserva deshacer',()=>{
  const app=boot(),run=app.run;
  run('openSlot("m1")');
  action(app,'add-product',{product:'shawarma-pollo'});
  const id=run('current().lines[0].id');
  action(app,'add-product',{product:'shawarma-pollo'},2);
  assert.equal(key(app,'Q'),true);
  assert.equal(run('current().lines.length'),1);
  assert.equal(run('current().lines[0].id'),id);
  assert.equal(run('current().lines[0].qty'),3);
  assert.equal(run('orderTotal(current())'),780);
  assert.match(run('renderOrder()'),/3 × Shawarma Pollo/);
  const reopened=boot(app.storage);
  assert.equal(reopened.run('data.orders.m1.lines.length'),1);
  assert.equal(reopened.run('data.orders.m1.lines[0].qty'),3);
  run('undo()');
  assert.equal(run('current().lines[0].qty'),2);
  action(app,'qty',{line:id,delta:'-1'});
  assert.equal(run('current().lines[0].qty'),1);
  assert.equal(run('orderTotal(current())'),260);
});

test('cada combo suma sus unidades sin mezclarse con el producto individual',()=>{
  const app=boot(),run=app.run;
  run('openSlot("m1");addProduct("shawarma-pollo");addProduct("combo-shawarma-pollo");addProduct("shawarma-pollo");addProduct("combo-shawarma-pollo")');
  assert.equal(run('current().lines.length'),2);
  assert.equal(run('current().lines.map(line=>line.qty).join(",")'),'2,2');
  assert.equal(run('current().lines.map(line=>line.unitPrice).join(",")'),'260,330');
  assert.equal(run('current().lines[0].mods.length'),0);
  assert.match(run('lineDetails(current().lines[1])'),/Combo incluido.*Papas fritas \+ Coca-Cola/);
  assert.equal(run('orderTotal(current())'),1180);
  run('addProduct("shawarma-carne");addProduct("shawarma-carne")');
  assert.equal(run('current().lines.length'),3);
  assert.equal(run('current().lines[2].qty'),2);
  assert.doesNotThrow(()=>run('validateImport(deepCopy(data))'));
});

test('los pedidos anteriores conservan sus combos, observaciones y precios al sumar productos',()=>{
  const app=boot(),run=app.run;
  run('openSlot("m1");addProduct("shawarma-pollo");toggleMod(current().lines[0].id,"hacer-combo");addProduct("shawarma-pollo");modifyLine(current().lines[1].id,line=>line.note="Sin salsa");addProduct("shawarma-pollo");addProduct("shawarma-pollo")');
  assert.equal(run('current().lines.length'),3);
  assert.equal(run('current().lines.map(line=>line.qty).join(",")'),'1,1,2');
  assert.equal(run('current().lines[0].mods[0].id'),'hacer-combo');
  assert.equal(run('current().lines[1].note'),'Sin salsa');
  run('data.catalog.find(product=>product.id==="shawarma-pollo").precio=270;addProduct("shawarma-pollo");addProduct("shawarma-pollo")');
  assert.equal(run('current().lines.length'),4);
  assert.equal(run('current().lines[2].unitPrice'),260);
  assert.equal(run('current().lines[2].qty'),2);
  assert.equal(run('current().lines[3].unitPrice'),270);
  assert.equal(run('current().lines[3].qty'),2);
});

test('sumar un producto enviado conserva la línea y avisa la cantidad corregida a Cocina',()=>{
  const app=boot(),run=app.run;
  run('openSlot("m1");addProduct("shawarma-pollo");sendKitchen();markReady("m1")');
  const id=run('current().lines[0].id');
  run('addProduct("shawarma-pollo")');
  assert.equal(run('current().lines.length'),1);
  assert.equal(run('current().lines[0].id'),id);
  assert.equal(run('current().lines[0].qty'),2);
  assert.equal(run('current().status'),'EN COCINA');
  assert.equal(run('current().kitchenEvents.at(-1).kind'),'MODIFICADO');
  assert.equal(run('current().kitchenEvents.at(-1).before.qty'),1);
  assert.equal(run('current().kitchenEvents.at(-1).after.qty'),2);
  run('undo()');
  assert.equal(run('current().lines[0].qty'),1);
  assert.doesNotThrow(()=>run('validateImport(deepCopy(data))'));
});

test('una cuenta con muchas líneas separadas se asigna a cuatro personas',()=>{
  const app=boot(),run=app.run;
  run('openSlot("m1");for(let i=0;i<18;i++)addProduct("papas");for(let i=0;i<17;i++)splitLine(current().lines[0].id);startClose();paymentParts=[newPaymentPart(),newPaymentPart(),newPaymentPart(),newPaymentPart()]');
  const initial=run('renderPaymentAllocation(current())');
  assert.match(initial,/data-action="payment-page"/);
  const reachable=new Set();
  for(let page=0;page<18;page++){
    const html=run('paymentProductPage='+page+';renderPaymentAllocation(current())');
    for(const match of html.matchAll(/data-action="payment-unit" data-line="([^"]+)" data-part="0" data-delta="1"/g))reachable.add(match[1]);
  }
  assert.equal(reachable.size,18);
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
  const rendered=[0,1,2,3,4].map(page=>run('paymentProductPage='+page+';renderPaymentAllocation(current())')).join('');
  assert.ok(rendered.indexOf('class="allocation-group">Kebabs')<rendered.indexOf('class="allocation-group">Shawarmas'));
  assert.ok(rendered.indexOf('class="allocation-group">Shawarmas')<rendered.indexOf('class="allocation-group">Acompañamientos'));
});

test('dos unidades iguales pueden pagarlas personas distintas',()=>{
  const app=boot(),run=app.run;
  run('openSlot("p0");addProduct("papas");addProduct("papas");sendKitchen();markReady("p0");startClose();paymentParts=[newPaymentPart(),newPaymentPart()]');
  assert.equal(run('current().lines.length'),1);
  run('assignPaymentUnit(current().lines[0].id,0,1);assignPaymentUnit(current().lines[0].id,1,1);paymentParts[0].method="Transferencia";paymentParts[1].method="Efectivo";paymentParts[1].cashReceived="200"');
  assert.equal(run('paymentStatus(current()).valid'),true);
  run('confirmClose()');
  assert.equal(run('data.history[0].payments[0].amount'),100);
  assert.equal(run('data.history[0].payments[1].amount'),100);
  assert.equal(run('data.history[0].payments[1].cashChange'),100);
});

test('el recorrido de reparto y cobro conserva cuatro personas, combos y medios distintos',()=>{
  const app=boot(),run=app.run;
  run('openSlot("m1");addProduct("combo-kebab-carne");changeQty(current().lines[0].id,1);addProduct("papas");addProduct("bebida-sprite-350");sendKitchen();markReady("m1");startClose()');
  action(app,'payment-split');
  const combo=run('current().lines[0].id'),fries=run('current().lines[1].id'),drink=run('current().lines[2].id');
  action(app,'payment-unit',{line:combo,part:'0',delta:'1'});
  action(app,'payment-select',{part:'1'});
  action(app,'payment-unit',{line:combo,part:'1',delta:'1'});
  action(app,'payment-add');
  action(app,'payment-unit',{line:fries,part:'2',delta:'1'});
  action(app,'payment-add');
  action(app,'payment-all-remaining',{part:'3'});
  assert.equal(run(`paymentParts[3].assigned[${JSON.stringify(drink)}]`),1);
  assert.equal(run('paymentAllocationStatus(current()).valid'),true);
  assert.equal(run('paymentStatus(current()).valid'),false);
  assert.equal(run('data.history.length'),0);
  action(app,'payment-step',{step:'pay'});
  action(app,'payment-select',{part:'0'});
  action(app,'payment-method',{part:'0',method:'Efectivo'});
  action(app,'payment-exact',{part:'0'});
  action(app,'payment-next');
  assert.equal(run('selectedPaymentPart'),1);
  action(app,'payment-method',{part:'1',method:'Pix'});
  action(app,'payment-next');
  assert.equal(run('selectedPaymentPart'),2);
  action(app,'payment-method',{part:'2',method:'Efectivo BRL'});
  app.events.input({target:{dataset:{brlCharged:'2'},value:'15,50'}});
  app.events.input({target:{dataset:{brlReceived:'2'},value:'20'}});
  action(app,'payment-next');
  assert.equal(run('selectedPaymentPart'),3);
  action(app,'payment-method',{part:'3',method:'Tarjeta'});
  assert.equal(run('paymentStatus(current()).valid'),true);
  assert.equal(run('data.history.length'),0);
  action(app,'close-confirm');
  assert.equal(run('data.history.length'),1);
  assert.equal(run('data.history[0].payments.map(part=>part.method).join("|")'),'Efectivo|Pix|Efectivo BRL|Tarjeta');
  assert.equal(run('data.history[0].payments[0].cashChange'),0);
  assert.equal(run('data.history[0].payments[2].brlChangeMinor'),450);
  assert.equal(run('data.history[0].payments.reduce((sum,part)=>sum+part.amount,0)'),run('data.history[0].total'));
  assert.doesNotThrow(()=>run('validateImport(deepCopy(data))'));
});

test('repartir de a una unidad acepta toques rápidos y nunca duplica ni resta de más',()=>{
  const app=boot(),run=app.run;
  run('openSlot("m1");addProduct("papas");changeQty(current().lines[0].id,1);changeQty(current().lines[0].id,1);startClose()');
  action(app,'payment-split');
  const line=run('current().lines[0].id');
  for(let detail=1;detail<=4;detail++)action(app,'payment-unit',{line,part:'0',delta:'1'},detail);
  assert.equal(run('remainingUnits(current().lines[0])'),0);
  assert.equal(run('partAmount(paymentParts[0],current())'),300);
  action(app,'payment-unit',{line,part:'1',delta:'1'});
  action(app,'payment-unit',{line,part:'1',delta:'-1'});
  assert.equal(run('Object.keys(paymentParts[1].assigned).length'),0);
  run('assignPaymentUnit(current().lines[0].id,0,1.5)');
  assert.equal(run('partAmount(paymentParts[0],current())'),300);
  assert.match(run('renderPaymentAllocation(current())'),/Quitar una unidad/);
  assert.match(run('renderPaymentAllocation(current())'),/Los|Sin pendientes/);
});

test('el paso de cobro exige todo asignado y permite quitar una persona vacía',()=>{
  const app=boot(),run=app.run;
  run('openSlot("m1");addProduct("papas");startClose()');
  action(app,'payment-split');
  action(app,'payment-step',{step:'pay'});
  assert.equal(run('paymentStep'),'assign');
  action(app,'payment-all-remaining',{part:'0'});
  action(app,'payment-step',{step:'pay'});
  assert.equal(run('paymentStep'),'assign');
  assert.match(run('paymentAllocationStatus(current()).message'),/quitá esa persona/);
  action(app,'payment-remove',{part:'1'});
  assert.equal(run('paymentParts.length'),1);
  assert.equal(run('partAmount(paymentParts[0],current())'),100);
  action(app,'payment-method',{part:'0',method:'PREX'});
  assert.equal(run('paymentStatus(current()).valid'),true);
  assert.equal(run('data.history.length'),0);
});

test('deshacer recupera a una persona quitada, conserva sus productos y no deshace nombres posteriores',()=>{
  const app=boot(),run=app.run;
  run('openSlot("m1");addProduct("papas");changeQty(current().lines[0].id,1);startClose()');
  action(app,'payment-split');
  const line=run('current().lines[0].id');
  action(app,'payment-unit',{line,part:'0',delta:'1'});
  action(app,'payment-unit',{line,part:'1',delta:'1'});
  action(app,'payment-add');
  action(app,'payment-remove',{part:'1'});
  assert.equal(run('remainingUnits(current().lines[0])'),1);
  app.events.input({target:{dataset:{payerName:'0'},value:'Ana'}});
  action(app,'payment-undo');
  assert.equal(run('paymentParts.length'),3);
  assert.equal(run('remainingUnits(current().lines[0])'),0);
  assert.equal(run('paymentParts[0].name'),'Ana');
  assert.equal(run(`paymentParts[1].assigned[${JSON.stringify(line)}]`),1);
  action(app,'payment-split');
  assert.equal(run('paymentParts.length'),1);
  action(app,'payment-undo');
  assert.equal(run('paymentParts.length'),3);
  assert.equal(run('paymentParts[0].name'),'Ana');
});

test('una corrección del reparto obliga a revisar el efectivo UYU y BRL del importe cambiado',()=>{
  const app=boot(),run=app.run;
  run('openSlot("m1");addProduct("papas");changeQty(current().lines[0].id,1);startClose()');
  action(app,'payment-split');
  const line=run('current().lines[0].id');
  action(app,'payment-unit',{line,part:'0',delta:'1'});
  action(app,'payment-unit',{line,part:'1',delta:'1'});
  run('paymentParts[0].method="Efectivo BRL";paymentParts[0].brlCharged="15";paymentParts[0].brlReceived="20";paymentParts[1].method="Efectivo";paymentParts[1].cashReceived="100"');
  assert.equal(run('paymentStatus(current()).valid'),true);
  action(app,'payment-unit',{line,part:'0',delta:'-1'});
  assert.equal(run('paymentParts[0].brlCharged'),'');
  assert.equal(run('paymentParts[0].brlReceived'),'');
  assert.equal(run('paymentParts[1].cashReceived'),'100');
  action(app,'payment-unit',{line,part:'1',delta:'1'});
  assert.equal(run('paymentParts[1].cashReceived'),'');
  action(app,'payment-undo');
  action(app,'payment-undo');
  assert.equal(run('paymentAllocationStatus(current()).valid'),true);
  assert.equal(run('paymentStatus(current()).valid'),false);
});

test('al repartir mantiene el lugar de la lista y los controles para corregir',()=>{
  const app=boot(),run=app.run;
  run('openSlot("m1");addProduct("papas");addProduct("boniato");startClose()');
  action(app,'payment-split');
  app.nodes.get('.payment-body').scrollTop=230;
  action(app,'payment-unit',{line:run('current().lines[0].id'),part:'0',delta:'1'});
  assert.equal(app.nodes.get('.payment-body').scrollTop,230);
  assert.equal((run('renderPaymentAllocation(current())').match(/data-delta="-1"/g)||[]).length,2);
  action(app,'payment-show-assigned');
  assert.equal((run('renderPaymentAllocation(current())').match(/data-delta="-1"/g)||[]).length,1);
  action(app,'payment-show-assigned');
  assert.equal((run('renderPaymentAllocation(current())').match(/data-delta="-1"/g)||[]).length,2);
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
  action(app,'payment-step',{step:'pay'});
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
  run('addProduct("boniato");addProduct("papas")');
  assert.equal(run('current().lines.length'),1);
  assert.equal(run('current().lines[0].qty'),1);
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

test('cambiar el nombre actualiza las etiquetas accesibles del reparto sin perder el foco',()=>{
  const app=boot(),run=app.run;
  run('openSlot("m1");addProduct("papas");changeQty(current().lines[0].id,1);startClose();paymentParts=[newPaymentPart(),newPaymentPart()];globalThis.modalRenders=0;renderModal=()=>{modalRenders++};globalThis.controls=[{dataset:{action:"payment-remove",part:"0"}},{dataset:{action:"payment-unit",part:"0",line:current().lines[0].id,delta:"1"}},{dataset:{action:"payment-unit",part:"0",line:current().lines[0].id,delta:"-1"}}];controls.forEach(button=>button.setAttribute=(name,value)=>button[name]=value);document.querySelectorAll=selector=>selector.includes("payment-remove")?controls:[]');
  app.events.input({target:{dataset:{payerName:'0'},value:'Ana'}});
  assert.equal(run('controls[0]["aria-label"]'),'Quitar a Ana');
  assert.equal(run('controls[1]["aria-label"]'),'Asignar una unidad de Papas fritas a Ana');
  assert.equal(run('controls[2]["aria-label"]'),'Quitar una unidad de Papas fritas a Ana');
  assert.equal(run('modalRenders'),0);
  run('assignPaymentUnit(current().lines[0].id,0,1)');
  assert.match(run('renderPaymentAllocation(current())'),/>El restante<\/button>/);
  assert.doesNotMatch(run('renderPaymentAllocation(current())'),/Los 1 restantes/);
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

test('la venta manual al personal conserva importe, detalle y cobro sin ocupar mesas ni Cocina',()=>{
  const app=boot(),run=app.run;
  run('openSlot("m1");addProduct("papas");sendKitchen();globalThis.beforeOrders=JSON.stringify(data.orders);go("staff")');
  app.events.input({target:{dataset:{staffField:'amount'},value:'150'}});
  app.events.input({target:{dataset:{staffField:'detail'},value:'Un kebab y una bebida'}});
  app.events.input({target:{dataset:{staffField:'name'},value:'Ana'}});
  let prevented=false;
  app.events.submit({target:{id:'staff-sale-form'},preventDefault(){prevented=true}});
  assert.equal(prevented,true);
  assert.equal(run('JSON.stringify(data.orders)'),run('beforeOrders'));
  assert.equal(run('data.kitchenNotices.length'),0);
  assert.equal(run('data.history.length'),1);
  assert.equal(run('data.history[0].saleType'),'staff');
  assert.equal(run('data.history[0].total'),150);
  assert.equal(run('data.history[0].lines[0].note'),'Un kebab y una bebida');
  assert.equal(run('data.history[0].name'),'Ana');
  assert.equal(run('data.history[0].payments[0].cashReceived'),150);
  assert.equal(run('data.history[0].payments[0].cashChange'),0);
  assert.match(run('renderStaff()'),/Un kebab y una bebida/);
  assert.match(run('renderHistory()'),/Personal · Al coste/);
  assert.equal(run('registerStaffSale()'),false);
  assert.equal(run('data.history.length'),1);
  const reopened=boot(app.storage);
  assert.equal(reopened.run('data.history[0].lines[0].note'),'Un kebab y una bebida');
  assert.doesNotThrow(()=>run('validateImport(deepCopy(data))'));
  assert.match(run('buildDayCsv()'),/Un kebab y una bebida/);
});

test('el cobro al personal calcula cambio UYU, conversión Pix y cobro acordado BRL',()=>{
  const app=boot(),run=app.run;
  run('staffDraft={...emptyStaffDraft(),amount:"150",detail:"Cena",cashReceived:"200"};registerStaffSale()');
  assert.equal(run('data.history[0].cashChange'),50);
  run('staffDraft={...emptyStaffDraft(),amount:"83",detail:"Bebida",method:"Pix"};registerStaffSale()');
  assert.equal(run('data.history[1].payments[0].pixBrl'),10);
  run('staffDraft={...emptyStaffDraft(),amount:"100",detail:"Almuerzo",method:"Efectivo BRL",brlCharged:"12,50",brlReceived:"20"};registerStaffSale()');
  assert.equal(run('data.history[2].brlChargedMinor'),1250);
  assert.equal(run('data.history[2].brlChangeMinor'),750);
  assert.equal(run('data.history[2].total'),100);
  assert.doesNotThrow(()=>run('validateImport(deepCopy(data))'));
});

test('las ventas al personal rechazan datos incompletos, importes inválidos y efectivo insuficiente',()=>{
  for(const draft of [
    {amount:'0',detail:'Bebida'}, {amount:'-1',detail:'Bebida'}, {amount:'12,50',detail:'Bebida'},
    {amount:'NaN',detail:'Bebida'}, {amount:'100',detail:' '}, {amount:'100',detail:'Cena',method:'Inválido'},
    {amount:'100',detail:'Cena',cashReceived:'50'}, {amount:'100',detail:'Cena',method:'Efectivo BRL'},
    {amount:'100',detail:'Cena',method:'Efectivo BRL',brlCharged:'15',brlReceived:'10'}
  ]){
    const app=boot(),run=app.run;
    run(`staffDraft={...emptyStaffDraft(),...${JSON.stringify(draft)}}`);
    assert.equal(run('registerStaffSale()'),false);
    assert.equal(run('data.history.length'),0);
    assert.equal(run('data.nextNumber'),1);
    assert.equal(app.writes,0);
    assert.ok(run('staffError'));
  }
});

test('si falla el guardado manual conserva los datos y permite un único reintento',()=>{
  const app=boot(),run=app.run;
  run('staffDraft={...emptyStaffDraft(),amount:"150",detail:"Cena",name:"Ana"}');
  app.failWrites=true;
  assert.equal(run('registerStaffSale()'),false);
  assert.equal(run('data.history.length'),0);
  assert.equal(run('data.nextNumber'),1);
  assert.equal(run('staffDraft.detail'),'Cena');
  app.failWrites=false;
  assert.equal(run('registerStaffSale()'),true);
  assert.equal(run('data.history.length'),1);
  assert.equal(run('staffDraft.amount'),'');
});

test('la pestaña personal filtra por fecha, escapa detalles y exporta solamente sus ventas',()=>{
  const app=boot(),run=app.run;
  run('openSlot("m1");addProduct("papas");startClose();paymentParts[0].method="Pix";confirmClose();staffDraft={...emptyStaffDraft(),amount:"50",detail:"<img src=x onerror=alert(1)>",name:"=Ana"};registerStaffSale()');
  assert.match(run('renderStaff()'),/&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.equal(run('staffForDate().length'),1);
  assert.match(run('buildStaffCsv()'),/'=Ana/);
  assert.doesNotMatch(run('buildStaffCsv()'),/Papas fritas/);
  run('staffDate="2020-01-01"');
  assert.equal(run('staffForDate().length'),0);
});

test('una venta manual se combina con cambios remotos de otra comanda sin perder el detalle',()=>{
  const app=boot(),run=app.run;
  run('openSlot("m1");addProduct("papas");globalThis.base=deepCopy(data);staffDraft={...emptyStaffDraft(),amount:"150",detail:"Cena de Ana"};registerStaffSale();globalThis.remote=deepCopy(base);remote.orders.m1.name="Mesa azul";globalThis.merged=mergeSharedState(base,data,remote)');
  assert.equal(run('merged.orders.m1.name'),'Mesa azul');
  assert.equal(run('merged.history[0].saleType'),'staff');
  assert.equal(run('merged.history[0].lines[0].note'),'Cena de Ana');
});

test('la sincronización no reconstruye el formulario mientras se escribe el detalle manual',async()=>{
  const app=boot(),run=app.run;
  run('document.activeElement={dataset:{staffField:"detail"}};sharedReady=true;globalThis.reads=0;sharedRpc=async()=>{reads++;return {version:1,state:emptyData()}}');
  await run('refreshShared()');
  assert.equal(run('reads'),0);
});

test('una propina manual conserva centésimos y detalle, sin crear una venta ni alterar pedidos',()=>{
  const app=boot(),run=app.run;
  run('openSlot("m1");addProduct("papas");sendKitchen();globalThis.before=JSON.stringify({orders:data.orders,history:data.history,number:data.nextNumber,notices:data.kitchenNotices});go("tips")');
  app.events.input({target:{dataset:{tipField:'amount'},value:'50,50'}});
  app.events.input({target:{dataset:{tipField:'note'},value:'Propinas del turno'}});
  let prevented=false;
  app.events.submit({target:{id:'tip-form'},preventDefault(){prevented=true}});
  assert.equal(prevented,true);
  assert.equal(run('data.tips[0].amountMinor'),5050);
  assert.equal(run('data.tips[0].note'),'Propinas del turno');
  assert.equal(run('JSON.stringify({orders:data.orders,history:data.history,number:data.nextNumber,notices:data.kitchenNotices})'),run('before'));
  assert.match(run('renderTips()'),/50,50/);
  assert.equal(run('registerTip()'),false);
  assert.equal(run('data.tips.length'),1);
  const reopened=boot(app.storage);
  assert.equal(reopened.run('data.tips[0].amountMinor'),5050);
  assert.doesNotThrow(()=>run('validateImport(deepCopy(data))'));
  assert.doesNotMatch(run('buildDayCsv()'),/Propinas del turno/);
});

test('propinas separa monedas, filtra fechas y exporta decimales y detalle seguro',()=>{
  const app=boot(),run=app.run;
  run('tipDraft={amount:"50,50",currency:"UYU",note:"=Propina"};registerTip();tipDraft={amount:"10.25",currency:"BRL",note:"<img src=x>"};registerTip()');
  assert.match(run('renderTips()'),/\$ 50,50/);
  assert.match(run('renderTips()'),/R\$ 10,25/);
  assert.match(run('renderTips()'),/&lt;img src=x&gt;/);
  assert.equal(run('data.history.length'),0);
  assert.match(run('buildTipsCsv()'),/'=Propina/);
  assert.match(run('buildTipsCsv()'),/"BRL";"10,25"/);
  run('tipDate="2020-01-01"');assert.equal(run('tipsForDate().length'),0);
  assert.doesNotMatch(run('buildTipsCsv()'),/Propina/);
});

test('propinas rechaza importes, monedas y detalles inválidos y recupera respaldos antiguos',()=>{
  for(const draft of [{amount:'0',currency:'UYU',note:'Turno'}, {amount:'-1',currency:'UYU',note:'Turno'}, {amount:'50,555',currency:'UYU',note:'Turno'}, {amount:'NaN',currency:'UYU',note:'Turno'}, {amount:'50',currency:'USD',note:'Turno'}, {amount:'50',currency:'UYU',note:' '}]){
    const app=boot();app.run(`tipDraft=${JSON.stringify(draft)}`);
    assert.equal(app.run('registerTip()'),false);
    assert.equal(app.run('data.tips.length'),0);assert.equal(app.writes,0);
  }
  const app=boot(),run=app.run;
  assert.equal(run('const old=emptyData();delete old.tips;validateImport(old).tips.length'),0);
  run('tipDraft={amount:"50",currency:"UYU",note:"Turno"};registerTip()');
  assert.throws(()=>run('{const bad=deepCopy(data);bad.tips.push(deepCopy(bad.tips[0]));validateImport(bad)}'),/repetidas/);
  assert.throws(()=>run('{const bad=deepCopy(data);bad.tips[0].amountMinor=1.5;validateImport(bad)}'),/inválida/);
});

test('un fallo de guardado de propina conserva el formulario para reintentar una sola vez',()=>{
  const app=boot(),run=app.run;
  run('tipDraft={amount:"50,50",currency:"UYU",note:"Turno"}');app.failWrites=true;
  assert.equal(run('registerTip()'),false);assert.equal(run('data.tips.length'),0);
  assert.equal(run('tipDraft.amount'),'50,50');app.failWrites=false;
  assert.equal(run('registerTip()'),true);assert.equal(run('data.tips.length'),1);
  assert.equal(run('tipDraft.note'),'');
});

test('la sincronización conserva propinas simultáneas y detecta correcciones incompatibles',()=>{
  const app=boot(),run=app.run;
  run('globalThis.base=emptyData();globalThis.local=deepCopy(base);globalThis.remote=deepCopy(base);local.tips.push({id:"a",createdAt:now(),amountMinor:5050,currency:"UYU",note:"Turno uno"});remote.tips.push({id:"b",createdAt:now(),amountMinor:1000,currency:"BRL",note:"Turno dos"});globalThis.merged=mergeSharedState(base,local,remote)');
  assert.equal(run('merged.tips.length'),2);
  assert.equal(run('merged.tips.reduce((n,t)=>n+t.amountMinor,0)'),6050);
  run('base=deepCopy(merged);local=deepCopy(base);remote=deepCopy(base);local.tips[0].note="Corrección local";remote.tips[0].note="Corrección remota"');
  assert.equal(run('mergeSharedState(base,local,remote)'),null);
});

test('borrar pedidos conserva propinas y recuperar un respaldo restaura sus registros',()=>{
  const app=boot(),run=app.run;
  run('tipDraft={amount:"50",currency:"UYU",note:"Turno"};registerTip();globalThis.backup=validateImport(deepCopy(data));openSlot("m1");addProduct("papas");resetAll()');
  assert.equal(run('data.tips.length'),1);assert.equal(run('Object.keys(data.orders).length'),0);
  run('importData(backup)');assert.equal(run('data.tips[0].note'),'Turno');
});

test('el guardado compartido envía propinas y conserva el foco mientras se escribe',async()=>{
  const app=boot(),run=app.run;
  run('tipDraft={amount:"50",currency:"UYU",note:"Turno"};registerTip();sharedReady=true;sharedVersion=1;sharedBase=emptyData();sharedPending=deepCopy(data);globalThis.sent=null;sharedRpc=async(name,body)=>{sent=body.next_state;return {ok:true,version:2}}');
  await run('flushShared()');
  assert.equal(run('sent.tips[0].amountMinor'),5000);
  assert.equal(run('sharedBase.tips[0].note'),'Turno');
  run('document.activeElement={dataset:{tipField:"note"}};globalThis.reads=0;sharedRpc=async()=>{reads++;return {version:3,state:emptyData()}}');
  await run('refreshShared()');assert.equal(run('reads'),0);
});

test('reparto por importes: distintos métodos, cambio, Pix y recuperación del historial',()=>{
  const app=boot(),run=app.run;
  run('openSlot("m1");addProduct("kebab-carne");addProduct("papas");sendKitchen();markReady("m1");startClose();setPaymentMode("amounts")');
  app.events.input({target:{dataset:{paymentAmount:'0'},value:'150'}});
  run('paymentParts[0].name="Ana";paymentParts[0].method="Efectivo";paymentParts[0].cashReceived="200";assignPaymentBalance(1);paymentParts[1].name="Luis";paymentParts[1].method="Pix"');
  assert.equal(run('paymentParts[1].amount'),'270');
  assert.equal(run('paymentStatus(current()).valid'),true);
  run('confirmClose()');
  assert.equal(run('data.orders.m1'),undefined);
  assert.equal(run('data.history[0].paymentSplit'),'amounts');
  assert.equal(run('data.history[0].payments[0].amount'),150);
  assert.equal(run('data.history[0].payments[0].cashChange'),50);
  assert.equal(run('data.history[0].payments[1].pixBrl'),32.53);
  assert.equal(run('data.history[0].payments[0].items.length'),0);
  assert.doesNotThrow(()=>run('validateImport(deepCopy(data))'));
  const recovered=boot(app.storage);
  assert.equal(recovered.run('data.history[0].payments[1].amount'),270);
  assert.match(recovered.run('renderHistoryPayments(data.history[0])'),/reparto por importes/);
  assert.match(recovered.run('buildDayCsv()'),/Ana: Importe de la cuenta — Efectivo \$150/);
});

test('el reparto por importes impide cerrar con faltantes, excedentes, importes inválidos o método faltante',()=>{
  const app=boot(),run=app.run;
  run('openSlot("m1");addProduct("papas");startClose();setPaymentMode("amounts");paymentParts.forEach(part=>part.method="Transferencia")');
  for(const [first,second,message] of [['40','50',/Faltan \$10/],['60','50',/Sobran \$10/],['-1','101',/pesos enteros/],['50.5','49.5',/pesos enteros/],['','100',/Persona 1/i],['0','100',/Persona 1/i],['9007199254740992','1',/pesos enteros/]]){
    run(`paymentParts[0].amount=${JSON.stringify(first)};paymentParts[1].amount=${JSON.stringify(second)};confirmClose()`);
    assert.equal(run('data.history.length'),0);
    assert.match(run('paymentStatus(current()).message'),message);
  }
  run('paymentParts[0].amount="40";paymentParts[1].amount="60";paymentParts[1].method="";confirmClose()');
  assert.equal(run('data.history.length'),0);
  assert.match(run('paymentStatus(current()).message'),/falta forma de pago/);
  run('paymentParts[1].method="Efectivo";paymentParts[1].cashReceived="50";confirmClose()');
  assert.equal(run('data.history.length'),0);
  run('paymentParts[1].cashReceived="60";confirmClose()');
  assert.equal(run('data.history.length'),1);
});

test('partes iguales conserva exactamente el total y el resto se puede asignar a cualquier persona',()=>{
  const app=boot(),run=app.run;
  run('openSlot("m1");addProduct("papas");startClose();setPaymentMode("amounts");handleAction({dataset:{action:"payment-add"}},{detail:1});dividePaymentEqually()');
  assert.equal(run('paymentParts.map(part=>part.amount).join(",")'),'34,33,33');
  run('paymentParts[0].amount="20";paymentParts[2].amount="25";assignPaymentBalance(1)');
  assert.equal(run('paymentParts[1].amount'),'55');
  run('paymentParts.forEach(part=>part.method="Débito");confirmClose()');
  assert.equal(run('data.history[0].payments.reduce((sum,part)=>sum+part.amount,0)'),100);
  assert.doesNotThrow(()=>run('validateImport(deepCopy(data))'));
});

test('respaldos de importes rechazan totales alterados y productos asignados a ese modo',()=>{
  const app=boot(),run=app.run;
  run('openSlot("m1");addProduct("papas");startClose();setPaymentMode("amounts");dividePaymentEqually();paymentParts.forEach(part=>part.method="Crédito");confirmClose()');
  assert.throws(()=>run('{const wrong=deepCopy(data);wrong.history[0].payments[0].amount=40;validateImport(wrong)}'));
  assert.throws(()=>run('{const wrong=deepCopy(data);wrong.history[0].payments[0].items=[{lineId:wrong.history[0].lines[0].id,qty:1}];validateImport(wrong)}'));
  assert.throws(()=>run('{const wrong=deepCopy(data);delete wrong.history[0].paymentSplit;validateImport(wrong)}'));
  assert.throws(()=>run('{const wrong=deepCopy(data);delete wrong.history[0].payments;validateImport(wrong)}'));
});

test('un error de guardado mantiene abierto el cobro por importes para reintentar sin duplicar ventas',()=>{
  const app=boot(),run=app.run;
  run('openSlot("m1");addProduct("papas");startClose();setPaymentMode("amounts");dividePaymentEqually();paymentParts.forEach(part=>part.method="Transferencia")');
  app.failWrites=true;run('confirmClose()');
  assert.equal(run('data.history.length'),0);
  assert.equal(run('modal'),'payment');
  assert.equal(run('paymentParts[0].amount'),'50');
  app.failWrites=false;run('confirmClose();confirmClose()');
  assert.equal(run('data.history.length'),1);
});

test('los importes se editan sin reconstruir el diálogo y cambiar de modo conserva nombres y métodos',()=>{
  const app=boot(),run=app.run;
  run('openSlot("m1");addProduct("papas");startClose();setPaymentMode("amounts");paymentParts[0].name="Ana";paymentParts[0].method="Débito"');
  const before=app.nodes.get('#modal-root').innerHTML;
  app.events.input({target:{dataset:{paymentAmount:'0'},value:'35'}});
  assert.equal(app.nodes.get('#modal-root').innerHTML,before);
  assert.equal(run('partAmount(paymentParts[0],current())'),35);
  run('setPaymentMode("products")');
  assert.equal(run('paymentParts[0].name'),'Ana');
  assert.equal(run('paymentParts[0].method'),'Débito');
  assert.equal(run('paymentStatus(current()).valid'),false);
  run('setPaymentMode("single")');
  assert.equal(run('partAmount(paymentParts[0],current())'),100);
  assert.equal(run('paymentStatus(current()).valid'),true);
});

test('importes conserva efectivo BRL, PREX y Pix junto a ventas al personal y propinas',()=>{
  const app=boot(),run=app.run;
  run('tipDraft={amount:"10,50",currency:"BRL",note:"Turno"};registerTip();staffDraft={...emptyStaffDraft(),amount:"50",detail:"Cena"};registerStaffSale();openSlot("m1");addProduct("kebab-carne");addProduct("papas");sendKitchen();markReady("m1");startClose();setPaymentMode("amounts")');
  action(app,'payment-add');action(app,'payment-add');
  run('paymentParts.forEach((part,index)=>part.amount=String([100,110,120,90][index]));paymentParts[0].method="Efectivo";paymentParts[0].cashReceived="150";paymentParts[1].method="Efectivo BRL";paymentParts[1].brlCharged="13,00";paymentParts[1].brlReceived="20";paymentParts[2].method="PREX";paymentParts[3].method="Pix";confirmClose()');
  assert.equal(run('data.history.length'),2);
  assert.equal(run('data.history[0].saleType'),'staff');
  assert.equal(run('data.tips[0].amountMinor'),1050);
  assert.equal(run('data.history[1].payments.map(part=>part.method).join("|")'),'Efectivo|Efectivo BRL|PREX|Pix');
  assert.equal(run('data.history[1].payments[1].brlChangeMinor'),700);
  assert.equal(run('data.history[1].payments[3].pixBrl'),10.84);
  assert.doesNotThrow(()=>run('validateImport(deepCopy(data))'));
  assert.match(run('buildDayCsv()'),/cobrado R\$ 13,00, recibido R\$ 20,00, cambio R\$ 7,00/);
});

test('deshacer importes conserva nombres posteriores y obliga a revisar solamente el efectivo cambiado',()=>{
  const app=boot(),run=app.run;
  run('openSlot("m1");addProduct("papas");startClose();setPaymentMode("amounts");dividePaymentEqually();paymentParts[0].method="Efectivo BRL";paymentParts[0].brlCharged="10";paymentParts[0].brlReceived="20";paymentParts[1].method="Efectivo";paymentParts[1].cashReceived="100"');
  const input={dataset:{paymentAmount:'0'},value:'4'};
  app.events.input({target:input});input.value='40';app.events.input({target:input});
  assert.equal(run('paymentParts[0].brlCharged'),'');
  assert.equal(run('paymentParts[1].cashReceived'),'100');
  app.events.input({target:{dataset:{payerName:'0'},value:'Ana'}});
  action(app,'payment-undo');
  assert.equal(run('paymentParts[0].amount'),'50');
  assert.equal(run('paymentParts[0].name'),'Ana');
  assert.equal(run('paymentParts[1].cashReceived'),'100');
  action(app,'payment-mode',{mode:'single'});action(app,'payment-undo');
  assert.equal(run('paymentMode'),'amounts');
  assert.equal(run('paymentParts.length'),2);
  assert.equal(run('paymentParts[0].amount'),'50');
});

test('el guardado compartido conserva reparto por importes y propinas en el mismo estado',async()=>{
  const app=boot(),run=app.run;
  run('tipDraft={amount:"50",currency:"UYU",note:"Turno"};registerTip();openSlot("m1");addProduct("papas");startClose();setPaymentMode("amounts");dividePaymentEqually();paymentParts.forEach(part=>part.method="PREX");confirmClose();sharedReady=true;sharedVersion=1;sharedBase=emptyData();sharedPending=deepCopy(data);globalThis.sent=null;sharedRpc=async(name,body)=>{sent=body.next_state;return {ok:true,version:2}}');
  await run('flushShared()');
  assert.equal(run('sent.history[0].paymentSplit'),'amounts');
  assert.equal(run('sharedBase.history[0].payments[1].amount'),50);
  assert.equal(run('sharedBase.tips[0].amountMinor'),5000);
});
