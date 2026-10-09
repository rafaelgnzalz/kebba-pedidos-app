-- Actualización aditiva: no modifica tablas, ventas, turnos, Caja ni el puente.
-- Los dispositivos anteriores conservan sus funciones de lectura habituales.
begin;

create or replace function kebba_private.read_state_if_changed(access_token text, known_version bigint default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  if access_token is null or access_token !~ '^[0-9a-f]{64}$' then
    raise exception 'Enlace de KEBBA inválido' using errcode='22023';
  end if;
  -- Una sola consulta comprueba la clave y devuelve una versión coherente con su estado.
  select case when known_version is not null and s.version=known_version and s.state is not null
    then pg_catalog.jsonb_build_object('version',s.version,'unchanged',true)
    else pg_catalog.jsonb_build_object('version',s.version,'state',s.state) end
    into result from kebba_private.app_state s where s.id=1
    and s.token_sha256=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(access_token,'UTF8')),'hex');
  if result is null then raise exception 'Enlace de KEBBA inválido' using errcode='22023'; end if;
  return result;
end;
$$;

create or replace function kebba_private.shift_snapshot_if_changed(access_token text, known_fingerprint text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; fingerprint text;
begin
  result:=kebba_private.shift_snapshot(access_token);
  fingerprint:=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(result::text,'UTF8')),'hex');
  if fingerprint=known_fingerprint then
    return pg_catalog.jsonb_build_object('fingerprint',fingerprint,'unchanged',true);
  end if;
  return result||pg_catalog.jsonb_build_object('fingerprint',fingerprint);
end;
$$;

create or replace function kebba_private.deleted_sales_if_changed(access_token text, known_fingerprint text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; fingerprint text;
begin
  result:=kebba_private.deleted_sales(access_token);
  fingerprint:=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(result::text,'UTF8')),'hex');
  if fingerprint=known_fingerprint then
    return pg_catalog.jsonb_build_object('fingerprint',fingerprint,'unchanged',true);
  end if;
  return result||pg_catalog.jsonb_build_object('fingerprint',fingerprint);
end;
$$;

create or replace function public.kebba_read_if_changed(access_token text, known_version bigint default null)
returns jsonb language sql security invoker set search_path='' as $$
  select kebba_private.read_state_if_changed(access_token,known_version);
$$;
create or replace function public.kebba_shift_read_if_changed(access_token text, known_fingerprint text default null)
returns jsonb language sql security invoker set search_path='' as $$
  select kebba_private.shift_snapshot_if_changed(access_token,known_fingerprint);
$$;
create or replace function public.kebba_deleted_sales_if_changed(access_token text, known_fingerprint text default null)
returns jsonb language sql security invoker set search_path='' as $$
  select kebba_private.deleted_sales_if_changed(access_token,known_fingerprint);
$$;

revoke all on function kebba_private.read_state_if_changed(text,bigint),
  kebba_private.shift_snapshot_if_changed(text,text),kebba_private.deleted_sales_if_changed(text,text),
  public.kebba_read_if_changed(text,bigint),public.kebba_shift_read_if_changed(text,text),
  public.kebba_deleted_sales_if_changed(text,text) from public;
grant execute on function kebba_private.read_state_if_changed(text,bigint),
  kebba_private.shift_snapshot_if_changed(text,text),kebba_private.deleted_sales_if_changed(text,text),
  public.kebba_read_if_changed(text,bigint),public.kebba_shift_read_if_changed(text,text),
  public.kebba_deleted_sales_if_changed(text,text) to anon,authenticated;

notify pgrst,'reload schema';
commit;
