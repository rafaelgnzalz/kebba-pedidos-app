/* Excel detallado del historial. Los importes y precios salen del cobro guardado. */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.KebbaHistoryExcel = api;
})(typeof window !== "undefined" ? window : globalThis, function (root) {
  "use strict";
  const MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  const MONEY = '#,##0.00;[Red](#,##0.00);"—"';
  const DATE = "dd/mm/yyyy", TIME = "hh:mm:ss", DATETIME = "dd/mm/yyyy hh:mm:ss";
  const FIRST = 9, HEADER = 8, DAY = 86400000;
  const DARK = "FF342B23", ORANGE = "FFF2A14A", LIGHT = "FFFFF4E8";
  let libraryPromise;
  const text = value => String(value ?? "").slice(0, 32767);
  const round = n => Math.round((n + Number.EPSILON) * 100) / 100;
  const sum = values => round(values.reduce((a, b) => a + (typeof b === "number" ? b : 0), 0));
  const value = n => typeof n === "number" && Number.isFinite(n) ? n : null;
  const criterion = ref => `SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(${ref},"~","~~"),"*","~*"),"?","~?")`;
  const minor = n => value(n) == null ? null : n / 100;
  const type = order => order.saleType === "staff" ? "Personal al coste" : "Cliente";
  const split = order => order.paymentSplit === "amounts" ? "Por importes" : order.payments?.length > 1 ? "Por productos" : "Pago único";
  const method = part => part.method === "Efectivo" ? "Efectivo UYU" : text(part.method);
  const label = order => text(order.label || (/^m\d+$/.test(order.slot) ? `Mesa ${Number(order.slot.slice(1))}` : /^p\d+$/.test(order.slot) ? `Pedido ${String.fromCharCode(65 + Number(order.slot.slice(1)) - 1)}` : order.slot));
  const price = line => line.unitPrice + sum((line.mods || []).map(mod => mod.price));
  const mods = line => (line.mods || []).map(mod => `${mod.name}${mod.description ? `: ${mod.description}` : ""}`).join("; ");
  const lineDescription = (line, qty = line.qty) => `${qty} × ${line.name}${mods(line) ? ` [${mods(line)}]` : ""}${line.note ? ` (${line.note})` : ""}`;
  function key(at) {
    const d = new Date(at);
    return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")].join("-");
  }
  function dateKey(date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) throw Error("Elegí fechas válidas para exportar.");
    const [y, m, d] = date.split("-").map(Number);
    const parsed = new Date(Date.UTC(y, m - 1, d));
    if (parsed.getUTCFullYear() !== y || parsed.getUTCMonth() !== m - 1 || parsed.getUTCDate() !== d) throw Error("Elegí fechas válidas para exportar.");
    return Date.UTC(y, m - 1, d) / DAY + 25569;
  }
  // Excel no guarda zona horaria: conservamos la fecha y hora local mostradas en la app.
  function serial(at, onlyDate = false) {
    if (at == null) return null;
    const d = new Date(at);
    if (!Number.isFinite(d.getTime())) return null;
    return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), onlyDate ? 0 : d.getHours(), onlyDate ? 0 : d.getMinutes(), onlyDate ? 0 : d.getSeconds()) / DAY + 25569;
  }
  const time = at => { const n = serial(at); return n == null ? null : n - Math.floor(n); };
  const minutes = (from, to) => from == null || to == null || to < from ? null : round((to - from) / 60000);
  function payments(order) {
    if (order.payments?.length) return order.payments;
    return [{ payer: order.name || "", method: order.payment, amount: order.total,
      items: (order.lines || []).map(line => ({ lineId: line.id, qty: line.qty })),
      cashReceived: order.cashReceived, cashChange: order.cashChange,
      brlChargedMinor: order.brlChargedMinor, brlReceivedMinor: order.brlReceivedMinor, brlChangeMinor: order.brlChangeMinor,
      pixRate: order.pixRate, pixBrl: order.pixBrl }];
  }
  function assigned(order, part) {
    if (order.paymentSplit === "amounts") return "Importe de la cuenta; sin asignación de productos";
    return (part.items || []).map(item => {
      const line = (order.lines || []).find(line => line.id === item.lineId);
      return line ? lineDescription(line, item.qty) : `${item.qty} × línea ${item.lineId}`;
    }).join("\n");
  }
  function formula(sheet, address, expression, result, format = MONEY) {
    const cell = sheet.getCell(address);
    cell.value = { formula: expression, result };
    cell.numFmt = format;
    return cell;
  }
  function styleHeader(sheet, row, columns) {
    sheet.getRow(row).height = 32;
    for (let col = 1; col <= columns; col++) {
      const cell = sheet.getCell(row, col);
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: DARK } };
      cell.font = { name: "Arial", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    }
  }
  function base(workbook, name, widths, options) {
    const sheet = workbook.addWorksheet(name, { properties: { defaultRowHeight: 22 }, pageSetup: { orientation: "landscape", paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
    sheet.columns = widths.map(width => ({ width }));
    sheet.views = [{ showGridLines: false }];
    sheet.getCell("A2").value = `${text(options.name || "KEBBA")} · ${name}`;
    sheet.getCell("A2").font = { name: "Arial", size: 14, bold: true, color: { argb: DARK } };
    sheet.getRow(2).height = 26;
    sheet.getCell("A4").value = "Desde"; sheet.getCell("B4").value = dateKey(options.from);
    sheet.getCell("C4").value = "Hasta"; sheet.getCell("D4").value = dateKey(options.to);
    sheet.getCell("B4").numFmt = DATE; sheet.getCell("D4").numFmt = DATE;
    sheet.getCell("C4").alignment = { indent: 1 };
    return sheet;
  }
  function detail(workbook, name, headers, widths, rows, formats, totals, options) {
    const sheet = base(workbook, name, widths, options);
    sheet.getCell("A6").value = `${rows.length} registros`;
    sheet.getRow(HEADER).values = headers;
    rows.forEach((row, index) => { sheet.getRow(FIRST + index).values = row.map(v => typeof v === "string" ? v === "" ? null : text(v) : v); });
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber !== 2) row.font = { name: "Arial", size: 10 };
      if (rowNumber >= FIRST) {
        const textLines = rows[rowNumber - FIRST].map((v, index) => typeof v === "string" ? v.split("\n").reduce((count, line) => count + Math.max(1, Math.ceil(line.length / Math.max(8, widths[index] * 0.9))), 0) : 1);
        row.height = Math.min(409, Math.max(38, Math.max(...textLines) * 14 + 8));
        for (let column = 1; column <= headers.length; column++) {
          const cell = row.getCell(column);
          cell.alignment = { vertical: "middle", horizontal: typeof cell.value === "string" ? "left" : "right", indent: 1, wrapText: typeof cell.value === "string" };
          if (rowNumber % 2 === 1) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: LIGHT } };
        }
        for (const [col, format] of Object.entries(formats)) row.getCell(Number(col)).numFmt = format;
      }
    });
    styleHeader(sheet, HEADER, headers.length);
    sheet.views = [{ state: "frozen", xSplit: 1, ySplit: HEADER, topLeftCell: `B${FIRST}`, showGridLines: false }];
    sheet.autoFilter = { from: { row: HEADER, column: 1 }, to: { row: Math.max(HEADER, FIRST + rows.length - 1), column: headers.length } };
    sheet.pageSetup.printTitlesRow = `1:${HEADER}`;
    if (!rows.length) sheet.getCell(`A${FIRST}`).value = "Sin registros en el período";
    const totalRow = FIRST + rows.length + 1;
    sheet.getCell(totalRow, 1).value = "TOTAL FILTRADO";
    sheet.getCell(totalRow, 1).font = { name: "Arial", size: 10, bold: true };
    for (const col of totals) {
      const letter = sheet.getColumn(col).letter;
      formula(sheet, `${letter}${totalRow}`, rows.length ? `SUBTOTAL(109,${letter}${FIRST}:${letter}${FIRST + rows.length - 1})` : "0", sum(rows.map(row => typeof row[col - 1] === "object" ? row[col - 1]?.result : row[col - 1])), formats[col] || MONEY).font = { name: "Arial", size: 10, bold: true };
    }
    return sheet;
  }
  function buildWorkbook(ExcelJS, source, options) {
    dateKey(options.from); dateKey(options.to);
    if (options.from > options.to) throw Error("La fecha desde debe ser anterior o igual a la fecha hasta.");
    const inRange = at => key(at) >= options.from && key(at) <= options.to;
    const orders = (source.history || []).filter(order => inRange(order.closedAt)).slice().sort((a, b) => a.closedAt - b.closedAt || a.number - b.number);
    const tips = (source.tips || []).filter(tip => inRange(tip.createdAt)).slice().sort((a, b) => a.createdAt - b.createdAt);
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "KEBBA"; workbook.created = new Date(options.generatedAt ?? Date.now());
    workbook.calcProperties.fullCalcOnLoad = true;
    const summary = base(workbook, "Resumen", [38, 20, 28, 23, 22, 22], options);
    const salesRows = [], productRows = [], paymentRows = [];
    for (const order of orders) {
      const parts = payments(order), row = FIRST + salesRows.length;
      const paid = sum(parts.map(part => part.amount));
      salesRows.push([order.number, serial(order.closedAt, true), time(order.closedAt), type(order), label(order), text(order.name),
        serial(order.openedAt), serial(order.sentAt), serial(order.readyAt), order.total, sum((order.lines || []).map(line => line.qty)), split(order),
        [...new Set(parts.map(method))].join(" / "), parts.length, paid, { formula: `J${row}-O${row}`, result: round(order.total - paid) },
        minutes(order.sentAt, order.readyAt), minutes(order.openedAt, order.closedAt)]);
      for (const line of order.lines || []) {
        const r = FIRST + productRows.length, extra = sum((line.mods || []).map(mod => mod.price));
        const people = order.paymentSplit === "amounts" ? "Reparto por importes" : parts.flatMap((part, index) => (part.items || []).filter(item => item.lineId === line.id).map(item => `${part.payer || `Persona ${index + 1}`}: ${item.qty}`)).join("; ");
        productRows.push([order.number, serial(order.closedAt, true), type(order), label(order), text(order.name), text(line.id), text(line.productId), text(line.name), line.qty,
          line.unitPrice, extra, { formula: `J${r}+K${r}`, result: price(line) }, { formula: `I${r}*L${r}`, result: line.qty * price(line) }, mods(line), text(line.note), people]);
      }
      parts.forEach((part, index) => {
        const currency = ["Efectivo BRL", "Pix"].includes(part.method) ? "BRL" : "UYU";
        const charged = part.method === "Efectivo BRL" ? minor(part.brlChargedMinor) : part.method === "Pix" ? value(part.pixBrl) : part.amount;
        const note = part.method === "Efectivo BRL" ? "Importe acordado en reales" : part.method === "Pix" && (value(part.pixBrl) == null || value(part.pixRate) == null) ? "Importe o tasa histórica de Pix no registrados" : "";
        paymentRows.push([order.number, serial(order.closedAt, true), time(order.closedAt), type(order), label(order), text(order.name), index + 1,
          text(part.payer || `Persona ${index + 1}`), split(order), method(part), part.amount, currency, charged,
          value(part.cashReceived), value(part.cashChange), minor(part.brlReceivedMinor), minor(part.brlChangeMinor), value(part.pixRate), assigned(order, part), note]);
      });
    }
    const tipRows = tips.map(tip => [text(tip.id), serial(tip.createdAt, true), time(tip.createdAt), text(tip.currency), minor(tip.amountMinor), text(tip.note)]);
    const sales = detail(workbook, "Ventas", ["Nº venta", "Fecha cierre", "Hora cierre", "Tipo de venta", "Mesa / pedido", "Nombre / referencia", "Apertura", "Envío a Cocina", "Listo", "Venta UYU", "Unidades registradas", "Tipo de reparto", "Medios de pago", "Cantidad de pagos", "Pagos UYU", "Diferencia UYU", "Minutos en Cocina", "Minutos hasta cierre"],
      [14, 16, 15, 23, 23, 30, 25, 25, 25, 19, 18, 22, 34, 19, 19, 19, 20, 22], salesRows,
      { 2: DATE, 3: TIME, 7: DATETIME, 8: DATETIME, 9: DATETIME, 10: MONEY, 11: "0", 14: "0", 15: MONEY, 16: MONEY, 17: "0.00", 18: "0.00" }, [10, 11, 14, 15, 16], options);
    detail(workbook, "Productos", ["Nº venta", "Fecha cierre", "Tipo de venta", "Mesa / pedido", "Nombre / referencia", "ID línea", "ID producto", "Producto", "Cantidad", "Precio base UYU", "Adicionales por unidad UYU", "Precio final UYU", "Total línea UYU", "Opciones / combo", "Observación", "Reparto por persona"],
      [14, 16, 23, 23, 30, 26, 24, 36, 14, 21, 23, 21, 21, 52, 52, 45], productRows,
      { 2: DATE, 9: "0", 10: MONEY, 11: MONEY, 12: MONEY, 13: MONEY }, [9, 13], options);
    detail(workbook, "Pagos", ["Nº venta", "Fecha cierre", "Hora cierre", "Tipo de venta", "Mesa / pedido", "Nombre / referencia", "Nº pago", "Persona que paga", "Tipo de reparto", "Medio de pago", "Parte de la venta UYU", "Moneda del cobro", "Cobrado en esa moneda", "Recibido UYU", "Cambio UYU", "Recibido BRL", "Cambio BRL", "Tasa Pix UYU por BRL", "Productos asignados / detalle", "Observación del cobro"],
      [14, 16, 15, 23, 23, 30, 12, 28, 22, 23, 23, 18, 24, 20, 20, 20, 20, 23, 62, 42], paymentRows,
      { 2: DATE, 3: TIME, 7: "0", 11: MONEY, 13: MONEY, 14: MONEY, 15: MONEY, 16: MONEY, 17: MONEY, 18: "0.0000" }, [11, 14, 15, 16, 17], options);
    detail(workbook, "Propinas", ["ID propina", "Fecha", "Hora", "Moneda", "Importe", "Detalle"], [32, 16, 15, 14, 20, 70], tipRows,
      { 2: DATE, 3: TIME, 5: MONEY }, [], options);
    sales.addConditionalFormatting({ ref: `P${FIRST}:P${Math.max(FIRST, FIRST + salesRows.length - 1)}`, rules: [{ type: "cellIs", operator: "notEqual", formulae: ["0"], style: { font: { color: { argb: "FF9C0006" } }, fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFC7CE" } } } }] });
    const end = rows => Math.max(FIRST, FIRST + rows.length - 1);
    const saleRange = col => `'Ventas'!$${col}$${FIRST}:$${col}$${end(salesRows)}`;
    const payRange = col => `'Pagos'!$${col}$${FIRST}:$${col}$${end(paymentRows)}`;
    const tipRange = col => `'Propinas'!$${col}$${FIRST}:$${col}$${end(tipRows)}`;
    const productRange = col => `'Productos'!$${col}$${FIRST}:$${col}$${end(productRows)}`;
    summary.getCell("A5").value = "Generado"; summary.getCell("B5").value = serial(options.generatedAt ?? Date.now()); summary.getCell("B5").numFmt = DATETIME;
    const total = sum(orders.map(order => order.total));
    summary.getCell("A7").value = "Ventas UYU"; formula(summary, "B7", `SUM(${saleRange("J")})`, total);
    summary.getCell("A8").value = "Ventas a clientes UYU"; formula(summary, "B8", `SUMIF(${saleRange("D")},"Cliente",${saleRange("J")})`, sum(orders.filter(order => type(order) === "Cliente").map(order => order.total)));
    summary.getCell("A9").value = "Personal al coste UYU"; formula(summary, "B9", `SUMIF(${saleRange("D")},"Personal al coste",${saleRange("J")})`, sum(orders.filter(order => type(order) !== "Cliente").map(order => order.total)));
    summary.getCell("A10").value = "Cantidad de ventas"; formula(summary, "B10", `COUNT(${saleRange("A")})`, orders.length, "0");
    summary.getCell("A11").value = "Ticket promedio UYU"; formula(summary, "B11", "IF(B10=0,0,B7/B10)", orders.length ? round(total / orders.length) : 0);
    summary.getCell("A12").value = "Unidades de productos a clientes"; formula(summary, "B12", `SUMIF(${productRange("C")},"Cliente",${productRange("I")})`, sum(productRows.filter(row => row[2] === "Cliente").map(row => row[8])), "0");
    ["UYU", "BRL"].forEach((currency, index) => { summary.getCell(7 + index, 4).value = `Propinas ${currency}`; formula(summary, `E${7 + index}`, `SUMIF(${tipRange("D")},"${currency}",${tipRange("E")})`, sum(tips.filter(tip => tip.currency === currency).map(tip => tip.amountMinor / 100))); });
    summary.getCell("D10").value = "Propinas separadas de ventas";
    summary.getCell("D11").value = "UYU y BRL se muestran por separado";
    summary.getCell("A14").value = "Cobros por medio de pago";
    summary.getRow(16).values = ["Medio de pago", "Cantidad de pagos", "Venta UYU", "Cobrado BRL"];
    styleHeader(summary, 16, 4);
    const methods = [...new Set(paymentRows.map(row => row[9]))].sort((a, b) => a.localeCompare(b));
    methods.forEach((m, index) => {
      const r = 17 + index, matching = paymentRows.filter(row => row[9] === m);
      summary.getCell(r, 1).value = m;
      const exactMethod = criterion(`A${r}`), brl = matching.filter(row => row[11] === "BRL");
      formula(summary, `B${r}`, `COUNTIF(${payRange("J")},${exactMethod})`, matching.length, "0");
      formula(summary, `C${r}`, `SUMIF(${payRange("J")},${exactMethod},${payRange("K")})`, sum(matching.map(row => row[10])));
      const missing = `COUNTIFS(${payRange("J")},${exactMethod},${payRange("L")},"BRL")-COUNTIFS(${payRange("J")},${exactMethod},${payRange("L")},"BRL",${payRange("M")},">=0")`;
      formula(summary, `D${r}`, `IF(${missing}>0,"Sin dato",SUMIFS(${payRange("M")},${payRange("J")},${exactMethod},${payRange("L")},"BRL"))`, brl.some(row => row[12] == null) ? "Sin dato" : sum(brl.map(row => row[12])));
    });
    if (!methods.length) summary.getCell("A17").value = "Sin cobros en el período";
    let r = 20 + Math.max(1, methods.length);
    summary.getCell(r, 1).value = "Ventas y propinas por fecha";
    r += 2; summary.getRow(r).values = ["Fecha", "Clientes UYU", "Personal UYU", "Ventas UYU", "Propinas UYU", "Propinas BRL"];
    styleHeader(summary, r, 6);
    const dates = [...new Set([...orders.map(order => key(order.closedAt)), ...tips.map(tip => key(tip.createdAt))])].sort();
    for (const day of dates) {
      r++; const dayOrders = orders.filter(order => key(order.closedAt) === day), dayTips = tips.filter(tip => key(tip.createdAt) === day);
      summary.getCell(r, 1).value = dateKey(day); summary.getCell(r, 1).numFmt = DATE;
      for (const [col, kind] of [["B", "Cliente"], ["C", "Personal al coste"]]) formula(summary, `${col}${r}`, `SUMIFS(${saleRange("J")},${saleRange("B")},A${r},${saleRange("D")},"${kind}")`, sum(dayOrders.filter(order => type(order) === kind).map(order => order.total)));
      formula(summary, `D${r}`, `B${r}+C${r}`, sum(dayOrders.map(order => order.total)));
      for (const [col, currency] of [["E", "UYU"], ["F", "BRL"]]) formula(summary, `${col}${r}`, `SUMIFS(${tipRange("E")},${tipRange("B")},A${r},${tipRange("D")},"${currency}")`, sum(dayTips.filter(tip => tip.currency === currency).map(tip => tip.amountMinor / 100)));
    }
    if (!dates.length) summary.getCell(++r, 1).value = "Sin registros en el período";
    r += 3; summary.getCell(r, 1).value = "Productos vendidos a clientes";
    r += 2; summary.getRow(r).values = ["Producto", "Unidades", "Venta UYU con adicionales"];
    styleHeader(summary, r, 3);
    summary.getCell(r, 5).value = "ID producto";
    summary.getCell(r, 5).font = { name: "Arial", size: 10, bold: true };
    const products = new Map();
    for (const row of productRows.filter(row => row[2] === "Cliente")) {
      const k = JSON.stringify([row[6], row[7]]), entry = products.get(k) || { id: row[6], name: row[7], qty: 0, total: 0 };
      entry.qty += row[8]; entry.total += row[12].result; products.set(k, entry);
    }
    for (const p of [...products.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))) {
      r++; summary.getCell(r, 1).value = p.name;
      // La clave contiene también el nombre histórico para distinguir cambios de carta.
      summary.getCell(r, 5).value = p.id;
      formula(summary, `B${r}`, `SUMIFS(${productRange("I")},${productRange("C")},"Cliente",${productRange("G")},${criterion(`E${r}`)},${productRange("H")},${criterion(`A${r}`)})`, p.qty, "0");
      formula(summary, `C${r}`, `SUMIFS(${productRange("M")},${productRange("C")},"Cliente",${productRange("G")},${criterion(`E${r}`)},${productRange("H")},${criterion(`A${r}`)})`, round(p.total));
    }
    if (!products.size) summary.getCell(++r, 1).value = "Sin productos vendidos a clientes";
    summary.eachRow((row, rowNumber) => {
      if (rowNumber === 2) return;
      row.eachCell(cell => {
        if (cell.font?.bold && cell.fill) return;
        cell.font = { name: "Arial", size: 10, ...(rowNumber >= 7 && rowNumber <= 12 && cell.col === 2 ? { bold: true } : {}) };
        cell.alignment = { vertical: "middle", horizontal: typeof cell.value === "number" || cell.value?.formula ? "right" : "left" };
      });
    });
    summary.getColumn(2).width = 25;
    summary.properties.tabColor = { argb: ORANGE };
    return { workbook, fileName: options.from === options.to ? `kebba-historial-${options.from}.xlsx` : `kebba-historial-${options.from}-a-${options.to}.xlsx`, saleCount: orders.length, tipCount: tips.length };
  }
  function loadLibrary() {
    if (root.ExcelJS) return Promise.resolve(root.ExcelJS);
    if (!libraryPromise) libraryPromise = new Promise((resolve, reject) => {
      const script = root.document.createElement("script");
      script.src = "./vendor/exceljs-4.4.0.min.js";
      script.onload = () => root.ExcelJS ? resolve(root.ExcelJS) : reject(Error("No se pudo cargar Excel. Recargá y volvé a intentar."));
      script.onerror = () => { script.remove(); reject(Error("No se pudo cargar Excel. Recargá y volvé a intentar.")); };
      root.document.head.append(script);
    }).catch(error => { libraryPromise = null; throw error; });
    return libraryPromise;
  }
  async function createExport(source, options) {
    const result = buildWorkbook(await loadLibrary(), source, options);
    const buffer = await result.workbook.xlsx.writeBuffer();
    return { buffer, fileName: result.fileName, saleCount: result.saleCount, tipCount: result.tipCount, mime: MIME };
  }
  return { buildWorkbook, createExport, MIME };
});
