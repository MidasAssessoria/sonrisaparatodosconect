/* Gestión · Varias sedes (Cesar/João 20/11).
   Una base, varias sedes: selector arriba («Todas» o una sede), agenda filtrada por sede,
   profesionales que atienden en más de una sede, y página «Sedes» con el consolidado. */
I.pin='<svg viewBox="0 0 24 24"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>';
function sedesSeed(){if(!S.sedes){S.sedes=[
  {id:'s1',name:'Asunción · Centro',dir:'Av. Mcal. López 1234',tel:'021 600 100',hor:'Lun–vie 08–18 · Sáb 08–12',sill:2,docs:['d1','d2'],est:'abierta',color:'#18BFB0'},
  {id:'s2',name:'San Lorenzo',dir:'Ruta Mcal. Estigarribia km 10',tel:'021 580 200',hor:'Lun–vie 08–18',sill:2,docs:['d2','d3'],est:'abierta',color:'#8B5CF6'},
  {id:'s3',name:'Luque',dir:'Calle Gral. Aquino 450',tel:'—',hor:'Desde febrero',sill:1,docs:[],est:'proxima',color:'#FFC23C'}];S.sedeAct=S.sedeAct||'';save()}return S.sedes}
function sede(id){return sedesSeed().filter(function(s){return s.id===id})[0]}
/* El Dr. Rojas atiende en las dos sedes: en la maqueta, días pares Centro e impares San Lorenzo. En la app real cada turno guarda su sede. */
function aptSede(a){if(a.sede)return a.sede;var L=sedesSeed().filter(function(s){return s.docs.indexOf(a.did)>=0});if(L.length<2)return L[0]?L[0].id:'s1';return pd(a.date).getDate()%2?L[1].id:L[0].id}
function enSede(a){sedesSeed();return !S.sedeAct||aptSede(a)===S.sedeAct}
function sedeDocs(){sedesSeed();if(!S.sedeAct)return S.dentists;var s=sede(S.sedeAct);return S.dentists.filter(function(d){return s.docs.indexOf(d.id)>=0})}
function paySede(y){var a={did:y.did,date:y.date};return y.sede||aptSede(a)}
NAV.push(['sedes','Sedes','pin']);TITLES.sedes='Sedes';
(function(){var top=document.querySelector('header.top');if(!top)return;sedesSeed();var w=document.createElement('div');w.className='sede-sel';
  w.innerHTML=I.pin+'<select id="sede-sel" data-ch="sede-sel" aria-label="Sede"><option value="">Todas las sedes</option>'+S.sedes.filter(function(s){return s.est==='abierta'}).map(function(s){return '<option value="'+s.id+'"'+(S.sedeAct===s.id?' selected':'')+'>'+esc(s.name)+'</option>'}).join('')+'</select>';
  top.insertBefore(w,top.querySelector('.gs'))})();
IN['sede-sel']=function(el){S.sedeAct=el.value;save();toast(el.value?'Viendo la sede '+sede(el.value).name:'Viendo todas las sedes');render(true)};
VIEWS.sedes=function(){var L=sedesSeed(),mes=TODAY.slice(0,7),wk0=addDays(TODAY,-6);
  var st=L.map(function(s){var hoy=S.appts.filter(function(a){return a.date===TODAY&&aptSede(a)===s.id}),sem=S.appts.filter(function(a){return a.date>wk0&&a.date<=TODAY&&aptSede(a)===s.id}),
    ing=S.payments.filter(function(y){return y.date.slice(0,7)===mes&&paySede(y)===s.id}).reduce(function(t,y){return t+y.amount},0);return {s:s,hoy:hoy.length,sem:sem.length,ing:ing}});
  var tot=st.reduce(function(t,x){return {hoy:t.hoy+x.hoy,sem:t.sem+x.sem,ing:t.ing+x.ing}},{hoy:0,sem:0,ing:0});
  return ph('Sedes','Todas las sedes en una sola base: pacientes, historial y caja compartidos',btn('Nueva sede','sede-new',{c:'pri',i:'plus'}))+
  '<div class="sede-grid">'+st.map(function(x){var s=x.s,op=s.est==='abierta';return '<div class="card sede-c" style="border-top:5px solid '+s.color+'"><div class="card-h"><h2>'+esc(s.name)+'</h2>'+(op?chip('Abierta','c-t'):chip('Próxima apertura','c-s'))+'</div>'+
    '<p class="muted small" style="margin:0 0 10px">'+esc(s.dir)+' · '+esc(s.tel)+'<br>'+esc(s.hor)+' · '+s.sill+' sillón'+(s.sill>1?'es':'')+'</p>'+
    (op?'<div class="sede-k"><div><b>'+x.hoy+'</b><span>turnos hoy</span></div><div><b>'+x.sem+'</b><span>últimos 7 días</span></div><div><b>'+gs(x.ing)+'</b><span>cobrado en el mes</span></div></div>':'<div class="empty" style="margin:6px 0">Se habilita la agenda y la caja el día de la apertura.</div>')+
    '<div class="sede-d">'+(s.docs.length?s.docs.map(function(id){var d=den(id),o=L.filter(function(z){return z.docs.indexOf(id)>=0}).length>1;return '<span><i style="background:'+d.color+'"></i>'+esc(d.name)+(o?' <em>también en otra sede</em>':'')+'</span>'}).join(''):'<span class="muted">Sin profesionales asignados</span>')+'</div>'+
    (op?'<button class="btn sm" data-act="sede-ver" data-id="'+s.id+'" style="margin-top:12px">Ver agenda de esta sede</button>':'')+'</div>'}).join('')+'</div>'+
  '<div class="card" style="margin-top:16px"><div class="card-h"><h2>Consolidado</h2></div><div class="sede-k"><div><b>'+tot.hoy+'</b><span>turnos hoy</span></div><div><b>'+tot.sem+'</b><span>últimos 7 días</span></div><div><b>'+gs(tot.ing)+'</b><span>cobrado en el mes</span></div></div>'+
  '<p class="muted small" style="margin-top:10px">El paciente es uno solo para todas las sedes: si se atiende en Centro y después en San Lorenzo, la ficha, el odontograma y el saldo lo siguen. Cada sede tiene su caja y su punto de expedición SIFEN.</p></div>'};
ACT['sede-ver']=function(el){S.sedeAct=el.dataset.id;save();var q=$('#sede-sel');if(q)q.value=el.dataset.id;nav('agenda')};
ACT['sede-new']=function(){modal('Nueva sede','<div class="field"><label>Nombre</label><input class="inp" placeholder="Ej. Fernando de la Mora"></div><div class="field"><label>Dirección</label><input class="inp"></div><div class="field"><label>Punto de expedición SIFEN</label><input class="inp" placeholder="Ej. 003"></div><p class="muted small">Después se asignan profesionales, sillones y horario.</p>','<button class="btn" data-act="close">Cancelar</button><button class="btn pri" data-act="close">Crear (demo)</button>')};
