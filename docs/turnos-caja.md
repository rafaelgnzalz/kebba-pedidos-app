# Turnos y Caja en Google Sheets

Abrir turno inicia una agrupación compartida entre los dispositivos. Cerrar turno espera el guardado de los pedidos, exige que no queden pedidos con productos sin cobrar y congela los totales por método. Los turnos pueden cruzar medianoche; la fecha de la planilla es la fecha del cierre en Uruguay.

Cada cierre se carga una vez por método: Efectivo UYU, Efectivo BRL, PREX, Pix, Transferencia, Débito, Crédito u Otro. Pix usa los reales registrados en cada pago, y Efectivo BRL usa el importe cobrado después de descontar el cambio. El tipo de cambio de Caja solo valora saldos en pesos. Las ventas al personal se incluyen y las propinas siguen aparte.

La primera apertura activa el requisito de abrir turno para los nuevos cobros en esta pantalla. Los clientes anteriores sin etiqueta de turno siguen guardando ventas en el diario; si cobran fuera de turno, la pantalla advierte la cantidad para revisarla en Historial. Un cliente actualizado no puede enviar un cobro etiquetado a un turno que ya cerró.

## Estado del envío

Un cierre guardado figura como **Pendiente de envío** hasta que Google confirme las filas del turno. La solicitud de red solo despierta al puente; nunca confirma el envío por sí misma. El puente también consulta pendientes cada minuto, aun con la computadora apagada. Los reintentos conservan el identificador `turno:método` y comprueban importes y fechas existentes antes de confirmar. Si hay filas modificadas, duplicadas o un importe BRL faltante, el cierre permanece pendiente.

## Activación del puente

1. Importar a Google Sheets la Caja preparada, conservando las hojas Caja, Retiros y Socios y la nueva hoja Turnos.
2. Crear el proyecto de Apps Script desde la cuenta propietaria de Kebba y agregar `GoogleSheets.gs`. Puede estar vinculado a la planilla o ser independiente: el destino se abre por el ID configurado. Usar `appsscript.json` para limitar los permisos a planillas, consultas externas al servidor de Kebba y el disparador periódico; no necesita acceso a Drive, Gmail ni contactos.
3. Guardar en Propiedades del script `KEBBA_URL`, `KEBBA_PUBLIC_KEY`, `KEBBA_SHEET_ID`, `KEBBA_BRIDGE_TOKEN` y `KEBBA_WAKE_TOKEN`. El puente usa una clave nueva limitada a consultar y confirmar resúmenes de turnos; nunca la clave de pedidos, la de Caja ni una clave de administrador.
4. Ejecutar `instalarKebba`, autorizar el acceso solicitado por Google y publicar como aplicación web ejecutada por el propietario. El endpoint público solo acepta la clave de aviso y no devuelve ventas.
5. Configurar una sola fila privada en `kebba_private.shift_excel_connection` con el ID y enlace de esa planilla, la URL `/exec`, SHA-256 de la clave del puente y clave de aviso.
6. Comprobar un cierre de ejemplo con reintento y confirmación en la planilla de prueba antes de habilitar la conexión definitiva. No registrar ventas ficticias en la Caja real.

Las claves se guardan fuera del código y de la planilla. La página solo recibe el enlace de la Caja y el estado del envío. El período e importes de un cierre confirmado se conservan en la base aunque se borre el historial visible o se recupere un respaldo.

En Turnos, las cuatro cuentas habituales ya están asignadas. Transferencia, tarjetas y Otro quedan visibles como Sin asignar hasta elegir su cuenta en el listado lateral. Una moneda incompatible con la cuenta queda sin asignar. La capacidad de los rangos de Caja se extiende al superar las mil filas iniciales.

El puente conserva los separadores de fórmulas que devuelve la planilla y admite referencias a Turnos con o sin comillas, como sucede al convertir el Excel a Google Sheets.

## Verificación

`node --test --test-isolation=none tests/*.test.cjs` prueba las pantallas y el puente con servicios simulados. `test-turnos-rollback.sql` prueba las funciones reales de Postgres y revierte todas las filas y cambios de ejemplo. Las tablas son privadas, con acceso directo revocado y RLS sin políticas de lectura; solo las funciones protegidas por claves acceden a los datos.

La extensión pg_net permanece en su instalación comprobada. El asesor marca su metadato de esquema público; mover esa extensión no es necesario para cerrar turnos y su reubicación fue rechazada por la revisión automática. No se altera su catálogo manualmente.

Referencias: [Funciones de base de datos](https://supabase.com/docs/guides/database/functions), [pg_net](https://supabase.com/docs/guides/database/extensions/pg_net), [Google Apps Script: Range](https://developers.google.com/apps-script/reference/spreadsheet/range), [bloqueo del script](https://developers.google.com/apps-script/reference/lock/lock-service).
