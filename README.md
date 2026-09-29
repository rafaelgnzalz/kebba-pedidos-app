# KEBBA · Pedidos

Aplicación de pedidos para Android, iPhone y computadora. Abrí [KEBBA Pedidos](https://rafaelgnzalz.github.io/kebba-pedidos-app/) en el navegador. En Android, usá **Instalar aplicación**; en iPhone, abrila en Safari y elegí **Compartir → Agregar a pantalla de inicio**.

Para compartir pedidos y ventas entre dispositivos, pedí el **enlace compartido de KEBBA**. El enlace contiene una clave y no se publica en este repositorio. Desde el ícono instalado, podés pegarlo en **Configuración → Conectar este dispositivo**. Se necesita internet para guardar cambios compartidos.

La página pública sin clave sigue guardando los datos solo en ese navegador. Guardá un respaldo JSON desde **Configuración** al terminar el turno.

**Caja es para encargados.** Además del enlace habitual de pedidos, pide una clave de Caja distinta. El encargado puede abrir y cerrar la jornada en UYU y BRL, registrar retiros, rendir compras, anotar devoluciones, ingresos y gastos, y descargar el diario desde **Caja → Guardar registro**. **Salir de Caja** olvida la clave en ese dispositivo. Un respaldo de pedidos no incluye el diario de Caja.

## Durante el servicio

- En cada mesa o pedido podés escribir un nombre o una descripción para reconocer a las personas.
- En **Shawarmas** y **Kebabs**, cada variedad tiene su botón normal y su botón **Combo** con el precio final. El combo incluye papas fritas y Coca-Cola; Cocina ve ese detalle en la comanda.
- Cocina separa las comandas **por enviar**, **en preparación** y **listas para cobrar**. Las correcciones aparecen resumidas; el historial de ediciones queda plegado dentro de cada comanda.
- Al cobrar, elegí un medio de pago único o **Dividir cuenta por productos**. En una cuenta dividida, los productos aparecen agrupados por tipo y ordenados alfabéticamente: primero Kebabs, Kebab al plato, Shawarmas y Acompañamientos, y luego el resto. Agregá personas, elegí quién paga y tocá cada producto una vez para asignar todas sus unidades pendientes. Si se repiten productos y los pagan personas distintas, usá **+1 unidad**. Podés asignar todo lo pendiente a la persona elegida y revisar o corregir lo asignado. Después elegí el medio de pago de cada persona: efectivo UYU, efectivo BRL, PREX, Pix, tarjeta u otros. La venta se cierra cuando todos los productos tienen un pago asignado.
- En efectivo, escribí cuánto entregó cada persona para ver el cambio. En BRL también escribí el importe acordado en reales; no se convierte automáticamente desde pesos.
- Para Pix, la app muestra el importe en reales con la tasa fija de **$8,30 uruguayos por R$1** y guarda la tasa utilizada en el historial.
- En laptop, la app ocupa la altura de la pantalla: las mesas y pedidos sin mesa se alternan con dos botones, Cocina muestra una categoría a la vez y la Carta y la Comanda permanecen lado a lado. Cuando una lista es demasiado larga, se desplaza dentro de su panel sin mover la navegación ni las acciones de cobro.

## Pruebas

`node --test tests/kebba.test.cjs tests/cash.test.cjs`

Las pruebas usan almacenamiento, red y un DOM simulados. Cubren pedidos, Cocina, pagos, errores de guardado, sincronización y conservación del foco; no crean ventas reales ni sustituyen una revisión visual en el navegador.
