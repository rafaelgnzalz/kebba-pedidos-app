/* Caja fase 1. Los movimientos confirmados viven en el diario privado de Supabase. */
(() => {
  "use strict";
  const STORE = "kebba-cash-pending-v1";
  const ACCESS_STORE = "kebba-cash-token-v1";
  const tokenFrom = value => {
    const input=String(value||"").trim();
    return input.match(/(?:^#|[&#])caja=([0-9a-f]{64})(?:&|$)/)?.[1] || input.match(/^([0-9a-f]{64})$/)?.[1] || null;
  };
  let cashToken=tokenFrom(window.location?.hash);
  if(!cashToken){try{cashToken=tokenFrom(localStorage.getItem(ACCESS_STORE));}catch{}}
  if(cashToken){try{localStorage.setItem(ACCESS_STORE,cashToken);}catch{}}
  let snapshot = {events: [], sales: []}, ready = false, loading = false, error = "";
  let section = window.KebbaBookUI ? "resumen" : "caja", dialog = "", selectedWithdrawal = null, selectedSession = null;
  let selectedBook = null, bookDraft = null;
  let bookFilters = {from:"",to:"",query:"",person:"",kind:"",category:""};
  const bookById = id => (snapshot.book||[]).find(e=>e.id===id);
  let pending = null;
  try { pending = JSON.parse(sessionStorage.getItem(STORE) || "null"); } catch {}
  const eventById = id => snapshot.events.find(e => e.id === id);
  const requestId = () => globalThis.crypto?.randomUUID?.() || "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g,c=>{
    const n=globalThis.crypto?.getRandomValues?globalThis.crypto.getRandomValues(new Uint8Array(1))[0]&15:Math.floor(Math.random()*16);
    return (c==="x"?n:(n&3|8)).toString(16);
  });
  const eventsOf = (kind, relatedId) => snapshot.events.filter(e => e.kind === kind && (relatedId === undefined || e.related_id === relatedId));
  const closeOf = id => snapshot.events.find(e => e.kind === "close" && e.session_id === id);
  const sessions = () => eventsOf("open").sort((a,b) => b.created_at.localeCompare(a.created_at));
  const activeSession = () => sessions().find(e => !closeOf(e.id));
  const minor = value => Number(value || 0);
  const cashMoney = (value, currency) => (currency === "BRL" ? "R$ " : "$ ") + (minor(value) / 100).toLocaleString("es-UY", {minimumFractionDigits: 2, maximumFractionDigits: 2});
  const inputMoney = value => {
    const match = String(value ?? "").trim().replace(/\s/g, "").match(/^(\d{1,10})(?:[,.](\d{1,2}))?$/);
    if (!match) return null;
    return Number(match[1]) * 100 + Number((match[2] || "").padEnd(2,"0"));
  };
  const datetime = value => new Date(value).toLocaleString("es-UY",{dateStyle:"short",timeStyle:"short"});
  const mapPayment = method => ({"Débito":"Tarjeta","Crédito":"Tarjeta","Transferencia":"Otros","Otro":"Otros"}[method] || method || "Otros");
  const salesFor = session => {
    const start = Date.parse(session.created_at),end = Date.parse(closeOf(session.id)?.created_at || new Date().toISOString());
    return snapshot.sales.filter(item => Date.parse(item.sold_at) >= start && Date.parse(item.sold_at) <= end);
  };
  const salesTotals = session => {
    const result = {"Efectivo UYU":0,"Efectivo BRL":0,"PREX":0,"Pix":0,"Tarjeta":0,"Otros":0};
    for (const {sale} of salesFor(session)) {
      const parts=Array.isArray(sale.payments)&&sale.payments.length?sale.payments:[sale];
      for(const part of parts){
        const method=mapPayment(part.method||sale.payment),amount=minor(part.amount??sale.total);
        if(method==="Efectivo")result["Efectivo UYU"]+=amount*100;
        else if(method==="Efectivo BRL")result["Efectivo BRL"]+=minor(part.brlChargedMinor??sale.brlChargedMinor);
        else result[Object.prototype.hasOwnProperty.call(result,method)?method:"Otros"]+=amount*100;
      }
    }
    return result;
  };
  const movementTotal = (session, currency, kinds) => snapshot.events
    .filter(e => e.session_id === session.id && e.currency === currency && kinds.includes(e.kind))
    .reduce((sum,e) => sum + minor(e.amount_minor), 0);
  const expected = (session, currency) => {
    const sales = salesTotals(session);
    const initial = minor(session.detail[`opening_${currency.toLowerCase()}`]);
    const paid = sales[currency === "UYU" ? "Efectivo UYU" : "Efectivo BRL"];
    return initial + paid + movementTotal(session,currency,["income","return"])
      - movementTotal(session,currency,["withdrawal","expense"]);
  };
  const withdrawalBalance = withdrawal => {
    const spent = eventsOf("settlement",withdrawal.id).reduce((sum,e)=>sum+minor(e.amount_minor),0);
    const returned = eventsOf("return",withdrawal.id).reduce((sum,e)=>sum+minor(e.amount_minor),0);
    const writeoff = eventsOf("writeoff",withdrawal.id).reduce((sum,e)=>sum+minor(e.amount_minor),0);
    return {spent,returned,writeoff,pending:minor(withdrawal.amount_minor)-spent-returned-writeoff,
      status:writeoff ? "Cerrado con diferencia" : spent+returned === minor(withdrawal.amount_minor) ? "Rendido" : spent ? "Parcialmente rendido" : "Pendiente"};
  };
  const currentCount = session => {
    const close = closeOf(session.id);
    if (!close) return null;
    const correction = eventsOf("close_correction").filter(e=>e.session_id===session.id).at(-1);
    return {uyu:minor(correction?.detail.new_counted_uyu ?? close.detail.counted_uyu),
      brl:minor(correction?.detail.new_counted_brl ?? close.detail.counted_brl)};
  };
  function render() {
    if (!sharedMode) return `<div class="headline"><h1>Caja</h1></div><div class="empty">Abrí el enlace compartido de KEBBA para usar Caja en todos los dispositivos.</div>`;
    if (!cashToken) return `<div class="headline"><h1>Caja</h1></div><div class="cash-panel"><h2>Acceso para encargados</h2><p>La clave de pedidos permite atender mesas y Cocina. Para ver y manejar Caja necesitás una clave distinta, que te debe dar un encargado.</p><form id="cash-access-form" class="cash-access-form"><label class="cash-field" for="cash-access-input">Clave o enlace de Caja<input id="cash-access-input" name="access" type="text" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="Pegá la clave o el enlace completo" required></label><button class="primary cash-big" type="submit">ENTRAR A CAJA</button></form>${error?`<p class="storage-alert" role="alert">${safe(error)}</p>`:""}</div>`;
    if (loading && !ready) return `<div class="headline"><h1>Caja</h1></div><div class="empty">Leyendo la caja compartida…</div>`;
    if (error && !ready) return `<div class="headline"><h1>Caja</h1></div><div class="storage-alert"><strong>${safe(error)}</strong><button data-cash-action="refresh">REINTENTAR</button></div>`;
    const active = activeSession();
    const sections=window.KebbaBookUI?[["resumen","Resumen"],["caja","Jornada"],["registro","Registro"],["personas","Personas"],["retiros","Retiros"],["compras","Compras"]]:[["caja","Caja"],["retiros","Retiros"],["compras","Compras"]];
    const tabs = `<div class="cash-tabs" role="group" aria-label="Secciones de caja">${sections.map(([id,label])=>`<button data-cash-action="tab" data-tab="${id}" class="${section===id?"active":""}" aria-pressed="${section===id}">${label}</button>`).join("")}</div>`;
    const pendingNotice = pending ? `<div class="storage-alert"><strong>Hay una operación cuyo guardado no pudimos comprobar.</strong><button data-cash-action="retry">REINTENTAR EL MISMO GUARDADO</button><button data-cash-action="refresh">COMPROBAR</button></div>` : "";
    const status = error ? `<div class="storage-alert">${safe(error)} <button data-cash-action="refresh">REINTENTAR</button></div>` : "";
    const head = `<div class="headline"><h1>Caja</h1><div class="cash-actions cash-toolbar"><button class="small-button" data-cash-action="refresh">Actualizar</button><button class="small-button" data-cash-action="export" title="Descargar respaldo JSON de Caja">Respaldo</button><button class="small-button" data-cash-action="disconnect" ${pending?"disabled":""}>Salir de Caja</button></div></div>${pendingNotice}${status}${tabs}`;
    if(["resumen","registro","personas"].includes(section)&&window.KebbaBookUI){
      const notice=snapshot.finance_version!==1?'<div class="storage-alert">El registro ampliado todavía necesita activarse en la base compartida. Las ventas y jornadas existentes siguen disponibles.</div>':"";
      return head+notice+window.KebbaBookUI.render(section,snapshot,!!pending||snapshot.finance_version!==1,bookFilters,{active:!!active,uyu:active?expected(active,"UYU"):0,brl:active?expected(active,"BRL"):0});
    }
    if (section === "retiros") return head + renderWithdrawals(active);
    if (section === "compras") return head + renderPurchases();
    return head + renderOverview(active);
  }
  function renderOverview(active) {
    if (!active) return `<div class="cash-panel"><h2>No hay caja abierta</h2><p>Abrí la jornada con el efectivo que tenés al empezar. Las ventas anteriores a la apertura no se incluirán en esta caja.</p><button class="primary cash-big" data-cash-action="open-dialog" data-dialog="open" ${pending?"disabled":""}>ABRIR CAJA DE HOY</button></div>${sessions().map(renderClosed).join("")}`;
    const totals = salesTotals(active);
    const movements = snapshot.events.filter(e=>e.session_id===active.id && !["open","close"].includes(e.kind)).slice().reverse();
    return `<div class="cash-panel"><div class="cash-header"><div><h2>Jornada ${safe(active.detail.date)}</h2><p>Abierta ${datetime(active.created_at)}</p></div><span class="status ready">ABIERTA</span></div>
      <div class="cash-counters"><div><span>Efectivo esperado UYU</span><strong>${cashMoney(expected(active,"UYU"),"UYU")}</strong></div><div><span>Efectivo esperado BRL</span><strong>${cashMoney(expected(active,"BRL"),"BRL")}</strong></div></div>
      <div class="cash-actions"><button class="primary" data-cash-action="open-dialog" data-dialog="withdrawal" ${pending?"disabled":""}>NUEVO RETIRO</button><button data-cash-action="open-dialog" data-dialog="movement" ${pending?"disabled":""}>INGRESO O GASTO</button><button class="success" data-cash-action="open-dialog" data-dialog="close" ${pending?"disabled":""}>CERRAR CAJA</button></div></div>
      <h2 class="section-title">Ventas por medio de pago</h2><div class="cash-stats">${Object.entries(totals).map(([method,value])=>`<div class="cash-stat"><span>${safe(method)}</span><strong>${cashMoney(value,method==="Efectivo BRL"?"BRL":"UYU")}</strong></div>`).join("")}</div>
      <h2 class="section-title">Movimientos de esta caja</h2>${movements.length?`<div class="cash-list">${movements.map(e=>`<div class="cash-list-row"><span><strong>${safe(labelKind(e.kind))}</strong><small>${datetime(e.created_at)} · ${safe(e.detail.responsible||e.detail.supplier||"")}${e.detail.reason?" · "+safe(e.detail.reason):""}</small></span><b>${movementLabel(e)}</b></div>`).join("")}</div>`:'<div class="empty">Todavía no hay movimientos.</div>'}${sessions().filter(s=>s.id!==active.id).map(renderClosed).join("")}`;
  }
  function renderClosed(session) {
    const close = closeOf(session.id); if (!close) return "";
    const count = currentCount(session);
    const expectedUyu=expected(session,"UYU"),expectedBrl=expected(session,"BRL");
    const diffUyu = count.uyu - expectedUyu, diffBrl = count.brl - expectedBrl;
    return `<div class="cash-panel cash-closed"><div class="cash-header"><h2>Caja ${safe(session.detail.date)}</h2><span class="status free">CERRADA</span></div><p>Cerrada ${datetime(close.created_at)}</p><div class="cash-counters"><div><span>UYU esperado / contado / diferencia</span><strong>${cashMoney(expectedUyu,"UYU")} / ${cashMoney(count.uyu,"UYU")} / ${cashMoney(diffUyu,"UYU")}</strong></div><div><span>BRL esperado / contado / diferencia</span><strong>${cashMoney(expectedBrl,"BRL")} / ${cashMoney(count.brl,"BRL")} / ${cashMoney(diffBrl,"BRL")}</strong></div></div><button data-cash-action="correct" data-session="${session.id}" ${pending?"disabled":""}>CORREGIR CON MOTIVO</button></div>`;
  }
  function renderWithdrawals(active) {
    const withdrawals = eventsOf("withdrawal").slice().reverse();
    return `<div class="cash-actions"><button class="primary" data-cash-action="open-dialog" data-dialog="withdrawal" ${!active||pending?"disabled":""}>NUEVO RETIRO</button></div>${withdrawals.length?withdrawals.map(w=>{
      const b=withdrawalBalance(w),available=b.pending>0;
      return `<article class="cash-panel"><div class="cash-header"><h2>${safe(w.detail.responsible)} · ${cashMoney(w.amount_minor,w.currency)}</h2><span class="status ${b.status==="Rendido"?"ready":b.status==="Cerrado con diferencia"?"kitchen":"open"}">${safe(b.status.toUpperCase())}</span></div><p>${datetime(w.created_at)} · ${safe(w.detail.reason)}</p><div class="cash-stats"><div class="cash-stat">Facturas <strong>${cashMoney(b.spent,w.currency)}</strong></div><div class="cash-stat">Devuelto <strong>${cashMoney(b.returned,w.currency)}</strong></div><div class="cash-stat">Pendiente <strong>${cashMoney(b.pending,w.currency)}</strong></div></div>${w.detail.note?`<p class="note">${safe(w.detail.note)}</p>`:""}<div class="cash-actions">${available?`<button class="primary" data-cash-action="withdrawal-dialog" data-dialog="settlement" data-id="${w.id}" ${pending?"disabled":""}>RENDIR COMPRA</button><button data-cash-action="withdrawal-dialog" data-dialog="return" data-id="${w.id}" ${!active||pending?"disabled":""}>DEVOLVER DINERO</button><button data-cash-action="withdrawal-dialog" data-dialog="writeoff" data-id="${w.id}" ${pending?"disabled":""}>CERRAR DIFERENCIA</button>`:""}</div>${eventsOf("settlement",w.id).map(e=>`<p class="cash-document">${datetime(e.created_at)} · ${safe(e.detail.supplier)}${e.detail.document_number?" #"+safe(e.detail.document_number):""} · ${cashMoney(e.amount_minor,e.currency)}</p>`).join("")}</article>`;
    }).join(""):'<div class="empty">No hay retiros registrados.</div>'}`;
  }
  function renderPurchases() {
    const purchases = eventsOf("settlement").slice().reverse();
    return purchases.length?`<div class="cash-list">${purchases.map(e=>{const w=eventById(e.related_id);return `<div class="cash-list-row"><span><strong>${safe(e.detail.supplier)}</strong><small>${safe(e.detail.document_date)} · Comprobante ${safe(e.detail.document_number||"sin número")} · Retiro de ${safe(w?.detail.responsible||"—")}${e.detail.note?" · "+safe(e.detail.note):""}</small></span><b>${cashMoney(e.amount_minor,e.currency)}</b></div>`;}).join("")}</div>`:'<div class="empty">Todavía no se rindieron compras.</div>';
  }
  const labelKind = kind => ({income:"Ingreso",expense:"Gasto",withdrawal:"Retiro",settlement:"Factura rendida",return:"Devolución",writeoff:"Diferencia cerrada",close_correction:"Corrección"}[kind]||kind);
  const movementLabel = event => ["settlement","writeoff"].includes(event.kind) ? "No mueve efectivo" :
    (["income","return"].includes(event.kind) ? "+ " : "− ") + cashMoney(event.amount_minor,event.currency);
  async function refresh() {
    if (!sharedMode || !cashToken || loading) return;
    const token=cashToken;
    loading=true; error=""; if(view==="cash") renderApp();
    try {
      const result=await sharedRpc("kebba_cash_read",{access_token:token});
      if(token!==cashToken)return;
      if(!Array.isArray(result.events)||!Array.isArray(result.sales))throw Error("La respuesta de Caja es inválida.");
      snapshot=result;ready=true;
      if(pending && (eventById(pending.request_id)||bookById(pending.request_id))){pending=null;try{sessionStorage.removeItem(STORE);}catch{}toast("La operación estaba guardada.");}
    } catch(e) {
      if(token!==cashToken)return;
      if(e.message.includes("Clave de Caja inválida")){forgetAccess();error="La clave de Caja no es válida. Pedí el enlace de encargados y probá de nuevo.";}
      else error=e.message.includes("404")?"Caja todavía no está activada en la base compartida.":"No pudimos leer Caja: "+e.message;
    }
    finally { loading=false; if(view==="cash") renderApp();if(cashToken&&token!==cashToken)void refresh(); }
  }
  function renderApp(){window.render();}
  function forgetAccess(){
    cashToken=null;ready=false;snapshot={events:[],sales:[]};
    try{localStorage.removeItem(ACCESS_STORE);}catch{}
    if(window.location?.hash?.includes("caja=")){
      const parts=new URLSearchParams(window.location.hash.slice(1));parts.delete("caja");
      window.history?.replaceState(null,"",window.location.pathname+window.location.search+(parts.size?"#"+parts:""));
    }
  }
  function connectAccess(form){
    const token=tokenFrom(new FormData(form).get("access"));
    if(!token){error="Pegá una clave de Caja válida o el enlace completo de encargados.";renderApp();return;}
    cashToken=token;ready=false;error="";
    try{localStorage.setItem(ACCESS_STORE,token);}catch{}
    void refresh();
  }
  async function command(action,payload) {
    if(!sharedMode||!cashToken||!ready||!canEdit()||pending)return;
    pending={request_id:requestId(),action,payload};
    try{sessionStorage.setItem(STORE,JSON.stringify(pending));}catch{}renderApp();
    await retry();
  }
  async function exportLedger(){
    if(!ready)return;
    if(await download(JSON.stringify({...snapshot,exported_at:new Date().toISOString()},null,2),`kebba-caja-${dayKey(now())}.json`,"application/json"))toast("Registro de Caja descargado. Guardalo en un lugar seguro.");
  }
  async function retry() {
    if(!pending)return;
    const item=pending;
    try {
      await sharedRpc(item.action==="book"?"kebba_book_command":"kebba_cash_command",item.action==="book"?{access_token:cashToken,request_id:item.request_id,payload:item.payload}:{access_token:cashToken,...item});
      pending=null;try{sessionStorage.removeItem(STORE);}catch{}closeDialog();
      await refresh();toast("Movimiento de Caja guardado.");
    } catch(e) {
      await refresh();
      if(!pending){closeDialog();renderApp();}
      else if(pending&&ready&&!error&&e.status>=400&&e.status<500){pending=null;try{sessionStorage.removeItem(STORE);}catch{}if(["close","close_correction"].includes(item.action))closeDialog();toast(e.message,true);renderApp();}
      else if(pending){error="No pudimos confirmar el guardado. Reintentá el mismo movimiento para evitar duplicados. "+e.message;renderApp();}
    }
  }
  function openDialog(type,withdrawalId=null,sessionId=null) {
    if(!ready||pending)return;
    dialog=type;selectedWithdrawal=withdrawalId;selectedSession=sessionId;renderDialog();
  }
  function closeDialog(){dialog="";selectedWithdrawal=null;selectedSession=null;selectedBook=null;bookDraft=null;document.querySelector("#cash-modal-root").innerHTML="";document.querySelector(".app").inert=false;}
  function field(id,label,type="text",extra="",required=true) {return `<label class="cash-field">${label}<input name="${id}" id="cash-${id}" type="${type}" ${extra} ${required?"required":""}></label>`;}
  function amountField(label="Importe") {return field("amount",label,"text",'inputmode="decimal" placeholder="Ej.: 1250 o 1250,50"');}
  function currencyField(){return `<label class="cash-field">Moneda<select name="currency"><option value="UYU">Pesos uruguayos (UYU)</option><option value="BRL">Reales (BRL)</option></select></label>`;}
  function renderDialog() {
    const root=document.querySelector("#cash-modal-root");if(!root)return;
    if(!dialog){root.innerHTML="";return;}
    const withdrawal=eventById(selectedWithdrawal),session=selectedSession?eventById(selectedSession):activeSession();
    let title="",body="";
    if(dialog==="open") { title="Abrir caja"; body=`<p>Contá el efectivo que hay ahora en cada moneda.</p><label class="cash-field">Fecha<input name="date" type="date" value="${dayKey(now())}" readonly></label>${field("opening_uyu","Saldo inicial UYU","text",'inputmode="decimal" value="0"')}${field("opening_brl","Saldo inicial BRL","text",'inputmode="decimal" value="0"')}`; }
    if(dialog==="withdrawal") { title="Nuevo retiro"; body=`${currencyField()}${amountField()}${field("responsible","Responsable")}${field("reason","Motivo")}${field("note","Observaciones (opcional)","text","",false)}`; }
    if(dialog==="movement") { title="Ingreso o gasto de efectivo"; body=`<label class="cash-field">Tipo<select name="kind"><option value="income">Ingreso extraordinario</option><option value="expense">Gasto directo</option>${snapshot.finance_version===1?'<option value="contribution">Aporte de una persona a la caja</option><option value="reimbursement">Reintegro de caja a una persona</option>':""}</select></label>${currencyField()}${amountField()}${field("responsible","Persona que aporta, recibe o registra")}${field("reason","Motivo")}${window.KebbaBook?`<label class="cash-field">Categoría<select name="category">${Object.entries(window.KebbaBook.categories).map(([k,v])=>`<option value="${k}" ${k==="unclassified"?"selected":""}>${safe(v)}</option>`).join("")}</select></label>`:""}${field("note","Observaciones (opcional)","text","",false)}`; }
    if(dialog==="settlement" && withdrawal) { title="Rendir compra"; body=`<p>Retiro de ${safe(withdrawal.detail.responsible)} · Pendiente ${cashMoney(withdrawalBalance(withdrawal).pending,withdrawal.currency)}</p>${field("supplier","Proveedor")}${field("document_date","Fecha del comprobante","date",`value="${dayKey(now())}"`)}${field("document_number","Número de factura o ticket (opcional)","text","",false)}${amountField("Total del comprobante")}${window.KebbaBook?`<label class="cash-field">Categoría<select name="category">${Object.entries(window.KebbaBook.categories).map(([k,v])=>`<option value="${k}" ${k==="unclassified"?"selected":""}>${safe(v)}</option>`).join("")}</select></label>`:""}${field("note","Detalle (opcional)","text","",false)}`; }
    if(dialog==="return" && withdrawal) { title="Devolver dinero a caja"; body=`<p>Retiro de ${safe(withdrawal.detail.responsible)} · Pendiente ${cashMoney(withdrawalBalance(withdrawal).pending,withdrawal.currency)}</p>${amountField("Dinero devuelto")}${field("responsible","Quién devuelve")}${field("note","Observaciones (opcional)","text","",false)}`; }
    if(dialog==="writeoff" && withdrawal) { title="Cerrar con diferencia"; body=`<p>Quedarán ${cashMoney(withdrawalBalance(withdrawal).pending,withdrawal.currency)} sin comprobante ni devolución. Esta diferencia quedará visible en el historial.</p>${field("reason","Motivo de la diferencia")}`; }
    if(dialog==="close" && session) { title="Cerrar caja"; body=`<p>Esperado: <strong>${cashMoney(expected(session,"UYU"),"UYU")}</strong> y <strong>${cashMoney(expected(session,"BRL"),"BRL")}</strong>. Contá el efectivo físico antes de confirmar.</p>${field("counted_uyu","Efectivo contado UYU","text",'inputmode="decimal"')}${field("counted_brl","Efectivo contado BRL","text",'inputmode="decimal"')}`; }
    if(dialog==="correct" && session) { title="Corregir cierre"; const count=currentCount(session);body=`<p>El cierre original no se borra. La corrección guardará el valor anterior, el nuevo y el motivo.</p>${field("counted_uyu","Nuevo contado UYU","text",`inputmode="decimal" value="${(count.uyu/100).toFixed(2)}"`)}${field("counted_brl","Nuevo contado BRL","text",`inputmode="decimal" value="${(count.brl/100).toFixed(2)}"`)}${field("reason","Motivo de la corrección")}`; }
    if(dialog==="book"){
      title=selectedBook?"Corregir registro":"Registrar compra o aporte";
      body=window.KebbaBookUI.form(bookById(selectedBook)||{},bookDraft||{});
      const names=[...new Set((snapshot.book||[]).flatMap(e=>[e.person,e.recipient]).filter(Boolean))];
      body+=`<datalist id="cash-person-list">${names.map(n=>`<option value="${safe(n)}">`).join("")}</datalist>`;
    }
    if(dialog==="book-void"){title="Anular registro";const entry=bookById(selectedBook);body=`<p>${safe(entry?.description)}. Se conservará el original y el motivo; dejará de sumarse en los saldos.</p>${field("correction_reason","Motivo de anulación","text",'minlength="5" maxlength="500"')}`;}
    root.innerHTML=`<div class="modal-backdrop"><div class="modal cash-modal" role="dialog" aria-modal="true" aria-labelledby="cash-dialog-title" tabindex="-1"><h2 id="cash-dialog-title">${title}</h2><form id="cash-form">${body}<div class="modal-actions"><button type="button" data-cash-action="cancel-dialog">VOLVER</button><button class="success" type="submit">CONFIRMAR</button></div></form></div></div>`;
    document.querySelector(".app").inert=true;root.querySelector(".modal")?.focus();
  }
  async function submit(form) {
    const values=Object.fromEntries(new FormData(form));
    const parse=(name,zero=false)=>{const value=inputMoney(values[name]);if(value===null||(!zero&&value<=0))throw Error(`Ingresá un importe válido en ${name.replaceAll("_"," ")}.`);return value;};
    try {
      let action=dialog,payload={};
      if(dialog==="open") payload={date:values.date,opening_uyu:parse("opening_uyu",true),opening_brl:parse("opening_brl",true)};
      if(dialog==="withdrawal"||dialog==="movement"){
        action=dialog==="movement"?({contribution:"income",reimbursement:"expense"}[values.kind]||values.kind):dialog;
        payload={currency:values.currency,amount_minor:parse("amount"),responsible:values.responsible?.trim(),reason:values.reason?.trim(),note:values.note?.trim()||"",funding_type:values.kind==="contribution"?"contribution":values.kind==="reimbursement"?"reimbursement":"operation",category:values.category||"unclassified"};
      }
      if(dialog==="book"){
        if(snapshot.finance_version!==1)throw Error("El registro ampliado todavía no está activado.");
        action="book";payload={...values,amount_minor:values.kind==="in_kind"&&!String(values.amount).trim()?null:parse("amount")};delete payload.amount;
        if(!window.KebbaBookUI.entryTypes[payload.kind])throw Error("Elegí un tipo de movimiento.");
        if(!/^\d{4}-\d{2}-\d{2}$/.test(payload.occurred_on)||payload.occurred_on>window.KebbaBook.localDay(new Date()))throw Error("Ingresá una fecha real, no futura.");
        if(payload.kind==="partner_transfer"&&window.KebbaBook.normalName(payload.person)===window.KebbaBook.normalName(payload.recipient))throw Error("Elegí otra persona para recibir el dinero.");
        if(["business_expense","reimbursement"].includes(payload.kind)&&!payload.payment_method)throw Error("Indicá cómo se pagó fuera de caja.");
        if(selectedBook)payload.supersedes=selectedBook;
        const similar=window.KebbaBook.activeEntries(snapshot.book).some(e=>e.id!==selectedBook&&e.kind===payload.kind&&e.occurred_on===payload.occurred_on&&e.currency===payload.currency&&e.amount_minor===payload.amount_minor&&window.KebbaBook.normalName(e.person)===window.KebbaBook.normalName(payload.person)&&e.description.toLowerCase()===payload.description.toLowerCase());
        if(similar&&!confirm("Hay un registro con la misma fecha, persona, concepto e importe. ¿Es otro movimiento distinto?"))return;
      }
      if(dialog==="book-void"){action="book";payload={kind:"void",supersedes:selectedBook,correction_reason:values.correction_reason};}
      if(dialog==="settlement") payload={withdrawal_id:selectedWithdrawal,supplier:values.supplier?.trim(),document_date:values.document_date,document_number:values.document_number?.trim()||"",amount_minor:parse("amount"),category:values.category||"unclassified",note:values.note?.trim()||""};
      if(dialog==="return") payload={withdrawal_id:selectedWithdrawal,amount_minor:parse("amount"),responsible:values.responsible?.trim(),note:values.note?.trim()||""};
      if(dialog==="writeoff") payload={withdrawal_id:selectedWithdrawal,reason:values.reason?.trim()};
      if(dialog==="close"||dialog==="correct") {action=dialog==="correct"?"close_correction":"close";payload={counted_uyu:parse("counted_uyu",true),counted_brl:parse("counted_brl",true),...(dialog==="correct"?{session_id:selectedSession,reason:values.reason?.trim(),previous_counted_uyu:currentCount(eventById(selectedSession)).uyu,previous_counted_brl:currentCount(eventById(selectedSession)).brl}:{expected_uyu:expected(activeSession(),"UYU"),expected_brl:expected(activeSession(),"BRL")})};}
      if(dialog==="settlement"&&!payload.document_number){
        const duplicate=eventsOf("settlement").some(e=>e.detail.supplier?.toLowerCase()===payload.supplier?.toLowerCase()&&e.detail.document_date===payload.document_date&&minor(e.amount_minor)===payload.amount_minor);
        if(duplicate&&!confirm("Ya existe un comprobante del mismo proveedor, fecha e importe. ¿Confirmás que es otro ticket?"))return;
      }
      if(dialog==="close"&&(sharedPending||sharedWriting||readBlocked))throw Error("Esperá a que todos los pedidos aparezcan como sincronizados antes de cerrar la caja.");
      if(dialog==="close"&&!confirm("¿Confirmás el cierre de caja con los importes contados?"))return;
      await command(action,payload);
    } catch(e) {toast(e.message,true);}
  }
  document.addEventListener("click",event=>{
    const button=event.target.closest("[data-cash-action]");if(!button||button.disabled)return;
    const action=button.dataset.cashAction;
    if(action==="tab"){section=button.dataset.tab;renderApp();}
    else if(action==="refresh")void refresh();
    else if(action==="retry")void retry();
    else if(action==="export")void exportLedger();
    else if(action==="disconnect"){forgetAccess();error="";renderApp();}
    else if(action==="open-dialog")openDialog(button.dataset.dialog);
    else if(action==="withdrawal-dialog")openDialog(button.dataset.dialog,button.dataset.id);
    else if(action==="correct")openDialog("correct",null,button.dataset.session);
    else if(action==="book-new"){selectedBook=null;bookDraft=null;openDialog("book");}
    else if(action==="book-edit"||action==="book-void"){selectedBook=button.dataset.id;bookDraft=null;openDialog(action==="book-edit"?"book":"book-void");}
    else if(action==="book-person"){bookFilters={from:"",to:"",query:"",person:button.dataset.person,kind:"",category:""};section="registro";renderApp();}
    else if(action==="book-period"){const today=window.KebbaBook.localDay(new Date());bookFilters={from:button.dataset.period==="today"?today:button.dataset.period==="month"?today.slice(0,7)+"-01":"",to:button.dataset.period==="all"?"":today,query:"",person:"",kind:"",category:""};renderApp();}
    else if(action==="book-csv")void download(window.KebbaBook.csv(window.KebbaBook.filter(window.KebbaBook.journal(snapshot),bookFilters)),`kebba-registro-${dayKey(now())}.csv`,"text/csv;charset=utf-8");
    else if(action==="cancel-dialog")closeDialog();
  });
  document.addEventListener("submit",event=>{
    if(event.target.id==="cash-form"){event.preventDefault();void submit(event.target);}
    if(event.target.id==="cash-access-form"){event.preventDefault();connectAccess(event.target);}
    if(event.target.id==="cash-book-filter"){event.preventDefault();const f=Object.fromEntries(new FormData(event.target));if(f.from&&f.to&&f.from>f.to){toast("La fecha desde debe ser anterior a hasta.",true);return;}bookFilters={...bookFilters,...f};renderApp();}
  });
  document.addEventListener("change",event=>{if(dialog==="book"&&event.target.name==="kind"){bookDraft=Object.fromEntries(new FormData(event.target.form));renderDialog();}});
  document.addEventListener("keydown",event=>{if(dialog&&event.key==="Escape"){event.preventDefault();closeDialog();}});
  window.KebbaCash={render,refresh,closeDialog,hasDialog:()=>!!dialog,syncDialog:()=>{if(dialog)document.querySelector(".app").inert=true;}};
})();
