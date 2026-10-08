/** Puente de Caja Kebba. Configuración secreta únicamente en Propiedades del script. */
function kebbaConfig_() {
  const p=PropertiesService.getScriptProperties().getProperties();
  for(const key of ['KEBBA_URL','KEBBA_PUBLIC_KEY','KEBBA_BRIDGE_TOKEN','KEBBA_SHEET_ID','KEBBA_WAKE_TOKEN'])if(!p[key])throw Error('Falta configurar '+key);
  if(!/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(p.KEBBA_URL))throw Error('Destino Kebba inválido');
  return p;
}
function kebbaRpc_(name,body,config) {
  const response=UrlFetchApp.fetch(config.KEBBA_URL+'/rest/v1/rpc/'+name,{method:'post',contentType:'application/json',headers:{apikey:config.KEBBA_PUBLIC_KEY},payload:JSON.stringify(body),muteHttpExceptions:true});
  if(response.getResponseCode()!==200)throw Error('Kebba no confirmó '+name+' ('+response.getResponseCode()+')');
  return JSON.parse(response.getContentText());
}
function kebbaTexto_(value){const s=String(value??'');return /^[=+@-]/.test(s)?"'"+s:s;}
function kebbaFilas_(turn) {
  if(!turn.id||!turn.code||!Array.isArray(turn.payment_totals))throw Error('Cierre inválido');
  const closed=new Date(turn.closed_at),opened=new Date(turn.opened_at);
  if(!Number.isFinite(closed.getTime())||!Number.isFinite(opened.getTime()))throw Error('Fecha de turno inválida');
  const day=new Date(Utilities.formatDate(closed,'America/Montevideo','yyyy-MM-dd')+'T00:00:00-03:00');
  const methods=new Set();
  return turn.payment_totals.map(p=>{
    if(!['Efectivo UYU','Efectivo BRL','Pix','PREX','Transferencia','Débito','Crédito','Otro'].includes(p.method))throw Error('Medio de pago desconocido');
    if(p.currency!==(['Pix','Efectivo BRL'].includes(p.method)?'BRL':'UYU'))throw Error('La moneda no coincide con el medio de pago');
    if(methods.has(p.method))throw Error('Medio de pago repetido');methods.add(p.method);
    if(!['UYU','BRL'].includes(p.currency)||p.amountMinor===null||!Number.isSafeInteger(Number(p.amountMinor))||Number(p.amountMinor)<0||Number(p.missingCount)>0)throw Error('Falta el importe cobrado en '+p.method);
    if(!Number.isFinite(Number(p.amountUYU))||Number(p.amountUYU)<0)throw Error('Venta UYU inválida');
    return [day,kebbaTexto_(turn.code),opened,closed,kebbaTexto_(p.method),p.currency,Number(p.amountMinor)/100,Number(p.amountUYU),Number(p.paymentsCount),'',turn.id+':'+p.method];
  });
}
function kebbaCuentaFormula_(row,separator) {
  const formula='=IF(E'+row+'="","",IF(COUNTIFS($N$7:$N$14,E'+row+')=0,"Sin asignar",IF(F'+row+'<>INDEX($P$7:$P$14,MATCH(E'+row+',$N$7:$N$14,0)),"Sin asignar",INDEX($O$7:$O$14,MATCH(E'+row+',$N$7:$N$14,0)))))';
  return separator===';'?formula.replace(/,/g,';'):formula;
}
function kebbaIndices_(sheet) {
  const last=Math.max(6,sheet.getLastRow()),rows=last>=7?sheet.getRange(7,1,last-6,11).getValues():[],index=new Map();let lastData=6;
  rows.forEach((row,i)=>{if(!row[10])return;if(index.has(String(row[10])))throw Error('ID de envío duplicado en la planilla');index.set(String(row[10]),{row:row,number:i+7});lastData=i+7;});
  return {index:index,lastData:lastData};
}
function kebbaComparar_(actual,expected) {
  for(let i=0;i<11;i++){
    if(i===9)continue;
    if([0,2,3].includes(i)){if(!(actual[i] instanceof Date)||actual[i].getTime()!==expected[i].getTime())throw Error('Fecha del cierre modificada en la planilla');}
    else if([6,7,8].includes(i)){if(typeof actual[i]!=='number'||Math.abs(actual[i]-expected[i])>0.0000001)throw Error('Importe del cierre modificado en la planilla');}
    else if(String(actual[i])!==String(expected[i]))throw Error('Datos del cierre modificados en la planilla');
  }
}
function kebbaCapacidad_(book,sheet,lastData) {
  const max=sheet.getMaxRows();if(lastData>max)sheet.insertRowsAfter(max,lastData-max+100);
  // Se extiende el rango de saldos cuando se supera la capacidad inicial de mil filas.
  const limit=Math.max(1006,lastData),caja=book.getSheetByName('Caja');
  for(let row=5;row<=8;row++){
    const cell=caja.getRange(row,3),formula=cell.getFormula();
    if(!/(?:'Turnos'|Turnos)!/.test(formula))throw Error('Falta la fórmula de Caja conectada a Turnos');
    cell.setFormula(formula.replace(/((?:'Turnos'|Turnos)!\$[GJA]\$7:\$[GJA]\$)\d+/g,'$1'+limit));
  }
  const separator=caja.getRange(5,3).getFormula().includes(';')?';':',';
  const formula='=SUMIFS($H$7:$H$'+limit+',$J$7:$J$'+limit+',"Sin asignar",$A$7:$A$'+limit+',">="&\'Caja\'!$E$11)';
  sheet.getRange('O19').setFormula(separator===';'?formula.replace(/,/g,';'):formula);
}
function kebbaSync_() {
  const lock=LockService.getScriptLock();if(!lock.tryLock(1000))return {ok:false,pending:true};
  try{
    const config=kebbaConfig_(),batch=kebbaRpc_('kebba_shift_excel_read',{bridge_token:config.KEBBA_BRIDGE_TOKEN},config);
    if(batch.spreadsheetId!==config.KEBBA_SHEET_ID)throw Error('La planilla de destino no coincide');
    const book=SpreadsheetApp.openById(config.KEBBA_SHEET_ID),sheet=book.getSheetByName('Turnos');
    if(!sheet||!book.getSheetByName('Caja'))throw Error('Falta la planilla de Caja con Turnos');
    const separator=book.getSheetByName('Caja').getRange(5,3).getFormula().includes(';')?';':',';
    const header=sheet.getRange(6,1,1,11).getValues()[0];
    if(header[0]!=='Fecha de cierre'||header[4]!=='Medio de pago'||header[10]!=='ID de envío')throw Error('Cambió la estructura de Turnos');
    let sent=0;
    for(const turn of batch.turns){
      const expected=kebbaFilas_(turn);let seen=kebbaIndices_(sheet),missing=[];
      for(const row of expected){const found=seen.index.get(row[10]);if(found)kebbaComparar_(found.row,row);else missing.push(row);}
      if(missing.length){
        const first=seen.lastData+1,last=first+missing.length-1;kebbaCapacidad_(book,sheet,last);
        sheet.getRange(first,1,missing.length,11).setValues(missing);
        sheet.getRange(first,10,missing.length,1).setFormulas(missing.map((_,i)=>[kebbaCuentaFormula_(first+i,separator)]));
        sheet.getRange(first,1,missing.length,1).setNumberFormat('dd/mm/yyyy');sheet.getRange(first,3,missing.length,2).setNumberFormat('dd/mm/yyyy hh:mm');sheet.getRange(first,7,missing.length,2).setNumberFormat('#,##0.00');
      }
      SpreadsheetApp.flush();seen=kebbaIndices_(sheet);
      for(const row of expected){
        const found=seen.index.get(row[10]);if(!found)throw Error('Falta una fila del cierre');kebbaComparar_(found.row,row);
        const cell=sheet.getRange(found.number,10),formula=kebbaCuentaFormula_(found.number,separator);
        if(cell.getFormula()!==formula)cell.setFormula(formula);
      }
      SpreadsheetApp.flush();
      for(const row of expected){const found=seen.index.get(row[10]);if(sheet.getRange(found.number,10).getFormula()!==kebbaCuentaFormula_(found.number,separator))throw Error('Falta actualizar la cuenta del cierre');}
      kebbaRpc_('kebba_shift_excel_ack',{bridge_token:config.KEBBA_BRIDGE_TOKEN,target_id:turn.id,spreadsheet_id:config.KEBBA_SHEET_ID,row_ids:expected.map(row=>row[10]).sort()},config);sent++;
    }
    PropertiesService.getScriptProperties().setProperty('KEBBA_LAST_OK',new Date().toISOString());
    return {ok:true,sent:sent};
  }finally{lock.releaseLock();}
}
function sincronizarKebba(){return kebbaSync_();}
function instalarKebba(){
  const c=kebbaConfig_(),book=SpreadsheetApp.openById(c.KEBBA_SHEET_ID);book.setSpreadsheetTimeZone('America/Montevideo');
  const existing=ScriptApp.getProjectTriggers().filter(t=>t.getHandlerFunction()==='sincronizarKebba');
  if(!existing.length)ScriptApp.newTrigger('sincronizarKebba').timeBased().everyMinutes(1).create();
  return sincronizarKebba();
}
function doPost(e){
  const config=kebbaConfig_(),body=JSON.parse(e?.postData?.contents||'{}');
  if(body.wakeToken!==config.KEBBA_WAKE_TOKEN)return ContentService.createTextOutput('{"ok":false}').setMimeType(ContentService.MimeType.JSON);
  try{return ContentService.createTextOutput(JSON.stringify(kebbaSync_())).setMimeType(ContentService.MimeType.JSON);}
  catch(error){PropertiesService.getScriptProperties().setProperty('KEBBA_LAST_ERROR',new Date().toISOString()+': '+error.message);return ContentService.createTextOutput('{"ok":false,"pending":true}').setMimeType(ContentService.MimeType.JSON);}
}
