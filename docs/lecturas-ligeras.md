# Lecturas pequeñas para reducir el consumo de Supabase

Los pedidos siguen comprobándose cada 1,8 segundos y los turnos y eliminados cada 4 segundos. Cuando los datos coinciden con la versión que tiene el dispositivo, el servidor devuelve un aviso pequeño. Las consultas automáticas se pausan mientras la página queda oculta y vuelven al mostrarla. Los guardados pendientes siguen enviándose.

La primera consulta y los cambios reciben los datos completos. Se conserva el historial para Caja, exportaciones, respaldos y las comprobaciones de guardado. El puente de Google Sheets y las funciones de escritura no cambian.

Los turnos y eliminados usan una huella del contenido para detectar también confirmaciones del puente que no cambian la versión de pedidos. Una respuesta pequeña jamás se utiliza como un estado vacío. Los errores de red, permisos o cuota mantienen los avisos de conexión. Si falta una función nueva en el servidor (`PGRST202`), ese dispositivo vuelve a la lectura anterior.

## Publicación y recuperación

1. Aplicar `lecturas-ligeras.sql` en una transacción. Agrega funciones; no modifica filas, tablas, claves ni permisos de tablas. Conserva las funciones anteriores y su protección mediante la clave del enlace.
2. Publicar el frontend y `sw.js` con la caché v24.
3. Recargar cada dispositivo cuando termine sus guardados. Los clientes que siguen abiertos con una versión anterior pueden trabajar, pero continúan consumiendo más datos.

Para recuperar la versión anterior del frontend, publicar el estado del commit `3fb6aa45ff298bb0365c67f490145b35afeb1686` con una nueva versión de caché. Las funciones adicionales pueden permanecer: los clientes anteriores no las utilizan. Nunca restablecer una copia de datos para revertir esta optimización.

## Verificación

Pruebas de pedidos, Cocina, pagos, propinas, historial, turnos, Caja, eliminaciones, restauraciones, exportaciones y puente; además, pruebas nuevas de lectura pequeña, dos dispositivos, reconexión, respuestas atrasadas y pestañas ocultas. `test-lecturas-rollback.sql` se ejecuta exclusivamente en PostgreSQL aislado con fixtures, junto con las pruebas de eliminaciones existentes.

Medición previa en producción del 9 de octubre: estado versión 3490, 288 ventas visibles, 290 ventas conservadas en diario y 4 turnos. La representación JSON completa mide 748.288 bytes; el aviso sin cambios, 36 bytes. Estos tamaños son contenido antes de compresión y encabezados, no una medición del consumo facturado ni una reducción de cada operación. Los cambios y el inicio de sesión todavía descargan el estado completo.

El consumo ya registrado no se borra. El panel de Supabase tarda en actualizarse y su política de restricciones sigue vigente hasta el reinicio del período. Esta mejora reduce futuras transferencias; no garantiza disponibilidad frente a restricciones del proveedor.
