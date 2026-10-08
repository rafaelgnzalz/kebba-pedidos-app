-- Todas las filas y cambios de prueba se revierten; no quedan turnos ni ventas de ejemplo.
begin;
do $$
declare token text:=repeat('0',64); bridge text:=repeat('1',64); v bigint;
  s uuid:='9f121111-1111-4111-8111-111111111111'; s2 uuid:='9f122222-2222-4222-8222-222222222222'; result jsonb; parts jsonb; frozen jsonb; rejected boolean;
begin
  select version into v from kebba_private.app_state where id=1;
  update kebba_private.app_state set token_sha256=encode(sha256(convert_to(token,'UTF8')),'hex'),
    state=jsonb_build_object('dataVersion',1,'orders','{}'::jsonb,'history','[]'::jsonb) where id=1;
  rejected:=false;
  begin perform public.kebba_shift_read(repeat('f',64)); exception when sqlstate '22023' then rejected:=true; end;
  assert rejected,'clave inválida aceptada';
  result:=public.kebba_shift_action(token,'open',s,null,v);
  assert result->'active'->>'id'=s::text,'apertura no confirmada';
  result:=public.kebba_shift_action(token,'open',s,null,v);
  assert (select count(*)=1 from kebba_private.sales_shifts),'apertura duplicada';
  insert into kebba_private.cash_sales(sale_key,sold_at,sale) values
    ('fixture-shift-cash',now()-interval '10 years',jsonb_build_object('shiftId',s,'total',150,'payments',jsonb_build_array(jsonb_build_object('method','Efectivo','amount',150,'cashReceived',300,'cashChange',150)))),
    ('fixture-shift-split',now()-interval '10 years',jsonb_build_object('shiftId',s,'total',300,'payments',jsonb_build_array(
      jsonb_build_object('method','Pix','amount',100,'pixBrl',12.05,'pixRate',8.3),
      jsonb_build_object('method','Efectivo BRL','amount',100,'brlChargedMinor',1350,'brlReceivedMinor',2000,'brlChangeMinor',650),
      jsonb_build_object('method','PREX','amount',50),jsonb_build_object('method','Transferencia','amount',50))));
  parts:=kebba_private.shift_totals(s);
  assert (select (p->>'amountMinor')::numeric=15000 from jsonb_array_elements(parts) p where p->>'method'='Efectivo UYU'),'efectivo incluyó cambio';
  assert (select (p->>'amountMinor')::numeric=1205 from jsonb_array_elements(parts) p where p->>'method'='Pix'),'Pix recalculó tipo de cambio';
  assert (select (p->>'amountMinor')::numeric=1350 from jsonb_array_elements(parts) p where p->>'method'='Efectivo BRL'),'reales incluyeron cambio';
  assert (select (p->>'amountMinor')::numeric=5000 from jsonb_array_elements(parts) p where p->>'method'='PREX'),'Prex incorrecto';
  assert (select count(*)=2 from kebba_private.shift_sales where shift_id=s),'reloj del cliente excluyó venta etiquetada';
  rejected:=false;begin perform public.kebba_shift_action(token,'close',gen_random_uuid(),s,v-1);exception when sqlstate '40001' then rejected:=true;end;assert rejected,'versión antigua aceptada';
  update kebba_private.app_state set state=jsonb_set(state,'{orders}','{"m1":{"lines":[{}]}}') where id=1;
  rejected:=false;begin perform public.kebba_shift_action(token,'close',gen_random_uuid(),s,v);exception when sqlstate '22023' then rejected:=true;end;assert rejected,'pedido sin cobrar cerró turno';
  update kebba_private.app_state set state=jsonb_set(state,'{orders}','{}') where id=1;
  result:=public.kebba_shift_action(token,'close',gen_random_uuid(),s,v);
  assert result->'active'='null'::jsonb,'siguió abierto';
  select payment_totals into frozen from kebba_private.sales_shifts where id=s;
  assert (select sales_count=2 and total_uyu=450 and exported_at is null from kebba_private.sales_shifts where id=s),'cierre duplicó venta dividida o afirmó envío';
  perform public.kebba_shift_action(token,'close',gen_random_uuid(),s,v);
  assert (select payment_totals=frozen from kebba_private.sales_shifts where id=s),'reintento modificó cierre';
  rejected:=false;begin insert into kebba_private.cash_sales(sale_key,sold_at,sale) values('fixture-stale',now(),jsonb_build_object('shiftId',s,'total',1,'payment','Efectivo'));exception when sqlstate '22023' then rejected:=true;end;assert rejected,'cobro etiquetado llegó a turno cerrado';
  insert into kebba_private.cash_sales(sale_key,sold_at,sale) values('fixture-legacy',clock_timestamp(),'{"total":10,"payment":"Efectivo"}');
  assert exists(select 1 from kebba_private.cash_sales where sale_key='fixture-legacy'),'cliente anterior perdió cobro';
  assert not exists(select 1 from kebba_private.shift_sales where sale_key='fixture-legacy'),'cobro posterior cambió cierre';
  insert into kebba_private.shift_excel_connection(id,spreadsheet_id,spreadsheet_url,webhook_url,bridge_token_sha256,wake_token)
    values(1,'fixture-sheet','https://docs.google.com/spreadsheets/d/fixture-sheet','https://script.google.com/macros/s/fixture/exec',encode(sha256(convert_to(bridge,'UTF8')),'hex'),'fixture-wake');
  assert jsonb_array_length(public.kebba_shift_excel_read(bridge)->'turns')=1,'turno pendiente ausente';
  rejected:=false;begin perform public.kebba_shift_excel_read(token);exception when sqlstate '22023' then rejected:=true;end;assert rejected,'clave pedidos accedió a puente';
  rejected:=false;begin perform public.kebba_shift_excel_ack(bridge,s,'otro-sheet','[]');exception when others then rejected:=true;end;assert rejected,'destino incorrecto aceptado';
  rejected:=false;begin perform public.kebba_shift_excel_ack(bridge,s,'fixture-sheet','[]');exception when others then rejected:=true;end;assert rejected,'envío incompleto confirmado';
  select jsonb_agg(s::text||':'||(p->>'method') order by (p->>'method') collate "C") into parts from jsonb_array_elements(frozen) p;
  perform public.kebba_shift_excel_ack(bridge,s,'fixture-sheet',parts);
  perform public.kebba_shift_excel_ack(bridge,s,'fixture-sheet',parts);
  assert jsonb_array_length(public.kebba_shift_excel_read(bridge)->'turns')=0,'envío confirmado se volvió a exportar';
  update kebba_private.shift_excel_connection set enabled=false where id=1;
  perform public.kebba_shift_action(token,'open',s2,null,v);
  insert into kebba_private.cash_sales(sale_key,sold_at,sale) values('fixture-missing-brl',now(),jsonb_build_object('shiftId',s2,'total',100,'payment','Pix'));
  perform public.kebba_shift_action(token,'close',gen_random_uuid(),s2,v);
  update kebba_private.shift_excel_connection set enabled=true where id=1;
  rejected:=false;begin perform public.kebba_shift_excel_ack(bridge,s2,'fixture-sheet',jsonb_build_array(s2::text||':Pix'));exception when others then rejected:=true;end;assert rejected,'importe BRL faltante confirmado';
end $$;
select 'PASS: acceso, apertura idempotente, monedas, reloj cliente, pagos divididos, cierre, versión, pedidos pendientes, cliente anterior, reintento y confirmación de envío' as verificacion;
rollback;
