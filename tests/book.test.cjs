const test=require('node:test');
const assert=require('node:assert/strict');
const B=require('../cash-book.js');
const entry=(id,kind,person,amount,extra={})=>({id,kind,person,amount_minor:amount,currency:'UYU',occurred_on:'2026-09-01',created_at:'2026-09-01T12:00:00Z',description:'Movimiento',category:'equipment',...extra});

test('el diario conserva el detalle al coste y cuenta el cobro al personal una sola vez',()=>{
  const sale={number:10,saleType:'staff',label:'Personal · Al coste',name:'Ana',total:150,payment:'Efectivo',lines:[{note:'Un kebab y una bebida'}],payments:[{method:'Efectivo',amount:150,cashReceived:200,cashChange:50}]};
  const rows=B.journal({sales:[{sold_at:'2026-10-05T18:00:00Z',sale}]});
  assert.match(rows[0].description,/Personal · Al coste · Ana/);
  assert.equal(rows[0].note,'Un kebab y una bebida');
  assert.equal(B.filter(rows,{query:'kebab'}).length,1);
  assert.equal(B.summary(rows).currencies.UYU.sales,15000);
  assert.equal(B.summary(rows).payments['Efectivo UYU'].uyu,15000);
  assert.equal(B.summary(rows).salesCount,1);
  assert.match(B.csv(rows),/Un kebab y una bebida/);
});

test('atribuir fondos entre personas conserva el total financiado sin duplicar gastos',()=>{
  const book=[entry('1','personal_payment','Ana',100000),entry('2','personal_payment','Carla',20000),entry('3','partner_transfer','Bruno',30000,{recipient:'Ana'})];
  const people=B.people(book);
  assert.equal(people.find(p=>p.name==='ANA').UYU.net,70000);
  assert.equal(people.find(p=>p.name==='BRUNO').UYU.net,30000);
  assert.equal(people.find(p=>p.name==='CARLA').UYU.net,20000);
  assert.equal(people.reduce((n,p)=>n+p.UYU.net,0),120000);
  assert.equal(B.summary(B.journal({book})).currencies.UYU.spending,120000);
});
test('aportes de cambio y bienes no se consideran gastos ni ventas',()=>{
  const book=[entry('1','business_contribution','Ana',40000,{category:'change'}),entry('2','in_kind','Ana',null),entry('3','in_kind','Ana',10000)];
  const s=B.summary(B.journal({book}));assert.equal(s.currencies.UYU.sales,0);assert.equal(s.currencies.UYU.spending,0);assert.equal(s.unvalued,1);
  const p=B.people(book)[0];assert.equal(p.UYU.net,40000);assert.equal(p.UYU.inKind,10000);assert.equal(p.UYU.unvalued,1);
});
test('reintegros reducen lo financiado sin crear otro gasto',()=>{
  const book=[entry('1','personal_payment','Ana',100000),entry('2','reimbursement','Ana',25000)];
  assert.equal(B.people(book)[0].UYU.net,75000);
  assert.equal(B.summary(B.journal({book})).currencies.UYU.spending,100000);
});
test('retiro, factura y devolución suman solamente la compra rendida',()=>{
  const events=[{id:'1',kind:'withdrawal',amount_minor:100000,currency:'UYU',created_at:'2026-09-01T12:00:00Z',detail:{responsible:'Ana'}},{id:'2',related_id:'1',kind:'settlement',amount_minor:80000,currency:'UYU',created_at:'2026-09-01T12:00:00Z',detail:{document_date:'2026-09-01',supplier:'Proveedor'}},{id:'3',related_id:'1',kind:'return',amount_minor:20000,currency:'UYU',created_at:'2026-09-01T12:00:00Z',detail:{responsible:'Ana'}}];
  const rows=B.journal({events});assert.equal(rows.length,3);assert.equal(B.summary(rows).currencies.UYU.spending,80000);assert.equal(rows.find(e=>e.kind==='settlement').person,'ANA');
});
test('aportes y reintegros del efectivo aparecen en personas, sin gasto ficticio',()=>{
  const events=[{id:'a',kind:'income',amount_minor:100000,currency:'UYU',created_at:'2026-09-01T12:00:00Z',detail:{responsible:'Ana',funding_type:'contribution'}},{id:'b',kind:'expense',amount_minor:20000,currency:'UYU',created_at:'2026-09-01T12:00:00Z',detail:{responsible:'Ana',funding_type:'reimbursement'}}];
  const rows=B.journal({events});assert.equal(B.people(rows)[0].UYU.net,80000);assert.equal(B.summary(rows).currencies.UYU.spending,0);
});
test('corregir y anular conserva originales pero solo suma la versión vigente',()=>{
  const book=[entry('a','personal_payment','Ana',10000),entry('b','personal_payment','Ana',20000,{supersedes:'a',correction_reason:'Corrección de importe'})];
  assert.equal(B.people(book)[0].UYU.net,20000);assert.equal(B.journal({book}).length,1);
  book.push(entry('c','void','Ana',null,{supersedes:'b',correction_reason:'Compra duplicada'}));
  assert.equal(B.people(book).length,0);assert.equal(B.journal({book}).length,0);assert.equal(book.length,3);
});
test('monedas separadas y una venta dividida se cuenta una sola vez',()=>{
  const book=[entry('1','personal_payment','Ana',10000,{currency:'BRL'})];
  const sales=[{sold_at:'2026-09-02T00:00:00Z',sale:{number:1,total:100,payments:[{method:'Efectivo',amount:40},{method:'Pix',amount:60}]}}];
  const s=B.summary(B.journal({book,sales}));assert.equal(s.currencies.BRL.spending,10000);assert.equal(s.currencies.UYU.spending,0);assert.equal(s.currencies.UYU.sales,10000);assert.equal(s.salesCount,1);
});
test('correcciones sucesivas conservan referencia de origen en registro y CSV',()=>{
  const book=[entry('a','personal_payment','Ana',10000,{source_key:'Libro.xlsx:Inversion inicial:3',source_detail:{row:3}}),entry('b','personal_payment','Ana',20000,{supersedes:'a'}),entry('c','personal_payment','Ana',30000,{supersedes:'b'})];
  const rows=B.journal({book});assert.equal(rows.length,1);assert.equal(rows[0].source_key,book[0].source_key);assert.equal(rows[0].source_detail.row,3);assert.ok(B.csv(rows).includes(book[0].source_key));
});
test('fechas del registro respetan Uruguay y filtros por emisor o receptor',()=>{
  assert.equal(B.localDay('2026-09-02T01:59:00Z'),'2026-09-01');
  const rows=B.journal({book:[entry('1','partner_transfer','Bruno',10000,{recipient:'Ana'})]});
  assert.equal(B.filter(rows,{person:'ana',from:'2026-09-01',to:'2026-09-01'}).length,1);
  assert.equal(B.filter(rows,{from:'2026-09-02'}).length,0);
});
test('CSV conserva decimales, bienes sin valorar y evita fórmulas incrustadas',()=>{
  const text=B.csv(B.journal({book:[entry('1','personal_payment','Ana',12345,{description:'=HYPERLINK("bad")'}),entry('2','in_kind','Ana',null)]}));
  assert.ok(text.startsWith('\uFEFF'));assert.ok(text.includes('123,45'));assert.ok(text.includes('Pendiente de valorar'));assert.ok(text.includes("'=HYPERLINK"));
});
