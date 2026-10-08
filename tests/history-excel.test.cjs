const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('../vendor/exceljs-4.4.0.min.js');
const { buildWorkbook } = require('../history-excel.js');
const at = value => new Date(value).getTime();
function fixture() {
  const first = at('2026-10-07T20:00:00'), second = at('2026-10-08T00:00:00');
  const line = (id, name, unitPrice, qty = 1, mods = [], note = '') => ({ id, productId: id, name, unitPrice, qty, mods, note });
  return {
    orders: { m1: { total: 9999 } },
    history: [
      { number: 1, slot: 'm1', label: 'Mesa 1', name: 'Pareja de azul', openedAt: first - 3600000, sentAt: first - 3000000, readyAt: first - 2400000, closedAt: first, total: 420, payment: 'Dividido',
        lines: [line('kebab', 'Kebab Pollo', 250, 1, [{ name: 'Combo', price: 70, description: 'Papas y Coca-Cola' }], 'Sin sal'), line('papas', 'Papas fritas', 100)],
        payments: [{ payer: 'Ana', method: 'Efectivo', amount: 320, cashReceived: 500, cashChange: 180, items: [{ lineId: 'kebab', qty: 1 }] },
          { payer: 'Luis', method: 'Pix', amount: 100, pixRate: 8, pixBrl: 12.5, items: [{ lineId: 'papas', qty: 1 }] }] },
      { number: 2, slot: 'm2', label: 'Mesa 2', name: 'Juan', openedAt: second - 10000, sentAt: null, readyAt: null, closedAt: second, total: 100, payment: 'Dividido', paymentSplit: 'amounts', lines: [line('papas', 'Papas fritas', 100)],
        payments: [{ payer: 'Marta', method: 'Efectivo BRL', amount: 40, brlChargedMinor: 550, brlReceivedMinor: 1000, brlChangeMinor: 450, items: [] },
          { payer: 'Juan', method: 'PREX', amount: 60, items: [] }] },
      { number: 3, slot: 'p0', saleType: 'staff', label: 'Personal · Al coste', name: 'Cocina', openedAt: first, closedAt: first + 1000, total: 150, payment: 'Transferencia',
        lines: [line('staff-manual', 'Venta al personal', 150, 1, [], 'Cena del equipo')], payments: [{ payer: 'Cocina', method: 'Transferencia', amount: 150, items: [{ lineId: 'staff-manual', qty: 1 }] }] },
      { number: 4, slot: 'm3', closedAt: at('2026-10-08T23:59:59'), total: 50, payment: 'Débito', lines: [line('bebida', 'Agua', 50)], payments: [{ method: 'Débito', amount: 50, items: [{ lineId: 'bebida', qty: 1 }] }] },
      { number: 5, slot: 'm4', closedAt: at('2026-10-09T00:00:00'), total: 999, payment: 'Débito', lines: [line('fuera', 'Fuera de período', 999)] }
    ],
    tips: [
      { id: 't1', createdAt: first, currency: 'UYU', amountMinor: 2550, note: 'Turno noche' },
      { id: 't2', createdAt: second, currency: 'BRL', amountMinor: 1075, note: 'Propina reais' },
      { id: 't3', createdAt: at('2026-10-09T00:00:00'), currency: 'UYU', amountMinor: 9900, note: 'Fuera de período' }
    ]
  };
}
function build(source = fixture(), options = {}) {
  return buildWorkbook(ExcelJS, source, { from: '2026-10-07', to: '2026-10-08', name: 'KEBBA', generatedAt: at('2026-10-10T12:00:00'), ...options });
}
function find(sheet, column, expected) {
  let row;
  sheet.eachRow((r, n) => { if (r.getCell(column).value === expected) row = n; });
  assert.ok(row, `${expected} no encontrado`); return row;
}
test('el rango incluye ambos días completos, excluye pedidos abiertos y no modifica la fuente', () => {
  const source = fixture(), before = JSON.stringify(source), result = build(source);
  assert.equal(result.saleCount, 4); assert.equal(result.tipCount, 2);
  assert.equal(JSON.stringify(source), before);
  assert.equal(result.fileName, 'kebba-historial-2026-10-07-a-2026-10-08.xlsx');
  const day = build(source, { to: '2026-10-07' });
  assert.equal(day.saleCount, 2); assert.equal(day.tipCount, 1);
  assert.equal(day.fileName, 'kebba-historial-2026-10-07.xlsx');
  assert.throws(() => build(source, { from: '2026-10-09' }), /anterior/);
  assert.throws(() => build(source, { from: '' }), /válidas/);
  assert.throws(() => build(source, { from: '2026-02-30' }), /válidas/);
});
test('ventas, productos y pagos reconcilian sin duplicar ventas divididas ni sumar propinas', () => {
  const wb = build().workbook;
  assert.deepEqual(wb.worksheets.map(sheet => sheet.name), ['Resumen', 'Ventas', 'Productos', 'Pagos', 'Propinas']);
  const s = wb.getWorksheet('Resumen');
  assert.equal(s.getCell('B7').result, 720);
  assert.equal(s.getCell('B8').result, 570);
  assert.equal(s.getCell('B9').result, 150);
  assert.equal(s.getCell('B10').result, 4);
  assert.equal(s.getCell('B11').result, 180);
  assert.equal(s.getCell('B12').result, 4);
  assert.equal(s.getCell('E7').result, 25.5); assert.equal(s.getCell('E8').result, 10.75);
  const sales = wb.getWorksheet('Ventas'), p = wb.getWorksheet('Productos'), pay = wb.getWorksheet('Pagos');
  assert.equal(sales.getCell('P9').result, 0); assert.equal(sales.getCell('J9').value, 420);
  assert.equal(p.getCell('J9').value, 250); assert.equal(p.getCell('K9').value, 70);
  assert.equal(p.getCell('L9').result, 320); assert.equal(p.getCell('M9').result, 320);
  assert.match(p.getCell('N9').value, /Papas y Coca-Cola/); assert.equal(p.getCell('O9').value, 'Sin sal');
  assert.equal(pay.getCell('N9').value, 500); assert.equal(pay.getCell('O9').value, 180);
  const pixRow = find(pay, 10, 'Pix'), brlRow = find(pay, 10, 'Efectivo BRL');
  assert.equal(pay.getCell(pixRow, 13).value, 12.5); assert.equal(pay.getCell(pixRow, 18).value, 8);
  assert.equal(pay.getCell(brlRow, 13).value, 5.5); assert.equal(pay.getCell(brlRow, 16).value, 10); assert.equal(pay.getCell(brlRow, 17).value, 4.5);
  assert.equal(pay.getCell(brlRow, 9).value, 'Por importes'); assert.match(pay.getCell(brlRow, 19).value, /sin asignación/);
  assert.equal(s.getCell(find(s, 1, 'Pix'), 4).result, 12.5);
  assert.equal(s.getCell(find(s, 1, 'Efectivo BRL'), 4).result, 5.5);
  assert.equal(s.getCell(find(s, 1, 'Papas fritas'), 2).result, 2);
});
test('los cobros antiguos conservan lo conocido y señalan el dato Pix que falta', () => {
  const source = fixture(); source.history = [{ ...source.history[0], payment: 'Pix', payments: undefined }]; source.tips = [];
  const wb = build(source).workbook, pay = wb.getWorksheet('Pagos'), summary = wb.getWorksheet('Resumen');
  assert.equal(pay.getCell('K9').value, 420); assert.equal(pay.getCell('M9').value, null); assert.equal(pay.getCell('R9').value, null);
  assert.match(pay.getCell('T9').value, /no registrados/);
  assert.equal(summary.getCell(find(summary, 1, 'Pix'), 4).result, 'Sin dato');
});
test('el XLSX se puede volver a abrir con números, fechas, fórmulas, filtros y texto seguro', async () => {
  const source = fixture(); source.history[0].name = '=HYPERLINK("https://example.com")'; source.history[0].lines[0].name = 'Kebab * ? ~';
  const wb = build(source).workbook;
  const buffer = await wb.xlsx.writeBuffer();
  assert.equal(buffer[0], 0x50); assert.equal(buffer[1], 0x4b);
  const read = new ExcelJS.Workbook(); await read.xlsx.load(buffer);
  assert.equal(read.getWorksheet('Ventas').getCell('J9').value, 420);
  assert.ok(read.getWorksheet('Ventas').getCell('B9').value instanceof Date);
  assert.equal(read.getWorksheet('Ventas').getCell('F9').type, ExcelJS.ValueType.String);
  assert.equal(read.getWorksheet('Ventas').getCell('F9').value, source.history[0].name);
  assert.equal(read.getWorksheet('Ventas').getCell('F9').formula, undefined);
  assert.equal(read.getWorksheet('Productos').getCell('M9').formula, 'I9*L9');
  assert.equal(read.getWorksheet('Productos').getCell('N10').value, null);
  assert.equal(read.getWorksheet('Resumen').getCell('B7').result, 720);
  assert.ok(read.getWorksheet('Ventas').autoFilter); assert.equal(read.getWorksheet('Ventas').views[0].ySplit, 8);
  const r = find(read.getWorksheet('Resumen'), 1, 'Kebab * ? ~');
  assert.match(read.getWorksheet('Resumen').getCell(r, 2).formula, /SUBSTITUTE/);
  assert.equal(read.getWorksheet('Resumen').getCell(r, 2).result, 1);
});
test('las observaciones largas se conservan y tienen altura para leerlas', () => {
  const source = fixture(); source.history[0].lines[0].note = 'Detalle de la preparación. '.repeat(18);
  const sheet = build(source).workbook.getWorksheet('Productos');
  assert.equal(sheet.getCell('O9').value, source.history[0].lines[0].note);
  assert.ok(sheet.getRow(9).height > 38);
});
test('un período sin ventas ni propinas produce un libro válido con totales cero', async () => {
  const result = build({ history: [], tips: [] }), wb = result.workbook;
  assert.equal(wb.getWorksheet('Resumen').getCell('B7').result, 0);
  assert.equal(wb.getWorksheet('Resumen').getCell('B11').result, 0);
  const read = new ExcelJS.Workbook(); await read.xlsx.load(await wb.xlsx.writeBuffer());
  assert.equal(read.getWorksheet('Ventas').getCell('A9').value, 'Sin registros en el período');
  assert.equal(read.getWorksheet('Resumen').getCell('B10').result, 0);
});
module.exports = { fixture };
