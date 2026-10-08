begin;
-- Fuente de la migración. Aplicar únicamente el archivo combinado eliminaciones.sql.
alter table kebba_private.cash_sales add column deleted_at timestamptz;
alter table kebba_private.sales_shifts add column deleted_at timestamptz;
alter table kebba_private.sales_shifts add column revision bigint not null default 1;
create view kebba_private.active_cash_sales as
select c.* from kebba_private.cash_sales c
where c.deleted_at is null and not exists (
  select 1 from kebba_private.shift_sales a join kebba_private.sales_shifts t on t.id=a.shift_id
  where a.sale_key=c.sale_key and t.deleted_at is not null
);
revoke all on kebba_private.active_cash_sales from public,anon,authenticated;
create table kebba_private.deletion_requests (
  id uuid primary key, kind text not null, action text not null, target_key text not null,
  created_at timestamptz not null default clock_timestamp()
);
alter table kebba_private.deletion_requests enable row level security;
revoke all on kebba_private.deletion_requests from public,anon,authenticated;

create function kebba_private.filter_deleted_history() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  new.state:=pg_catalog.jsonb_set(new.state,'{history}',coalesce((
    select pg_catalog.jsonb_agg(item order by ordinal)
    from pg_catalog.jsonb_array_elements(new.state->'history') with ordinality h(item,ordinal)
    where not exists(select 1 from kebba_private.cash_sales c
      where c.sale_key=(item->>'number')||':'||(item->>'openedAt')
      and not exists(select 1 from kebba_private.active_cash_sales v where v.sale_key=c.sale_key))
  ),'[]'::jsonb));
  return new;
end; $$;
create trigger kebba_filter_deleted_history before update of state on kebba_private.app_state
for each row execute function kebba_private.filter_deleted_history();
revoke all on function kebba_private.filter_deleted_history() from public,anon,authenticated;

create function kebba_private.deleted_sales(access_token text) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  perform kebba_private.check_shift_access(access_token);
  return pg_catalog.jsonb_build_object('sales',coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('key',c.sale_key,'sale',c.sale,
      'deleted_at',coalesce(c.deleted_at,t.deleted_at),'shift_id',t.id,'shift_code',t.code,
      'shift_deleted',t.deleted_at is not null) order by c.sold_at desc)
    from kebba_private.cash_sales c left join kebba_private.shift_sales a using(sale_key)
    left join kebba_private.sales_shifts t on t.id=a.shift_id
    where c.deleted_at is not null or t.deleted_at is not null),'[]'::jsonb));
end; $$;

create function kebba_private.delete_action(access_token text,request_id uuid,kind text,action text,target_key text,expected_version bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare current_version bigint; current_state jsonb; affected uuid; prior kebba_private.deletion_requests;
  target_sale kebba_private.cash_sales; target_shift kebba_private.sales_shifts; stamp timestamptz;
  restored jsonb;
begin
  perform kebba_private.check_shift_access(access_token);
  if request_id is null or kind is null or action is null or target_key is null or
    kind not in ('sale','shift') or action not in ('delete','restore') then
    raise exception 'Solicitud de eliminación inválida' using errcode='22023';
  end if;
  select s.version,s.state into current_version,current_state from kebba_private.app_state s where id=1 for update;
  select * into prior from kebba_private.deletion_requests where id=request_id;
  if found then
    if prior.kind<>kind or prior.action<>action or prior.target_key<>target_key then
      raise exception 'La solicitud ya corresponde a otra operación' using errcode='22023';
    end if;
    return kebba_private.read_state(access_token)||pg_catalog.jsonb_build_object('ok',true);
  end if;
  if expected_version is null or expected_version<>current_version then
    raise exception 'Los pedidos cambiaron. Actualizá antes de eliminar o restaurar.' using errcode='40001';
  end if;
  stamp:=case when action='delete' then pg_catalog.clock_timestamp() else null end;
  if kind='sale' then
    select * into target_sale from kebba_private.cash_sales where sale_key=target_key;
    if not found then raise exception 'Ese pedido no existe' using errcode='22023'; end if;
    select a.shift_id into affected from kebba_private.shift_sales a where sale_key=target_key;
    if action='restore' and exists(select 1 from kebba_private.sales_shifts where id=affected and deleted_at is not null) then
      raise exception 'Primero restaurá el turno de este pedido' using errcode='22023';
    end if;
    update kebba_private.cash_sales set deleted_at=stamp where sale_key=target_key;
  else
    select * into target_shift from kebba_private.sales_shifts where id=target_key::uuid;
    if not found then raise exception 'Ese turno no existe' using errcode='22023'; end if;
    if target_shift.closed_at is null then raise exception 'Cerrá el turno antes de eliminarlo' using errcode='22023'; end if;
    affected:=target_shift.id;
    update kebba_private.sales_shifts set deleted_at=stamp where id=affected;
  end if;
  -- Se reconstruye únicamente el cierre afectado, conservando los importes originales por moneda.
  update kebba_private.sales_shifts t set
    sales_count=(select count(*) from kebba_private.shift_sales a join kebba_private.active_cash_sales c using(sale_key) where a.shift_id=affected),
    total_uyu=coalesce((select sum((c.sale->>'total')::numeric) from kebba_private.shift_sales a join kebba_private.active_cash_sales c using(sale_key) where a.shift_id=affected),0),
    payment_totals=kebba_private.shift_totals(affected),revision=revision+1,exported_at=null,export_error=null
  where t.id=affected and t.closed_at is not null;
  if action='restore' then
    select coalesce(pg_catalog.jsonb_agg(c.sale order by c.sold_at),'[]'::jsonb) into restored
    from kebba_private.active_cash_sales c
    where (kind='sale' and c.sale_key=target_key or kind='shift' and exists(
      select 1 from kebba_private.shift_sales a where a.sale_key=c.sale_key and a.shift_id=affected))
    and not exists(select 1 from pg_catalog.jsonb_array_elements(current_state->'history') h
      where (h->>'number')||':'||(h->>'openedAt')=c.sale_key);
    if exists(select 1 from pg_catalog.jsonb_array_elements(restored) r,
      pg_catalog.jsonb_array_elements(current_state->'history') h
      where r->>'number'=h->>'number' and r->>'openedAt'<>h->>'openedAt') or exists(
      select 1 from pg_catalog.jsonb_array_elements(restored) r,pg_catalog.jsonb_each(current_state->'orders') o
      where r->>'number'=o.value->>'number') then
      raise exception 'Ese número de pedido está en uso. Revisá el historial antes de restaurar.' using errcode='22023';
    end if;
    current_state:=pg_catalog.jsonb_set(current_state,'{history}',(current_state->'history')||restored);
  end if;
  update kebba_private.app_state set state=current_state,version=version+1,updated_at=pg_catalog.clock_timestamp() where id=1;
  insert into kebba_private.deletion_requests(id,kind,action,target_key) values(request_id,kind,action,target_key);
  if affected is not null then perform kebba_private.queue_shift_export(); end if;
  return kebba_private.read_state(access_token)||pg_catalog.jsonb_build_object('ok',true);
end; $$;

create or replace function kebba_private.shift_excel_read(bridge_token text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  perform kebba_private.check_shift_bridge(bridge_token);
  select pg_catalog.jsonb_build_object('spreadsheetId',c.spreadsheet_id,'turns',
    coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(s) order by s.closed_at)
    from (select id,code,opened_at,closed_at,sales_count,total_uyu,payment_totals,deleted_at,revision
      from kebba_private.sales_shifts where closed_at is not null and exported_at is null order by closed_at limit 100) s),'[]'::jsonb))
  into result from kebba_private.shift_excel_connection c where id=1;
  return result;
end; $$;

create function kebba_private.shift_excel_ack_revision(bridge_token text,target_id uuid,spreadsheet_id text,row_ids jsonb,expected_revision bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare target kebba_private.sales_shifts; expected_ids jsonb;
begin
  perform kebba_private.check_shift_bridge(bridge_token);
  if not exists(select 1 from kebba_private.shift_excel_connection c where id=1 and c.spreadsheet_id=shift_excel_ack_revision.spreadsheet_id) then
    raise exception 'La planilla de destino no coincide';
  end if;
  select * into target from kebba_private.sales_shifts where id=target_id for update;
  if target.id is null or target.closed_at is null then raise exception 'El turno no está cerrado'; end if;
  if expected_revision is null or target.revision<>expected_revision then
    raise exception 'El turno cambió durante el envío. Se volverá a sincronizar.' using errcode='40001';
  end if;
  if exists(select 1 from pg_catalog.jsonb_array_elements(target.payment_totals) p where p->>'amountMinor' is null) then
    raise exception 'Falta el importe registrado de uno de los medios de pago';
  end if;
  select coalesce(pg_catalog.jsonb_agg(target_id::text||':'||(p->>'method') order by (p->>'method') collate "C"),'[]'::jsonb)
    into expected_ids from pg_catalog.jsonb_array_elements(target.payment_totals) p;
  if row_ids is null or pg_catalog.jsonb_typeof(row_ids)<>'array' or row_ids<>expected_ids then
    raise exception 'El envío del turno todavía está incompleto';
  end if;
  update kebba_private.sales_shifts set exported_at=pg_catalog.clock_timestamp(),export_error=null where id=target_id;
  return pg_catalog.jsonb_build_object('ok',true,'id',target_id,'revision',target.revision);
end; $$;
-- La versión anterior del puente solo puede confirmar la primera revisión.
create or replace function kebba_private.shift_excel_ack(bridge_token text,target_id uuid,spreadsheet_id text,row_ids jsonb)
returns jsonb language sql security definer set search_path='' as $$
  select kebba_private.shift_excel_ack_revision(bridge_token,target_id,spreadsheet_id,row_ids,1)
$$;
create function public.kebba_shift_excel_ack_revision(bridge_token text,target_id uuid,spreadsheet_id text,row_ids jsonb,expected_revision bigint)
returns jsonb language sql security invoker set search_path='' as $$
  select kebba_private.shift_excel_ack_revision(bridge_token,target_id,spreadsheet_id,row_ids,expected_revision)
$$;
create function public.kebba_deleted_sales(access_token text) returns jsonb language sql security invoker set search_path='' as $$ select kebba_private.deleted_sales(access_token) $$;
create function public.kebba_delete_action(access_token text,request_id uuid,kind text,action text,target_key text,expected_version bigint)
returns jsonb language sql security invoker set search_path='' as $$ select kebba_private.delete_action(access_token,request_id,kind,action,target_key,expected_version) $$;
revoke all on function kebba_private.deleted_sales(text),kebba_private.delete_action(text,uuid,text,text,text,bigint),
  kebba_private.shift_excel_ack_revision(text,uuid,text,jsonb,bigint),public.kebba_deleted_sales(text),
  public.kebba_delete_action(text,uuid,text,text,text,bigint),public.kebba_shift_excel_ack_revision(text,uuid,text,jsonb,bigint)
from public,anon,authenticated;
grant execute on function kebba_private.deleted_sales(text),kebba_private.delete_action(text,uuid,text,text,text,bigint),
  kebba_private.shift_excel_ack_revision(text,uuid,text,jsonb,bigint),public.kebba_deleted_sales(text),
  public.kebba_delete_action(text,uuid,text,text,text,bigint),public.kebba_shift_excel_ack_revision(text,uuid,text,jsonb,bigint) to anon;

CREATE OR REPLACE FUNCTION kebba_private.cash_read(access_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if access_token is null or access_token !~ '^[0-9a-f]{64}$' or not exists(select 1 from kebba_private.cash_access s where s.id=1 and s.token_sha256=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(access_token,'UTF8')),'hex')) then raise exception 'Clave de Caja inválida' using errcode='22023'; end if;
  return pg_catalog.jsonb_build_object(
    'finance_version',1,
    'events',coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(e) order by e.created_at,e.id) from kebba_private.cash_events e),'[]'::jsonb),
    'sales',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('sold_at',s.sold_at,'sale',s.sale) order by s.sold_at) from kebba_private.active_cash_sales s),'[]'::jsonb),
    'book',coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(b) order by b.created_at,b.id) from kebba_private.book_entries b),'[]'::jsonb));
end;$function$;

CREATE OR REPLACE FUNCTION kebba_private.cash_command(access_token text, request_id uuid, action text, payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  active_id uuid; target kebba_private.cash_events%rowtype; previous kebba_private.cash_events%rowtype;
  event_session uuid; event_currency text; event_amount bigint := 0; event_related uuid;
  event_detail jsonb := '{}'::jsonb; result kebba_private.cash_events%rowtype;
  spent bigint; returned bigint; written_off bigint; opening_uyu bigint; opening_brl bigint;
  counted_uyu bigint; counted_brl bigint; expected_uyu bigint; expected_brl bigint;
  sales_uyu bigint; sales_brl bigint; close_at timestamptz := pg_catalog.now();
begin
  if access_token is null or access_token !~ '^[0-9a-f]{64}$' or request_id is null
     or payload is null or pg_catalog.jsonb_typeof(payload)<>'object' then
    raise exception 'Solicitud de caja inválida' using errcode='22023';
  end if;
  perform 1 from kebba_private.cash_access s where s.id=1
    and s.token_sha256=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(access_token,'UTF8')),'hex') for update;
  if not found then raise exception 'Clave de Caja inválida' using errcode='22023'; end if;
  perform 1 from kebba_private.app_state s where s.id=1 for update;
  select * into result from kebba_private.cash_events where id=request_id;
  if found then return pg_catalog.to_jsonb(result); end if;
  if action not in ('open','income','expense','withdrawal','settlement','return','writeoff','close','close_correction') then
    raise exception 'Acción de caja inválida' using errcode='22023';
  end if;
  select e.id into active_id from kebba_private.cash_events e
   where e.kind='open' and not exists(select 1 from kebba_private.cash_events c where c.kind='close' and c.session_id=e.id)
   order by e.created_at desc limit 1;
  event_currency := payload->>'currency';
  if action='open' then
    if active_id is not null then raise exception 'Ya hay una caja abierta'; end if;
    if coalesce(payload->>'date','') !~ '^\d{4}-\d{2}-\d{2}$'
       or payload->>'date' <> pg_catalog.to_char(pg_catalog.now() at time zone 'America/Montevideo','YYYY-MM-DD') then
      raise exception 'La fecha de apertura debe ser la de hoy en Uruguay';
    end if;
    if coalesce(payload->>'opening_uyu','') !~ '^[0-9]{1,13}$' or coalesce(payload->>'opening_brl','') !~ '^[0-9]{1,13}$' then
      raise exception 'Saldo inicial inválido';
    end if;
    opening_uyu := (payload->>'opening_uyu')::bigint;
    opening_brl := (payload->>'opening_brl')::bigint;
    event_session := request_id; event_currency := null;
    event_detail := pg_catalog.jsonb_build_object('date',payload->>'date','opening_uyu',opening_uyu,'opening_brl',opening_brl);
  elsif action in ('income','expense','withdrawal') then
    if active_id is null then raise exception 'Abrí una caja antes de registrar movimientos'; end if;
    if coalesce(event_currency,'') not in ('UYU','BRL') or coalesce(payload->>'amount_minor','') !~ '^[1-9][0-9]{0,12}$' then
      raise exception 'Importe o moneda inválidos';
    end if;
    event_amount := (payload->>'amount_minor')::bigint; event_session := active_id;
    if pg_catalog.length(pg_catalog.btrim(coalesce(payload->>'responsible',''))) < 2
       or pg_catalog.length(payload->>'responsible') > 100
       or pg_catalog.length(pg_catalog.btrim(coalesce(payload->>'reason',''))) < 2
       or pg_catalog.length(payload->>'reason') > 240 then
      raise exception 'Ingresá responsable y motivo';
    end if;
    if coalesce(payload->>'funding_type','operation') not in ('operation','contribution','reimbursement')
      or (payload->>'funding_type'='contribution' and action<>'income')
      or (payload->>'funding_type'='reimbursement' and action<>'expense') then raise exception 'Tipo de aporte o reintegro inválido'; end if;
    if coalesce(payload->>'category','unclassified') not in ('equipment','renovation','stock','rent','services','staff','tax','marketing','change','other','unclassified') then raise exception 'Categoría inválida'; end if;
    event_detail := pg_catalog.jsonb_build_object('responsible',pg_catalog.btrim(payload->>'responsible'),
      'reason',pg_catalog.btrim(payload->>'reason'),'note',pg_catalog.left(coalesce(payload->>'note',''),500),
      'funding_type',coalesce(payload->>'funding_type','operation'),'category',coalesce(payload->>'category','unclassified'));
  elsif action in ('settlement','return','writeoff') then
    begin event_related := (payload->>'withdrawal_id')::uuid;
    exception when others then raise exception 'Retiro inválido'; end;
    select * into target from kebba_private.cash_events where id=event_related and kind='withdrawal';
    if not found then raise exception 'Retiro no encontrado'; end if;
    select coalesce(sum(amount_minor),0) into spent from kebba_private.cash_events where kind='settlement' and related_id=event_related;
    select coalesce(sum(amount_minor),0) into returned from kebba_private.cash_events where kind='return' and related_id=event_related;
    select coalesce(sum(amount_minor),0) into written_off from kebba_private.cash_events where kind='writeoff' and related_id=event_related;
    if written_off>0 or spent+returned>=target.amount_minor then raise exception 'El retiro ya está rendido'; end if;
    event_currency := target.currency; event_session := case when action='return' then active_id else target.session_id end;
    if action='return' and active_id is null then raise exception 'Abrí una caja para devolver efectivo'; end if;
    if action='writeoff' then
      event_amount := target.amount_minor-spent-returned;
      if pg_catalog.length(pg_catalog.btrim(coalesce(payload->>'reason','')))<5 then raise exception 'Explicá la diferencia'; end if;
      event_detail := pg_catalog.jsonb_build_object('reason',pg_catalog.left(pg_catalog.btrim(payload->>'reason'),500));
    else
      if coalesce(payload->>'amount_minor','') !~ '^[1-9][0-9]{0,12}$' then raise exception 'Importe inválido'; end if;
      event_amount := (payload->>'amount_minor')::bigint;
      if event_amount>target.amount_minor-spent-returned then raise exception 'El importe supera el pendiente'; end if;
      if action='settlement' then
        if pg_catalog.length(pg_catalog.btrim(coalesce(payload->>'supplier','')))<2
           or pg_catalog.length(payload->>'supplier')>150
           or coalesce(payload->>'document_date','') !~ '^\d{4}-\d{2}-\d{2}$' then
          raise exception 'Proveedor o fecha de comprobante inválidos';
        end if;
        if coalesce(payload->>'category','unclassified') not in ('equipment','renovation','stock','rent','services','staff','tax','marketing','change','other','unclassified') then raise exception 'Categoría inválida'; end if;
        if kebba_private.book_invoice_exists(payload->>'supplier',payload->>'document_number') then
          raise exception 'Ese proveedor y número de comprobante ya están registrados';
        end if;
        event_detail := pg_catalog.jsonb_build_object('supplier',pg_catalog.btrim(payload->>'supplier'),
          'document_number',pg_catalog.left(pg_catalog.btrim(coalesce(payload->>'document_number','')),100),
          'document_date',payload->>'document_date','category',coalesce(payload->>'category','unclassified'),'note',pg_catalog.left(coalesce(payload->>'note',''),500));
      else
        if pg_catalog.length(pg_catalog.btrim(coalesce(payload->>'responsible','')))<2 then
          raise exception 'Indicá quién devuelve el dinero';
        end if;
        event_detail := pg_catalog.jsonb_build_object('responsible',pg_catalog.left(pg_catalog.btrim(coalesce(payload->>'responsible','')),100),
          'note',pg_catalog.left(coalesce(payload->>'note',''),500));
      end if;
    end if;
  elsif action='close' then
    if active_id is null then raise exception 'No hay caja abierta'; end if;
    if coalesce(payload->>'counted_uyu','') !~ '^[0-9]{1,13}$' or coalesce(payload->>'counted_brl','') !~ '^[0-9]{1,13}$' then
      raise exception 'Importe contado inválido';
    end if;
    counted_uyu := (payload->>'counted_uyu')::bigint; counted_brl := (payload->>'counted_brl')::bigint;
    select * into target from kebba_private.cash_events where id=active_id;
    opening_uyu := (target.detail->>'opening_uyu')::bigint; opening_brl := (target.detail->>'opening_brl')::bigint;
    select coalesce(sum((p.part->>'amount')::bigint * 100),0) into sales_uyu
      from kebba_private.active_cash_sales s
      cross join lateral pg_catalog.jsonb_array_elements(coalesce(s.sale->'payments',
        pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('method',s.sale->>'payment','amount',s.sale->>'total')))) p(part)
     where s.sold_at>=target.created_at and s.sold_at<=close_at and p.part->>'method'='Efectivo';
    select coalesce(sum((p.part->>'brlChargedMinor')::bigint),0) into sales_brl
      from kebba_private.active_cash_sales s
      cross join lateral pg_catalog.jsonb_array_elements(coalesce(s.sale->'payments',
        pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('method',s.sale->>'payment','brlChargedMinor',s.sale->>'brlChargedMinor')))) p(part)
     where s.sold_at>=target.created_at and s.sold_at<=close_at and p.part->>'method'='Efectivo BRL';
    select opening_uyu+sales_uyu+coalesce(sum(case
      when kind in ('income','return') then amount_minor
      when kind in ('expense','withdrawal') then -amount_minor else 0 end),0)
      into expected_uyu from kebba_private.cash_events where session_id=active_id and currency='UYU';
    select opening_brl+sales_brl+coalesce(sum(case
      when kind in ('income','return') then amount_minor
      when kind in ('expense','withdrawal') then -amount_minor else 0 end),0)
      into expected_brl from kebba_private.cash_events where session_id=active_id and currency='BRL';
    if coalesce(payload->>'expected_uyu','') !~ '^-?[0-9]{1,13}$'
       or coalesce(payload->>'expected_brl','') !~ '^-?[0-9]{1,13}$'
       or expected_uyu<>(payload->>'expected_uyu')::bigint
       or expected_brl<>(payload->>'expected_brl')::bigint then
      raise exception 'Caja cambió mientras contabas. Actualizá y revisá el esperado antes de cerrar.';
    end if;
    event_session := active_id; event_currency := null;
    event_detail := pg_catalog.jsonb_build_object('expected_uyu',expected_uyu,'expected_brl',expected_brl,
      'counted_uyu',counted_uyu,'counted_brl',counted_brl,'sales_uyu',sales_uyu,'sales_brl',sales_brl);
  else -- close_correction
    begin event_session := (payload->>'session_id')::uuid;
    exception when others then raise exception 'Caja inválida'; end;
    select * into target from kebba_private.cash_events where session_id=event_session and kind='close';
    if not found then raise exception 'La caja no está cerrada'; end if;
    select * into previous from kebba_private.cash_events where session_id=event_session and kind='close_correction' order by created_at desc,id desc limit 1;
    if coalesce(payload->>'counted_uyu','') !~ '^[0-9]{1,13}$' or coalesce(payload->>'counted_brl','') !~ '^[0-9]{1,13}$'
       or pg_catalog.length(pg_catalog.btrim(coalesce(payload->>'reason','')))<5 then
      raise exception 'Ingresá importes y motivo de la corrección';
    end if;
    counted_uyu := (payload->>'counted_uyu')::bigint; counted_brl := (payload->>'counted_brl')::bigint;
    opening_uyu := coalesce((previous.detail->>'new_counted_uyu')::bigint,(target.detail->>'counted_uyu')::bigint);
    opening_brl := coalesce((previous.detail->>'new_counted_brl')::bigint,(target.detail->>'counted_brl')::bigint);
    if coalesce(payload->>'previous_counted_uyu','') !~ '^[0-9]{1,13}$'
       or coalesce(payload->>'previous_counted_brl','') !~ '^[0-9]{1,13}$'
       or opening_uyu<>(payload->>'previous_counted_uyu')::bigint
       or opening_brl<>(payload->>'previous_counted_brl')::bigint then
      raise exception 'El cierre cambió. Actualizá la caja antes de corregirlo.';
    end if;
    if opening_uyu=counted_uyu and opening_brl=counted_brl then raise exception 'No hay cambio que registrar'; end if;
    event_related := target.id; event_currency := null;
    event_detail := pg_catalog.jsonb_build_object('old_counted_uyu',opening_uyu,'old_counted_brl',opening_brl,
      'new_counted_uyu',counted_uyu,'new_counted_brl',counted_brl,'reason',pg_catalog.left(pg_catalog.btrim(payload->>'reason'),500));
  end if;
  insert into kebba_private.cash_events (id,session_id,kind,currency,amount_minor,related_id,detail,created_at)
  values (request_id,event_session,action,event_currency,event_amount,event_related,event_detail,close_at)
  returning * into result;
  return pg_catalog.to_jsonb(result);
end;
$function$;

CREATE OR REPLACE FUNCTION kebba_private.shift_totals(target uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$
  with parts as (
    select p, s.sale from kebba_private.shift_sales a join kebba_private.active_cash_sales s using(sale_key)
    cross join lateral pg_catalog.jsonb_array_elements(case
      when pg_catalog.jsonb_typeof(s.sale->'payments')='array' and pg_catalog.jsonb_array_length(s.sale->'payments')>0
      then s.sale->'payments' else pg_catalog.jsonb_build_array(s.sale) end) p
    where a.shift_id=target
  ), amounts as (
    select coalesce(p->>'method',sale->>'payment','Otro') as method,
      coalesce((p->>'amount')::numeric,(sale->>'total')::numeric) as amount_uyu,
      case coalesce(p->>'method',sale->>'payment')
        when 'Pix' then round(coalesce((p->>'pixBrl')::numeric,(sale->>'pixBrl')::numeric)*100)
        when 'Efectivo BRL' then coalesce((p->>'brlChargedMinor')::numeric,(sale->>'brlChargedMinor')::numeric)
        else round(coalesce((p->>'amount')::numeric,(sale->>'total')::numeric)*100) end as amount_minor
    from parts
  ), totals as (
    select method, case when method in ('Pix','Efectivo BRL') then 'BRL' else 'UYU' end as currency,
      sum(amount_uyu) as amount_uyu, count(*) as payments_count,
      count(*) filter(where amount_minor is null) as missing_count,
      case when count(*) filter(where amount_minor is null)>0 then null else sum(amount_minor) end as amount_minor
    from amounts group by method
  ) select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'method',case when method='Efectivo' then 'Efectivo UYU' else method end,
      'currency',currency,'amountUYU',amount_uyu,'amountMinor',amount_minor,
      'paymentsCount',payments_count,'missingCount',missing_count
    ) order by method),'[]'::jsonb) from totals;
$function$;

CREATE OR REPLACE FUNCTION kebba_private.shift_action(access_token text, action text, request_id uuid, target_id uuid, expected_version bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare current_version bigint; current_state jsonb; target kebba_private.sales_shifts; day_code text; next_number integer; result jsonb;
begin
  perform kebba_private.check_shift_access(access_token);
  if request_id is null or action not in ('open','close','retry_export') then raise exception 'Acción de turno inválida'; end if;
  -- El mismo candado que usa kebba_write: un cobro no puede quedar entre la captura y el cierre.
  select s.version,s.state into current_version,current_state from kebba_private.app_state s where s.id=1 for update;
  if action='retry_export' then
    perform kebba_private.queue_shift_export();
    return kebba_private.shift_snapshot(access_token);
  end if;
  if action='open' then
    if exists(select 1 from kebba_private.sales_shifts where id=request_id or closed_at is null) then
      return kebba_private.shift_snapshot(access_token);
    end if;
    if expected_version is null or expected_version<>current_version then
      raise exception 'Los pedidos cambiaron. Actualizá y volvé a abrir el turno.' using errcode='40001';
    end if;
    day_code:=pg_catalog.to_char(pg_catalog.clock_timestamp() at time zone 'America/Montevideo','YYYYMMDD');
    select count(*)+1 into next_number from kebba_private.sales_shifts where code like 'T-'||day_code||'-%';
    insert into kebba_private.sales_shifts(id,code) values(request_id,'T-'||day_code||'-'||pg_catalog.lpad(next_number::text,3,'0'));
  else
    select * into target from kebba_private.sales_shifts where id=target_id;
    if not found then raise exception 'Ese turno no existe'; end if;
    if target.closed_at is not null then return kebba_private.shift_snapshot(access_token); end if;
    if expected_version is null or expected_version<>current_version then
      raise exception 'Los pedidos cambiaron. Revisá los cobros y volvé a cerrar el turno.' using errcode='40001';
    end if;
    if exists(select 1 from pg_catalog.jsonb_each(current_state->'orders') o
      where pg_catalog.jsonb_array_length(coalesce(o.value->'lines','[]'::jsonb))>0) then
      raise exception 'Quedan pedidos sin cobrar. Cobralos antes de cerrar el turno.' using errcode='22023';
    end if;
    update kebba_private.sales_shifts set closed_at=pg_catalog.clock_timestamp(),close_request_id=request_id,
      sales_count=(select count(*) from kebba_private.shift_sales a join kebba_private.active_cash_sales c using(sale_key) where a.shift_id=target_id),
      total_uyu=coalesce((select sum((c.sale->>'total')::numeric) from kebba_private.shift_sales a join kebba_private.active_cash_sales c using(sale_key) where a.shift_id=target_id),0),
      payment_totals=kebba_private.shift_totals(target_id) where id=target_id;
    perform kebba_private.queue_shift_export();
  end if;
  return kebba_private.shift_snapshot(access_token);
end;
$function$;

CREATE OR REPLACE FUNCTION kebba_private.shift_snapshot(access_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare active_json jsonb; closed_json jsonb; conn jsonb; pending integer; feature_enabled boolean; outside_turn integer;
begin
  perform kebba_private.check_shift_access(access_token);
  select pg_catalog.to_jsonb(s)||pg_catalog.jsonb_build_object(
    'sales_count',(select count(*) from kebba_private.shift_sales a join kebba_private.active_cash_sales c using(sale_key) where a.shift_id=s.id),
    'total_uyu',coalesce((select sum((c.sale->>'total')::numeric) from kebba_private.shift_sales a join kebba_private.active_cash_sales c using(sale_key) where a.shift_id=s.id),0),
    'payment_totals',kebba_private.shift_totals(s.id)) into active_json
    from kebba_private.sales_shifts s where s.closed_at is null;
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(s) order by s.closed_at desc),'[]'::jsonb)
    into closed_json from (select * from kebba_private.sales_shifts where closed_at is not null and deleted_at is null order by closed_at desc limit 30) s;
  select pg_catalog.jsonb_build_object('url',spreadsheet_url) into conn
    from kebba_private.shift_excel_connection where id=1 and enabled;
  select count(*) into pending from kebba_private.app_state a,
    lateral pg_catalog.jsonb_each(a.state->'orders') o where a.id=1 and pg_catalog.jsonb_array_length(coalesce(o.value->'lines','[]'::jsonb))>0;
  select exists(select 1 from kebba_private.sales_shifts) into feature_enabled;
  select count(*) into outside_turn from kebba_private.active_cash_sales c where c.sold_at >= (select min(opened_at) from kebba_private.sales_shifts)
    and not exists(select 1 from kebba_private.shift_sales a where a.sale_key=c.sale_key);
  return pg_catalog.jsonb_build_object('active',active_json,'closed',closed_json,'deleted',coalesce((select jsonb_agg(to_jsonb(t) order by t.closed_at desc) from kebba_private.sales_shifts t where t.deleted_at is not null),'[]'::jsonb),'connection',conn,'pendingOrders',pending,'enabled',feature_enabled,'outsideTurn',outside_turn);
end;
$function$;

CREATE OR REPLACE FUNCTION kebba_private.write_state(access_token text, expected_version bigint, next_state jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  current_version bigint;
begin
  if access_token is null or access_token !~ '^[0-9a-f]{64}$' then
    raise exception 'Enlace de KEBBA inválido' using errcode = '22023';
  end if;
  if next_state is null
     or pg_catalog.jsonb_typeof(next_state) <> 'object'
     or next_state->>'dataVersion' <> '1'
     or pg_catalog.jsonb_typeof(next_state->'orders') <> 'object'
     or pg_catalog.jsonb_typeof(next_state->'history') <> 'array'
     or pg_catalog.jsonb_typeof(next_state->'catalog') <> 'array'
     or pg_catalog.jsonb_typeof(next_state->'modifierCatalog') <> 'array'
     or pg_catalog.jsonb_typeof(next_state->'settings') <> 'object'
     or pg_catalog.pg_column_size(next_state) > 10485760 then
    raise exception 'Datos de KEBBA inválidos o demasiado grandes' using errcode = '22023';
  end if;

  select s.version into current_version
    from kebba_private.app_state as s
   where s.id = 1
     and s.token_sha256 = pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(access_token, 'UTF8')), 'hex')
   for update;
  if current_version is null then
    raise exception 'Enlace de KEBBA inválido' using errcode = '22023';
  end if;
  if current_version <> expected_version then
    return pg_catalog.jsonb_build_object('ok', false, 'version', current_version);
  end if;

  update kebba_private.app_state as s
     set state = next_state, version = s.version + 1, updated_at = pg_catalog.now()
   where s.id = 1;
  return pg_catalog.jsonb_build_object('ok', true, 'version', current_version + 1, 'state',(select s.state from kebba_private.app_state s where id=1));
end;
$function$;

commit;
