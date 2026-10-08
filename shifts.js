/* Turnos compartidos: el servidor congela los totales y confirma el envío a Caja. */
(() => {
  "use strict";
  const STORE="kebba-shift-pending-v1";
  let snapshot={active:null,closed:[],connection:null,enabled:false},ready=false,loading=false,busy=false,error="",pending=null;
  try{pending=JSON.parse(sessionStorage.getItem(STORE)||"null");}catch{}
  const datetime=value=>new Date(value).toLocaleString("es-UY",{dateStyle:"short",timeStyle:"short"});
  const nativeMoney=p=>p.amountMinor===null?"Importe pendiente":(p.currency==="BRL"?"R$ ":"$ ")+(Number(p.amountMinor)/100).toLocaleString("es-UY",{minimumFractionDigits:2,maximumFractionDigits:2});
  const id=()=>crypto.randomUUID();
  const rerender=()=>{if(["home","shifts"].includes(view)&&!modal)window.requestAnimationFrame?window.requestAnimationFrame(()=>render()):render();};
  function savePending(value){sessionStorage.setItem(STORE,JSON.stringify(value));pending=value;}
  function clearPending(){sessionStorage.removeItem(STORE);pending=null;}
  const matchesPending=()=>pending&&(pending.action==="open"?[snapshot.active,...snapshot.closed].some(t=>t?.id===pending.request_id):pending.action==="close"?snapshot.closed.some(t=>t.id===pending.target_id):false);
  function apply(value){
    if(!value||!Array.isArray(value.closed)||typeof value.enabled!=="boolean")throw Error("No pudimos comprobar el turno. Reintentá.");
    const changed=!ready||!!error||JSON.stringify(snapshot)!==JSON.stringify(value);snapshot=value;ready=true;error="";
    if(matchesPending())clearPending();
    return changed;
  }
  async function refresh(){
    if(!sharedMode||!sharedReady||loading||busy)return;
    loading=true;let changed=false;
    try{changed=apply(await sharedRpc("kebba_shift_read",{access_token:sharedToken}));}
    catch(e){changed=true;ready=false;error=e.message;}
    finally{loading=false;if(changed)rerender();}
  }
  async function durableOrders(){
    const deadline=Date.now()+20000;
    while(sharedWriting||sharedPending){
      if(readBlocked||storageConflict||Date.now()>deadline)throw Error("Quedan cobros sin guardar. Reintentá la conexión antes de cerrar el turno.");
      if(sharedPending&&!sharedWriting)await flushShared();
      else await new Promise(resolve=>setTimeout(resolve,50));
    }
    if(!sharedReady||readBlocked||storageConflict)throw Error("Esperá a sincronizar los pedidos antes de cambiar el turno.");
    await refreshShared();
    if(readBlocked||sharedReading||sharedWriting||sharedPending)throw Error("Todavía estamos comprobando los pedidos. Volvé a intentar.");
  }
  async function action(kind){
    if(busy||loading||!sharedMode||!sharedReady)return;
    if(pending&&kind!=="retry")return;
    if(kind==="close"&&snapshot.pendingOrders){error="Quedan pedidos sin cobrar. Cobralos antes de cerrar el turno.";rerender();return;}
    if(kind==="close"&&!confirm("¿Cerrar el turno y enviar los totales por medio de pago a la Caja?"))return;
    busy=true;error="";rerender();
    try{
      if(kind!=="retry"){await durableOrders();savePending({action:kind,request_id:id(),target_id:kind==="close"?snapshot.active?.id:null,expected_version:sharedVersion});}
      if(!pending)throw Error("No hay una operación pendiente.");
      const result=await sharedRpc("kebba_shift_action",{access_token:sharedToken,...pending});
      apply(result);
      if(pending?.action==="open"&&result.active)clearPending();
      if(pending?.action==="retry_export")clearPending();
      if(pending)throw Error("No pudimos confirmar la operación. Comprobá el turno o reintentá el mismo guardado.");
    }catch(e){
      error=e.message;
      // Un rechazo explícito no necesita repetir una solicitud ya descartada.
      if(e.status>=400&&e.status<500&&e.status!==408&&e.status!==429){clearPending();ready=false;}
    }finally{busy=false;rerender();}
  }
  function totals(turn){return (turn.payment_totals||[]).length?`<div class="shift-totals">${turn.payment_totals.map(p=>`<div class="shift-total"><span>${safe(p.method)}</span><strong>${safe(nativeMoney(p))}</strong><small>${Number(p.paymentsCount)} pago(s) · ${safe(p.currency)}${p.currency==="BRL"?` · ${money(p.amountUYU)} en ventas`:""}</small>${p.missingCount?'<p>Falta el importe en reales. El envío queda pendiente.</p>':""}</div>`).join("")}</div>`:'<div class="shift-empty">Todavía no hay ventas en este turno.</div>';}
  function banner(){
    if(!sharedMode)return "";
    const text=!ready?"Comprobando el turno…":snapshot.active?`Turno abierto · ${snapshot.active.code}`:"Sin turno abierto";
    return `<div class="shift-banner ${ready&&snapshot.active?"open":""}"><strong>${safe(text)}</strong><button data-action="view" data-view="shifts">${snapshot.active?"VER / CERRAR TURNO":"ABRIR TURNO"}</button></div>`;
  }
  function renderShift(){
    const heading='<div class="headline"><h1>Turno</h1><button data-shift-action="refresh" class="small-button">Actualizar</button></div>';
    if(!sharedMode)return heading+'<div class="empty">Abrí el enlace compartido de Kebba para abrir y cerrar turnos.</div>';
    if(!sharedReady)return heading+'<div class="empty">Esperá a conectar con los pedidos compartidos.</div>';
    const notice=(snapshot.outsideTurn?`<div class="storage-alert">${snapshot.outsideTurn} cobro(s) registrado(s) fuera de turno desde la primera apertura. Revisalos en Historial antes de cargar la Caja.</div>`:"")+(error?`<div class="storage-alert" role="alert">${safe(error)} <button data-shift-action="refresh">COMPROBAR TURNO</button></div>`:"");
    const uncertainty=pending?`<div class="storage-alert">Hay una operación cuyo resultado falta comprobar. <button data-shift-action="retry" ${busy?"disabled":""}>REINTENTAR EL MISMO GUARDADO</button></div>`:"";
    if(!ready)return heading+notice+uncertainty+(loading?'<div class="empty">Leyendo el turno…</div>':"");
    const disabled=busy||!!pending||window.KebbaDeletion?.isBusy()?"disabled":"",active=snapshot.active;
    const connection=snapshot.connection?.url&&/^https:\/\/docs\.google\.com\/spreadsheets\/d\/[\w-]+/.test(snapshot.connection.url)?`<a href="${safe(snapshot.connection.url)}" target="_blank" rel="noopener">ABRIR PLANILLA DE CAJA ↗</a>`:'<p class="note">Falta conectar Google Sheets. Los cierres se conservarán pendientes de envío.</p>';
    return heading+notice+uncertainty+(window.KebbaDeletion?.notice()||"")+`<div class="cash-panel">${active?`<h2>${safe(active.code)} · Abierto</h2><p class="shift-meta">Inicio: ${datetime(active.opened_at)} · ${active.sales_count} venta(s)</p><div class="shift-summary">Ventas: ${money(active.total_uyu)}</div>${totals(active)}${snapshot.pendingOrders?`<p class="storage-alert">${snapshot.pendingOrders} pedido(s) sin cobrar. Cobralos antes de cerrar.</p>`:""}<button class="primary cash-big" data-shift-action="close" ${snapshot.pendingOrders?"disabled":disabled}>${busy?"GUARDANDO…":"CERRAR TURNO Y ENVIAR A CAJA"}</button>`:`<h2>Sin turno abierto</h2><p>Abrí el turno antes de empezar a cobrar.</p><button class="primary cash-big" data-shift-action="open" ${disabled}>${busy?"GUARDANDO…":"ABRIR TURNO"}</button>`}<p>Al cerrar se carga un total por cada medio de pago. Pix y efectivo en reales conservan los importes cobrados en BRL.</p>${connection}</div>${snapshot.closed.map(t=>`<div class="cash-panel shift-closed"><h2>${safe(t.code)} <span class="shift-status ${t.exported_at?"sent":""}">${t.exported_at?"Enviado a Caja":"Pendiente de envío"}</span></h2><p class="shift-meta">${datetime(t.opened_at)} → ${datetime(t.closed_at)} · ${t.sales_count} venta(s) · ${money(t.total_uyu)}</p>${totals(t)}${window.KebbaDeletion?.button("shift","delete",t.id,`el turno ${t.code} y todos sus pedidos`)||""}</div>`).join("")}${(snapshot.deleted||[]).length?`<details class="maintenance"><summary>Turnos eliminados (${snapshot.deleted.length})</summary>${snapshot.deleted.map(t=>`<div class="cash-panel"><h2>${safe(t.code)} · Eliminado</h2><p>${t.exported_at?"Quitado de la planilla de Caja":"Pendiente de quitar de la planilla"}</p>${window.KebbaDeletion?.button("shift","restore",t.id,`el turno ${t.code}`)||""}</div>`).join("")}</details>`:""}${snapshot.closed.some(t=>!t.exported_at)&&snapshot.connection?`<button data-shift-action="retry_export" ${disabled}>REINTENTAR ENVÍOS PENDIENTES</button>`:""}`;
  }
  function canCharge(){
    if(!sharedMode)return true;
    if(busy||pending||!ready||window.KebbaDeletion?.isBusy()){toast("Comprobá el turno antes de cobrar.",true);void refresh();return false;}
    if(snapshot.enabled&&!snapshot.active){toast("Abrí un turno antes de cobrar.",true);go("shifts");return false;}
    return true;
  }
  window.KebbaShifts={refresh,render:renderShift,banner,canCharge,receiptTag:()=>snapshot.active?{shiftId:snapshot.active.id}:{}};
  document.addEventListener("click",event=>{const button=event.target.closest?.("[data-shift-action]");if(!button||button.disabled)return;const kind=button.dataset.shiftAction;if(kind==="refresh")void refresh();else void action(kind);});
  setInterval(()=>void refresh(),4000);
  window.addEventListener("focus",()=>void refresh());
  void refresh();
})();
