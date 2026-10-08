-- Pruebas de integración con reversión completa. Nunca borra ventas reales.
begin;
do $$
declare token text:=repeat('0',64); bridge text:=repeat('1',64); cash text:=repeat('2',64);
  s uuid:='9f123333-3333-4333-8333-333333333333'; req uuid:=gen_random_uuid(); v bigint; result jsonb; original jsonb;
  a jsonb; b jsonb; revision bigint; rejected boolean;
begin
  update kebba_private.app_state set token_sha256=encode(sha256(convert_to(token,'UTF8')),'hex'),
    state=jsonb_build_object('dataVersion',1,'orders','{}'::jsonb,'history','[]'::jsonb,
      'catalog','[]'::jsonb,'modifierCatalog','[]'::jsonb,'settings','{}'::jsonb) where id=1;
  update kebba_private.cash_access set token_sha256=encode(sha256(convert_to(cash,'UTF8')),'hex') where id=1;
  -- Un turno fixture cerrado permite probar sin interferir con el turno operativo.
  insert into kebba_private.sales_shifts(id,code,opened_at,closed_at,payment_totals)
    values(s,'PRUEBA-ELIMINACIONES',now()-interval '20 years',now()-interval '19 years','[]');
  a:=jsonb_build_object('number',900001,'openedAt',900000000001,'closedAt',900000100001,'total',250,
    'payment','Dividido','payments',jsonb_build_array(jsonb_build_object('method','Efectivo','amount',150),jsonb_build_object('method','Pix','amount',100,'pixBrl',12.05)));
  b:=jsonb_build_object('number',900002,'openedAt',900000000002,'closedAt',900000100002,'total',180,
    'payment','Efectivo BRL','brlChargedMinor',2500);
  insert into kebba_private.cash_sales(sale_key,sold_at,sale) values('900001:900000000001',now()-interval '20 years',a),('900002:900000000002',now()-interval '20 years',b);
  insert into kebba_private.shift_sales(sale_key,shift_id) values('900001:900000000001',s),('900002:900000000002',s);
  update kebba_private.app_state set state=jsonb_set(state,'{history}',jsonb_build_array(a,b)) where id=1;
  select state,version into original,v from kebba_private.app_state where id=1;
  rejected:=false;begin perform public.kebba_delete_action(repeat('f',64),req,'sale','delete','900001:900000000001',v);exception when sqlstate '22023' then rejected:=true;end;assert rejected,'aceptó clave inválida';
  rejected:=false;begin perform public.kebba_delete_action(token,req,'sale','delete','900001:900000000001',v-1);exception when sqlstate '40001' then rejected:=true;end;assert rejected,'aceptó versión vieja';
  result:=public.kebba_delete_action(token,req,'sale','delete','900001:900000000001',v);v:=(result->>'version')::bigint;
  assert jsonb_array_length(result->'state'->'history')=1,'historial no descontó pedido';
  assert not exists(select 1 from jsonb_array_elements(public.kebba_cash_read(cash)->'sales') c where c->'sale'->>'number'='900001'),'Caja conserva venta eliminada';
  assert (select t.total_uyu=180 and t.sales_count=1 and t.revision=2 from kebba_private.sales_shifts t where id=s),'turno no recalculó';
  assert (select p->>'amountMinor'='2500' from jsonb_array_elements(kebba_private.shift_totals(s)) p where p->>'method'='Efectivo BRL'),'reales alterados';
  result:=public.kebba_delete_action(token,req,'sale','delete','900001:900000000001',v-1);
  assert (result->>'version')::bigint=v,'respuesta perdida repitió modificación';
  rejected:=false;begin perform public.kebba_delete_action(token,req,'shift','delete',s::text,v);exception when sqlstate '22023' then rejected:=true;end;assert rejected,'reutilizó solicitud para otro objetivo';
  -- Un respaldo anterior no resucita una venta ni su importe.
  result:=public.kebba_write(token,v,original);v:=(result->>'version')::bigint;
  assert jsonb_array_length(result->'state'->'history')=1,'respaldo resucitó pedido';
  result:=public.kebba_delete_action(token,gen_random_uuid(),'shift','delete',s::text,v);v:=(result->>'version')::bigint;
  assert jsonb_array_length(result->'state'->'history')=0,'eliminar turno conservó pedidos';
  assert (select total_uyu=0 and sales_count=0 and payment_totals='[]' from kebba_private.sales_shifts where id=s),'turno eliminado conserva dinero';
  rejected:=false;begin perform public.kebba_delete_action(token,gen_random_uuid(),'sale','restore','900001:900000000001',v);exception when sqlstate '22023' then rejected:=true;end;assert rejected,'restauró venta de turno eliminado';
  result:=public.kebba_delete_action(token,gen_random_uuid(),'shift','restore',s::text,v);v:=(result->>'version')::bigint;
  assert jsonb_array_length(result->'state'->'history')=1,'restaurar turno resucitó venta eliminada individualmente';
  result:=public.kebba_delete_action(token,gen_random_uuid(),'sale','restore','900001:900000000001',v);v:=(result->>'version')::bigint;
  assert jsonb_array_length(result->'state'->'history')=2,'restaurar pedido no recuperó historial';
  assert (select total_uyu=430 and sales_count=2 from kebba_private.sales_shifts where id=s),'restaurar duplicó o perdió montos';
  assert (select p->>'amountMinor'='1205' from jsonb_array_elements(kebba_private.shift_totals(s)) p where p->>'method'='Pix'),'restaurar recalculó Pix';
  update kebba_private.shift_excel_connection set bridge_token_sha256=encode(sha256(convert_to(bridge,'UTF8')),'hex'),enabled=true where id=1;
  select t.revision into revision from kebba_private.sales_shifts t where id=s;
  rejected:=false;begin perform public.kebba_shift_excel_ack_revision(bridge,s,(select spreadsheet_id from kebba_private.shift_excel_connection where id=1),'[]',revision-1);exception when sqlstate '40001' then rejected:=true;end;assert rejected,'ACK viejo confirmó nueva revisión';
  rejected:=false;begin perform public.kebba_shift_excel_ack(bridge,s,(select spreadsheet_id from kebba_private.shift_excel_connection where id=1),'[]');exception when sqlstate '40001' then rejected:=true;end;assert rejected,'puente anterior confirmó revisión nueva';
  result:=public.kebba_shift_excel_ack_revision(bridge,s,(select spreadsheet_id from kebba_private.shift_excel_connection where id=1),jsonb_build_array(s::text||':Efectivo BRL',s::text||':Efectivo UYU',s::text||':Pix'),revision);
  assert result->>'ok'='true','confirmación actual falló';
  assert (select exported_at is not null from kebba_private.sales_shifts where id=s),'cierre no confirmó envío';
end; $$;
rollback;
select 'OK: eliminar/restaurar, reintento, respaldo antiguo, monedas, acceso y ACK de revisión' as resultado;
