const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const test=require('node:test');
const assert=require('node:assert/strict');

const source=fs.readFileSync(path.join(__dirname,'..','cash.js'),'utf8');
function boot(response,options={}){
  const listeners={};
  const calls=[];
  const store=new Map(options.storedToken===null?[]:[['kebba-cash-token-v1',options.storedToken||'a'.repeat(64)]]);
  const app={inert:false};
  const modal={innerHTML:'',focus(){},querySelector(){return null}};
  const context={
    sharedMode:true,sharedToken:'test',view:'home',sharedPending:null,sharedWriting:false,readBlocked:false,
    sharedRpc:async (name,body)=>{calls.push({name,body});if(name==='kebba_cash_read'){if(options.readError)throw Error(options.readError);return response;}if(options.commandError)throw options.commandError;return {};},
    safe:value=>String(value??'').replace(/[&<>]/g,''),
    dayKey:()=>"2026-09-29",now:()=>Date.parse('2026-09-29T18:00:00Z'),uid:()=>"22222222-2222-4222-8222-222222222222",
    canEdit:()=>true,toast(){},confirm:()=>true,
    sessionStorage:{getItem:()=>null,setItem(){},removeItem(){}},
    localStorage:{getItem:key=>store.get(key)||null,setItem:(key,value)=>store.set(key,value),removeItem:key=>store.delete(key)},
    FormData:class{constructor(form){this.form=form}get(key){return this.form[key]}[Symbol.iterator](){return Object.entries(this.form)[Symbol.iterator]()}},
    document:{addEventListener(name,fn){listeners[name]=fn},querySelector(selector){return selector==='.app'?app:modal}},
    window:{KebbaBook:options.book,render(){},location:{hash:options.hash||'',pathname:'/kebba-pedidos-app/',search:''},history:{replaceState(){}}},console
  };
  vm.createContext(context);vm.runInContext(source,context);
  return {cash:context.window.KebbaCash,listeners,calls,store,modal};
}
test('caja exige otra clave y no acepta la de pedidos por sí sola',async()=>{
  const {cash,calls,listeners,store}=boot({events:[],sales:[]},{storedToken:null});
  assert.match(cash.render(),/Acceso para encargados/);
  await cash.refresh();assert.equal(calls.length,0);
  const key='b'.repeat(64);
  listeners.submit({target:{id:'cash-access-form',access:`https://example.com/#clave=${'a'.repeat(64)}&caja=${key}`},preventDefault(){}});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(calls[0].body.access_token,key);
  assert.equal(store.get('kebba-cash-token-v1'),key);
});

test('una respuesta de guardado perdida mantiene el mismo ID para reintentar',async()=>{
  const {cash,listeners,calls}=boot({events:[],sales:[]},{commandError:Error('Conexión perdida')});
  await cash.refresh();
  listeners.click({target:{closest:()=>({dataset:{cashAction:'open-dialog',dialog:'movement'}})}});
  listeners.submit({target:{id:'cash-form',kind:'income',currency:'UYU',amount:'100',responsible:'Ana',reason:'Prueba'},preventDefault(){}});
  await new Promise(resolve=>setImmediate(resolve));
  assert.match(cash.render(),/guardado no pudimos comprobar/);
  listeners.click({target:{closest:()=>({dataset:{cashAction:'retry'}})}});
  await new Promise(resolve=>setImmediate(resolve));
  const writes=calls.filter(c=>c.name==='kebba_cash_command');assert.equal(writes.length,2);assert.equal(writes[0].body.request_id,writes[1].body.request_id);
});

test('un rechazo confirmado permite corregir el formulario sin dejarlo bloqueado',async()=>{
  const rejected=Error('Importe inválido');rejected.status=400;
  const {cash,listeners}=boot({events:[],sales:[]},{commandError:rejected});await cash.refresh();
  listeners.click({target:{closest:()=>({dataset:{cashAction:'open-dialog',dialog:'movement'}})}});
  listeners.submit({target:{id:'cash-form',kind:'income',currency:'UYU',amount:'100',responsible:'Ana',reason:'Prueba'},preventDefault(){}});
  await new Promise(resolve=>setImmediate(resolve));assert.doesNotMatch(cash.render(),/guardado no pudimos comprobar/);
});

test('rendir una compra permite elegir y guardar su categoría',async()=>{
  const withdrawal='33333333-3333-4333-8333-333333333333';
  const events=[{id:withdrawal,session_id:'1',kind:'withdrawal',currency:'UYU',amount_minor:100000,created_at:'2026-09-29T13:00:00Z',detail:{responsible:'Ana',reason:'Mercadería'}}];
  const {cash,listeners,calls,modal}=boot({events,sales:[],book:[],finance_version:1},{book:require('../cash-book.js')});
  await cash.refresh();
  listeners.click({target:{closest:()=>({dataset:{cashAction:'withdrawal-dialog',dialog:'settlement',id:withdrawal}})}});
  assert.match(modal.innerHTML,/name="category"/);
  assert.match(modal.innerHTML,/Mercadería/);
  listeners.submit({target:{id:'cash-form',supplier:'Distribuidora',document_date:'2026-09-29',document_number:'123',amount:'100',category:'stock',note:'Bebidas'},preventDefault(){}});
  await new Promise(resolve=>setImmediate(resolve));
  const saved=calls.find(c=>c.name==='kebba_cash_command');
  assert.equal(saved.body.action,'settlement');assert.equal(saved.body.payload.category,'stock');assert.equal(saved.body.payload.amount_minor,10000);
});

test('una clave de Caja rechazada se olvida en ese dispositivo',async()=>{
  const {cash,store}=boot({events:[],sales:[]},{readError:'Clave de Caja inválida'});
  await cash.refresh();
  assert.match(cash.render(),/La clave de Caja no es válida/);
  assert.equal(store.has('kebba-cash-token-v1'),false);
});
test('caja separa efectivo, pagos electrónicos y rendición sin contar la factura dos veces',async()=>{
  const id='11111111-1111-4111-8111-111111111111',withdrawal='33333333-3333-4333-8333-333333333333';
  const events=[
    {id,session_id:id,kind:'open',currency:null,amount_minor:0,created_at:'2026-09-29T12:00:00Z',detail:{date:'2026-09-29',opening_uyu:1500000,opening_brl:10000}},
    {id:withdrawal,session_id:id,kind:'withdrawal',currency:'UYU',amount_minor:1000000,created_at:'2026-09-29T13:00:00Z',detail:{responsible:'Sebastián',reason:'Mercadería'}},
    {id:'44444444-4444-4444-8444-444444444444',session_id:id,kind:'settlement',currency:'UYU',amount_minor:875000,related_id:withdrawal,created_at:'2026-09-29T14:00:00Z',detail:{supplier:'Distribuidora',document_date:'2026-09-29',document_number:'1034'}},
    {id:'55555555-5555-4555-8555-555555555555',session_id:id,kind:'return',currency:'UYU',amount_minor:125000,related_id:withdrawal,created_at:'2026-09-29T15:00:00Z',detail:{responsible:'Sebastián'}}
  ];
  const sales=[
    {sold_at:'2026-09-29T16:00:00Z',sale:{payment:'Efectivo',total:32400}},
    {sold_at:'2026-09-29T16:01:00Z',sale:{payment:'Pix',total:1500}}
  ];
  const {cash}=boot({events,sales});await cash.refresh();
  const overview=cash.render();
  assert.match(overview,/38\.650,00/);
  assert.match(overview,/100,00/);
  assert.match(overview,/Pix/);
  assert.match(overview,/1\.500,00/);
  assert.match(overview,/No mueve efectivo/);
  assert.doesNotMatch(overview,/39\.?525,00/);
});

test('caja cerrada conserva esperado y muestra corrección auditada',async()=>{
  const id='11111111-1111-4111-8111-111111111111',close='66666666-6666-4666-8666-666666666666';
  const events=[
    {id,session_id:id,kind:'open',currency:null,amount_minor:0,created_at:'2026-09-29T12:00:00Z',detail:{date:'2026-09-29',opening_uyu:100000,opening_brl:0}},
    {id:close,session_id:id,kind:'close',currency:null,amount_minor:0,created_at:'2026-09-29T17:00:00Z',detail:{expected_uyu:100000,expected_brl:0,counted_uyu:99000,counted_brl:0}},
    {id:'77777777-7777-4777-8777-777777777777',session_id:id,kind:'close_correction',currency:null,amount_minor:0,related_id:close,created_at:'2026-09-29T18:00:00Z',detail:{old_counted_uyu:99000,new_counted_uyu:99500,old_counted_brl:0,new_counted_brl:0,reason:'Recuento'}}
  ];
  const {cash}=boot({events,sales:[]});await cash.refresh();
  const overview=cash.render();
  assert.match(overview,/995,00/);
  assert.match(overview,/-5,00/);
  assert.match(overview,/CORREGIR CON MOTIVO/);
});

test('caja suma cada medio de pago de una venta dividida',async()=>{
  const id='11111111-1111-4111-8111-111111111111';
  const events=[{id,session_id:id,kind:'open',currency:null,amount_minor:0,created_at:'2026-09-29T12:00:00Z',detail:{date:'2026-09-29',opening_uyu:0,opening_brl:0}}];
  const sales=[{sold_at:'2026-09-29T13:00:00Z',sale:{payment:'Dividido',total:500,payments:[
    {method:'Efectivo',amount:100},{method:'Efectivo BRL',amount:200,brlChargedMinor:2500},{method:'PREX',amount:200}
  ]}}];
  const {cash}=boot({events,sales});await cash.refresh();
  const overview=cash.render();
  assert.match(overview,/Efectivo esperado UYU<\/span><strong>\$ 100,00/);
  assert.match(overview,/Efectivo esperado BRL<\/span><strong>R\$ 25,00/);
  assert.match(overview,/PREX<\/span><strong>\$ 200,00/);
});
