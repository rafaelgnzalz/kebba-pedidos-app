// Funciones verificadas en la base existente; no contiene credenciales ni ventas.
const fs=require('node:fs'),path=require('node:path');
const input=JSON.parse(fs.readFileSync(process.argv[2],'utf8')),functions=new Map();
for(let i=0;i<input.length;i+=2)functions.set(input[i],input[i+1].trim()+';');
function replace(source,from,to){if(!source.includes(from))throw Error('No coincide: '+from);return source.replaceAll(from,to);}
let output=fs.readFileSync(path.join(__dirname,'eliminaciones-core.sql'),'utf8');
for(const name of ['cash_read','cash_command','shift_totals','shift_action','shift_snapshot','write_state']){
  let source=functions.get(name);if(!source)throw Error('Falta '+name);
  if(name!=='write_state')source=replace(source,'kebba_private.cash_sales','kebba_private.active_cash_sales');
  if(name==='shift_action')source=replace(source,'(select count(*) from kebba_private.shift_sales where shift_id=target_id)',
    '(select count(*) from kebba_private.shift_sales a join kebba_private.active_cash_sales c using(sale_key) where a.shift_id=target_id)');
  if(name==='shift_snapshot'){
    source=replace(source,'(select count(*) from kebba_private.shift_sales a where a.shift_id=s.id)',
      '(select count(*) from kebba_private.shift_sales a join kebba_private.active_cash_sales c using(sale_key) where a.shift_id=s.id)');
    source=replace(source,'where closed_at is not null order by closed_at desc limit 30','where closed_at is not null and deleted_at is null order by closed_at desc limit 30');
    source=replace(source,"'closed',closed_json,","'closed',closed_json,'deleted',coalesce((select jsonb_agg(to_jsonb(t) order by t.closed_at desc) from kebba_private.sales_shifts t where t.deleted_at is not null),'[]'::jsonb),");
  }
  if(name==='write_state')source=replace(source,"'ok', true, 'version', current_version + 1)","'ok', true, 'version', current_version + 1, 'state',(select s.state from kebba_private.app_state s where id=1))");
  output+='\n'+source+'\n';
}
fs.writeFileSync(path.join(__dirname,'eliminaciones.sql'),'begin;\n'+output+'\ncommit;\n');
