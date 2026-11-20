/* Gestión · núcleo, Inicio, Agenda, Pacientes (incl. Patología bucal) */
var VIEWS={},ACT={},IN={};
var $=function(s,r){return (r||document).querySelector(s)};
var $$=function(s,r){return Array.prototype.slice.call((r||document).querySelectorAll(s))};
var val=function(id){var e=document.getElementById(id);return e?e.value:''};
var ui={agDate:TODAY,agView:'day',patQ:'',patF:'todos',cont:'libro',contM:curMonth(),contTipo:'todos',draft:null,repFrom:TODAY.slice(0,8)+'01',repTo:TODAY,invMore:false,invOpen:null,pay:null,les:null};

var I={
 home:'<svg viewBox="0 0 24 24"><path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/></svg>',
 cal:'<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
 users:'<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.7-3.5 3.3-5.5 6.5-5.5s5.8 2 6.5 5.5"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.8c2 .7 3.2 2.4 3.6 5.2"/></svg>',
 doc:'<svg viewBox="0 0 24 24"><path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 13h6M9 17h6"/></svg>',
 cash:'<svg viewBox="0 0 24 24"><rect x="2.5" y="6" width="19" height="12" rx="2.5"/><circle cx="12" cy="12" r="2.8"/><path d="M6 9v.01M18 15v.01"/></svg>',
 inv:'<svg viewBox="0 0 24 24"><path d="M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2z"/><path d="M9 8h6M9 12h6"/></svg>',
 book:'<svg viewBox="0 0 24 24"><path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 21V5M9 8h6M9 12h6"/></svg>',
 chart:'<svg viewBox="0 0 24 24"><path d="M4 20V10M10 20V4M16 20v-8M22 20H2"/></svg>',
 team:'<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21c.8-4.5 4-7 8-7s7.2 2.5 8 7"/></svg>',
 box:'<svg viewBox="0 0 24 24"><path d="M3 7l9-4 9 4-9 4z"/><path d="M3 7v10l9 4 9-4V7M12 11v10"/></svg>',
 plus:'<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
 dl:'<svg viewBox="0 0 24 24"><path d="M12 4v11M7 11l5 5 5-5M4 20h16"/></svg>',
 tooth:'<svg viewBox="0 0 24 24"><path d="M6 5c2-1.5 4 0 6 0s4-1.5 6 0c2 2 1 5 0 8-.6 2-1 7-2.5 7s-1.2-4-3.5-4-2 4-3.5 4S7 15 6 13c-1-3-2-6 0-8z"/></svg>',
 alert:'<svg viewBox="0 0 24 24"><path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.01"/></svg>',
 info:'<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.01"/></svg>',
 check:'<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
 efectivo:'<svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.6"/></svg>',
 tarjeta:'<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3 10h18M7 15h4"/></svg>',
 transferencia:'<svg viewBox="0 0 24 24"><path d="M4 8h14l-3-3M20 16H6l3 3"/></svg>',
 qr:'<svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14v.01M14 20h3M20 18v3"/></svg>',
 cam:'<svg viewBox="0 0 24 24"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>'
};
var NAV=[['inicio','Inicio','home'],['agenda','Agenda','cal'],['pacientes','Pacientes','users'],['presupuestos','Presupuestos','doc'],['caja','Caja','cash'],['facturacion','Facturación SIFEN','inv'],['contabilidad','Contabilidad','book'],['reportes','Reportes','chart'],['personal','Personal','team'],['inventario','Inventario','box']];
var TITLES={inicio:'Inicio',agenda:'Agenda',pacientes:'Pacientes',presupuestos:'Presupuestos',caja:'Caja',facturacion:'Facturación SIFEN',contabilidad:'Contabilidad',reportes:'Reportes',personal:'Personal',inventario:'Inventario'};
var ST={agendada:['Agendada','c-g'],confirmada:['Confirmada','c-i'],'en sala':['En sala','c-s'],atendida:['Atendida','c-t']};
var NEXT={agendada:'confirmada',confirmada:'en sala','en sala':'atendida'};
var NEXTLB={agendada:'Confirmar',confirmada:'Pasar a sala','en sala':'Marcar atendida'};
var PALETTE_M={efectivo:'#18BFB0',tarjeta:'#2E9BEC',transferencia:'#8B5CF6',qr:'#FFC23C'};

/* ---------- helpers de UI ---------- */
function chip(t,c,nodot){return '<span class="chip '+c+(nodot?' nodot':'')+'">'+esc(t)+'</span>'}
function stChip(s){var x=ST[s]||[s,'c-g'];return chip(x[0],x[1])}
function avatar(name,cls,lg){return '<div class="avatar '+(lg?'lg ':'')+(cls||'c-i')+'">'+esc(initials(name))+'</div>'}
var AVC=['c-t','c-i','c-u','c-r','c-s','c-c'];
function pav(p,lg){return avatar(p.name,AVC[parseInt(p.id.slice(1),10)%6],lg)}
function ph(title,sub,acts){return '<div class="ph"><div><h1>'+title+'</h1>'+(sub?'<p>'+sub+'</p>':'')+'</div><div class="acts">'+(acts||'')+'</div></div>'}
function btn(label,act,o){o=o||{};return '<button class="btn '+(o.c||'')+'" '+(o.id?'id="'+o.id+'" ':'')+'data-act="'+act+'"'+(o.d?' '+o.d:'')+'>'+(o.i?I[o.i]:'')+label+'</button>'}
function toast(msg,err){var t=document.createElement('div');t.className='toast'+(err?' err':'');t.innerHTML='<i>'+(err?'!':'✓')+'</i><span>'+esc(msg)+'</span>';$('#toasts').appendChild(t);setTimeout(function(){t.style.opacity='0';t.style.transition='opacity .3s';setTimeout(function(){t.remove()},320)},3400)}
function modal(title,body,foot,wide){$('#modal-root').innerHTML='<div class="bk" data-act="bk"><div class="mdl'+(wide?' wide':'')+'" role="dialog" aria-modal="true" aria-label="'+esc(title)+'"><div class="mdl-h"><h2>'+title+'</h2><button class="x" data-act="close" aria-label="Cerrar">×</button></div><div class="mdl-b">'+body+'</div>'+(foot?'<div class="mdl-f">'+foot+'</div>':'')+'</div></div>'}
function closeModal(){$('#modal-root').innerHTML='';ui.invOpen=null}
function compact(v){return v>=1e6?(v/1e6).toFixed(1).replace('.',',')+' M':v>=1000?Math.round(v/1000)+' mil':String(v)}
function opts(arr,sel,f){return arr.map(function(x){var o=f(x);return '<option value="'+esc(o[0])+'"'+(String(o[0])===String(sel)?' selected':'')+'>'+esc(o[1])+'</option>'}).join('')}
function patOpts(sel){return opts(S.patients.slice().sort(function(a,b){return a.name.localeCompare(b.name,'es')}),sel,function(p){return [p.id,p.name+' · CI '+p.ci]})}
function csv(name,rows){
  var t='﻿'+rows.map(function(r){return r.map(function(c){c=String(c==null?'':c);return /[;"\n]/.test(c)?'"'+c.replace(/"/g,'""')+'"':c}).join(';')}).join('\r\n');
  var b=new Blob([t],{type:'text/csv;charset=utf-8'});var a=document.createElement('a');a.href=URL.createObjectURL(b);a.download=name;document.body.appendChild(a);a.click();
  setTimeout(function(){a.remove();URL.revokeObjectURL(a.href)},600);toast('Archivo «'+name+'» descargado');
}
function txFor(amount,b){
  if(!b)return null;var sub=bSub(b),sh={g10:0,g5:0,ex:0};
  b.items.forEach(function(i){sh[i.iva===10?'g10':i.iva===5?'g5':'ex']+=i.price*i.qty});
  var tx={g10:Math.round(amount*sh.g10/sub),g5:Math.round(amount*sh.g5/sub),ex:Math.round(amount*sh.ex/sub)};tx.g10+=amount-tx.g10-tx.g5-tx.ex;return tx;
}

/* ---------- router ---------- */
function parseHash(){var h=(location.hash||'#/inicio').slice(2);var q={};var qi=h.indexOf('?');if(qi>=0){h.slice(qi+1).split('&').forEach(function(kv){var a=kv.split('=');q[a[0]]=decodeURIComponent(a[1]||'')});h=h.slice(0,qi)}var p=h.split('/');return {name:p[0]||'inicio',a:p[1],b:p[2],q:q}}
function render(soft){
  var r=parseHash();if(!VIEWS[r.name])r.name='inicio';
  var v=$('#view');v.innerHTML=VIEWS[r.name](r);
  if(!soft){ui.anamV=null;v.classList.remove('view');void v.offsetWidth;v.classList.add('view');window.scrollTo(0,0)}
  $$('#nav a').forEach(function(a){a.classList.toggle('on',a.dataset.route===r.name)});
  document.title=(TITLES[r.name]||'Gestión')+' · Sonrisa Para Todos Conecta';
  $('#side').classList.remove('open');
  if(VIEWS[r.name].after)VIEWS[r.name].after(r);
}
function nav(h){if(location.hash==='#/'+h){render()}else location.hash='#/'+h}

/* ---------- eventos ---------- */
document.addEventListener('click',function(e){
  var el=e.target.closest('[data-act]');
  if(!el){var g=$('#gs-res');if(g&&!e.target.closest('.gs'))g.hidden=true;return}
  var a=el.dataset.act;if(ACT[a])ACT[a](el,e);
});
document.addEventListener('input',function(e){var f=e.target.dataset&&e.target.dataset.in;if(f&&IN[f])IN[f](e.target,e)});
document.addEventListener('change',function(e){var f=e.target.dataset&&e.target.dataset.ch;if(f&&IN[f])IN[f](e.target,e)});
document.addEventListener('keydown',function(e){if(e.key==='Escape')closeModal()});
window.addEventListener('hashchange',function(){closeModal();render()});
ACT.bk=function(el,e){if(e.target===el)closeModal()};
ACT.close=function(){closeModal()};
ACT['toggle-side']=function(){$('#side').classList.toggle('open')};
ACT.go=function(el){nav(el.dataset.to)};
ACT.reset=function(){seed(false);ui.draft=null;ui.pay=null;closeModal();toast('Demo reiniciada con los datos de ejemplo');if(location.hash!=='#/inicio')location.hash='#/inicio';else render()};
ACT['reset-closed']=function(){seed(true);ui.draft=null;ui.pay=null;closeModal();toast('Demo reiniciada · caja cerrada');if(location.hash!=='#/caja')location.hash='#/caja';else render()};
IN.gsearch=function(el){
  var q=el.value.trim().toLowerCase(),box=$('#gs-res');if(!q){box.hidden=true;return}
  var r=S.patients.filter(function(p){return (p.name+' '+p.ci+' '+p.tel).toLowerCase().indexOf(q)>=0}).slice(0,6);
  box.hidden=false;
  box.innerHTML=r.length?r.map(function(p){return '<a href="#/pacientes/'+p.id+'" data-act="gs-pick">'+pav(p)+'<span><b>'+esc(p.name)+'</b><span class="small muted"> · CI '+p.ci+'</span></span></a>'}).join(''):'<div class="empty small">Sin resultados</div>';
};
ACT['gs-pick']=function(){$('#gs-res').hidden=true;$('#gsearch').value=''};

/* ---------- gráficos ---------- */
function barSvg(items,o){
  o=o||{};var W=o.w||620,H=o.h||230,pb=34,pt=22,max=Math.max.apply(null,items.map(function(i){return i.v}))||1;
  var n=items.length,bw=Math.min(56,(W-40)/n*.6),step=(W-40)/n,out='<svg viewBox="0 0 '+W+' '+H+'" role="img" aria-label="'+esc(o.label||'Gráfico de barras')+'" style="width:100%;height:auto">';
  for(var g=0;g<=3;g++){var y=H-pb-(H-pb-pt)*g/3;out+='<line x1="30" x2="'+W+'" y1="'+y+'" y2="'+y+'" stroke="#EFEBF6"/>'+'<text x="26" y="'+(y+4)+'" font-size="10.5" fill="#5E5878" text-anchor="end">'+compact(max*g/3)+'</text>'}
  items.forEach(function(it,i){var h=(H-pb-pt)*it.v/max,x=36+step*i+(step-bw)/2,y=H-pb-h;
    out+='<rect x="'+x+'" y="'+y+'" width="'+bw+'" height="'+Math.max(h,1)+'" rx="8" fill="'+(it.hl?'#0B7A70':'#18BFB0')+'" opacity="'+(it.hl?1:.85)+'"><title>'+esc(it.l+': '+gs(it.v))+'</title></rect>'+
    '<text x="'+(x+bw/2)+'" y="'+(y-7)+'" font-size="11" font-weight="700" fill="#232036" text-anchor="middle">'+compact(it.v)+'</text>'+
    '<text x="'+(x+bw/2)+'" y="'+(H-12)+'" font-size="12" fill="#5E5878" text-anchor="middle">'+esc(it.l)+'</text>'});
  return out+'</svg>';
}

/* ================= INICIO ================= */
VIEWS.inicio=function(){
  var tp=payIn(TODAY,TODAY),ingD=sum(tp,function(x){return x.amount}),mr=monthRange(curMonth()),ingM=sum(payIn(mr[0],mr[1]),function(x){return x.amount});
  var ap=S.appts.filter(function(a){return a.date===TODAY}).sort(function(a,b){return a.time<b.time?-1:a.time>b.time?1:0});
  var done=ap.filter(function(a){return a.status==='atendida'}).length,tb=totalBal();
  var days=[];for(var k=6;k>=0;k--){var d=addDays(TODAY,-k);days.push({l:DNS[pd(d).getDay()]+' '+pd(d).getDate(),v:sum(payIn(d,d),function(x){return x.amount}),hl:k===0})}
  var debt=S.patients.map(function(p){return {p:p,b:patBal(p.id)}}).filter(function(x){return x.b>0}).sort(function(a,b){return b.b-a.b}).slice(0,4);
  var low=S.inventory.filter(function(i){return i.stock<=i.min}),draft=S.budgets.filter(function(b){return b.status==='borrador'}),due=S.payables.filter(function(c){return !c.paid&&c.due<TODAY});
  var al='';
  if(low.length)al+='<div class="alert warn">'+I.alert+'<div><b>Stock bajo:</b> '+low.map(function(i){return esc(i.name)}).join(', ')+'. <a href="#/inventario">Ver inventario</a></div></div>';
  if(draft.length)al+='<div class="alert info">'+I.info+'<div><b>'+draft.length+' presupuestos</b> esperan aprobación. <a href="#/presupuestos">Revisar</a></div></div>';
  if(due.length)al+='<div class="alert bad">'+I.alert+'<div><b>Pago vencido</b> a '+esc(due[0].prov)+' ('+gs(due[0].amount)+'). <a href="#/contabilidad">Ver cuentas por pagar</a></div></div>';
  var ses=openSes();
  return ph('Buen día, Lorena','<span id="hoy-fecha">'+fdateLong(TODAY)+'</span> · Sede Centro, Asunción',btn('Nuevo turno','ag-new',{c:'pri',i:'plus',id:'btn-nuevo-turno-inicio'})+btn('Cobrar','pay-new',{i:'cash',id:'btn-cobrar-inicio'}))+
  '<div class="grid g4" style="margin-bottom:18px">'+
   '<div class="card kpi"><div class="lb"><i class="c-t">'+I.cash+'</i>Ingresos de hoy</div><div class="v" id="kpi-hoy">'+gs(ingD)+'</div><div class="s">'+tp.length+' cobros · caja '+(ses?'abierta':'cerrada')+'</div></div>'+
   '<div class="card kpi"><div class="lb"><i class="c-i">'+I.chart+'</i>Ingresos del mes</div><div class="v" id="kpi-mes">'+gs(ingM)+'</div><div class="s">'+MN[pd(TODAY).getMonth()]+' '+pd(TODAY).getFullYear()+'</div></div>'+
   '<div class="card kpi"><div class="lb"><i class="c-c">'+I.doc+'</i>Saldos pendientes</div><div class="v" id="kpi-saldos">'+gs(tb)+'</div><div class="s">por cobrar de presupuestos aprobados</div></div>'+
   '<div class="card kpi"><div class="lb"><i class="c-u">'+I.cal+'</i>Turnos de hoy</div><div class="v">'+ap.length+'</div><div class="s">'+done+' atendidos · '+(ap.length-done)+' por atender</div></div>'+
  '</div><div class="grid g21"><div class="stack">'+
   '<div class="card"><div class="card-h"><h2>Ingresos de los últimos 7 días</h2><span class="muted small">en guaraníes</span></div>'+barSvg(days,{label:'Ingresos de los últimos 7 días'})+'</div>'+
   '<div class="card"><div class="card-h"><h2>Turnos de hoy</h2>'+btn('Ver agenda','go',{d:'data-to="agenda"',c:'sm'})+'</div><div class="tw"><table class="tbl rs" id="tbl-hoy"><thead><tr><th>Hora</th><th>Paciente</th><th>Tratamiento</th><th>Profesional</th><th>Estado</th><th></th></tr></thead><tbody>'+
   ap.map(function(a){var p=pat(a.pid),d=den(a.did);return '<tr><td data-l="Hora" class="num"><b>'+a.time+'</b></td><td data-l="Paciente"><div class="pcell">'+pav(p)+'<b>'+esc(p.name)+'</b></div></td><td data-l="Tratamiento">'+esc(tre(a.tid).name)+'</td><td data-l="Profesional">'+esc(d.name)+' · '+d.chair+'</td><td data-l="Estado">'+stChip(a.status)+'</td><td class="r">'+(NEXT[a.status]?'<button class="btn sm" data-act="ag-next" data-id="'+a.id+'">'+NEXTLB[a.status]+'</button>':'<button class="btn sm" data-act="pay-new" data-pid="'+p.id+'">Cobrar</button>')+'</td></tr>'}).join('')+'</tbody></table></div></div>'+
  '</div><div class="stack">'+
   '<div class="card"><h2 style="margin-bottom:12px">Alertas</h2><div class="stack" style="gap:10px">'+(al||'<div class="empty small">Todo en orden</div>')+'</div></div>'+
   '<div class="card"><div class="card-h"><h2>Mayores saldos</h2>'+btn('Cuentas por cobrar','go',{d:'data-to="contabilidad"',c:'sm'})+'</div>'+debt.map(function(x){return '<div class="mini-row"><a href="#/pacientes/'+x.p.id+'/pagos" style="text-decoration:none;color:inherit;display:flex;gap:10px;align-items:center;flex:1;min-width:0">'+pav(x.p)+'<div class="g"><b>'+esc(x.p.name)+'</b></div></a><b class="num">'+gs(x.b)+'</b></div>'}).join('')+'</div>'+
  '</div></div>';
};
ACT['ag-next']=function(el){var a=S.appts.filter(function(x){return x.id===el.dataset.id})[0];a.status=NEXT[a.status];save();toast(pat(a.pid).name+': '+ST[a.status][0].toLowerCase());render(true)};

/* ================= AGENDA ================= */
var H0=480,H1=1080,SLOT=38;
VIEWS.agenda=function(){
  var d=ui.agDate,wk=ui.agView==='week',title=wk?'Semana del '+fdate(mondayOf(d))+' al '+fdate(addDays(mondayOf(d),5)):fdateLong(d);
  var leg='<div class="dlist">'+sedeDocs().map(function(x){return '<span><i style="background:'+x.color+'"></i>'+esc(x.name)+' · '+x.chair+'</span>'}).join('')+'</div>';
  var head=ph('Agenda','Turnos por profesional y sillón',
    '<div class="seg" role="group" aria-label="Vista"><button id="ag-v-day" data-act="ag-view" data-v="day" class="'+(wk?'':'on')+'">Día</button><button id="ag-v-week" data-act="ag-view" data-v="week" class="'+(wk?'on':'')+'">Semana</button></div>'+btn('Nuevo turno','ag-new',{c:'pri',i:'plus',id:'btn-nuevo-turno'}));
  var nb='<div class="row" style="margin-bottom:14px"><button class="btn sm" id="ag-prev" data-act="ag-prev" aria-label="Anterior">‹</button><button class="btn sm" id="ag-hoy" data-act="ag-today">Hoy</button><button class="btn sm" id="ag-next" data-act="ag-nextd" aria-label="Siguiente">›</button><h2 style="margin-left:8px;text-transform:capitalize">'+title+'</h2><span style="flex:1"></span>'+leg+'</div>';
  var body;
  if(!wk){
    var slots=(H1-H0)/30,hgt=slots*SLOT,cols='<div class="ag-h"></div>'+sedeDocs().map(function(x){return '<div class="ag-h"><span style="color:'+x.color+'">●</span> '+esc(x.name)+'<small>'+x.chair+' · '+x.esp+'</small></div>'}).join('');
    var tcol='<div class="ag-time" style="height:'+hgt+'px">'+Array.apply(null,Array(slots/2)).map(function(_,i){return '<span style="top:'+(i*2*SLOT)+'px">'+pad(8+i)+':00</span>'}).join('')+'</div>';
    var now=toMin(nowHM());
    var cc=sedeDocs().map(function(x){
      var zs='';for(var s=0;s<slots;s++)zs+='<div class="ag-slot" style="top:'+(s*SLOT)+'px" data-act="ag-new" data-did="'+x.id+'" data-time="'+fromMin(H0+s*30)+'"></div>';
      var as=S.appts.filter(function(a){return a.date===d&&a.did===x.id&&enSede(a)}).map(function(a){var p=pat(a.pid),t=tre(a.tid),top=(toMin(a.time)-H0)/30*SLOT,h=a.dur/30*SLOT-3;
        return '<div class="apt s-'+a.status.replace(' ','')+'" data-act="ag-open" data-id="'+a.id+'" style="top:'+top+'px;height:'+h+'px;background:'+x.color+'24;border-color:'+x.color+'"><span class="st">'+stChip(a.status)+(a.src==='online'?' <span class="chip c-s" title="Reservado por el paciente">Online</span>':'')+'</span><b>'+esc(p.name)+'</b><span>'+a.time+' · '+esc(t.name)+'</span></div>'}).join('');
      var nl=(d===TODAY&&now>=H0&&now<H1)?'<div class="now" style="top:'+((now-H0)/30*SLOT)+'px"></div>':'';
      return '<div class="ag-col" style="--slot:'+SLOT+'px;height:'+hgt+'px">'+zs+as+nl+'</div>'}).join('');
    body='<div class="agwrap"><div class="ag" style="grid-template-columns:56px repeat('+sedeDocs().length+',minmax(210px,1fr))">'+cols+tcol+cc+'</div></div>';
  }else{
    var mo=mondayOf(d);body='<div class="wk">';
    for(var i=0;i<6;i++){var ds=addDays(mo,i),list=S.appts.filter(function(a){return a.date===ds&&enSede(a)}).sort(function(a,b){return a.time<b.time?-1:1});
      body+='<div class="wk-d'+(ds===TODAY?' today':'')+'"><h4>'+DNS[pd(ds).getDay()]+' '+pd(ds).getDate()+' <span class="muted small">· '+list.length+' turnos</span></h4>'+list.map(function(a){var x=den(a.did);return '<div class="wk-a" data-act="ag-open" data-id="'+a.id+'" style="border-color:'+x.color+'"><b>'+a.time+'</b> '+esc(pat(a.pid).name)+'<div class="muted tiny">'+esc(tre(a.tid).name)+' · '+x.chair+'</div><div style="margin-top:4px">'+stChip(a.status)+'</div></div>'}).join('')+'</div>'}
    body+='</div>';
  }
  return head+'<div class="card" style="padding:16px">'+nb+body+'</div>';
};
ACT['ag-view']=function(el){ui.agView=el.dataset.v;render(true)};
ACT['ag-prev']=function(){ui.agDate=addDays(ui.agDate,ui.agView==='week'?-7:-1);render(true)};
ACT['ag-nextd']=function(){ui.agDate=addDays(ui.agDate,ui.agView==='week'?7:1);render(true)};
ACT['ag-today']=function(){ui.agDate=TODAY;render(true)};
ACT['ag-open']=function(el){
  var a=S.appts.filter(function(x){return x.id===el.dataset.id})[0],p=pat(a.pid),d=den(a.did),t=tre(a.tid);
  var b=['confirmada','en sala','atendida'].map(function(s){return '<button class="btn '+(a.status===s?'pri':'')+'" id="st-'+s.replace(' ','')+'" data-act="ag-status" data-id="'+a.id+'" data-s="'+s+'">'+ST[s][0]+'</button>'}).join('');
  var alerts=medBanner(p)?'<div style="margin-top:14px">'+medBanner(p)+'</div>':p.alerts.length?'<div class="alert warn" style="margin-top:14px">'+I.alert+'<div><b>Alertas clínicas:</b> '+p.alerts.map(esc).join(' · ')+'</div></div>':'';
  modal('Turno de '+esc(p.name),
   '<div class="row" style="margin-bottom:12px">'+pav(p)+'<div class="g"><b>'+esc(t.name)+'</b><div class="muted small">'+fdateLong(a.date)+' · '+a.time+' a '+fromMin(toMin(a.time)+a.dur)+'</div></div>'+stChip(a.status)+'</div>'+
   '<div class="small muted" style="margin-bottom:6px">Profesional</div><b>'+esc(d.name)+' · '+d.chair+'</b>'+alerts+
   '<div class="small muted" style="margin:18px 0 8px">Cambiar estado</div><div class="row">'+b+'</div>',
   '<button class="btn" data-act="ag-cancel" data-id="'+a.id+'" id="btn-cancelar-turno">Cancelar turno</button><a class="btn" href="#/pacientes/'+p.id+'">Ver ficha</a><button class="btn pri" data-act="close">Listo</button>');
};
ACT['ag-status']=function(el){var a=S.appts.filter(function(x){return x.id===el.dataset.id})[0];a.status=el.dataset.s;save();toast('Turno de '+pat(a.pid).name+': '+ST[a.status][0].toLowerCase());
  if(a.status==='atendida'){modal('Turno atendido','<div class="empty"><div class="ok-big">'+I.check+'</div><h2>'+esc(pat(a.pid).name)+' fue atendido/a</h2><p class="muted" style="margin-top:6px">¿Querés registrar el cobro ahora?</p></div>','<button class="btn" data-act="close">Más tarde</button><button class="btn pri" id="btn-cobrar-turno" data-act="pay-new" data-pid="'+a.pid+'">Cobrar ahora</button>')}else closeModal();
  render(true)};
ACT['ag-cancel']=function(el){S.appts=S.appts.filter(function(x){return x.id!==el.dataset.id});save();closeModal();toast('Turno cancelado');render(true)};
ACT['ag-new']=function(el){
  var d=el&&el.dataset.did||'d1',tm=el&&el.dataset.time||'10:00',pid=el&&el.dataset.pid||'p13';
  modal('Nuevo turno',
   '<div class="field"><label for="ap-pid">Paciente</label><select id="ap-pid">'+patOpts(pid)+'</select></div>'+
   '<div class="f2"><div class="field"><label for="ap-did">Profesional y sillón</label><select id="ap-did">'+opts(S.dentists,d,function(x){return [x.id,x.name+' · '+x.chair]})+'</select></div>'+
   '<div class="field"><label for="ap-tid">Tratamiento</label><select id="ap-tid" data-ch="apTid">'+opts(S.treatments.slice(0,12),'t2',function(x){return [x.id,x.name]})+'</select></div></div>'+
   '<div class="f2"><div class="field"><label for="ap-date">Fecha</label><input id="ap-date" type="date" value="'+(ui.agView==='day'?ui.agDate:TODAY)+'"></div>'+
   '<div class="field"><label for="ap-time">Hora</label><input id="ap-time" type="time" step="900" value="'+tm+'"></div></div>'+
   '<div class="field"><label for="ap-dur">Duración</label><select id="ap-dur">'+opts([30,45,60,90],30,function(x){return [x,x+' minutos']})+'</select></div><div id="ap-err"></div>',
   '<button class="btn" data-act="close">Cancelar</button><button class="btn pri" id="ap-save" data-act="ag-save">Crear turno</button>');
};
IN.apTid=function(el){var t=tre(el.value),s=$('#ap-dur');if(s)s.value=String(t.dur)};
ACT['ag-save']=function(){
  var did=val('ap-did'),date=val('ap-date'),tm=val('ap-time'),dur=+val('ap-dur'),pid=val('ap-pid'),err=$('#ap-err');
  if(!date||!tm){err.innerHTML='<div class="alert bad">'+I.alert+'<div>Completá la fecha y la hora.</div></div>';return}
  var s=toMin(tm);if(s<H0||s+dur>H1){err.innerHTML='<div class="alert bad">'+I.alert+'<div>El horario de atención es de 08:00 a 18:00.</div></div>';return}
  var c=S.appts.filter(function(a){return a.did===did&&a.date===date&&s<toMin(a.time)+a.dur&&s+dur>toMin(a.time)})[0];
  if(c){err.innerHTML='<div class="alert bad">'+I.alert+'<div><b>Horario ocupado:</b> '+esc(den(did).name)+' atiende a '+esc(pat(c.pid).name)+' de '+c.time+' a '+fromMin(toMin(c.time)+c.dur)+'. Probá otro horario.</div></div>';return}
  S.appts.push({id:'a'+nid('apt'),date:date,time:tm,dur:dur,pid:pid,did:did,tid:val('ap-tid'),status:'agendada',sede:S.sedeAct||undefined});
  save();ui.agDate=date;closeModal();toast('Turno creado para '+pat(pid).name+' · '+fdate(date)+' '+tm);
  if(parseHash().name==='agenda')render(true);else{ui.agView='day';nav('agenda')}
};

/* ================= PACIENTES ================= */
function patRows(){
  var q=ui.patQ.trim().toLowerCase(),f=ui.patF;
  var list=S.patients.filter(function(p){
    if(q&&(p.name+' '+p.ci+' '+p.tel).toLowerCase().indexOf(q)<0)return false;
    if(f==='saldo'&&patBal(p.id)<=0)return false;if(f==='ped'&&age(p.born)>=12)return false;if(f==='alerta'&&!p.alerts.length)return false;return true;
  }).sort(function(a,b){return a.name.localeCompare(b.name,'es')});
  if(!list.length)return '<tr><td colspan="6" class="empty">No encontramos pacientes con esa búsqueda.</td></tr>';
  return list.map(function(p){
    var nx=S.appts.filter(function(a){return a.pid===p.id&&a.date>=TODAY}).sort(function(a,b){return (a.date+a.time)<(b.date+b.time)?-1:1})[0],bl=patBal(p.id);
    return '<tr class="click" data-act="pat-open" data-id="'+p.id+'"><td data-l="Paciente"><div class="pcell">'+pav(p)+'<div><b>'+esc(p.name)+'</b><span class="muted small">'+age(p.born)+' años</span></div></div></td><td data-l="CI" class="num">'+p.ci+'</td><td data-l="Teléfono" class="num">'+p.tel+'</td><td data-l="Próximo turno">'+(nx?fdate(nx.date)+' · '+nx.time:'<span class="muted">Sin turno</span>')+'</td><td data-l="Saldo" class="num">'+(bl>0?'<b>'+gs(bl)+'</b>':'<span class="muted">—</span>')+'</td><td data-l="Alertas">'+(p.alerts.length?p.alerts.map(function(a){return chip(a,'c-s',true)}).join(' '):'<span class="muted">—</span>')+'</td></tr>';
  }).join('');
}
VIEWS.pacientes=function(r){
  if(r.a&&pat(r.a))return patProfile(pat(r.a),r.b||'datos');
  var fl=[['todos','Todos'],['saldo','Con saldo'],['ped','Pediátricos'],['alerta','Con alerta clínica']];
  return ph('Pacientes',S.patients.length+' pacientes registrados',btn('Nuevo paciente','pat-new',{c:'pri',i:'plus',id:'btn-nuevo-paciente'}))+
  '<div class="card"><div class="row" style="margin-bottom:14px"><input class="inp" id="pat-q" data-in="patQ" style="max-width:380px" type="search" placeholder="Buscar por nombre, CI o teléfono" value="'+esc(ui.patQ)+'" aria-label="Buscar paciente"><div class="seg" id="pat-f">'+fl.map(function(x){return '<button data-act="pat-f" data-f="'+x[0]+'" class="'+(ui.patF===x[0]?'on':'')+'">'+x[1]+'</button>'}).join('')+'</div></div>'+
  '<div class="tw"><table class="tbl rs" id="tbl-pac"><thead><tr><th>Paciente</th><th>CI</th><th>Teléfono</th><th>Próximo turno</th><th>Saldo</th><th>Alertas</th></tr></thead><tbody id="pat-body">'+patRows()+'</tbody></table></div></div>';
};
IN.patQ=function(el){ui.patQ=el.value;$('#pat-body').innerHTML=patRows()};
ACT['pat-f']=function(el){ui.patF=el.dataset.f;$$('#pat-f button').forEach(function(b){b.classList.toggle('on',b.dataset.f===ui.patF)});$('#pat-body').innerHTML=patRows()};
ACT['pat-open']=function(el){nav('pacientes/'+el.dataset.id)};
ACT['pat-new']=function(){
  modal('Nuevo paciente','<div class="field"><label for="np-name">Nombre y apellido</label><input id="np-name" placeholder="Ej.: Marta Giménez"></div><div class="f2"><div class="field"><label for="np-ci">Cédula de identidad</label><input id="np-ci" placeholder="0.000.000"></div><div class="field"><label for="np-tel">Teléfono</label><input id="np-tel" placeholder="0981 000 000"></div></div><div class="f2"><div class="field"><label for="np-born">Fecha de nacimiento</label><input id="np-born" type="date" value="1990-01-01"></div><div class="field"><label for="np-sex">Sexo</label><select id="np-sex"><option value="F">Femenino</option><option value="M">Masculino</option></select></div><div class="field"><label for="np-lang">Idioma del paciente</label><select id="np-lang"><option value="es">Español</option><option value="gn">Guaraní</option></select></div></div><div id="np-err"></div>','<button class="btn" data-act="close">Cancelar</button><button class="btn pri" id="np-save" data-act="pat-save">Guardar paciente</button>');
};
ACT['pat-save']=function(){
  var n=val('np-name').trim();if(!n){$('#np-err').innerHTML='<div class="alert bad">'+I.alert+'<div>Escribí el nombre del paciente.</div></div>';return}
  var id='p'+nid('pat');S.patients.push({id:id,name:n,ci:val('np-ci')||'—',tel:val('np-tel')||'—',born:val('np-born')||'1990-01-01',alerts:[],lang:val('np-lang'),ruc:(val('np-ci')||'0').replace(/\./g,'')+'-0',city:'Asunción',email:'',family:[],note:'',marks:{},lesions:[],anam:[],sex:val('np-sex')||'F'});
  save();closeModal();toast('Paciente «'+n+'» creado');nav('pacientes/'+id);
};
function odoSvg(p){
  var ped=age(p.born)<12,m=p.marks||{};
  var up=ped?[55,54,53,52,51,61,62,63,64,65]:[18,17,16,15,14,13,12,11,21,22,23,24,25,26,27,28],lo=ped?[85,84,83,82,81,71,72,73,74,75]:[48,47,46,45,44,43,42,41,31,32,33,34,35,36,37,38];
  var n=up.length,W=n*50+30,o='<svg viewBox="0 0 '+W+' 250" role="img" aria-label="Odontograma resumido de '+esc(p.name)+'"><text x="'+W/2+'" y="16" text-anchor="middle" font-size="11" font-weight="700" fill="#5E5878" letter-spacing="1">SUPERIOR</text><text x="'+W/2+'" y="244" text-anchor="middle" font-size="11" font-weight="700" fill="#5E5878" letter-spacing="1">INFERIOR</text><text x="2" y="125" font-size="10" fill="#5E5878">Derecha</text><text x="'+(W-2)+'" y="125" font-size="10" fill="#5E5878" text-anchor="end">Izquierda</text>';
  function tooth(num,x,y,up){
    var mk=(m[num]||[])[0],stroke=mk==='ext'?'#1A5FB4':'#CFC6B8',h='<g><rect x="'+x+'" y="'+y+'" width="38" height="46" rx="12" fill="#FBF6EA" stroke="'+stroke+'" stroke-width="'+(mk==='ext'?3:1.6)+'"/>';
    if(mk==='caries')h+='<circle cx="'+(x+19)+'" cy="'+(y+23)+'" r="8" fill="#16161A"/>';
    if(mk==='ext')h+='<path d="M'+(x+9)+' '+(y+10)+'l20 26M'+(x+29)+' '+(y+10)+'l-20 26" stroke="#1A5FB4" stroke-width="3.5" stroke-linecap="round"/>';
    if(mk==='perio')h+='<rect x="'+(x+3)+'" y="'+(up?y+1:y+37)+'" width="32" height="8" rx="4" fill="#D7262B"/>';
    h+='<text x="'+(x+19)+'" y="'+(up?y+62:y-8)+'" text-anchor="middle" font-size="12" font-weight="700" fill="#232036">'+num+'</text><title>Pieza '+num+(mk?': '+({caries:'caries',ext:'extracción',perio:'problema periodontal'}[mk]):': sana')+'</title></g>';return h}
  up.forEach(function(t,i){o+=tooth(t,15+i*50+(i>=n/2?10:0),28,true)});
  lo.forEach(function(t,i){o+=tooth(t,15+i*50+(i>=n/2?10:0),150,false)});
  return o+'</svg>';
}
function patProfile(p,tab){
  var tabs=[['datos','Datos'],['odontograma','Odontograma'],['patologia','Patología bucal'],['radiografias','Radiografías'],['periodontograma','Periodontograma'],['recetas','Recetas y certificados'],['consentimientos','Consentimientos'],['fotos','Fotos clínicas'],['anamnesis','Anamnesis e historial'],['presupuestos','Presupuestos'],['pagos','Pagos']];
  var bl=patBal(p.id);
  var head='<div class="card" style="margin-bottom:18px"><div class="row" style="gap:18px">'+pav(p,true)+'<div style="flex:1;min-width:220px"><h1>'+esc(p.name)+'</h1><div class="muted">'+age(p.born)+' años · CI '+p.ci+' · '+p.tel+'</div><div class="row" style="margin-top:8px;gap:6px">'+p.alerts.map(function(a){return '<span class="chip c-s">⚠ '+esc(a)+'</span>'}).join('')+(bl>0?chip('Saldo '+gs(bl),'c-c'):'')+'</div></div><div class="row"><a class="btn" href="#/pacientes">‹ Pacientes</a>'+btn('Nuevo turno','ag-new',{d:'data-pid="'+p.id+'"',i:'cal'})+btn('Nuevo presupuesto','bud-new',{d:'data-pid="'+p.id+'"',c:'pri',i:'doc',id:'btn-nuevo-presupuesto-pac'})+'</div></div>'+(medBanner(p)?'<div style="margin-top:14px">'+medBanner(p)+'</div>':'')+'</div>';
  var tb='<div class="tabs" role="tablist">'+tabs.map(function(t){return '<a role="tab" id="tab-'+t[0]+'" data-tab="'+t[0]+'" class="'+(tab===t[0]?'on':'')+'" href="#/pacientes/'+p.id+'/'+t[0]+'">'+t[1]+'</a>'}).join('')+'</div>';
  var body='';
  if(tab==='datos'){
    var fam=p.family.map(pat);
    body='<div class="grid g2"><div class="card"><h2>Datos personales</h2><dl class="dgrid" style="margin-top:14px"><div><dt>Documento (CI)</dt><dd>'+p.ci+'</dd></div><div><dt>RUC</dt><dd>'+esc(p.ruc)+'</dd></div><div><dt>Nacimiento</dt><dd>'+fdate(p.born)+'</dd></div><div><dt>Teléfono</dt><dd>'+p.tel+'</dd></div><div><dt>Correo</dt><dd>'+esc(p.email||'—')+'</dd></div><div><dt>Ciudad</dt><dd>'+p.city+'</dd></div><div><dt>Idioma</dt><dd>'+(p.lang==='gn'?'Guaraní':'Español')+'</dd></div><div><dt>Recordatorios</dt><dd>WhatsApp</dd></div></dl></div>'+
    '<div class="stack"><div class="card"><h2 style="margin-bottom:10px">Alertas clínicas</h2>'+(p.alerts.length?p.alerts.map(function(a){return '<div class="alert warn" style="margin-bottom:8px">'+I.alert+'<div><b>'+esc(a)+'</b></div></div>'}).join(''):'<p class="muted">Sin alertas registradas.</p>')+'</div>'+
    '<div class="card"><h2 style="margin-bottom:10px">Grupo familiar</h2>'+(fam.length?fam.map(function(f){return '<div class="mini-row">'+pav(f)+'<div class="g"><b>'+esc(f.name)+'</b><div class="muted small">'+age(f.born)+' años</div></div><a class="btn sm" href="#/pacientes/'+f.id+'">Ver ficha</a></div>'}).join(''):'<p class="muted">Sin familiares vinculados.</p>')+'</div>'+
    '<div class="card"><h2 style="margin-bottom:8px">Notas internas</h2><p class="muted">'+esc(p.note||'Sin notas.')+'</p></div></div></div>';
  }else if(tab==='odontograma'){
    var cnt={caries:0,ext:0,perio:0};Object.keys(p.marks||{}).forEach(function(k){cnt[p.marks[k][0]]++});
    var plan=[];Object.keys(p.marks||{}).forEach(function(k){var t=p.marks[k][0];plan.push((t==='caries'?'Resina · pieza ':t==='ext'?'Extracción · pieza ':'Tratamiento periodontal · pieza ')+k)});
    body='<div class="grid g21"><div class="card odo"><div class="card-h"><h2>Odontograma resumido</h2><span class="muted small">'+(age(p.born)<12?'Dentición temporal (51–85)':'Adulto (11–48)')+'</span></div>'+odoSvg(p)+
    '<div class="legend" style="margin-top:8px"><span><i style="background:#16161A"></i>Caries</span><span><i style="background:#1A5FB4"></i>Extracción</span><span><i style="background:#D7262B"></i>Problema periodontal</span><span><i style="background:#FBF6EA;border:1px solid #CFC6B8"></i>Sano</span></div></div>'+
    '<div class="stack"><div class="card"><h3 style="margin-bottom:10px">Resumen</h3><div class="mini-row"><span class="g">Caries</span><b>'+cnt.caries+'</b></div><div class="mini-row"><span class="g">Extracciones</span><b>'+cnt.ext+'</b></div><div class="mini-row"><span class="g">Problema periodontal</span><b>'+cnt.perio+'</b></div>'+
    (medBanner(p)?'<div style="margin-top:14px">'+medBanner(p)+'</div>':'')+'<a class="btn pri" id="btn-odonto3d" href="/" style="width:100%;margin-top:16px">'+I.tooth+'Abrir odontograma 3D</a><a class="btn" id="btn-rx-desde-odo" href="#/pacientes/'+p.id+'/radiografias" style="width:100%;margin-top:8px">Ver radiografías</a><p class="muted small" style="margin-top:8px">Abre el odontograma interactivo en 3D para marcar por cara y ver el historial clínico.</p></div>'+
    '<div class="card"><h3 style="margin-bottom:8px">Plan sugerido</h3>'+(plan.length?plan.slice(0,6).map(function(x){return '<div class="mini-row small">'+I.check.replace('<svg','<svg width="16" height="16" fill="none" stroke="#0B7A70" stroke-width="2.5"')+'<span>'+esc(x)+'</span></div>'}).join(''):'<p class="muted">Sin hallazgos registrados.</p>')+(plan.length?'<button class="btn sm" style="margin-top:10px" data-act="bud-new" data-pid="'+p.id+'">Armar presupuesto</button>':'')+'</div></div></div>';
  }else if(tab==='patologia'){
    body=lesionTab(p);
  }else if(tab==='periodontograma'){
    body=perioTab(p);
  }else if(tab==='recetas'){
    body=recTab(p);
  }else if(tab==='consentimientos'){
    body=consTab(p);
  }else if(tab==='fotos'){
    body=fotosTab(p);
  }else if(tab==='radiografias'){
    body=rxTab(p);
  }else if(tab==='anamnesis'){
    body=anamTab(p);
  }else if(tab==='presupuestos'){
    var bs=S.budgets.filter(function(b){return b.pid===p.id});
    body='<div class="card"><div class="card-h"><h2>Presupuestos</h2>'+btn('Nuevo presupuesto','bud-new',{d:'data-pid="'+p.id+'"',c:'pri',i:'plus'})+'</div>'+(bs.length?'<div class="tw"><table class="tbl rs"><thead><tr><th>N.º</th><th>Fecha</th><th>Tratamientos</th><th>Estado</th><th class="r">Total</th><th class="r">Saldo</th></tr></thead><tbody>'+bs.map(function(b){return '<tr class="click" data-act="bud-open" data-id="'+b.id+'"><td data-l="N.º"><b>'+b.num+'</b></td><td data-l="Fecha">'+fdate(b.date)+'</td><td data-l="Tratamientos">'+b.items.map(function(i){return esc(i.name)}).join(', ')+'</td><td data-l="Estado">'+chip(b.status==='aprobado'?'Aprobado':'Borrador',b.status==='aprobado'?'c-t':'c-g')+'</td><td data-l="Total" class="r num">'+gs(bTotal(b))+'</td><td data-l="Saldo" class="r num">'+gs(bBal(b))+'</td></tr>'}).join('')+'</tbody></table></div>':'<div class="empty">Todavía no hay presupuestos para este paciente.</div>')+'</div>';
  }else{
    var ps=S.payments.filter(function(x){return x.pid===p.id}).sort(function(a,b){return (b.date+b.time)<(a.date+a.time)?-1:1});
    body='<div class="card"><div class="card-h"><h2>Pagos</h2>'+(bl>0?chip('Saldo pendiente '+gs(bl),'c-c'):chip('Al día','c-t'))+btn('Registrar pago','pay-new',{d:'data-pid="'+p.id+'"',c:'pri',i:'cash',id:'btn-pago-paciente'})+'</div>'+(ps.length?'<div class="tw"><table class="tbl rs"><thead><tr><th>Fecha</th><th>Concepto</th><th>Forma</th><th>Factura</th><th class="r">Monto</th></tr></thead><tbody>'+ps.map(function(x){var f=x.invId?inv(x.invId):null;return '<tr><td data-l="Fecha">'+fdate(x.date)+' '+x.time+'</td><td data-l="Concepto">'+esc(x.concept)+'</td><td data-l="Forma">'+METHODS[x.method]+'</td><td data-l="Factura">'+(f?'<a href="#/facturacion" data-act="fac-view" data-id="'+f.id+'">'+f.num+'</a>':'<span class="muted">Sin factura</span>')+'</td><td data-l="Monto" class="r num"><b>'+gs(x.amount)+'</b></td></tr>'}).join('')+'</tbody></table></div>':'<div class="empty">Sin pagos registrados.</div>')+'</div>';
  }
  return head+tb+body;
}

/* ================= PATOLOGÍA BUCAL ================= */
var ZONES={
 labio_sup:{n:'Labio superior',x:260,y:58},labio_inf:{n:'Labio inferior',x:260,y:410},
 encia:{n:'Encía',x:150,y:112},
 yugal_d:{n:'Mucosa yugal derecha',x:62,y:235},yugal_i:{n:'Mucosa yugal izquierda',x:458,y:235},
 paladar_duro:{n:'Paladar duro',x:260,y:172},paladar_blando:{n:'Paladar blando',x:260,y:221},
 orofaringe:{n:'Orofaringe',x:260,y:243},
 lengua_dorso:{n:'Lengua · dorso',x:260,y:296},lengua_bordes:{n:'Lengua · bordes',x:158,y:300},
 lengua_ventral:{n:'Lengua · cara ventral',x:700,y:160},piso:{n:'Piso de boca',x:700,y:318}
};
var LES_TIPOS=['Úlcera','Leucoplasia','Eritroplasia','Liquen plano','Candidiasis','Mucocele','Fibroma','Herpes','Otra'];
var LES_EST=['en observación','derivada a biopsia','resuelta'];
var EST_C={'en observación':['#FFC23C','c-s'],'derivada a biopsia':['#FF5D5D','c-c'],'resuelta':['#18BFB0','c-t']};
function lesionTab(p){
  var L=p.lesions||[];
  function z(id,shape,extra){return '<g class="zone" data-act="zone" data-zone="'+id+'" tabindex="0" role="button" aria-label="'+ZONES[id].n+'">'+shape.replace('<','<title>'+ZONES[id].n+'</title><')+'</g>'}
  var map='<svg id="pat-map" viewBox="0 0 860 450" role="group" aria-label="Mapa esquemático de la boca" style="width:100%;height:auto">'+
   '<style>.zone{cursor:pointer}.zone>*:not(title){transition:filter .15s,opacity .15s}.zone:hover>*:not(title),.zone:focus>*:not(title){filter:brightness(.93) drop-shadow(0 0 6px rgba(24,191,176,.9))}.zl{font:700 11px Hanken,sans-serif;fill:#232036;pointer-events:none}.zn{font:600 12px Hanken,sans-serif;fill:#5E5878}</style>'+
   '<rect x="8" y="8" width="504" height="434" rx="40" fill="#FFF1E0"/>'+
   z('yugal_d','<path d="M42 118 Q18 232 60 346 L120 334 Q92 236 130 142Z" fill="#F4A9A0" stroke="#D88078" stroke-width="2"/>')+
   z('yugal_i','<path d="M478 118 Q502 232 460 346 L400 334 Q428 236 390 142Z" fill="#F4A9A0" stroke="#D88078" stroke-width="2"/>')+
   z('lengua_bordes','<ellipse cx="260" cy="296" rx="122" ry="50" fill="#E87F86" stroke="#C85E68" stroke-width="2"/>')+
   z('lengua_dorso','<ellipse cx="260" cy="296" rx="88" ry="31" fill="#F2A0A4" stroke="#C85E68" stroke-width="1.5"/>')+
   z('paladar_duro','<path d="M150 160 Q260 142 370 160 Q374 198 260 207 Q146 198 150 160Z" fill="#F6C1B5" stroke="#D88078" stroke-width="2"/>')+
   z('paladar_blando','<path d="M175 207 Q260 217 345 207 Q338 233 260 237 Q182 233 175 207Z" fill="#EE9F97" stroke="#D88078" stroke-width="2"/>')+
   z('orofaringe','<ellipse cx="260" cy="243" rx="36" ry="10" fill="#7A3B46"/>')+
   z('encia','<path d="M120 98 Q260 84 400 98 L400 124 Q260 110 120 124Z" fill="#E56F7B" stroke="#C85E68" stroke-width="2"/><path d="M130 346 Q260 372 390 346 L390 366 Q260 392 130 366Z" fill="#E56F7B" stroke="#C85E68" stroke-width="2"/>')+
   '<g pointer-events="none" fill="#fff" stroke="#D9D3E6">'+[0,1,2,3,4,5,6,7,8,9,10].map(function(i){return '<rect x="'+(128+i*24)+'" y="'+(116+Math.abs(5-i)*0.8)+'" width="22" height="30" rx="8"/>'}).join('')+'</g>'+
   z('labio_sup','<path d="M86 100 Q88 36 260 24 Q432 36 434 100 Q260 82 86 100Z" fill="#F08FA3" stroke="#C86078" stroke-width="2"/>')+
   z('labio_inf','<path d="M86 372 Q260 450 434 372 Q440 426 260 440 Q80 426 86 372Z" fill="#F08FA3" stroke="#C86078" stroke-width="2"/>')+
   '<text class="zn" x="20" y="34">Derecha del paciente</text><text class="zn" x="500" y="34" text-anchor="end">Izquierda</text>'+
   '<g class="zl"><text x="260" y="176" text-anchor="middle">Paladar duro</text><text x="260" y="226" text-anchor="middle" font-size="10">Paladar blando</text><text x="260" y="300" text-anchor="middle">Lengua · dorso</text><text x="62" y="240" text-anchor="middle" transform="rotate(-90 62 240)">Mucosa yugal D.</text><text x="458" y="240" text-anchor="middle" transform="rotate(90 458 240)">Mucosa yugal I.</text><text x="260" y="66" text-anchor="middle">Labio superior</text><text x="260" y="420" text-anchor="middle">Labio inferior</text></g>'+
   '<g transform="translate(560,40)"><text class="zn" x="140" y="-4" text-anchor="middle">Lengua elevada (vista ventral)</text>'+
   '<g class="zone" data-act="zone" data-zone="piso" tabindex="0" role="button" aria-label="Piso de boca"><title>Piso de boca</title><path d="M20 120 Q20 290 140 296 Q260 290 260 120 Q236 232 140 232 Q44 232 20 120Z" fill="#E56F7B" stroke="#C85E68" stroke-width="2"/></g>'+
   '<g class="zone" data-act="zone" data-zone="lengua_ventral" tabindex="0" role="button" aria-label="Lengua, cara ventral"><title>Lengua · cara ventral</title><ellipse cx="140" cy="120" rx="108" ry="76" fill="#F2A0A4" stroke="#C85E68" stroke-width="2"/><path d="M140 70 V190" stroke="#C85E68" stroke-width="2" fill="none"/></g>'+
   '<g class="zl"><text x="140" y="120" text-anchor="middle" transform="rotate(0)">Cara ventral</text><text x="140" y="268" text-anchor="middle">Piso de boca</text></g></g>'+
   '<text class="zn" x="700" y="426" text-anchor="middle">Dorso, bordes y ventral de la lengua son zonas separadas</text>';
  var dots='';
  L.forEach(function(l){var zn=ZONES[l.zone],k=L.filter(function(m){return m.zone===l.zone}).indexOf(l);
    dots+='<g data-act="les-open" data-id="'+l.id+'" class="lesdot" style="cursor:pointer"><circle cx="'+(zn.x+k*20)+'" cy="'+zn.y+'" r="10" fill="'+EST_C[l.estado][0]+'" stroke="#fff" stroke-width="3"/><circle cx="'+(zn.x+k*20)+'" cy="'+zn.y+'" r="14" fill="none" stroke="'+EST_C[l.estado][0]+'" stroke-width="2" opacity=".5"/><title>'+esc(l.tipo+' · '+ZONES[l.zone].n+' · '+l.estado)+'</title></g>'});
  map+=dots+'</svg>';
  var leg='<div class="legend" style="margin-top:8px"><span><i style="background:#FFC23C;border-radius:50%"></i>En observación</span><span><i style="background:#FF5D5D;border-radius:50%"></i>Derivada a biopsia</span><span><i style="background:#18BFB0;border-radius:50%"></i>Resuelta</span></div>';
  var cards=L.length?L.map(lesionCard).join(''):'<div class="card empty">Sin lesiones registradas. Tocá una zona del mapa para registrar la primera.</div>';
  return '<div class="grid g21"><div class="card"><div class="card-h"><h2>Mapa de tejidos blandos</h2><span class="muted small">Tocá una zona para registrar una lesión</span></div>'+map+leg+'</div><div class="stack" id="les-list">'+cards+'</div></div>';
}
function lesionCard(l){
  var e=EST_C[l.estado];
  return '<div class="card" id="les-'+l.id+'"><div class="card-h"><h3>'+esc(l.tipo)+' · '+esc(ZONES[l.zone].n)+'</h3>'+chip(l.estado,e[1])+'</div>'+
   '<div class="muted small" style="margin-bottom:10px">'+l.mm+' mm · '+esc(l.color)+' · '+(l.dolor?'con dolor':'sin dolor')+' · registrada el '+fdate(l.fecha)+'</div>'+
   '<div class="tl">'+l.evo.map(function(v,i){return '<div class="tl-i"><span class="tl-d" style="background:'+EST_C[v.estado][0]+'"></span><div><b>'+fdate(v.fecha)+'</b> · '+v.mm+' mm · '+esc(v.estado)+'<div class="muted small">'+esc(v.nota)+'</div></div></div>'}).join('')+'</div>'+
   '<div class="row" style="margin-top:12px"><button class="btn sm pri" data-act="ctl-new" data-id="'+l.id+'">Agregar control</button><button class="btn sm" data-act="les-open" data-id="'+l.id+'">Ver detalle</button></div></div>';
}
ACT.zone=function(el){
  var id=el.dataset.zone,p=pat(parseHash().a),ex=(p.lesions||[]).filter(function(l){return l.zone===id});
  ui.les={zone:id,foto:false};
  var list=ex.length?'<div class="alert info" style="margin-bottom:14px">'+I.info+'<div>Esta zona ya tiene '+ex.length+' lesión(es): '+ex.map(function(l){return '<a href="#" data-act="les-open" data-id="'+l.id+'">'+esc(l.tipo)+'</a>'}).join(', ')+'.</div></div>':'';
  modal('Registrar lesión · '+ZONES[id].n,list+
   '<div class="f2"><div class="field"><label for="les-tipo">Tipo de lesión</label><select id="les-tipo">'+opts(LES_TIPOS,'Úlcera',function(x){return [x,x]})+'</select></div><div class="field"><label for="les-mm">Tamaño (mm)</label><input id="les-mm" type="number" min="1" max="80" value="5"></div></div>'+
   '<div class="f2"><div class="field"><label for="les-color">Color</label><select id="les-color">'+opts(['Blanquecina','Rojiza','Mixta (blanca y roja)','Color de la mucosa','Azulada','Amarillenta','Pardo-oscura'],'Blanquecina',function(x){return [x,x]})+'</select></div><div class="field"><label for="les-consist">Consistencia</label><select id="les-consist">'+opts(['Blanda','Firme','Dura','Fluctuante','Placa que no se desprende al raspado'],'Blanda',function(x){return [x,x]})+'</select></div></div>'+
   '<div class="f2"><div class="field"><label for="les-dolor">¿Dolor?</label><select id="les-dolor"><option value="no">No</option><option value="si">Sí</option></select></div><div class="field"><label for="les-fecha">Fecha</label><input id="les-fecha" type="date" value="'+TODAY+'"></div></div>'+
   '<div class="field"><label for="les-estado">Estado</label><select id="les-estado">'+opts(LES_EST,'en observación',function(x){return [x,x.charAt(0).toUpperCase()+x.slice(1)]})+'</select></div>'+
   '<div class="field"><label for="les-obs">Observaciones</label><textarea id="les-obs" rows="2" placeholder="Ej.: aparece hace 2 semanas, sin antecedentes"></textarea></div>'+
   '<div class="field"><label>Foto clínica</label><button type="button" id="les-foto" class="btn" data-act="les-foto" style="justify-content:flex-start;min-height:96px">'+photoPh(false)+'</button></div><div id="les-err"></div>',
   '<button class="btn" data-act="close">Cancelar</button><button class="btn pri" id="les-save" data-act="les-save">Guardar lesión</button>');
};
function photoPh(on){return '<svg width="120" height="80" viewBox="0 0 120 80" aria-hidden="true"><rect x="2" y="2" width="116" height="76" rx="10" fill="'+(on?'#E8FAF8':'#F1EFF6')+'" stroke="'+(on?'#18BFB0':'#D9D3E6')+'" stroke-width="2" stroke-dasharray="'+(on?'0':'6 5')+'"/><g transform="translate(46 20) scale(1.2)" fill="none" stroke="'+(on?'#0B7A70':'#5E5878')+'" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></g></svg><span style="text-align:left"><b>'+(on?'Foto adjunta (marcador de posición)':'Adjuntar foto')+'</b><br><span class="muted small">Recuadro ilustrativo: en la versión real se sube la foto del paciente.</span></span>'}
ACT['les-foto']=function(el){ui.les.foto=!ui.les.foto;el.innerHTML=photoPh(ui.les.foto)};
ACT['les-save']=function(){
  var p=pat(parseHash().a),mm=+val('les-mm');if(!mm||mm<1){$('#les-err').innerHTML='<div class="alert bad">'+I.alert+'<div>Indicá el tamaño en milímetros.</div></div>';return}
  p.lesions=p.lesions||[];var id='l'+Date.now().toString(36),est=val('les-estado'),f=val('les-fecha')||TODAY;
  p.lesions.push({id:id,zone:ui.les.zone,tipo:val('les-tipo'),mm:mm,color:val('les-color'),consist:val('les-consist'),dolor:val('les-dolor')==='si',fecha:f,obs:val('les-obs'),estado:est,foto:ui.les.foto,evo:[{fecha:f,mm:mm,estado:est,nota:val('les-obs')||'Primer registro.'}]});
  save();closeModal();toast('Lesión registrada en '+ZONES[ui.les.zone].n.toLowerCase());render(true);
};
function findLes(id){var p=pat(parseHash().a);return {p:p,l:(p.lesions||[]).filter(function(x){return x.id===id})[0]}}
ACT['les-open']=function(el,e){
  if(e&&e.preventDefault)e.preventDefault();var l=findLes(el.dataset.id).l;if(!l)return;
  modal(esc(l.tipo)+' · '+esc(ZONES[l.zone].n),'<div class="row" style="margin-bottom:10px">'+chip(l.estado,EST_C[l.estado][1])+'<span class="muted small">'+l.mm+' mm · '+esc(l.color)+' · '+esc(l.consist)+' · '+(l.dolor?'con dolor':'sin dolor')+'</span></div>'+(l.obs?'<p style="margin-bottom:12px">'+esc(l.obs)+'</p>':'')+
   '<div class="row" style="margin-bottom:12px;align-items:flex-start">'+photoPh(!!l.foto).replace('Adjuntar foto','Sin foto adjunta')+'</div><h3 style="margin-bottom:8px">Evolución</h3><div class="tl">'+l.evo.map(function(v){return '<div class="tl-i"><span class="tl-d" style="background:'+EST_C[v.estado][0]+'"></span><div><b>'+fdate(v.fecha)+'</b> · '+v.mm+' mm · '+esc(v.estado)+'<div class="muted small">'+esc(v.nota)+'</div></div></div>'}).join('')+'</div>',
   '<button class="btn" data-act="close">Cerrar</button><button class="btn pri" data-act="ctl-new" data-id="'+l.id+'">Agregar control</button>');
};
ACT['ctl-new']=function(el){
  var l=findLes(el.dataset.id).l;
  modal('Nuevo control · '+esc(l.tipo),'<div class="f2"><div class="field"><label for="ctl-fecha">Fecha del control</label><input id="ctl-fecha" type="date" value="'+TODAY+'"></div><div class="field"><label for="ctl-mm">Tamaño (mm)</label><input id="ctl-mm" type="number" min="0" max="80" value="'+l.mm+'"></div></div><div class="field"><label for="ctl-estado">Estado</label><select id="ctl-estado">'+opts(LES_EST,l.estado,function(x){return [x,x.charAt(0).toUpperCase()+x.slice(1)]})+'</select></div><div class="field"><label for="ctl-nota">Nota de la visita</label><textarea id="ctl-nota" rows="2" placeholder="Evolución observada"></textarea></div>','<button class="btn" data-act="close">Cancelar</button><button class="btn pri" id="ctl-save" data-act="ctl-save" data-id="'+l.id+'">Guardar control</button>');
};
ACT['ctl-save']=function(el){
  var l=findLes(el.dataset.id).l,mm=+val('ctl-mm'),est=val('ctl-estado');
  l.evo.push({fecha:val('ctl-fecha')||TODAY,mm:mm,estado:est,nota:val('ctl-nota')||'Control sin novedades.'});l.evo.sort(function(a,b){return a.fecha<b.fecha?-1:1});l.mm=mm;l.estado=est;save();closeModal();toast('Control agregado a la evolución');render(true);
};
