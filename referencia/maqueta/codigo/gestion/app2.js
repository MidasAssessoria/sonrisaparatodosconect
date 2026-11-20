/* Gestión · Presupuestos, Caja, Facturación SIFEN, Contabilidad, Reportes, Personal, Inventario */

/* ================= PRESUPUESTOS ================= */
function dTot(items,disc){var sub=0,g={g10:0,g5:0,ex:0};items.forEach(function(i){var v=i.price*i.qty;sub+=v;g[i.iva===10?'g10':i.iva===5?'g5':'ex']+=v});var f=1-(disc||0)/100;return {sub:sub,desc:Math.round(sub*(disc||0)/100),total:Math.round(sub*f),g10:g.g10*f,g5:g.g5*f,ex:g.ex*f}}
function totBlock(t){return '<div class="tot"><span>Subtotal</span><b class="num">'+gs(t.sub)+'</b></div>'+(t.desc?'<div class="tot"><span>Descuento</span><b class="num">−'+gs(t.desc).replace('₲ ','₲ ')+'</b></div>':'')+'<div class="tot muted small"><span>IVA 10% incluido</span><span class="num">'+gs(iva10(t.g10))+'</span></div>'+(t.g5?'<div class="tot muted small"><span>IVA 5% incluido</span><span class="num">'+gs(iva5(t.g5))+'</span></div>':'')+'<div class="tot big"><span>Total</span><b class="num">'+gs(t.total)+'</b></div>'}
ACT['bud-new']=function(el){ui.draft={pid:(el&&el.dataset.pid)||'',items:[],disc:0};nav('presupuestos/nuevo')};
ACT['bud-open']=function(el){nav('presupuestos/'+el.dataset.id)};
IN.bdPid=function(el){ui.draft.pid=el.value};
IN.bdDisc=function(el){ui.draft.disc=Math.min(50,Math.max(0,+el.value||0));render(true)};
ACT['bud-add']=function(el){var t=tre(el.dataset.tid),ex=ui.draft.items.filter(function(i){return i.tid===t.id})[0];if(ex)ex.qty++;else ui.draft.items.push({tid:t.id,name:t.name,price:t.price,qty:1,iva:t.iva});render(true)};
ACT['bud-qty']=function(el){var i=ui.draft.items[+el.dataset.i];i.qty+=+el.dataset.d;if(i.qty<1)ui.draft.items.splice(+el.dataset.i,1);render(true)};
ACT['bud-save']=function(el){
  var d=ui.draft;if(!d.pid){toast('Elegí un paciente para el presupuesto','err');return}if(!d.items.length){toast('Agregá al menos un tratamiento','err');return}
  var ap=el.dataset.ap==='1',b={id:'b'+nid('bud'),num:'P-'+(1000+S.seq.bud),pid:d.pid,did:'d1',items:d.items.slice(),status:ap?'aprobado':'borrador',date:TODAY,discPct:d.disc||0,approvedOn:ap?TODAY:null};
  S.budgets.push(b);save();ui.draft=null;toast(ap?'Presupuesto aprobado · saldo a cobrar '+gs(bTotal(b)):'Presupuesto guardado como borrador');nav('presupuestos/'+b.id);
};
ACT['bud-approve']=function(el){var b=bud(el.dataset.id);b.status='aprobado';b.approvedOn=TODAY;save();toast('Presupuesto aprobado · saldo a cobrar '+gs(bBal(b)));render(true)};
ACT['bud-pay']=function(el){openPay({bid:el.dataset.id})};
VIEWS.presupuestos=function(r){
  if(r.a==='nuevo'){
    if(!ui.draft)ui.draft={pid:r.q.pid||'',items:[],disc:0};var d=ui.draft,t=dTot(d.items,d.disc);
    return ph('Nuevo presupuesto','Armá el plan de tratamiento con precios',  '<a class="btn" href="#/presupuestos">‹ Presupuestos</a>')+
    '<div class="grid g21"><div class="stack"><div class="card"><h2 style="margin-bottom:12px">1. Paciente</h2><div class="field" style="margin:0"><label for="bd-pid">Paciente</label><select id="bd-pid" data-ch="bdPid"><option value="">Elegí un paciente…</option>'+patOpts(d.pid)+'</select></div></div>'+
    '<div class="card"><h2 style="margin-bottom:12px">2. Tratamientos</h2><div class="cat">'+S.treatments.map(function(x){return '<button data-act="bud-add" data-tid="'+x.id+'" id="cat-'+x.id+'"><b>'+esc(x.name)+'</b><span>'+gs(x.price)+(x.iva!==10?' · IVA '+(x.iva?x.iva+'%':'exento'):'')+'</span></button>'}).join('')+'</div></div></div>'+
    '<div class="card" style="align-self:start;position:sticky;top:88px"><h2 style="margin-bottom:12px">3. Presupuesto</h2>'+(d.items.length?d.items.map(function(i,k){return '<div class="mini-row"><div class="g"><b>'+esc(i.name)+'</b><div class="muted small">'+gs(i.price)+' c/u</div></div><span class="qty"><button data-act="bud-qty" data-i="'+k+'" data-d="-1" aria-label="Menos">−</button><b>'+i.qty+'</b><button data-act="bud-qty" data-i="'+k+'" data-d="1" aria-label="Más">+</button></span><b class="num" style="min-width:110px;text-align:right">'+gs(i.price*i.qty)+'</b></div>'}).join(''):'<div class="empty small">Tocá un tratamiento para agregarlo.</div>')+
    '<div class="field" style="margin:14px 0 6px"><label for="bd-disc">Descuento (%)</label><input id="bd-disc" data-ch="bdDisc" type="number" min="0" max="50" value="'+(d.disc||0)+'"></div>'+totBlock(t)+
    '<div class="row" style="margin-top:14px"><button class="btn" id="bud-save-draft" data-act="bud-save" data-ap="0" style="flex:1">Guardar borrador</button><button class="btn pri" id="bud-save-approve" data-act="bud-save" data-ap="1" style="flex:1">Guardar y aprobar</button></div></div></div>';
  }
  var b=r.a&&bud(r.a);
  if(b){
    var p=pat(b.pid),t=dTot(b.items,b.discPct),paid=bPaid(b),bal=bBal(b),pays=S.payments.filter(function(x){return x.bid===b.id});
    var allInv=pays.length&&pays.every(function(x){return x.invId});
    var st=b.status!=='aprobado'?0:paid===0?1:bal>0?2:allInv?4:3,sl=['Borrador','Aprobado','Cobro en curso','Pagado','Facturado'];
    return ph('Presupuesto '+b.num,esc(p.name)+' · '+fdate(b.date),'<a class="btn" href="#/presupuestos">‹ Presupuestos</a>')+
    '<div class="steps" id="bud-steps">'+sl.map(function(s,i){return '<span class="'+(i<st?'done':i===st?'cur':'')+'">'+s+'</span>'}).join('')+'</div>'+
    '<div class="grid g21"><div class="card"><h2 style="margin-bottom:12px">Tratamientos</h2><div class="tw"><table class="tbl rs"><thead><tr><th>Tratamiento</th><th class="r">Cant.</th><th class="r">Precio</th><th class="r">Subtotal</th></tr></thead><tbody>'+b.items.map(function(i){return '<tr><td data-l="Tratamiento"><b>'+esc(i.name)+'</b></td><td data-l="Cant." class="r">'+i.qty+'</td><td data-l="Precio" class="r num">'+gs(i.price)+'</td><td data-l="Subtotal" class="r num">'+gs(i.price*i.qty)+'</td></tr>'}).join('')+'</tbody></table></div><div style="max-width:380px;margin-left:auto;margin-top:12px">'+totBlock(t)+'</div></div>'+
    '<div class="stack"><div class="card">'+(b.status==='borrador'?'<h3>Pendiente de aprobación</h3><p class="muted" style="margin:6px 0 14px">Al aprobarlo, el total pasa a ser un saldo a cobrar del paciente.</p><button class="btn pri" id="btn-aprobar" data-act="bud-approve" data-id="'+b.id+'" style="width:100%">Aprobar presupuesto</button>':
     '<h3>Saldo a cobrar</h3><div class="fre" id="bud-saldo" style="font-size:34px;font-weight:600;margin:6px 0">'+gs(bal)+'</div><div class="bar"><i style="width:'+Math.round(paid/bTotal(b)*100)+'%"></i></div><div class="row small muted" style="justify-content:space-between;margin:6px 0 14px"><span>Pagado '+gs(paid)+'</span><span>Total '+gs(bTotal(b))+'</span></div>'+(bal>0?'<button class="btn pri" id="btn-cobrar-presupuesto" data-act="bud-pay" data-id="'+b.id+'" style="width:100%">Cobrar ahora</button>':'<div class="alert ok">'+I.check+'<div><b>Presupuesto saldado.</b></div></div>'))+'</div>'+
     (pays.length?'<div class="card"><h3 style="margin-bottom:8px">Pagos de este presupuesto</h3>'+pays.map(function(x){return '<div class="mini-row"><div class="g"><b class="num">'+gs(x.amount)+'</b><div class="muted small">'+fdate(x.date)+' · '+METHODS[x.method]+'</div></div>'+(x.invId?chip('Facturado','c-t'):'<button class="btn sm" data-act="fac-emit" data-id="'+x.id+'">Facturar</button>')+'</div>'}).join('')+'</div>':'')+'</div></div>';
  }
  var list=S.budgets.slice().sort(function(a,b){return a.date<b.date?1:-1});
  return ph('Presupuestos','Planes de tratamiento y saldos por cobrar',btn('Nuevo presupuesto','bud-new',{c:'pri',i:'plus',id:'btn-nuevo-presupuesto'}))+
  '<div class="card"><div class="tw"><table class="tbl rs" id="tbl-bud"><thead><tr><th>N.º</th><th>Paciente</th><th>Fecha</th><th>Estado</th><th class="r">Total</th><th class="r">Pagado</th><th class="r">Saldo</th></tr></thead><tbody>'+list.map(function(b){var p=pat(b.pid);return '<tr class="click" data-act="bud-open" data-id="'+b.id+'"><td data-l="N.º"><b>'+b.num+'</b></td><td data-l="Paciente"><div class="pcell">'+pav(p)+'<b>'+esc(p.name)+'</b></div></td><td data-l="Fecha">'+fdate(b.date)+'</td><td data-l="Estado">'+chip(b.status==='aprobado'?'Aprobado':'Borrador',b.status==='aprobado'?'c-t':'c-g')+'</td><td data-l="Total" class="r num">'+gs(bTotal(b))+'</td><td data-l="Pagado" class="r num">'+gs(bPaid(b))+'</td><td data-l="Saldo" class="r num"><b>'+gs(bBal(b))+'</b></td></tr>'}).join('')+'</tbody></table></div></div>';
};

/* ================= CAJA ================= */
function openPay(o){
  o=o||{};var s=openSes();if(!s){toast('Abrí la caja para registrar cobros','err');nav('caja');return}
  var pid=o.pid||'',bid=o.bid||'';if(bid)pid=bud(bid).pid;ui.pay={pid:pid,bid:bid,method:'efectivo'};
  modal('Registrar pago','<div class="field"><label for="pay-pid">Paciente</label><select id="pay-pid" data-ch="payPid"><option value="">Elegí un paciente…</option>'+patOpts(pid)+'</select></div><div id="pay-dyn">'+payDyn()+'</div><div class="field"><label>Forma de pago</label><div class="pm" id="pay-m">'+Object.keys(METHODS).map(function(k){return '<button type="button" id="pm-'+k+'" data-act="pay-m" data-m="'+k+'" class="'+(ui.pay.method===k?'on':'')+'">'+I[k]+METHODS[k]+'</button>'}).join('')+'</div></div><div id="pay-err"></div>','<button class="btn" data-act="close">Cancelar</button><button class="btn pri" id="pay-save" data-act="pay-save">Registrar pago</button>');
}
function payDyn(){
  var pid=ui.pay.pid,bs=S.budgets.filter(function(b){return b.pid===pid&&bBal(b)>0}),bid=ui.pay.bid,b=bid?bud(bid):null;
  var amt=b?bBal(b):'';
  return '<div class="field"><label for="pay-bid">Presupuesto a cobrar</label><select id="pay-bid" data-ch="payBid"><option value="">Cobro particular (sin presupuesto)</option>'+opts(bs,bid,function(x){return [x.id,x.num+' · saldo '+gs(bBal(x))]})+'</select></div>'+
   '<div class="field"><label for="pay-amount">Monto (₲)</label><input id="pay-amount" type="number" min="0" step="1000" value="'+amt+'" placeholder="0"></div>'+
   (b?'':'<div class="f2"><div class="field"><label for="pay-concept">Concepto</label><input id="pay-concept" value="Consulta y diagnóstico"></div><div class="field"><label for="pay-iva">IVA</label><select id="pay-iva"><option value="10">10%</option><option value="5">5%</option><option value="0">Exento</option></select></div></div>');
}
IN.payPid=function(el){ui.pay.pid=el.value;ui.pay.bid='';$('#pay-dyn').innerHTML=payDyn()};
IN.payBid=function(el){ui.pay.bid=el.value;$('#pay-dyn').innerHTML=payDyn();var s=$('#pay-bid');if(s)s.value=ui.pay.bid};
ACT['pay-new']=function(el){openPay({pid:el&&el.dataset&&el.dataset.pid})};
ACT['pay-m']=function(el){ui.pay.method=el.dataset.m;$$('#pay-m button').forEach(function(b){b.classList.toggle('on',b.dataset.m===ui.pay.method)})};
ACT['pay-save']=function(){
  var err=function(m){$('#pay-err').innerHTML='<div class="alert bad">'+I.alert+'<div>'+m+'</div></div>'};
  var pid=val('pay-pid'),amt=Math.round(+val('pay-amount')),bid=val('pay-bid'),b=bid?bud(bid):null,s=openSes();
  if(!pid)return err('Elegí el paciente.');if(!amt||amt<=0)return err('Indicá un monto mayor a cero.');
  if(b&&amt>bBal(b))return err('El monto supera el saldo del presupuesto ('+gs(bBal(b))+').');
  var tx;if(b)tx=txFor(amt,b);else{var iv=val('pay-iva');tx={g10:iv==='10'?amt:0,g5:iv==='5'?amt:0,ex:iv==='0'?amt:0}}
  var p={id:'y'+nid('pay'),date:TODAY,time:nowHM(),pid:pid,bid:bid||null,amount:amt,method:ui.pay.method,concept:b?'Pago a cuenta · Presupuesto '+b.num:(val('pay-concept')||'Cobro particular'),trat:b?b.items[0].name:(val('pay-concept')||'Cobro particular'),did:b?b.did:'d1',sid:s.id,tx:tx,invId:null};
  S.payments.push(p);save();
  modal('Pago registrado','<div class="empty" style="padding:10px"><div class="ok-big">'+I.check+'</div><h2 id="pay-ok-amount">'+gs(amt)+'</h2><p class="muted" style="margin-top:6px">'+esc(pat(pid).name)+' · '+METHODS[p.method]+'</p>'+(b?'<p class="small" style="margin-top:10px">Saldo restante del presupuesto: <b>'+gs(bBal(b))+'</b></p>':'')+'</div>','<button class="btn" data-act="close">Listo</button><button class="btn pri" id="btn-emitir-factura-ahora" data-act="fac-emit" data-id="'+p.id+'">Emitir factura SIFEN</button>');
  render(true);
};
ACT['exp-new']=function(){
  if(!openSes()){toast('Abrí la caja para registrar egresos','err');nav('caja');return}
  modal('Registrar egreso','<div class="field"><label for="ex-concept">Concepto</label><input id="ex-concept" placeholder="Ej.: Compra de guantes"></div><div class="f2"><div class="field"><label for="ex-amount">Monto (₲)</label><input id="ex-amount" type="number" min="0" step="1000"></div><div class="field"><label for="ex-cat">Categoría</label><select id="ex-cat">'+opts(['Insumos','Laboratorio','Servicios','Mantenimiento','Marketing','Otros'],'Insumos',function(x){return [x,x]})+'</select></div></div><div class="f2"><div class="field"><label for="ex-method">Forma de pago</label><select id="ex-method"><option value="efectivo">Efectivo</option><option value="transferencia">Transferencia</option><option value="tarjeta">Tarjeta</option></select></div><div class="field"><label for="ex-prov">Proveedor (opcional)</label><input id="ex-prov"></div></div><div id="ex-err"></div>','<button class="btn" data-act="close">Cancelar</button><button class="btn pri" id="ex-save" data-act="exp-save">Registrar egreso</button>');
};
ACT['exp-save']=function(){
  var c=val('ex-concept').trim(),a=Math.round(+val('ex-amount'));if(!c||!a){$('#ex-err').innerHTML='<div class="alert bad">'+I.alert+'<div>Completá concepto y monto.</div></div>';return}
  S.expenses.push({id:'e'+nid('exp'),date:TODAY,time:nowHM(),concept:c,cat:val('ex-cat'),amount:a,method:val('ex-method'),iva:10,prov:val('ex-prov'),sid:openSes().id});save();closeModal();toast('Egreso registrado: '+c+' · '+gs(a));render(true);
};
ACT['caja-open']=function(){modal('Abrir caja','<p class="muted" style="margin-bottom:14px">Contá el efectivo inicial del cajón (fondo de caja).</p><div class="field"><label for="co-amount">Efectivo inicial (₲)</label><input id="co-amount" type="number" min="0" step="10000" value="500000"></div>','<button class="btn" data-act="close">Cancelar</button><button class="btn pri" id="co-ok" data-act="caja-open-ok">Abrir caja</button>')};
ACT['caja-open-ok']=function(){S.sessions.push({id:'s'+nid('ses'),date:TODAY,openedAt:nowHM(),opening:Math.round(+val('co-amount'))||0,closedAt:null,by:'Lorena Fretes'});save();closeModal();toast('Caja abierta a las '+nowHM());render(true)};
ACT['caja-close']=function(){
  var s=openSes(),exp=cashExpected(s.id);
  modal('Cerrar caja · arqueo','<div class="tot"><span>Fondo inicial</span><b class="num">'+gs(s.opening)+'</b></div><div class="tot"><span>Cobros en efectivo</span><b class="num">'+gs(sum(S.payments.filter(function(p){return p.sid===s.id&&p.method==='efectivo'}),function(p){return p.amount}))+'</b></div><div class="tot"><span>Egresos en efectivo</span><b class="num">−'+gs(sum(S.expenses.filter(function(p){return p.sid===s.id&&p.method==='efectivo'}),function(p){return p.amount}))+'</b></div><div class="tot big"><span>Efectivo esperado</span><b class="num" id="cc-exp">'+gs(exp)+'</b></div>'+
   '<div class="field" style="margin-top:14px"><label for="cc-count">Efectivo contado (₲)</label><input id="cc-count" data-in="ccCount" type="number" min="0" step="1000" placeholder="Ingresá lo que contaste"></div><div id="cc-diff" class="alert info">'+I.info+'<div>Ingresá el efectivo contado para ver la diferencia.</div></div>','<button class="btn" data-act="close">Cancelar</button><button class="btn pri" id="cc-ok" data-act="caja-close-ok">Confirmar cierre</button>');
};
IN.ccCount=function(el){
  var exp=cashExpected(openSes().id),v=el.value===''?null:Math.round(+el.value),box=$('#cc-diff');if(v===null){return}
  var d=v-exp,cls=d===0?'ok':d>0?'warn':'bad',tx=d===0?'Caja cuadrada: sin diferencia.':d>0?'Sobrante':'Faltante';
  box.className='alert '+cls;box.innerHTML=I.info+'<div><span class="diff" id="cc-diff-val">'+gs(d)+'</span><div>'+tx+'</div></div>';
};
ACT['caja-close-ok']=function(){
  var s=openSes(),raw=val('cc-count');if(raw===''){toast('Ingresá el efectivo contado','err');return}
  var exp=cashExpected(s.id),c=Math.round(+raw);s.closedAt=nowHM();s.expected=exp;s.counted=c;s.diff=c-exp;save();
  modal('Caja cerrada','<div class="empty" style="padding:6px"><div class="ok-big">'+I.check+'</div><h2>Cierre registrado a las '+s.closedAt+'</h2></div><div class="tot"><span>Esperado</span><b class="num">'+gs(exp)+'</b></div><div class="tot"><span>Contado</span><b class="num">'+gs(c)+'</b></div><div class="tot big"><span>Diferencia</span><b class="num" id="cierre-dif">'+gs(s.diff)+'</b></div>','<button class="btn pri" data-act="close">Entendido</button>');
  render(true);
};
VIEWS.caja=function(){
  var s=openSes(),pays=S.payments.filter(function(p){return p.date===TODAY}),exps=S.expenses.filter(function(p){return p.date===TODAY});
  var ing=sum(pays,function(x){return x.amount}),egr=sum(exps,function(x){return x.amount});
  var mv=pays.map(function(p){return {t:p.time,tipo:'in',c:pat(p.pid).name,d:p.concept,m:p.method,v:p.amount}}).concat(exps.map(function(e){return {t:e.time,tipo:'out',c:e.prov||'Egreso',d:e.concept,m:e.method,v:e.amount}})).sort(function(a,b){return a.t<b.t?1:-1});
  var by=Object.keys(METHODS).map(function(k){return [k,sum(pays.filter(function(p){return p.method===k}),function(p){return p.amount})]});
  var closed=S.sessions.filter(function(x){return x.closedAt&&x.date===TODAY});
  var st=s?'<div class="alert ok">'+I.check+'<div><b>Caja abierta</b> desde las '+s.openedAt+' · fondo inicial '+gs(s.opening)+' · '+esc(s.by)+'</div></div>':'<div class="alert warn">'+I.alert+'<div><b>Caja cerrada.</b> Abrila para registrar cobros y egresos.</div></div>';
  var acts=s?btn('Registrar pago','pay-new',{c:'pri',i:'cash',id:'btn-cobrar'})+btn('Registrar egreso','exp-new',{i:'plus',id:'btn-egreso'})+btn('Cerrar caja','caja-close',{c:'dark',id:'btn-cerrar-caja'}):btn('Abrir caja','caja-open',{c:'pri',i:'cash',id:'btn-abrir-caja'});
  return ph('Caja','Movimientos del día · '+fdateLong(TODAY),acts)+'<div style="margin-bottom:18px">'+st+'</div>'+
  '<div class="grid g4" style="margin-bottom:18px"><div class="card kpi"><div class="lb"><i class="c-t">'+I.cash+'</i>Ingresos del día</div><div class="v" id="caja-ing">'+gs(ing)+'</div></div><div class="card kpi"><div class="lb"><i class="c-c">'+I.cash+'</i>Egresos del día</div><div class="v" id="caja-egr">'+gs(egr)+'</div></div><div class="card kpi"><div class="lb"><i class="c-i">'+I.cash+'</i>Resultado del día</div><div class="v">'+gs(ing-egr)+'</div></div><div class="card kpi"><div class="lb"><i class="c-s">'+I.efectivo+'</i>Efectivo esperado</div><div class="v" id="caja-esperado">'+(s?gs(cashExpected(s.id)):'—')+'</div><div class="s">'+(s?'en el cajón ahora':'caja cerrada')+'</div></div></div>'+
  '<div class="grid g21"><div class="card"><div class="card-h"><h2>Movimientos de hoy</h2></div>'+(mv.length?'<div class="tw"><table class="tbl rs" id="tbl-mov"><thead><tr><th>Hora</th><th>Detalle</th><th>Forma</th><th class="r">Monto</th></tr></thead><tbody>'+mv.map(function(x){return '<tr><td data-l="Hora" class="num">'+x.t+'</td><td data-l="Detalle"><b>'+esc(x.c)+'</b><div class="muted small">'+esc(x.d)+'</div></td><td data-l="Forma">'+chip(METHODS[x.m],x.tipo==='in'?'c-t':'c-c')+'</td><td data-l="Monto" class="r num"><b style="color:'+(x.tipo==='in'?'#0B7A70':'#C23434')+'">'+(x.tipo==='in'?'+':'−')+gs(x.v).replace('₲ ','₲ ')+'</b></td></tr>'}).join('')+'</tbody></table></div>':'<div class="empty">Todavía no hay movimientos hoy.</div>')+'</div>'+
  '<div class="stack"><div class="card"><h3 style="margin-bottom:10px">Ingresos por forma de pago</h3>'+by.map(function(x){return '<div class="mini-row"><i style="width:12px;height:12px;border-radius:4px;background:'+PALETTE_M[x[0]]+'"></i><span class="g">'+METHODS[x[0]]+'</span><b class="num">'+gs(x[1])+'</b></div>'}).join('')+'</div>'+
  (closed.length?'<div class="card"><h3 style="margin-bottom:10px">Arqueos de hoy</h3>'+closed.map(function(c){return '<div class="mini-row small"><div class="g"><b>Cierre '+c.closedAt+'</b><div class="muted">Esperado '+gs(c.expected)+' · contado '+gs(c.counted)+'</div></div>'+chip(c.diff===0?'Cuadrada':gs(c.diff),c.diff===0?'c-t':c.diff>0?'c-s':'c-c')+'</div>'}).join('')+'</div>':'')+'</div></div>';
};

/* ================= FACTURACIÓN SIFEN ================= */
ACT['fac-emit']=function(el){
  var p=payById(el.dataset.id);if(p.invId){ACT['fac-view']({dataset:{id:p.invId}});return}
  var f=makeInvoice(p,false);save();showInvoice(f.id);
  setTimeout(function(){f.status='aprobada';save();if(ui.invOpen===f.id)showInvoice(f.id,true);toast('Factura '+f.num+' aprobada por SIFEN (demo)');if(parseHash().name==='facturacion'||parseHash().name==='presupuestos'||parseHash().name==='pacientes')render(true)},1600);
  if(parseHash().name==='facturacion')render(true);
};
ACT['fac-view']=function(el,e){if(e&&e.preventDefault&&el.tagName==='A'){}showInvoice(el.dataset.id)};
function invDoc(f){
  var p=pat(f.pid),t=f.tx,ok=f.status==='aprobada';
  return '<div class="invoice" id="fac-doc"><div class="wm">DOCUMENTO DE<br>DEMOSTRACIÓN</div>'+
  '<div class="hd"><div><b class="fre" style="font-size:19px">Clínica Sonrisa Para Todos Conecta</b><div class="muted">Servicios odontológicos · Sede Centro, Asunción</div><div>RUC: <b>80099999-0</b> (ficticio)</div></div><div style="text-align:right"><span class="demo-tag">Documento de demostración</span><div style="margin-top:8px">Timbrado N.º <b>12345678</b><div class="muted small">Vigencia: 01/01/2026 a 31/12/2026</div></div><div class="fre" style="font-size:18px;margin-top:4px">Factura electrónica<br><b id="fac-num">'+f.num+'</b></div></div></div>'+
  '<div class="grid g2" style="margin-top:14px;gap:8px 20px"><div><span class="muted">Fecha de emisión:</span> <b>'+fdate(f.date)+' '+f.time+'</b></div><div><span class="muted">Condición:</span> <b>Contado</b></div><div><span class="muted">Cliente:</span> <b>'+esc(p.name)+'</b></div><div><span class="muted">RUC / CI:</span> <b>'+esc(p.ruc)+'</b></div></div>'+
  '<table><thead><tr><th>Descripción</th><th class="r">Cant.</th><th class="r">Exentas</th><th class="r">5%</th><th class="r">10%</th></tr></thead><tbody><tr><td>'+esc(f.concept)+'</td><td class="r">1</td><td class="r num">'+gs(t.ex)+'</td><td class="r num">'+gs(t.g5)+'</td><td class="r num">'+gs(t.g10)+'</td></tr></tbody><tfoot><tr><td colspan="4" class="r"><b>Total a pagar</b></td><td class="r num"><b>'+gs(f.total)+'</b></td></tr></tfoot></table>'+
  '<div class="small">Liquidación del IVA: (5%) <b>'+gs(iva5(t.g5))+'</b> · (10%) <b>'+gs(iva10(t.g10))+'</b> · Total IVA <b>'+gs(iva5(t.g5)+iva10(t.g10))+'</b></div>'+
  '<div class="row" style="margin-top:16px;align-items:flex-start;gap:20px"><div style="flex:none;border:1px solid var(--borde);border-radius:10px;padding:8px">'+qrSvg(f.cdc,112)+'</div><div style="flex:1;min-width:220px"><div class="muted small">CDC (Código de Control, ejemplo)</div><div class="cdc" id="fac-cdc">'+f.cdc.replace(/(\d{4})/g,'$1 ')+'</div><div style="margin-top:8px" id="fac-estado">'+(ok?chip('Aprobado por SIFEN (demo)','c-t'):'<span class="chip c-s nodot"><span class="spin"></span>&nbsp;Enviando a SIFEN…</span>')+'</div><p class="muted tiny" style="margin-top:8px">Este es un documento de demostración sin validez tributaria. Los datos, el RUC, el timbrado, el CDC y el código QR son ficticios.</p></div></div></div>';
}
function showInvoice(id,keep){
  ui.invOpen=id;var f=inv(id);
  modal('Factura '+f.num,invDoc(f),'<button class="btn" data-act="close">Cerrar</button><button class="btn" id="btn-wa" data-act="fac-wa">Enviar por WhatsApp</button><button class="btn pri" id="btn-imprimir" data-act="fac-print">Imprimir / guardar PDF</button>',true);
  ui.invOpen=id;
}
ACT['fac-print']=function(){window.print()};
ACT['fac-wa']=function(){toast('Factura enviada por WhatsApp (demostración)')};
ACT['fac-more']=function(){ui.invMore=true;render(true)};
VIEWS.facturacion=function(){
  var pend=S.payments.filter(function(p){return !p.invId}).sort(function(a,b){return (b.date+b.time)<(a.date+a.time)?-1:1});
  var fs=S.invoices.slice().sort(function(a,b){return (b.date+b.time)<(a.date+a.time)?-1:1}),shown=ui.invMore?fs:fs.slice(0,12);
  var mk=curMonth(),inM=S.invoices.filter(function(f){return f.date.slice(0,7)===mk});
  return ph('Facturación SIFEN','Factura electrónica emitida desde cada cobro','<span class="demo-tag">Documento de demostración</span>')+
  '<div class="grid g3" style="margin-bottom:18px"><div class="card kpi"><div class="lb"><i class="c-t">'+I.inv+'</i>Facturas del mes</div><div class="v" id="fac-count">'+inM.length+'</div><div class="s">por '+gs(sum(inM,function(f){return f.total}))+'</div></div><div class="card kpi"><div class="lb"><i class="c-s">'+I.alert+'</i>Cobros sin factura</div><div class="v">'+pend.length+'</div><div class="s">emitilas desde la lista de abajo</div></div><div class="card kpi"><div class="lb"><i class="c-i">'+I.info+'</i>Timbrado</div><div class="v" style="font-size:24px">12345678</div><div class="s">ejemplo · vigente hasta 31/12/2026</div></div></div>'+
  '<div class="card" style="margin-bottom:18px"><div class="card-h"><h2>Cobros pendientes de facturar</h2></div>'+(pend.length?'<div class="tw"><table class="tbl rs" id="tbl-sinfac"><thead><tr><th>Fecha</th><th>Paciente</th><th>Concepto</th><th class="r">Monto</th><th></th></tr></thead><tbody>'+pend.map(function(p){return '<tr><td data-l="Fecha">'+fdate(p.date)+' '+p.time+'</td><td data-l="Paciente"><b>'+esc(pat(p.pid).name)+'</b></td><td data-l="Concepto">'+esc(p.concept)+'</td><td data-l="Monto" class="r num">'+gs(p.amount)+'</td><td class="r"><button class="btn sm pri" data-act="fac-emit" data-id="'+p.id+'" id="emit-'+p.id+'">Emitir factura</button></td></tr>'}).join('')+'</tbody></table></div>':'<div class="empty">Todos los cobros están facturados.</div>')+'</div>'+
  '<div class="card"><div class="card-h"><h2>Facturas emitidas</h2></div><div class="tw"><table class="tbl rs" id="tbl-fac"><thead><tr><th>N.º</th><th>Fecha</th><th>Cliente</th><th>Estado</th><th class="r">Total</th><th></th></tr></thead><tbody>'+shown.map(function(f){return '<tr class="click" data-act="fac-view" data-id="'+f.id+'"><td data-l="N.º"><b>'+f.num+'</b></td><td data-l="Fecha">'+fdate(f.date)+'</td><td data-l="Cliente">'+esc(pat(f.pid).name)+'</td><td data-l="Estado">'+(f.status==='aprobada'?chip('Aprobada','c-t'):chip('Enviando…','c-s'))+'</td><td data-l="Total" class="r num">'+gs(f.total)+'</td><td class="r"><button class="btn sm" data-act="fac-view" data-id="'+f.id+'">Ver</button></td></tr>'}).join('')+'</tbody></table></div>'+(!ui.invMore&&fs.length>12?'<div style="text-align:center;margin-top:12px"><button class="btn" data-act="fac-more">Ver las '+fs.length+' facturas</button></div>':'')+'</div>';
};

/* ================= CONTABILIDAD ================= */
function mLabel(k){var a=k.split('-');return MN[+a[1]-1]+' '+a[0]}
function libro(k){var r=monthRange(k),rows=[];
  payIn(r[0],r[1]).forEach(function(p){var f=p.invId?inv(p.invId):null;rows.push({d:p.date,t:p.time,tipo:'Ingreso',c:pat(p.pid).name+' · '+p.concept,m:METHODS[p.method],comp:f?f.num:'Sin factura',ing:p.amount,egr:0})});
  expIn(r[0],r[1]).forEach(function(e){rows.push({d:e.date,t:e.time,tipo:'Egreso',c:e.concept+(e.prov?' · '+e.prov:''),m:METHODS[e.method]||e.method,comp:e.cat,ing:0,egr:e.amount})});
  return rows.sort(function(a,b){return (b.d+b.t)<(a.d+a.t)?-1:1})}
function cxc(){return S.budgets.filter(function(b){return bBal(b)>0}).map(function(b){var days=daysBetween(b.approvedOn||b.date,TODAY);return {b:b,p:pat(b.pid),days:days,bk:aging(days),bal:bBal(b)}}).sort(function(a,b){return b.days-a.days})}
function ivaCalc(k){var r=monthRange(k),py=payIn(r[0],r[1]),ex=expIn(r[0],r[1]);var g10=sum(py,function(p){return p.tx.g10}),g5=sum(py,function(p){return p.tx.g5}),e0=sum(py,function(p){return p.tx.ex});
  var c10=sum(ex.filter(function(e){return e.iva===10}),function(e){return e.amount}),c5=sum(ex.filter(function(e){return e.iva===5}),function(e){return e.amount});
  return {g10:g10,g5:g5,ex:e0,d10:iva10(g10),d5:iva5(g5),c10:c10,c5:c5,cr10:iva10(c10),cr5:iva5(c5)}}
function resumen(){var k=curMonth(),r=monthRange(k),ing=sum(payIn(r[0],r[1]),function(p){return p.amount}),egr=sum(expIn(r[0],r[1]),function(p){return p.amount});var cur={key:k,label:MN[pd(TODAY).getMonth()].slice(0,3),ing:ing,egr:egr};return S.hist.concat([cur])}
ACT['cont-tab']=function(el){ui.cont=el.dataset.t;render(true)};
ACT['cont-m']=function(el){var a=ui.contM.split('-'),d=new Date(+a[0],+a[1]-1+ +el.dataset.d,1);ui.contM=d.getFullYear()+'-'+pad(d.getMonth()+1);render(true)};
ACT['cont-tipo']=function(el){ui.contTipo=el.dataset.t;render(true)};
ACT['cxc-cobrar']=function(el){openPay({bid:el.dataset.id})};
ACT['cxp-pagar']=function(el){
  var c=S.payables.filter(function(x){return x.id===el.dataset.id})[0],s=openSes();c.paid=true;
  S.expenses.push({id:'e'+nid('exp'),date:TODAY,time:nowHM(),concept:c.concept,cat:'Proveedores',amount:c.amount,method:'transferencia',iva:c.iva,prov:c.prov,sid:s?s.id:'h'});save();toast('Pago a '+c.prov+' registrado · '+gs(c.amount));render(true);
};
ACT.csv=function(){
  var k=ui.contM,t=ui.cont;
  if(t==='libro'){csv('libro-ingresos-egresos-'+k+'.csv',[['Fecha','Hora','Tipo','Concepto','Forma de pago','Comprobante','Ingreso (Gs)','Egreso (Gs)']].concat(libro(k).map(function(x){return [fdate(x.d),x.t,x.tipo,x.c,x.m,x.comp,x.ing,x.egr]})))}
  else if(t==='cxc'){csv('cuentas-por-cobrar-'+TODAY+'.csv',[['Paciente','Presupuesto','Fecha','Dias de antiguedad','Tramo','Total (Gs)','Saldo (Gs)']].concat(cxc().map(function(x){return [x.p.name,x.b.num,fdate(x.b.approvedOn||x.b.date),x.days,AGE_LB[x.bk],bTotal(x.b),x.bal]})))}
  else if(t==='cxp'){csv('cuentas-por-pagar-'+TODAY+'.csv',[['Proveedor','Concepto','Vencimiento','Monto (Gs)','Estado']].concat(S.payables.map(function(c){return [c.prov,c.concept,fdate(c.due),c.amount,c.paid?'Pagada':(c.due<TODAY?'Vencida':'Pendiente')]})))}
  else if(t==='iva'){var v=ivaCalc(k);csv('resumen-iva-'+k+'.csv',[['Concepto','Base (Gs)','IVA (Gs)'],['Ventas gravadas 10%',v.g10-v.d10,v.d10],['Ventas gravadas 5%',v.g5-v.d5,v.d5],['Ventas exentas',v.ex,0],['Compras gravadas 10%',v.c10-v.cr10,v.cr10],['Compras gravadas 5%',v.c5-v.cr5,v.cr5],['IVA a pagar','',v.d10+v.d5-v.cr10-v.cr5]])}
  else{csv('resultado-mensual-'+TODAY.slice(0,7)+'.csv',[['Mes','Ingresos (Gs)','Egresos (Gs)','Resultado (Gs)']].concat(resumen().map(function(m){return [m.label,m.ing,m.egr,m.ing-m.egr]})))}
};
function groupBars(rows){
  var W=760,H=280,pb=36,pt=24,max=Math.max.apply(null,rows.map(function(r){return Math.max(r.ing,r.egr)}))||1,step=(W-50)/rows.length,bw=Math.min(34,step*.32);
  var o='<svg viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Ingresos y egresos por mes" style="width:100%;height:auto">';
  for(var g=0;g<=4;g++){var y=H-pb-(H-pb-pt)*g/4;o+='<line x1="44" x2="'+W+'" y1="'+y+'" y2="'+y+'" stroke="#EFEBF6"/><text x="38" y="'+(y+4)+'" font-size="10.5" fill="#5E5878" text-anchor="end">'+compact(max*g/4)+'</text>'}
  rows.forEach(function(r,i){var x0=50+step*i+(step-2*bw-6)/2,h1=(H-pb-pt)*r.ing/max,h2=(H-pb-pt)*r.egr/max;
    o+='<rect x="'+x0+'" y="'+(H-pb-h1)+'" width="'+bw+'" height="'+h1+'" rx="6" fill="#18BFB0"><title>Ingresos '+esc(r.label)+': '+gs(r.ing)+'</title></rect><rect x="'+(x0+bw+6)+'" y="'+(H-pb-h2)+'" width="'+bw+'" height="'+h2+'" rx="6" fill="#FF5D5D"><title>Egresos '+esc(r.label)+': '+gs(r.egr)+'</title></rect><text x="'+(x0+bw+3)+'" y="'+(H-14)+'" font-size="12" fill="#5E5878" text-anchor="middle">'+esc(r.label)+'</text>'});
  return o+'</svg>';
}
VIEWS.contabilidad=function(){
  var k=ui.contM,tabs=[['libro','Libro de ingresos y egresos'],['cxc','Cuentas por cobrar'],['cxp','Cuentas por pagar'],['iva','IVA'],['res','Resultado mensual']];
  var tb='<div class="tabs">'+tabs.map(function(t){return '<button id="ctab-'+t[0]+'" data-act="cont-tab" data-t="'+t[0]+'" class="'+(ui.cont===t[0]?'on':'')+'">'+t[1]+'</button>'}).join('')+'</div>';
  var mnav=(ui.cont==='libro'||ui.cont==='iva')?'<div class="row" style="margin-bottom:14px"><button class="btn sm" data-act="cont-m" data-d="-1" aria-label="Mes anterior">‹</button><b style="text-transform:capitalize;min-width:150px;text-align:center">'+mLabel(k)+'</b><button class="btn sm" data-act="cont-m" data-d="1" aria-label="Mes siguiente">›</button></div>':'';
  var body='';
  if(ui.cont==='libro'){
    var rows=libro(k),ti=ui.contTipo,sh=rows.filter(function(x){return ti==='todos'||x.tipo.toLowerCase()+'s'===ti}),ti2=sum(rows,function(x){return x.ing}),te=sum(rows,function(x){return x.egr});
    body=mnav+'<div class="grid g3" style="margin-bottom:16px"><div class="card kpi"><div class="lb"><i class="c-t">'+I.cash+'</i>Ingresos</div><div class="v">'+gs(ti2)+'</div></div><div class="card kpi"><div class="lb"><i class="c-c">'+I.cash+'</i>Egresos</div><div class="v">'+gs(te)+'</div></div><div class="card kpi"><div class="lb"><i class="c-i">'+I.chart+'</i>Resultado</div><div class="v">'+gs(ti2-te)+'</div></div></div><div class="card"><div class="seg" style="margin-bottom:12px">'+[['todos','Todos'],['ingresos','Ingresos'],['egresos','Egresos']].map(function(x){return '<button data-act="cont-tipo" data-t="'+x[0]+'" class="'+(ti===x[0]?'on':'')+'">'+x[1]+'</button>'}).join('')+'</div><div class="tw"><table class="tbl rs" id="tbl-libro"><thead><tr><th>Fecha</th><th>Tipo</th><th>Concepto</th><th>Forma</th><th>Comprobante</th><th class="r">Ingreso</th><th class="r">Egreso</th></tr></thead><tbody>'+(sh.length?sh.map(function(x){return '<tr><td data-l="Fecha" class="num">'+fdate(x.d)+'</td><td data-l="Tipo">'+chip(x.tipo,x.tipo==='Ingreso'?'c-t':'c-c')+'</td><td data-l="Concepto">'+esc(x.c)+'</td><td data-l="Forma">'+esc(x.m)+'</td><td data-l="Comprobante" class="muted small">'+esc(x.comp)+'</td><td data-l="Ingreso" class="r num">'+(x.ing?gs(x.ing):'')+'</td><td data-l="Egreso" class="r num">'+(x.egr?gs(x.egr):'')+'</td></tr>'}).join(''):'<tr><td colspan="7" class="empty">Sin movimientos en este mes.</td></tr>')+'</tbody><tfoot><tr><td colspan="5">Totales</td><td class="r num">'+gs(sum(sh,function(x){return x.ing}))+'</td><td class="r num">'+gs(sum(sh,function(x){return x.egr}))+'</td></tr></tfoot></table></div></div>';
  }else if(ui.cont==='cxc'){
    var c=cxc(),bk=[0,1,2,3].map(function(i){return sum(c.filter(function(x){return x.bk===i}),function(x){return x.bal})}),tot=sum(bk,function(x){return x});
    body='<div class="card" style="margin-bottom:16px"><div class="card-h"><h2>Antigüedad de saldos</h2><b class="fre" style="font-size:22px">'+gs(tot)+'</b></div><div class="grid g4">'+bk.map(function(v,i){return '<div class="card flat kpi" style="padding:14px"><div class="lb">'+chip(AGE_LB[i],AGE_CH[i])+'</div><div class="v" style="font-size:24px">'+gs(v)+'</div><div class="bar" style="margin-top:8px"><i style="width:'+(tot?Math.round(v/tot*100):0)+'%;background:'+['#18BFB0','#FFC23C','#FF5D5D','#C23434'][i]+'"></i></div></div>'}).join('')+'</div></div>'+
    '<div class="card"><div class="tw"><table class="tbl rs" id="tbl-cxc"><thead><tr><th>Paciente</th><th>Presupuesto</th><th>Aprobado</th><th>Antigüedad</th><th class="r">Total</th><th class="r">Saldo</th><th></th></tr></thead><tbody>'+(c.length?c.map(function(x){return '<tr><td data-l="Paciente"><div class="pcell">'+pav(x.p)+'<b>'+esc(x.p.name)+'</b></div></td><td data-l="Presupuesto">'+x.b.num+'</td><td data-l="Aprobado">'+fdate(x.b.approvedOn||x.b.date)+'</td><td data-l="Antigüedad">'+chip(x.days+' días · '+AGE_LB[x.bk],AGE_CH[x.bk])+'</td><td data-l="Total" class="r num">'+gs(bTotal(x.b))+'</td><td data-l="Saldo" class="r num"><b>'+gs(x.bal)+'</b></td><td class="r"><button class="btn sm pri" data-act="cxc-cobrar" data-id="'+x.b.id+'">Cobrar</button></td></tr>'}).join(''):'<tr><td colspan="7" class="empty">No hay saldos pendientes.</td></tr>')+'</tbody><tfoot><tr><td colspan="5">Total por cobrar</td><td class="r num">'+gs(tot)+'</td><td></td></tr></tfoot></table></div></div>';
  }else if(ui.cont==='cxp'){
    var ps=S.payables.slice().sort(function(a,b){return a.due<b.due?-1:1});
    body='<div class="card"><div class="card-h"><h2>Proveedores y laboratorios</h2><b class="fre" style="font-size:22px">'+gs(sum(ps.filter(function(x){return !x.paid}),function(x){return x.amount}))+'</b></div><div class="tw"><table class="tbl rs" id="tbl-cxp"><thead><tr><th>Proveedor</th><th>Concepto</th><th>Vencimiento</th><th>Estado</th><th class="r">Monto</th><th></th></tr></thead><tbody>'+ps.map(function(c){var dd=daysBetween(TODAY,c.due),stt=c.paid?chip('Pagada','c-t'):dd<0?chip('Vencida hace '+(-dd)+' días','c-c'):dd<=7?chip('Vence en '+dd+' días','c-s'):chip('Al día','c-g');return '<tr><td data-l="Proveedor"><b>'+esc(c.prov)+'</b></td><td data-l="Concepto">'+esc(c.concept)+'</td><td data-l="Vence">'+fdate(c.due)+'</td><td data-l="Estado">'+stt+'</td><td data-l="Monto" class="r num">'+gs(c.amount)+'</td><td class="r">'+(c.paid?'':'<button class="btn sm pri" data-act="cxp-pagar" data-id="'+c.id+'">Registrar pago</button>')+'</td></tr>'}).join('')+'</tbody></table></div></div>';
  }else if(ui.cont==='iva'){
    var v=ivaCalc(k),deb=v.d10+v.d5,cre=v.cr10+v.cr5;
    body=mnav+'<div class="grid g2"><div class="card"><h2 style="margin-bottom:10px">Ventas (IVA débito)</h2><table class="tbl" id="tbl-iva"><thead><tr><th>Tasa</th><th class="r">Base</th><th class="r">IVA</th></tr></thead><tbody><tr><td>Gravadas 10%</td><td class="r num">'+gs(v.g10-v.d10)+'</td><td class="r num">'+gs(v.d10)+'</td></tr><tr><td>Gravadas 5%</td><td class="r num">'+gs(v.g5-v.d5)+'</td><td class="r num">'+gs(v.d5)+'</td></tr><tr><td>Exentas</td><td class="r num">'+gs(v.ex)+'</td><td class="r num">—</td></tr></tbody><tfoot><tr><td>IVA débito</td><td></td><td class="r num">'+gs(deb)+'</td></tr></tfoot></table></div>'+
    '<div class="card"><h2 style="margin-bottom:10px">Compras (IVA crédito)</h2><table class="tbl"><thead><tr><th>Tasa</th><th class="r">Base</th><th class="r">IVA</th></tr></thead><tbody><tr><td>Gravadas 10%</td><td class="r num">'+gs(v.c10-v.cr10)+'</td><td class="r num">'+gs(v.cr10)+'</td></tr><tr><td>Gravadas 5%</td><td class="r num">'+gs(v.c5-v.cr5)+'</td><td class="r num">'+gs(v.cr5)+'</td></tr></tbody><tfoot><tr><td>IVA crédito</td><td></td><td class="r num">'+gs(cre)+'</td></tr></tfoot></table></div></div><div class="card" style="margin-top:18px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px"><div><h2>IVA a pagar del mes</h2><span class="muted small">Débito − crédito · cálculo ilustrativo</span></div><div class="fre" id="iva-pagar" style="font-size:32px;font-weight:600">'+gs(deb-cre)+'</div></div>';
  }else{
    var rs=resumen(),cur=rs[rs.length-1];
    body='<div class="grid g3" style="margin-bottom:16px"><div class="card kpi"><div class="lb"><i class="c-t">'+I.cash+'</i>Ingresos del mes</div><div class="v">'+gs(cur.ing)+'</div></div><div class="card kpi"><div class="lb"><i class="c-c">'+I.cash+'</i>Egresos del mes</div><div class="v">'+gs(cur.egr)+'</div></div><div class="card kpi"><div class="lb"><i class="c-i">'+I.chart+'</i>Resultado del mes</div><div class="v" id="res-mes" style="color:'+(cur.ing-cur.egr>=0?'#0B7A70':'#C23434')+'">'+gs(cur.ing-cur.egr)+'</div><div class="s">ingresos − egresos</div></div></div><div class="card"><div class="card-h"><h2>Últimos 6 meses</h2><div class="legend"><span><i style="background:#18BFB0"></i>Ingresos</span><span><i style="background:#FF5D5D"></i>Egresos</span></div></div>'+groupBars(rs)+'<div class="tw" style="margin-top:10px"><table class="tbl rs"><thead><tr><th>Mes</th><th class="r">Ingresos</th><th class="r">Egresos</th><th class="r">Resultado</th></tr></thead><tbody>'+rs.map(function(m){return '<tr><td data-l="Mes" style="text-transform:capitalize">'+m.label+'</td><td data-l="Ingresos" class="r num">'+gs(m.ing)+'</td><td data-l="Egresos" class="r num">'+gs(m.egr)+'</td><td data-l="Resultado" class="r num"><b>'+gs(m.ing-m.egr)+'</b></td></tr>'}).join('')+'</tbody></table></div></div>';
  }
  return ph('Contabilidad','Libro, cuentas, IVA y resultado de la clínica',btn('Exportar CSV','csv',{c:'pri',i:'dl',id:'btn-csv'}))+tb+body;
};

/* ================= REPORTES ================= */
IN.repRange=function(){ui.repFrom=val('rep-from')||ui.repFrom;ui.repTo=val('rep-to')||ui.repTo;if(ui.repFrom>ui.repTo){var t=ui.repFrom;ui.repFrom=ui.repTo;ui.repTo=t}render(true)};
ACT['rep-preset']=function(el){var p=el.dataset.p;ui.repTo=TODAY;ui.repFrom=p==='hoy'?TODAY:p==='7'?addDays(TODAY,-6):p==='30'?addDays(TODAY,-29):TODAY.slice(0,8)+'01';render(true)};
function hbars(rows,color,fmt){var mx=Math.max.apply(null,rows.map(function(r){return r.v}))||1;return rows.map(function(r){return '<div class="hbar"><span>'+esc(r.l)+'</span><div class="bar"><i style="width:'+Math.round(r.v/mx*100)+'%;background:'+(r.c||color)+'"></i></div><b class="num right">'+fmt(r)+'</b></div>'}).join('')}
VIEWS.reportes=function(){
  var f=ui.repFrom,t=ui.repTo,py=payIn(f,t),tot=sum(py,function(p){return p.amount});
  var byD=S.dentists.map(function(d){var x=py.filter(function(p){return p.did===d.id});return {l:d.name,v:sum(x,function(p){return p.amount}),n:x.length,c:d.color}});
  var g={};py.forEach(function(p){g[p.trat]=g[p.trat]||{l:p.trat,v:0,n:0};g[p.trat].v+=p.amount;g[p.trat].n++});
  var top=Object.keys(g).map(function(k){return g[k]}).sort(function(a,b){return b.n-a.n||b.v-a.v}).slice(0,6);
  var byM=Object.keys(METHODS).map(function(k){return {k:k,l:METHODS[k],v:sum(py.filter(function(p){return p.method===k}),function(p){return p.amount}),c:PALETTE_M[k]}});
  var C=2*Math.PI*52,off=0,donut='<svg viewBox="0 0 140 140" width="160" height="160" role="img" aria-label="Ingresos por forma de pago"><circle cx="70" cy="70" r="52" fill="none" stroke="#F1EFF6" stroke-width="22"/>'+byM.map(function(m){var len=tot?C*m.v/tot:0,s='<circle cx="70" cy="70" r="52" fill="none" stroke="'+m.c+'" stroke-width="22" stroke-dasharray="'+len+' '+(C-len)+'" stroke-dashoffset="'+(-off)+'" transform="rotate(-90 70 70)"><title>'+m.l+': '+gs(m.v)+'</title></circle>';off+=len;return s}).join('')+'<text x="70" y="66" text-anchor="middle" font-size="11" fill="#5E5878">Total</text><text x="70" y="84" text-anchor="middle" font-size="14" font-weight="700" fill="#232036">'+compact(tot)+'</text></svg>';
  var pre=[['hoy','Hoy'],['7','Últimos 7 días'],['mes','Este mes'],['30','Últimos 30 días']];
  return ph('Reportes','Producción, tratamientos y formas de pago')+
  '<div class="card" style="margin-bottom:18px"><div class="row" style="gap:14px"><div class="field" style="margin:0"><label for="rep-from">Desde</label><input id="rep-from" type="date" data-ch="repRange" value="'+f+'"></div><div class="field" style="margin:0"><label for="rep-to">Hasta</label><input id="rep-to" type="date" data-ch="repRange" value="'+t+'"></div><div class="seg" style="align-self:flex-end">'+pre.map(function(x){return '<button id="rep-p-'+x[0]+'" data-act="rep-preset" data-p="'+x[0]+'">'+x[1]+'</button>'}).join('')+'</div></div></div>'+
  '<div class="grid g3" style="margin-bottom:18px"><div class="card kpi"><div class="lb"><i class="c-t">'+I.cash+'</i>Ingresos del período</div><div class="v" id="rep-total">'+gs(tot)+'</div><div class="s">'+fdate(f)+' al '+fdate(t)+'</div></div><div class="card kpi"><div class="lb"><i class="c-i">'+I.doc+'</i>Cobros registrados</div><div class="v" id="rep-count">'+py.length+'</div></div><div class="card kpi"><div class="lb"><i class="c-u">'+I.chart+'</i>Cobro promedio</div><div class="v">'+gs(py.length?tot/py.length:0)+'</div></div></div>'+
  '<div class="grid g2"><div class="card"><h2 style="margin-bottom:10px">Producción por profesional</h2>'+(tot?hbars(byD,'#18BFB0',function(r){return gs(r.v)}):'<div class="empty">Sin datos en el período</div>')+'</div>'+
  '<div class="card"><h2 style="margin-bottom:10px">Tratamientos más realizados</h2>'+(top.length?hbars(top.map(function(x){return {l:x.l,v:x.n,c:'#8B5CF6',s:x.v}}),'#8B5CF6',function(r){return r.v+' · '+compact(r.s)}):'<div class="empty">Sin datos en el período</div>')+'</div></div>'+
  '<div class="card" style="margin-top:18px"><h2 style="margin-bottom:10px">Ingresos por forma de pago</h2><div class="row" style="gap:30px;align-items:center">'+donut+'<div style="flex:1;min-width:240px">'+byM.map(function(m){return '<div class="mini-row"><i style="width:12px;height:12px;border-radius:4px;background:'+m.c+'"></i><span class="g">'+m.l+'</span><span class="muted small">'+(tot?Math.round(m.v/tot*100):0)+'%</span><b class="num" style="min-width:120px;text-align:right">'+gs(m.v)+'</b></div>'}).join('')+'</div></div></div>';
};

/* ================= PERSONAL ================= */
ACT['stf-toggle']=function(el){var f=S.staff.filter(function(x){return x.id===el.dataset.id})[0];f.on=!f.on;if(f.on&&f.hor==='Pendiente de activar')f.hor='Lun a vie · 08:00 a 16:00';save();toast(f.name+(f.on?' activado/a':' desactivado/a'));render(true)};
ACT['stf-new']=function(){modal('Invitar usuario','<div class="field"><label for="sf-name">Nombre y apellido</label><input id="sf-name"></div><div class="field"><label for="sf-rol">Rol</label><select id="sf-rol">'+opts(['Odontólogo/a','Asistente dental','Recepción y caja','Administración'],'',function(x){return [x,x]})+'</select></div>','<button class="btn" data-act="close">Cancelar</button><button class="btn pri" id="sf-ok" data-act="stf-save">Enviar invitación</button>')};
ACT['stf-save']=function(){var n=val('sf-name').trim();if(!n){toast('Escribí el nombre','err');return}S.staff.push({id:'f'+nid('stf'),name:n,rol:val('sf-rol'),sede:'Sede Centro',hor:'Pendiente de activar',extra:'Invitación enviada',on:false});save();closeModal();toast('Invitación enviada a '+n);render(true)};
VIEWS.personal=function(){
  return ph('Personal',S.staff.filter(function(x){return x.on}).length+' personas activas',btn('Invitar usuario','stf-new',{c:'pri',i:'plus',id:'btn-invitar'}))+
  '<div class="grid g3">'+S.staff.map(function(f,i){return '<div class="card" style="'+(f.on?'':'opacity:.7')+'"><div class="row" style="gap:14px">'+avatar(f.name,AVC[i%6],true)+'<div style="flex:1;min-width:0"><h3>'+esc(f.name)+'</h3><div class="muted">'+esc(f.rol)+'</div></div><button class="sw '+(f.on?'on':'')+'" role="switch" aria-checked="'+f.on+'" aria-label="Activo" data-act="stf-toggle" data-id="'+f.id+'"></button></div><div class="mini-row small" style="margin-top:12px"><span class="muted">Sede</span><b class="g" style="text-align:right">'+f.sede+'</b></div><div class="mini-row small"><span class="muted">Horario</span><b class="g" style="text-align:right">'+esc(f.hor)+'</b></div><div class="mini-row small"><span class="muted">Asignación</span><b class="g" style="text-align:right">'+esc(f.extra)+'</b></div><div style="margin-top:10px">'+(f.on?chip('Activo','c-t'):chip(f.hor==='Pendiente de activar'?'Pendiente de activar':'Inactivo','c-g'))+'</div></div>'}).join('')+'</div>';
};

/* ================= INVENTARIO ================= */
ACT['inv-in']=function(el){var i=S.inventory.filter(function(x){return x.id===el.dataset.id})[0];modal('Registrar entrada · '+esc(i.name),'<p class="muted" style="margin-bottom:12px">Stock actual: <b>'+i.stock+' '+i.unit+'</b> · mínimo '+i.min+'</p><div class="field"><label for="in-qty">Cantidad recibida</label><input id="in-qty" type="number" min="1" value="10"></div>','<button class="btn" data-act="close">Cancelar</button><button class="btn pri" id="in-ok" data-act="inv-in-ok" data-id="'+i.id+'">Registrar entrada</button>')};
ACT['inv-in-ok']=function(el){var i=S.inventory.filter(function(x){return x.id===el.dataset.id})[0],q=Math.round(+val('in-qty'));if(!q||q<1)return;i.stock+=q;save();closeModal();toast('Entrada registrada: +'+q+' '+i.unit+' de '+i.name);render(true)};
ACT['inv-out']=function(el){var i=S.inventory.filter(function(x){return x.id===el.dataset.id})[0];if(i.stock>0)i.stock--;save();toast('Salida registrada: '+i.name+' · quedan '+i.stock);render(true)};
VIEWS.inventario=function(){
  var low=S.inventory.filter(function(i){return i.stock<=i.min});
  return ph('Inventario','Insumos y materiales con alerta de reposición')+
  (low.length?'<div class="alert warn" id="inv-alert" style="margin-bottom:18px">'+I.alert+'<div><b>Reposición necesaria:</b> '+low.map(function(i){return esc(i.name)+' ('+i.stock+' de '+i.min+' mínimos)'}).join(' · ')+'</div></div>':'<div class="alert ok" style="margin-bottom:18px">'+I.check+'<div>Todo el stock está por encima del mínimo.</div></div>')+
  '<div class="card"><div class="tw"><table class="tbl rs" id="tbl-inv"><thead><tr><th>Insumo</th><th>Categoría</th><th>Nivel</th><th>Proveedor</th><th>Vence</th><th></th></tr></thead><tbody>'+S.inventory.map(function(i){var lo=i.stock<=i.min,pc=Math.min(100,Math.round(i.stock/(i.min*3)*100)),soon=i.exp&&daysBetween(TODAY,i.exp)<=30;
   return '<tr><td data-l="Insumo"><b>'+esc(i.name)+'</b></td><td data-l="Categoría">'+i.cat+'</td><td data-l="Nivel" style="min-width:200px"><div class="row" style="gap:10px"><b class="num">'+i.stock+' '+i.unit+'</b>'+(lo?chip(i.stock===0?'Agotado':'Nivel bajo','c-c'):'')+'</div><div class="bar" style="margin-top:6px"><i style="width:'+pc+'%;background:'+(lo?'#FF5D5D':'#18BFB0')+'"></i></div><div class="muted tiny">mínimo '+i.min+'</div></td><td data-l="Proveedor">'+esc(i.prov)+'</td><td data-l="Vence">'+(i.exp?fdate(i.exp)+(soon?' '+chip('Vence pronto','c-s'):''):'—')+'</td><td class="r"><div class="row" style="justify-content:flex-end"><button class="btn sm" data-act="inv-out" data-id="'+i.id+'" aria-label="Registrar salida">−1</button><button class="btn sm pri" id="inv-in-'+i.id+'" data-act="inv-in" data-id="'+i.id+'">Entrada</button></div></td></tr>'}).join('')+'</tbody></table></div></div>';
};

/* ================= ARRANQUE ================= */
function boot(){
  $('#nav').innerHTML=NAV.map(function(n,i){return (n[0]==='personal'?'<div class="sep">Gestión interna</div>':'')+'<a href="#/'+n[0]+'" id="nav-'+n[0]+'" data-route="'+n[0]+'">'+I[n[2]]+n[1]+'</a>'}).join('');
  $('#datechip').textContent=fdateLong(TODAY);
  render();
}
boot();
