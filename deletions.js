/* Eliminaciones recuperables, confirmadas en el servidor y reflejadas en Caja. */
(() => {
  'use strict';
  const STORE='kebba-delete-pending-v1';
  let deleted=[],ready=false,loading=false,busy=false,pending=null,error='';
  try{pending=JSON.parse(sessionStorage.getItem(STORE)||'null');}catch{}
  const rerender=()=>{if(['history','shifts','staff'].includes(view)&&!modal)render();};
  function clear(){pending=null;try{sessionStorage.removeItem(STORE);}catch{}}
  async function refresh(){
    if(!sharedMode||!sharedReady||loading||busy)return;
    loading=true;
    try{
      const result=await sharedRpc('kebba_deleted_sales',{access_token:sharedToken});
      if(!Array.isArray(result.sales))throw Error('No pudimos leer los pedidos eliminados.');
      const changed=!ready||error||JSON.stringify(deleted)!==JSON.stringify(result.sales);
      deleted=result.sales;ready=true;error='';if(changed)rerender();
    }catch(e){error=e.message;ready=false;rerender();}finally{loading=false;}
  }
  async function durable(){
    const deadline=Date.now()+20000;
    while(sharedWriting||sharedPending){
      if(readBlocked||storageConflict||Date.now()>deadline)throw Error('Esperá a guardar los pedidos antes de eliminar o restaurar.');
      if(sharedPending&&!sharedWriting)await flushShared();else await new Promise(r=>setTimeout(r,50));
    }
    await refreshShared();
    if(!sharedReady||readBlocked||storageConflict||sharedReading||sharedWriting||sharedPending)throw Error('Comprobá la conexión antes de eliminar o restaurar.');
  }
  async function command(kind,action,target,label){
    if(busy||!sharedMode||!sharedReady||pending)return;
    const text=action==='delete'?`¿Eliminar ${label}?\n\nSus ventas dejarán de contar en Caja y en la planilla. Podrás restaurarlas desde Eliminados.`:`¿Restaurar ${label}? Sus importes volverán a contar en Caja.`;
    if(!confirm(text))return;
    busy=true;error='';rerender();
    try{
      await durable();
      pending={request_id:crypto.randomUUID(),kind,action,target_key:target,expected_version:sharedVersion};
      sessionStorage.setItem(STORE,JSON.stringify(pending));
      await send();
    }catch(e){handleError(e);}finally{busy=false;rerender();void refresh();}
  }
  function handleError(e){
    error=e.message;
    if(e.status>=400&&e.status<500&&![408,429].includes(e.status))clear();
    toast(error,true);
  }
  async function send(){
    const result=await sharedRpc('kebba_delete_action',{access_token:sharedToken,...pending});
    if(!result?.ok||!result.state)throw Error('No pudimos confirmar el cambio. Reintentá el mismo guardado.');
    clear();applySharedState(result);historyDetail=null;
    toast('Cambio guardado. La planilla de Caja se actualiza automáticamente.');
    void window.KebbaShifts?.refresh();void window.KebbaCash?.refresh();
  }
  async function retry(){
    if(busy||!pending)return;busy=true;error='';rerender();
    try{await send();}catch(e){handleError(e);}finally{busy=false;rerender();void refresh();}
  }
  function notice(){return (pending?`<div class="storage-alert" role="alert">Falta confirmar una eliminación o restauración. <button data-delete-retry ${busy?'disabled':''}>REINTENTAR EL MISMO GUARDADO</button></div>`:'')+(error?`<div class="storage-alert" role="alert">${safe(error)} <button data-delete-refresh>ACTUALIZAR</button></div>`:'');}
  function button(kind,action,key,label){return `<button class="${action==='delete'?'danger':'small-button'}" data-delete-kind="${kind}" data-delete-action="${action}" data-delete-target="${safe(key)}" data-delete-label="${safe(label)}" ${busy||pending||!ready?'disabled':''}>${action==='delete'?(kind==='shift'?'ELIMINAR TURNO Y SUS PEDIDOS':'ELIMINAR PEDIDO'):'RESTAURAR'}</button>`;}
  function renderDeleted(day){
    const rows=deleted.filter(item=>dayKey(item.sale.closedAt)===day);
    return notice()+`<details class="maintenance"><summary>Pedidos eliminados en esta fecha (${rows.length})</summary>${rows.length?rows.map(item=>`<div class="cash-panel"><strong>${numberLabel(item.sale.number)} · ${money(item.sale.total)}</strong><p>${safe(item.sale.label||'')} · ${safe(item.sale.name||'')}${item.shift_code?' · '+safe(item.shift_code):''}</p>${item.shift_deleted?'<p>Restaurá su turno desde Turno → Turnos eliminados.</p>':button('sale','restore',item.key,`el pedido ${numberLabel(item.sale.number)}`)}</div>`).join(''):'<p>No hay pedidos eliminados en esta fecha.</p>'}</details>`;
  }
  window.KebbaDeletion={refresh,button,notice,renderDeleted,isBusy:()=>busy||!!pending};
  document.addEventListener('click',event=>{
    const el=event.target.closest?.('[data-delete-kind],[data-delete-retry],[data-delete-refresh]');if(!el||el.disabled)return;
    if(el.hasAttribute('data-delete-retry'))void retry();
    else if(el.hasAttribute('data-delete-refresh'))void refresh();
    else void command(el.dataset.deleteKind,el.dataset.deleteAction,el.dataset.deleteTarget,el.dataset.deleteLabel);
  });
  setInterval(()=>void refresh(),4000);window.addEventListener('focus',()=>void refresh());void refresh();
})();
