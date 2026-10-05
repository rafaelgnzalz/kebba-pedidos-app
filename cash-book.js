/* Cálculos del registro de gestión. Importes enteros en centésimos. */
(function(root,factory){const api=factory();if(typeof module==="object"&&module.exports)module.exports=api;else root.KebbaBook=api;})(typeof window!=="undefined"?window:globalThis,()=>{
  "use strict";
  const kinds={personal_payment:"Compra pagada por una persona",partner_transfer:"Dinero entre personas",business_contribution:"Dinero aportado a Kebba",reimbursement:"Reintegro de Kebba a una persona",business_expense:"Gasto pagado fuera de caja",in_kind:"Aporte en bienes",void:"Registro anulado",sale:"Venta",expense:"Gasto de caja",settlement:"Compra rendida",income:"Ingreso de caja",withdrawal:"Retiro para compras",return:"Dinero devuelto a caja",writeoff:"Diferencia de retiro"};
  const categories={equipment:"Equipamiento",renovation:"Reformas",stock:"Mercadería",rent:"Alquiler",services:"Servicios",staff:"Personal",tax:"Impuestos y tasas",marketing:"Publicidad e impresión",change:"Fondo para cambio",other:"Otros",unclassified:"Por clasificar"};
  const amount=x=>Number(x||0);
  const activeEntries=entries=>{
    const replaced=new Set((entries||[]).map(e=>e.supersedes).filter(Boolean));
    return (entries||[]).filter(e=>!replaced.has(e.id)&&e.kind!=="void");
  };
  const localDay=value=>{
    if(/^\d{4}-\d{2}-\d{2}$/.test(String(value)))return value;
    const d=new Date(value);if(!Number.isFinite(d.getTime()))return "";
    const parts=new Intl.DateTimeFormat("en-US",{timeZone:"America/Montevideo",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(d);
    const get=t=>parts.find(p=>p.type===t).value;return `${get("year")}-${get("month")}-${get("day")}`;
  };
  const normalName=name=>String(name||"").trim().replace(/\s+/g," ").toLocaleUpperCase("es-UY");
  const canonical=e=>({...e,source:"book",date:e.occurred_on,amount_minor:e.amount_minor===null?null:amount(e.amount_minor),person:normalName(e.person),category:e.category||"other"});
  function journal(snapshot){
    const originals=new Map((snapshot.book||[]).map(e=>[e.id,e]));
    const book=activeEntries(snapshot.book).map(e=>{
      let ancestor=e;const seen=new Set();
      while(!ancestor.source_key&&ancestor.supersedes&&!seen.has(ancestor.id)){
        seen.add(ancestor.id);const previous=originals.get(ancestor.supersedes);if(!previous)break;ancestor=previous;
      }
      return canonical({...e,source_key:ancestor.source_key||e.source_key,source_detail:ancestor.source_detail||e.source_detail});
    });
    const events=(snapshot.events||[]).filter(e=>["expense","income","settlement","withdrawal","return","writeoff"].includes(e.kind)).map(e=>({...e,kind:e.detail.funding_type==="contribution"?"business_contribution":e.detail.funding_type==="reimbursement"?"reimbursement":e.kind,source:"cash",date:e.kind==="settlement"?(e.detail.document_date||localDay(e.created_at)):localDay(e.created_at),person:normalName(e.detail.responsible||(snapshot.events||[]).find(w=>w.id===e.related_id)?.detail.responsible),supplier:e.detail.supplier||"",description:e.detail.reason||(e.kind==="settlement"?"Compra rendida":"")||kinds[e.kind],category:e.detail.category||"unclassified",note:e.detail.note||"",document_number:e.detail.document_number||"",payment_method:e.kind==="settlement"?"Retiro rendido":"Efectivo de caja"}));
    const sales=(snapshot.sales||[]).map((e,i)=>({id:`sale-${e.sale.number||i}-${e.sale.openedAt||e.sold_at}`,source:"sales",kind:"sale",date:localDay(e.sold_at),created_at:e.sold_at,description:`Venta #${e.sale.number||"—"}${e.sale.label?" · "+e.sale.label:""}${e.sale.saleType==="staff"&&e.sale.name?" · "+e.sale.name:""}`,person:"",currency:"UYU",amount_minor:Math.round(amount(e.sale.total)*100),category:"sales",payment_method:e.sale.payment||"",note:e.sale.saleType==="staff"?(e.sale.lines||[]).map(line=>line.note||"").join("\n"):"",sale:e.sale}));
    return [...book,...events,...sales].sort((a,b)=>b.date.localeCompare(a.date)||String(b.created_at||"").localeCompare(String(a.created_at||""))||a.id.localeCompare(b.id));
  }
  const isExpense=e=>["personal_payment","business_expense","expense","settlement"].includes(e.kind);
  function filter(entries,{from="",to="",query="",person="",kind="",category=""}={}){
    const q=query.trim().toLocaleLowerCase("es-UY");
    return entries.filter(e=>(!from||e.date>=from)&&(!to||e.date<=to)&&(!person||normalName(e.person)===normalName(person)||normalName(e.recipient)===normalName(person))&&(!kind||e.kind===kind)&&(!category||e.category===category)&&(!q||[e.description,e.person,e.recipient,e.supplier,e.note,e.document_number,kinds[e.kind],categories[e.category]].join(" ").toLocaleLowerCase("es-UY").includes(q)));
  }
  function summary(entries){
    const currencies={UYU:{sales:0,spending:0,personal:0,contributions:0},BRL:{sales:0,spending:0,personal:0,contributions:0}};
    const byCategory={},payments={};let salesCount=0,unvalued=0,unclassified=0;
    for(const e of entries){
      const c=currencies[e.currency];if(!c)continue;
      const n=amount(e.amount_minor);
      if(e.kind==="sale"){c.sales+=n;salesCount++;const sale=e.sale||{};for(const p of (Array.isArray(sale.payments)&&sale.payments.length?sale.payments:[sale])){const method=({Efectivo:"Efectivo UYU",Débito:"Tarjeta",Crédito:"Tarjeta",Transferencia:"Otros",Otro:"Otros"}[p.method||sale.payment]||p.method||sale.payment||"Otros");payments[method]??={uyu:0,brl:0};payments[method].uyu+=Math.round(amount(p.amount??sale.total)*100);payments[method].brl+=method==="Efectivo BRL"?amount(p.brlChargedMinor??sale.brlChargedMinor):method==="Pix"?Math.round(amount(p.pixBrl??sale.pixBrl)*100):0;}}
      if(isExpense(e)){c.spending+=n;const key=`${e.currency}:${e.category}`;byCategory[key]=(byCategory[key]||0)+n;if(e.category==="unclassified")unclassified++;}
      if(e.kind==="personal_payment")c.personal+=n;
      if(e.kind==="business_contribution")c.contributions+=n;
      if(e.kind==="in_kind"&&e.amount_minor===null)unvalued++;
    }
    return {currencies,byCategory,payments,salesCount,unvalued,unclassified};
  }
  function people(entries){
    const result={};
    function bucket(name,currency){const key=normalName(name);if(!key)return null;result[key]??={name:key,UYU:{paid:0,sent:0,received:0,contributed:0,reimbursed:0,net:0,inKind:0,unvalued:0},BRL:{paid:0,sent:0,received:0,contributed:0,reimbursed:0,net:0,inKind:0,unvalued:0}};return result[key][currency];}
    for(const e of activeEntries(entries)){
      if(!["personal_payment","business_contribution","reimbursement","partner_transfer","in_kind"].includes(e.kind))continue;
      const c=bucket(e.person,e.currency);if(!c)continue;const n=amount(e.amount_minor);
      if(e.kind==="personal_payment")c.paid+=n;
      if(e.kind==="business_contribution")c.contributed+=n;
      if(e.kind==="reimbursement")c.reimbursed+=n;
      if(e.kind==="partner_transfer"){c.sent+=n;const receiver=bucket(e.recipient,e.currency);if(receiver)receiver.received+=n;}
      if(e.kind==="in_kind"){if(e.amount_minor===null)c.unvalued++;else c.inKind+=n;}
    }
    for(const p of Object.values(result))for(const currency of ["UYU","BRL"]){const c=p[currency];c.net=c.paid+c.contributed+c.sent-c.received-c.reimbursed;}
    return Object.values(result).sort((a,b)=>a.name.localeCompare(b.name,"es"));
  }
  const csvCell=value=>{let s=String(value??"");if(/^[\s]*[=+@-]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};
  function csv(entries){
    const headers=["Fecha","Tipo","Persona","Destinatario","Concepto","Categoría","Moneda","Importe","Proveedor","Medio de pago","Comprobante","Notas","Origen","Referencia de origen","Registrado","ID"];
    return "\uFEFF"+[headers,...entries.map(e=>[e.date,kinds[e.kind]||e.kind,e.person,e.recipient,e.description,categories[e.category]||e.category,e.currency,e.amount_minor===null?"Pendiente de valorar":(amount(e.amount_minor)/100).toFixed(2).replace(".",","),e.supplier,e.payment_method,e.document_number,e.note,e.source,e.source_key,e.created_at,e.id])].map(row=>row.map(csvCell).join(";")).join("\r\n");
  }
  return {kinds,categories,activeEntries,localDay,normalName,journal,isExpense,filter,summary,people,csv};
});
