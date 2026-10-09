-- Ejecutar solamente en PostgreSQL aislado con las migraciones y fixtures de prueba.
-- Nunca usar estos fixtures en el proyecto de producción.
begin;
update kebba_private.app_state set token_sha256=encode(sha256(convert_to(repeat('a',64),'UTF8')),'hex'),version=7;
insert into kebba_private.sales_shifts(id,code,opened_at,closed_at,sales_count,total_uyu,payment_totals)
values('11111111-1111-4111-8111-111111111111','T-FIXTURE','2026-10-01T18:00:00Z','2026-10-01T19:00:00Z',1,100,'[]');
insert into kebba_private.cash_sales(sale_key,sold_at,sale)
values('1:1790880000000','2026-10-01T18:40:00Z','{"number":1,"closedAt":1790880000000,"total":100,"payment":"Efectivo"}');
insert into kebba_private.shift_sales(sale_key,shift_id)
values('1:1790880000000','11111111-1111-4111-8111-111111111111');

do $$
declare full_read jsonb; small_read jsonb; initial_fingerprint text; result jsonb; before_state jsonb; old_version bigint;
begin
  select state,version into before_state,old_version from kebba_private.app_state where id=1;
  full_read:=kebba_private.read_state(repeat('a',64));
  result:=public.kebba_read_if_changed(repeat('a',64),null);
  if result<>full_read then raise exception 'Primera lectura debe conservar el estado completo'; end if;
  small_read:=public.kebba_read_if_changed(repeat('a',64),7);
  if small_read<>jsonb_build_object('version',7,'unchanged',true) or small_read?'state' then
    raise exception 'Lectura sin cambios debe omitir el historial';
  end if;
  if public.kebba_read_if_changed(repeat('a',64),6)<>full_read
    or public.kebba_read_if_changed(repeat('a',64),8)<>full_read then
    raise exception 'Versiones distintas deben recibir todos los datos';
  end if;
  result:=public.kebba_shift_read_if_changed(repeat('a',64),null);
  if result-'fingerprint'<>kebba_private.shift_snapshot(repeat('a',64)) then
    raise exception 'Turnos deben conservar todos los campos';
  end if;
  initial_fingerprint:=result->>'fingerprint';
  result:=public.kebba_shift_read_if_changed(repeat('a',64),initial_fingerprint);
  if result<>jsonb_build_object('fingerprint',initial_fingerprint,'unchanged',true) then
    raise exception 'Turnos sin cambios deben enviar aviso pequeño';
  end if;
  result:=public.kebba_deleted_sales_if_changed(repeat('a',64),null);
  if result-'fingerprint'<>kebba_private.deleted_sales(repeat('a',64)) then
    raise exception 'Eliminados deben conservar todos los campos';
  end if;
  result:=public.kebba_deleted_sales_if_changed(repeat('a',64),result->>'fingerprint');
  if result->>'unchanged'<>'true' or result?'sales' then raise exception 'Eliminados sin cambios deben omitirse'; end if;
  if (select state from kebba_private.app_state where id=1)<>before_state
    or (select version from kebba_private.app_state where id=1)<>old_version then
    raise exception 'Las lecturas no deben modificar los pedidos';
  end if;
  update kebba_private.sales_shifts set exported_at='2026-10-01T19:01:00Z' where code='T-FIXTURE';
  result:=public.kebba_shift_read_if_changed(repeat('a',64),initial_fingerprint);
  if result->>'unchanged'='true' or result->'closed'->0->>'exported_at' is null
    or result->>'fingerprint'=initial_fingerprint then raise exception 'ACK de Google debe detectarse sin cambios en pedidos'; end if;
  result:=public.kebba_deleted_sales_if_changed(repeat('a',64),null);
  initial_fingerprint:=result->>'fingerprint';
  update kebba_private.cash_sales set deleted_at=now() where sale_key='1:1790880000000';
  result:=public.kebba_deleted_sales_if_changed(repeat('a',64),initial_fingerprint);
  if jsonb_array_length(result->'sales')<>1 or result->>'fingerprint'=initial_fingerprint then
    raise exception 'Una eliminación debe detectarse';
  end if;
  update kebba_private.cash_sales set deleted_at=null where sale_key='1:1790880000000';
  result:=public.kebba_deleted_sales_if_changed(repeat('a',64),result->>'fingerprint');
  if jsonb_array_length(result->'sales')<>0 or result->>'fingerprint'<>initial_fingerprint then
    raise exception 'Una restauración debe detectarse';
  end if;
  update kebba_private.app_state set version=8 where id=1;
  result:=public.kebba_read_if_changed(repeat('a',64),7);
  if result->>'version'<>'8' or not result?'state' then raise exception 'Cambios de otro dispositivo deben detectarse'; end if;
  update kebba_private.app_state set state=null where id=1;
  result:=public.kebba_read_if_changed(repeat('a',64),8);
  if not result?'state' or result->'state'<>'null'::jsonb then raise exception 'Inicialización nunca debe quedar oculta'; end if;
end;
$$;

-- La misma protección de la clave rige incluso cuando la versión o huella coincide.
set local role anon;
do $$
declare key text; i integer;
begin
  perform public.kebba_read_if_changed(repeat('a',64),8);
  foreach key in array array[null,repeat('b',64),'invalid'] loop
    for i in 1..3 loop
      begin
        if i=1 then perform public.kebba_read_if_changed(key,8);
        elsif i=2 then perform public.kebba_shift_read_if_changed(key,null);
        else perform public.kebba_deleted_sales_if_changed(key,null); end if;
        raise exception 'Una clave inválida obtuvo acceso';
      exception when sqlstate '22023' then null; end;
    end loop;
  end loop;
end;
$$;
reset role;
rollback;
select 'Lecturas completas, avisos pequeños, cambios, ACK, restauraciones, claves y no escritura: OK' as resultado;
