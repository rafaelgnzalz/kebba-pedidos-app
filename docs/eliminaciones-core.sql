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
