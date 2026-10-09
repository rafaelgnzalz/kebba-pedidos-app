const fs=require('node:fs'),vm=require('node:vm'),test=require('node:test'),assert=require('node:assert/strict');
const source=fs.readFileSync(require('node:path').join(__dirname,'../deletions.js'),'utf8');
const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
const reads=html.slice(html.indexOf('const sharedLegacyReads='),html.indexOf('function applySharedState'));
function boot(){
 const store=new Map(),events={},calls=[];let serial=0;
 const ctx={sharedMode:true,sharedReady:true,sharedWriting:false,sharedPending:null,sharedReading:false,sharedVersion:10,sharedToken:'fixture',readBlocked:false,storageConflict:false,view:'history',modal:null,historyDetail:374,
  sessionStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)},
  window:{addEventListener(){},KebbaShifts:{refresh:async()=>{}},KebbaCash:{refresh:async()=>{}}},
  document:{addEventListener:(name,f)=>events[name]=f},setInterval(){},setTimeout,Date,
  crypto:{randomUUID:()=>`request-${++serial}`},confirm:()=>true,render(){},safe:String,dayKey:()=> '2026-10-08',numberLabel:n=>'#'+n,money:n=>'$ '+n,toast(m){ctx.message=m},
  refreshShared:async()=>{},flushShared:async()=>{ctx.sharedPending=null},applySharedState(r){ctx.applied=r;ctx.sharedVersion=r.version},
  sharedRpc:async(name,body)=>{calls.push({name,body});return name.startsWith('kebba_deleted_sales')?{sales:[]}:{ok:true,state:{history:[]},version:11};}};
 vm.createContext(ctx);vm.runInContext(reads,ctx);vm.runInContext(source,ctx);
 const click=(dataset={},attribute='')=>events.click({target:{closest:()=>({dataset,disabled:false,hasAttribute:name=>name===attribute})}});
 return {ctx,store,calls,click,tick:()=>new Promise(r=>setImmediate(r))};
}
test('eliminar pedido espera el guardado y usa su identidad completa y la versión actual',async()=>{
 const a=boot();await a.tick();a.ctx.sharedPending={sale:1};let flushed=false;a.ctx.flushShared=async()=>{flushed=true;a.ctx.sharedPending=null};
 a.click({deleteKind:'sale',deleteAction:'delete',deleteTarget:'374:1791485000000',deleteLabel:'el pedido #374'});await a.tick();
 const request=a.calls.find(c=>c.name==='kebba_delete_action');assert.ok(flushed);assert.equal(request.body.target_key,'374:1791485000000');assert.equal(request.body.expected_version,10);
 assert.equal(a.ctx.applied.version,11);assert.equal(a.store.size,0);assert.equal(a.ctx.historyDetail,null);
});
test('respuesta perdida conserva solicitud y el reintento no puede eliminar otro turno',async()=>{
 const a=boot();await a.tick();const requests=[];a.ctx.sharedRpc=async(name,b)=>{if(name.startsWith('kebba_deleted_sales'))return {sales:[]};requests.push(b);throw Error('Respuesta perdida')};
 a.click({deleteKind:'shift',deleteAction:'delete',deleteTarget:'turno-1',deleteLabel:'el turno 1'});await a.tick();
 assert.equal(a.store.size,1);assert.ok(a.ctx.window.KebbaDeletion.isBusy());
 a.click({deleteKind:'shift',deleteAction:'delete',deleteTarget:'turno-2'});await a.tick();assert.equal(requests.length,1);
 a.click({},'data-delete-retry');await a.tick();assert.equal(requests.length,2);assert.deepEqual(requests[0],requests[1]);
});
test('un rechazo de versión no mantiene una eliminación falsa y cancelar no envía cambios',async()=>{
 const a=boot();await a.tick();a.ctx.confirm=()=>false;a.click({deleteKind:'sale',deleteAction:'delete',deleteTarget:'1:2'});await a.tick();assert.equal(a.calls.length,1);
 a.ctx.confirm=()=>true;a.ctx.sharedRpc=async(name)=>{if(name.startsWith('kebba_deleted_sales'))return{sales:[]};const e=Error('Los pedidos cambiaron');e.status=409;throw e};
 a.click({deleteKind:'sale',deleteAction:'delete',deleteTarget:'1:2'});await a.tick();assert.equal(a.store.size,0);assert.equal(a.ctx.applied,undefined);
});
test('eliminados de un turno ofrecen restaurar el turno y no una venta que seguiría excluida',async()=>{
 const a=boot();await a.tick();a.ctx.sharedRpc=async()=>({sales:[{key:'1:2',sale:{number:1,total:100,closedAt:1},shift_deleted:true,shift_code:'T-001'}]});await a.ctx.window.KebbaDeletion.refresh();
 const html=a.ctx.window.KebbaDeletion.renderDeleted('2026-10-08');assert.match(html,/Restaurá su turno/);assert.doesNotMatch(html,/data-delete-action="restore"/);
});

test('lectura pequeña conserva las restauraciones y los errores no habilitan eliminar',async()=>{
 const a=boot();await a.tick();const result={sales:[{key:'1:2',sale:{number:1,total:100,closedAt:1},shift_deleted:false}],fingerprint:'first'};
 a.ctx.sharedRpc=async()=>result;await a.ctx.window.KebbaDeletion.refresh();
 a.ctx.sharedRpc=async(name,body)=>{assert.equal(name,'kebba_deleted_sales_if_changed');assert.equal(body.known_fingerprint,'first');return {unchanged:true,fingerprint:'first'}};
 await a.ctx.window.KebbaDeletion.refresh();assert.match(a.ctx.window.KebbaDeletion.renderDeleted('2026-10-08'),/RESTAURAR/);
 a.ctx.sharedRpc=async()=>{throw Error('Sin conexión')};await a.ctx.window.KebbaDeletion.refresh();assert.match(a.ctx.window.KebbaDeletion.button('sale','delete','1:2','pedido'),/disabled/);
 a.ctx.sharedRpc=async(name,body)=>{assert.equal(body.known_fingerprint,null);return {sales:[],fingerprint:'second'}};
 await a.ctx.window.KebbaDeletion.refresh();assert.match(a.ctx.window.KebbaDeletion.renderDeleted('2026-10-08'),/fecha \(0\)/);
});
