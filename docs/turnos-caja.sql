-- Turnos de ventas. Se conservan aparte del historial visible y de la jornada de efectivo.
create extension if not exists pg_net with schema extensions;

create table kebba_private.sales_shifts (
  id uuid primary key,
  code text not null unique,
  opened_at timestamptz not null default clock_timestamp(),
  closed_at timestamptz,
  close_request_id uuid unique,
  sales_count integer,
  total_uyu numeric(18,2),
  payment_totals jsonb,
  exported_at timestamptz,
  export_error text,
  check (closed_at is null or closed_at >= opened_at),
  check ((closed_at is null and payment_totals is null) or
         (closed_at is not null and jsonb_typeof(payment_totals)='array'))
);
create unique index sales_shifts_one_open on kebba_private.sales_shifts ((true)) where closed_at is null;
create index sales_shifts_pending_export on kebba_private.sales_shifts (closed_at) where closed_at is not null and exported_at is null;
create table kebba_private.shift_sales (
  sale_key text primary key references kebba_private.cash_sales(sale_key),
  shift_id uuid not null references kebba_private.sales_shifts(id)
);
create index shift_sales_shift_idx on kebba_private.shift_sales(shift_id);
create table kebba_private.shift_excel_connection (
  id smallint primary key check (id=1),
  spreadsheet_id text not null,
  spreadsheet_url text not null,
  webhook_url text not null check (webhook_url ~ '^https://script\.google\.com/macros/s/[A-Za-z0-9_-]+/exec$'),
  bridge_token_sha256 text not null check (bridge_token_sha256 ~ '^[0-9a-f]{64}$'),
  wake_token text not null,
  enabled boolean not null default true
);
alter table kebba_private.sales_shifts enable row level security;
alter table kebba_private.shift_sales enable row level security;
alter table kebba_private.shift_excel_connection enable row level security;
revoke all on kebba_private.sales_shifts, kebba_private.shift_sales, kebba_private.shift_excel_connection from public, anon, authenticated;

create function kebba_private.check_shift_access(access_token text)
returns void language plpgsql security invoker set search_path='' as $$
begin
  if access_token is null or access_token !~ '^[0-9a-f]{64}$' or not exists (
    select 1 from kebba_private.app_state s where s.id=1
    and s.token_sha256=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(access_token,'UTF8')),'hex')
  ) then raise exception 'Enlace de KEBBA inválido' using errcode='22023'; end if;
end;
$$;

create function kebba_private.shift_totals(target uuid)
returns jsonb language sql security invoker set search_path='' as $$
  with parts as (
    select p, s.sale from kebba_private.shift_sales a join kebba_private.cash_sales s using(sale_key)
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
$$;

create function kebba_private.assign_sale_shift()
returns trigger language plpgsql security definer set search_path='' as $$
declare active kebba_private.sales_shifts;
begin
  select * into active from kebba_private.sales_shifts where closed_at is null;
  if active.id is null then
    if new.sale->>'shiftId' is not null then
      raise exception 'El turno ya cerró. Actualizá la página antes de cobrar.' using errcode='22023';
    end if;
    -- Un cliente anterior sin Turnos sigue guardando sus ventas en el diario.
    return new;
  end if;
  -- Un respaldo antiguo no incorpora ventas históricas al turno actual.
  if new.sale->>'shiftId' is not null and new.sale->>'shiftId'<>active.id::text then
    raise exception 'El turno cambió. Actualizá la página antes de cobrar.' using errcode='22023';
  end if;
  if new.sale->>'shiftId' is null and new.sold_at < active.opened_at then return new; end if;
  insert into kebba_private.shift_sales(sale_key,shift_id) values(new.sale_key,active.id);
  return new;
end;
$$;
create trigger kebba_assign_sale_shift after insert on kebba_private.cash_sales
for each row execute function kebba_private.assign_sale_shift();

create function kebba_private.queue_shift_export()
returns boolean language plpgsql security invoker set search_path='' as $$
declare config kebba_private.shift_excel_connection;
begin
  select * into config from kebba_private.shift_excel_connection where id=1 and enabled;
  if not found then return false; end if;
  perform net.http_post(url:=config.webhook_url,
    body:=pg_catalog.jsonb_build_object('wakeToken',config.wake_token),
    timeout_milliseconds:=15000);
  return true;
exception when others then
  -- El cierre ya guardado permanece pendiente; Apps Script vuelve a consultarlo.
  return false;
end;
$$;

create function kebba_private.shift_snapshot(access_token text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare active_json jsonb; closed_json jsonb; conn jsonb; pending integer; feature_enabled boolean; outside_turn integer;
begin
  perform kebba_private.check_shift_access(access_token);
  select pg_catalog.to_jsonb(s)||pg_catalog.jsonb_build_object(
    'sales_count',(select count(*) from kebba_private.shift_sales a where a.shift_id=s.id),
    'total_uyu',coalesce((select sum((c.sale->>'total')::numeric) from kebba_private.shift_sales a join kebba_private.cash_sales c using(sale_key) where a.shift_id=s.id),0),
    'payment_totals',kebba_private.shift_totals(s.id)) into active_json
    from kebba_private.sales_shifts s where s.closed_at is null;
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(s) order by s.closed_at desc),'[]'::jsonb)
    into closed_json from (select * from kebba_private.sales_shifts where closed_at is not null order by closed_at desc limit 30) s;
  select pg_catalog.jsonb_build_object('url',spreadsheet_url) into conn
    from kebba_private.shift_excel_connection where id=1 and enabled;
  select count(*) into pending from kebba_private.app_state a,
    lateral pg_catalog.jsonb_each(a.state->'orders') o where a.id=1 and pg_catalog.jsonb_array_length(coalesce(o.value->'lines','[]'::jsonb))>0;
  select exists(select 1 from kebba_private.sales_shifts) into feature_enabled;
  select count(*) into outside_turn from kebba_private.cash_sales c where c.sold_at >= (select min(opened_at) from kebba_private.sales_shifts)
    and not exists(select 1 from kebba_private.shift_sales a where a.sale_key=c.sale_key);
  return pg_catalog.jsonb_build_object('active',active_json,'closed',closed_json,'connection',conn,'pendingOrders',pending,'enabled',feature_enabled,'outsideTurn',outside_turn);
end;
$$;

create function kebba_private.shift_action(access_token text, action text, request_id uuid, target_id uuid, expected_version bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
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
      sales_count=(select count(*) from kebba_private.shift_sales where shift_id=target_id),
      total_uyu=coalesce((select sum((c.sale->>'total')::numeric) from kebba_private.shift_sales a join kebba_private.cash_sales c using(sale_key) where a.shift_id=target_id),0),
      payment_totals=kebba_private.shift_totals(target_id) where id=target_id;
    perform kebba_private.queue_shift_export();
  end if;
  return kebba_private.shift_snapshot(access_token);
end;
$$;

create function kebba_private.check_shift_bridge(bridge_token text)
returns void language plpgsql security invoker set search_path='' as $$
begin
  if bridge_token is null or bridge_token !~ '^[0-9a-f]{64}$' or not exists(
    select 1 from kebba_private.shift_excel_connection where id=1 and enabled and
    bridge_token_sha256=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(bridge_token,'UTF8')),'hex')
  ) then raise exception 'Conexión de Caja inválida' using errcode='22023'; end if;
end;
$$;
create function kebba_private.shift_excel_read(bridge_token text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  perform kebba_private.check_shift_bridge(bridge_token);
  select pg_catalog.jsonb_build_object('spreadsheetId',c.spreadsheet_id,'turns',
    coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(s) order by s.closed_at)
      from (select id,code,opened_at,closed_at,sales_count,total_uyu,payment_totals
        from kebba_private.sales_shifts where closed_at is not null and exported_at is null order by closed_at limit 100) s),'[]'::jsonb))
    into result from kebba_private.shift_excel_connection c where c.id=1;
  return result;
end;
$$;
create function kebba_private.shift_excel_ack(bridge_token text, target_id uuid, spreadsheet_id text, row_ids jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare target kebba_private.sales_shifts; expected_ids jsonb;
begin
  perform kebba_private.check_shift_bridge(bridge_token);
  if not exists(select 1 from kebba_private.shift_excel_connection c where c.id=1 and c.spreadsheet_id=shift_excel_ack.spreadsheet_id) then
    raise exception 'La planilla de destino no coincide';
  end if;
  select * into target from kebba_private.sales_shifts where id=target_id for update;
  if target.id is null or target.closed_at is null then raise exception 'El turno no está cerrado'; end if;
  if exists(select 1 from pg_catalog.jsonb_array_elements(target.payment_totals) p where p->>'amountMinor' is null) then
    raise exception 'Falta el importe registrado de uno de los medios de pago';
  end if;
  select coalesce(pg_catalog.jsonb_agg(target_id::text||':'||(p->>'method') order by (p->>'method') collate "C"),'[]'::jsonb)
    into expected_ids from pg_catalog.jsonb_array_elements(target.payment_totals) p;
  if row_ids is null or pg_catalog.jsonb_typeof(row_ids)<>'array' or row_ids<>expected_ids then
    raise exception 'El envío del turno todavía está incompleto';
  end if;
  update kebba_private.sales_shifts set exported_at=coalesce(exported_at,pg_catalog.clock_timestamp()),export_error=null where id=target_id;
  return pg_catalog.jsonb_build_object('ok',true,'id',target_id);
end;
$$;

create function public.kebba_shift_read(access_token text) returns jsonb language sql security invoker set search_path=''
as $$ select kebba_private.shift_snapshot(access_token) $$;
create function public.kebba_shift_action(access_token text, action text, request_id uuid, target_id uuid default null, expected_version bigint default null)
returns jsonb language sql security invoker set search_path=''
as $$ select kebba_private.shift_action(access_token,action,request_id,target_id,expected_version) $$;
create function public.kebba_shift_excel_read(bridge_token text) returns jsonb language sql security invoker set search_path=''
as $$ select kebba_private.shift_excel_read(bridge_token) $$;
create function public.kebba_shift_excel_ack(bridge_token text,target_id uuid,spreadsheet_id text,row_ids jsonb)
returns jsonb language sql security invoker set search_path=''
as $$ select kebba_private.shift_excel_ack(bridge_token,target_id,spreadsheet_id,row_ids) $$;

revoke all on function kebba_private.check_shift_access(text),kebba_private.shift_totals(uuid),kebba_private.assign_sale_shift(),
  kebba_private.queue_shift_export(),kebba_private.shift_snapshot(text),kebba_private.shift_action(text,text,uuid,uuid,bigint),
  kebba_private.check_shift_bridge(text),kebba_private.shift_excel_read(text),kebba_private.shift_excel_ack(text,uuid,text,jsonb)
from public,anon,authenticated;
revoke all on function public.kebba_shift_read(text), public.kebba_shift_action(text,text,uuid,uuid,bigint),
  public.kebba_shift_excel_read(text),public.kebba_shift_excel_ack(text,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function kebba_private.shift_snapshot(text),kebba_private.shift_action(text,text,uuid,uuid,bigint),
  kebba_private.shift_excel_read(text),kebba_private.shift_excel_ack(text,uuid,text,jsonb) to anon;
grant execute on function public.kebba_shift_read(text),public.kebba_shift_action(text,text,uuid,uuid,bigint),
  public.kebba_shift_excel_read(text),public.kebba_shift_excel_ack(text,uuid,text,jsonb) to anon;
