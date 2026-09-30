# KEBBA · Pedidos

Aplicación de pedidos para Android, iPhone y computadora. Abrí [KEBBA Pedidos](https://rafaelgnzalz.github.io/kebba-pedidos-app/) en el navegador. En Android, usá **Instalar aplicación**; en iPhone, abrila en Safari y elegí **Compartir → Agregar a pantalla de inicio**.

Para compartir pedidos y ventas entre dispositivos, pedí el **enlace compartido de KEBBA**. El enlace contiene una clave y no se publica en este repositorio. Desde el ícono instalado, podés pegarlo en **Configuración → Conectar este dispositivo**. Se necesita internet para guardar cambios compartidos.

La página pública sin clave sigue guardando los datos solo en ese navegador. Guardá un respaldo JSON desde **Configuración** al terminar el turno.

**Caja es para encargados.** Además del enlace habitual de pedidos, pide una clave de Caja distinta y conexión a internet. Permite llevar las jornadas de efectivo, compras, inversión y aportes. **Salir de Caja** olvida la clave en ese dispositivo. El enlace habitual del equipo no da acceso a estos datos.

## Caja y registro de gestión

- **Resumen:** ventas de todo el historial o del período elegido, medios de pago, compras y gastos por categoría, retiros pendientes y datos por completar.
- **Jornada:** abrir y cerrar la caja en UYU y BRL; registrar ingresos, gastos, aportes y reintegros. El cierre conserva el efectivo esperado, el contado y la diferencia por moneda. Los pagos electrónicos se muestran aparte del efectivo.
- **Registro:** compras pagadas por personas, transferencias entre personas, aportes en dinero o bienes y gastos fuera de caja. Permite buscar y filtrar por fecha, persona, concepto, proveedor, tipo y categoría; descargar CSV; y corregir o anular estos registros con motivo, conservando su historial.
- **Personas:** muestra lo financiado por cada persona: compras pagadas + aportes de dinero + transferencias enviadas − transferencias recibidas − reintegros. Los bienes se muestran aparte. Este saldo no fija cuánto se debe devolver ni cómo se reparten ganancias.
- **Retiros y Compras:** seguir el dinero entregado para compras, rendir comprobantes con categoría y registrar devoluciones. La rendición registra el gasto sin descontar de nuevo el efectivo que ya salió con el retiro.

Las transferencias entre personas cambian quién financió las compras y no agregan otro gasto. Los bienes sin valor conocido quedan pendientes de valorar. **La ganancia todavía no se calcula:** hacen falta los costos completos y distinguir inversión, mercadería y gastos del período. Los registros históricos no modifican el efectivo esperado de la jornada actual.

Usá **Caja → Respaldo** para descargar una copia JSON del diario financiero. En **Registro → Buscar y filtrar**, **Descargar Excel / CSV** exporta los movimientos que coinciden con los filtros. Un respaldo de pedidos desde Configuración no incluye el diario de Caja. Conservá estos archivos fuera del repositorio.

## Durante el servicio

- En cada mesa o pedido podés escribir un nombre o una descripción para reconocer a las personas.
- En **Shawarmas** y **Kebabs**, cada variedad tiene su botón normal y su botón **Combo** con el precio final. El combo incluye papas fritas y Coca-Cola; Cocina ve ese detalle en la comanda.
- Cocina separa las comandas **por enviar**, **en preparación** y **listas para cobrar**. Las correcciones aparecen resumidas; el historial de ediciones queda plegado dentro de cada comanda.
- Al cobrar, elegí un pago único o **Dividir por productos**. La cuenta dividida tiene dos pasos: **Repartir productos** y **Cobrar**, detallados abajo. Cada persona puede pagar con efectivo UYU, efectivo BRL, PREX, Pix, tarjeta u otros.
- En efectivo, escribí cuánto entregó cada persona para ver el cambio. En BRL también escribí el importe acordado en reales; no se convierte automáticamente desde pesos.
- Para Pix, la app muestra el importe en reales con la tasa fija de **$8,30 uruguayos por R$1** y guarda la tasa utilizada en el historial.
- En laptop, la app ocupa la altura de la pantalla: las mesas y pedidos sin mesa se alternan con dos botones, Cocina muestra una categoría a la vez y la Carta y la Comanda permanecen lado a lado. Cuando una lista es demasiado larga, se desplaza dentro de su panel sin mover la navegación ni las acciones de cobro.

### Dividir una cuenta por persona

1. En **Cobrar y cerrar**, tocá **Dividir por productos**. Elegí una persona en la fila superior; podés ponerle nombre y agregar hasta ocho personas.
2. Repartí con **+** y **−**. **Los restantes** asigna las unidades pendientes de ese producto; **Asignar todo lo pendiente** completa la cuenta de la persona elegida. Los productos quedan visibles para corregirlos y podés mostrar solo los pendientes. Abajo se ven el importe sin asignar y el subtotal de la persona elegida.
3. Cuando todas las unidades estén repartidas y cada persona tenga productos, tocá **Continuar al cobro**. Elegí el medio de pago de cada persona. **Siguiente persona** lleva al próximo pago que necesita datos; en efectivo UYU, **Importe justo** completa lo recibido sin cambio.
4. Revisá el resumen y confirmá después de recibir todos los pagos. Hasta confirmar, la comanda sigue abierta y no se registra ninguna venta.

**Deshacer reparto** recupera la última asignación o una persona quitada. **Volver al reparto** conserva los datos de pago; si cambiás los productos de alguien, revisá sus importes de efectivo UYU o BRL antes de confirmar. En pago único, **Más formas de pago** muestra las demás opciones disponibles.

## Pruebas

`node --test tests/kebba.test.cjs tests/cash.test.cjs tests/book.test.cjs`

Las pruebas usan almacenamiento, red y un DOM simulados. Cubren pedidos, Cocina, reparto y pagos, errores de guardado, sincronización, conservación del foco, aportes, transferencias, correcciones y exportación del registro. No crean ventas reales ni sustituyen una revisión visual en el navegador.
