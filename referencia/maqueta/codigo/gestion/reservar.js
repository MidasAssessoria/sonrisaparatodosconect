/* Reserva online del paciente (Cesar/João 20/11). Página pública, celular primero.
   Lee la agenda real (S.appts) para mostrar solo horarios libres; el turno entra en la agenda de la clínica
   con origen «online». Paso a paso: motivo → profesional → día y hora → datos → confirmación. */
var RV_MOT=[
  {id:'m1',tid:'t1',n:'Primera consulta / control',d:'Revisión y diagnóstico',dur:30},
  {id:'m2',tid:'t2',n:'Limpieza dental',d:'Profilaxis',dur:30},
  {id:'m3',tid:'t1',n:'Tengo dolor',d:'Te damos el primer horario libre',dur:30,urg:1},
  {id:'m4',tid:'t11',n:'Control de ortodoncia',d:'Solo pacientes en tratamiento',dur:30,esp:'d3'},
  {id:'m5',tid:'t1',n:'Consulta por implante',d:'Evaluación con el especialista',dur:30,esp:'d2'}
];
var RV_HOR={1:[480,1080],2:[480,1080],3:[480,1080],4:[480,1080],5:[480,1080],6:[480,720]}; // lun–vie 8–18, sáb 8–12
var RV_ANT=120, RV_DIAS=14, DN=['dom','lun','mar','mié','jue','vie','sáb'], MN=['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
var R={paso:1,mot:null,did:'',fecha:'',hora:'',n:'',ci:'',tel:'',born:'',res:null,err:''};
function mm(t){var a=t.split(':');return +a[0]*60+ +a[1]}function hh(m){return pad(Math.floor(m/60))+':'+pad(m%60)}
function libre(did,f,ini,dur){return !S.appts.some(function(a){return a.did===did&&a.date===f&&ini<mm(a.time)+a.dur&&ini+dur>mm(a.time)})}
function nowMin(){var d=new Date();return d.getHours()*60+d.getMinutes()}
function horarios(f){var dw=pd(f).getDay(),h=RV_HOR[dw];if(!h)return [];var m=RV_MOT.filter(function(x){return x.id===R.mot})[0],out=[];
  var docs=R.did?[R.did]:S.dentists.map(function(d){return d.id});
  for(var t=h[0];t+m.dur<=h[1];t+=30){if(f===TODAY&&t<nowMin()+RV_ANT)continue;var d=docs.filter(function(id){return libre(id,f,t,m.dur)})[0];if(d)out.push({t:hh(t),did:d})}return out}
function dias(){var o=[];for(var i=0;o.length<RV_DIAS&&i<30;i++){var f=addDays(TODAY,i);if(RV_HOR[pd(f).getDay()])o.push(f)}return o}
function steps(){var s='';for(var i=1;i<=4;i++)s+='<i class="'+(i<=R.paso?'on':'')+'"></i>';return '<div class="steps">'+s+'</div>'}
function head(t,s){return '<div class="rv-top"><div class="lg"><svg width="24" height="24" viewBox="0 0 24 24" fill="#fff"><path d="M6 5c2-1.5 4 0 6 0s4-1.5 6 0c2 2 1 5 0 8-.6 2-1 7-2.5 7s-1.2-4-3.5-4-2 4-3.5 4S7 15 6 13c-1-3-2-6 0-8z"/></svg></div><div><b>Sonrisa Para Todos</b><span>Reservá tu turno online</span></div></div>'+(R.paso<5?steps():'')+'<h1>'+t+'</h1><p class="sub">'+s+'</p>'}
function draw(){var h='',el=document.getElementById('rv'),m=RV_MOT.filter(function(x){return x.id===R.mot})[0];
  if(R.paso===1){h=head('¿Para qué querés el turno?','Elegí el motivo; la duración la calculamos nosotros.')+RV_MOT.map(function(x){return '<button class="opt'+(R.mot===x.id?' sel':'')+'" data-mot="'+x.id+'"><span class="dot" style="background:'+(x.urg?'var(--sol)':'var(--t)')+'"></span><span><b>'+x.n+'</b><small>'+x.d+' · '+x.dur+' min</small></span></button>'}).join('')}
  else if(R.paso===2){var L=m.esp?S.dentists.filter(function(d){return d.id===m.esp}):S.dentists;h=head('¿Con quién?','Si te da igual, te damos el primer profesional libre.')+(m.esp?'':'<button class="opt'+(R.did===''?' sel':'')+'" data-did=""><span class="dot" style="background:var(--sol)"></span><span><b>Cualquier profesional</b><small>Más horarios disponibles</small></span></button>')+L.map(function(d){return '<button class="opt'+(R.did===d.id?' sel':'')+'" data-did="'+d.id+'"><span class="dot" style="background:'+d.color+'"></span><span><b>'+esc(d.name)+'</b><small>'+esc(d.esp)+'</small></span></button>'}).join('')+'<button class="btn" data-go="3">Seguir</button><button class="btn gh" data-go="1">Volver</button>'}
  else if(R.paso===3){var D=dias();if(!R.fecha){R.fecha=D.filter(function(f){return horarios(f).length})[0]||D[0]}var H=horarios(R.fecha);
    h=head('Elegí día y hora','Solo te mostramos horarios libres de verdad.')+'<div class="days">'+D.map(function(f){var d=pd(f),n=horarios(f).length;return '<button class="day'+(f===R.fecha?' sel':'')+'" data-f="'+f+'"'+(n?'':' disabled')+'><small>'+DN[d.getDay()]+'</small><b>'+d.getDate()+'</b><small>'+MN[d.getMonth()]+'</small></button>'}).join('')+'</div>'+
    (H.length?'<div class="hrs">'+H.map(function(x){return '<button class="hr'+(R.hora===x.t?' sel':'')+'" data-h="'+x.t+'" data-hd="'+x.did+'">'+x.t+'</button>'}).join('')+'</div>':'<div class="empty">Sin horarios libres este día.</div>')+
    (m.urg?'<div class="note">Si el dolor es muy fuerte o hay hinchazón, llamá o escribí al WhatsApp de la clínica: te buscamos un lugar hoy.</div>':'')+
    '<button class="btn" data-go="4"'+(R.hora?'':' disabled')+'>Seguir</button><button class="btn gh" data-go="'+(m.esp?1:2)+'">Volver</button>'}
  else if(R.paso===4){var ex=S.patients.filter(function(p){return R.ci&&p.ci.replace(/\D/g,'')===R.ci.replace(/\D/g,'')})[0];
    h=head('Tus datos','Para confirmarte por WhatsApp.')+'<label class="lbl">Cédula de identidad</label><input class="inp" id="f-ci" inputmode="numeric" value="'+esc(R.ci)+'" placeholder="Ej. 4.321.001">'+
    (ex?'<div class="note" style="border-color:var(--t)">¡Hola, <b>'+esc(ex.name.split(' ')[0])+'</b>! Ya sos paciente: usamos los datos de tu ficha.</div>':
    '<label class="lbl">Nombre y apellido</label><input class="inp" id="f-n" value="'+esc(R.n)+'"><label class="lbl">WhatsApp</label><input class="inp" id="f-tel" inputmode="tel" value="'+esc(R.tel)+'" placeholder="0981 000 000"><label class="lbl">Fecha de nacimiento</label><input class="inp" id="f-born" type="date" value="'+esc(R.born)+'">')+
    '<div class="err">'+esc(R.err)+'</div><button class="btn" data-ok="1">Confirmar turno</button><button class="btn gh" data-go="3">Volver</button>'}
  else{var a=R.res,p=pat(a.pid),d=den(a.did),dt=pd(a.date);
    h=head('','')+'<div class="ok"><div class="big"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3"><path d="M5 12l5 5 9-10"/></svg></div><h1>¡Turno reservado!</h1><p class="sub">Código <b>'+a.cod+'</b></p>'+
    '<div class="card"><div><span>Paciente</span><b>'+esc(p.name)+'</b></div><div><span>Motivo</span><b>'+esc(m.n)+'</b></div><div><span>Día</span><b>'+DN[dt.getDay()]+' '+dt.getDate()+' de '+MN[dt.getMonth()]+'</b></div><div><span>Hora</span><b>'+a.time+'</b></div><div><span>Profesional</span><b>'+esc(d.name)+'</b></div></div>'+
    '<div class="wa"><b>WhatsApp</b><span>Te mandamos la confirmación a '+esc(p.tel)+' y un recordatorio el día anterior. Para cambiar o cancelar, respondé ese mensaje.</span></div>'+
    '<button class="btn gh" data-new="1">Reservar otro turno</button></div>'}
  el.innerHTML=h;window.scrollTo(0,0)}
document.addEventListener('click',function(e){var b=e.target.closest('button');if(!b||b.disabled)return;var d=b.dataset;
  if(d.mot){R.mot=d.mot;var m=RV_MOT.filter(function(x){return x.id===d.mot})[0];R.fecha='';R.hora='';if(m.esp){R.did=m.esp;R.paso=3}else{R.did='';R.paso=2}}
  else if(d.did!==undefined){R.did=d.did;R.fecha='';R.hora=''}
  else if(d.f){R.fecha=d.f;R.hora=''}
  else if(d.h){R.hora=d.h;R.hd=d.hd}
  else if(d.go){R.paso=+d.go;R.err=''}
  else if(d.ok){confirmar();return}
  else if(d.new){R={paso:1,mot:null,did:'',fecha:'',hora:'',n:'',ci:'',tel:'',born:'',res:null,err:''}}
  draw()});
document.addEventListener('input',function(e){var k={'f-ci':'ci','f-n':'n','f-tel':'tel','f-born':'born'}[e.target.id];if(k){R[k]=e.target.value;if(k==='ci'){var c=e.target.selectionStart;draw();var i=document.getElementById('f-ci');i.focus();i.setSelectionRange(c,c)}}});
function confirmar(){var m=RV_MOT.filter(function(x){return x.id===R.mot})[0],ci=R.ci.replace(/\D/g,'');
  if(ci.length<5){R.err='Escribí tu cédula.';return draw()}
  var p=S.patients.filter(function(x){return x.ci.replace(/\D/g,'')===ci})[0];
  if(!p){if(R.n.trim().split(' ').length<2){R.err='Escribí nombre y apellido.';return draw()}if(R.tel.replace(/\D/g,'').length<9){R.err='Revisá el número de WhatsApp.';return draw()}
    p={id:'p'+nid('pat'),name:R.n.trim(),ci:R.ci,tel:R.tel,born:R.born||'1990-01-01',alerts:[],lang:'es',ruc:ci+'-0',city:'Asunción',email:'',family:[],note:'Registrado por reserva online',marks:{},lesions:[],anam:[],sex:'F'};S.patients.push(p)}
  if(S.appts.some(function(a){return a.pid===p.id&&a.src==='online'&&(a.date>TODAY||(a.date===TODAY&&mm(a.time)>nowMin()))})){R.err='Ya tenés un turno reservado online. Para cambiarlo respondé el WhatsApp de confirmación.';return draw()}
  var did=R.did||R.hd;if(!libre(did,R.fecha,mm(R.hora),m.dur)){R.err='Ese horario se acaba de ocupar. Elegí otro.';R.paso=3;R.hora='';return draw()}
  var a={id:'a'+nid('apt'),date:R.fecha,time:R.hora,dur:m.dur,pid:p.id,did:did,tid:m.tid,status:'agendada',src:'online',motivo:m.n,cod:'T-'+Math.random().toString(36).slice(2,7).toUpperCase(),creado:new Date().toISOString()};
  S.appts.push(a);save();R.res=a;R.paso=5;R.err='';draw()}
(function(){var q=/[?&]demo=(\w+)/.exec(location.search);if(!q)return;R.mot='m2';R.did='';R.paso=3;var f=dias().filter(function(x){return x>TODAY&&horarios(x).length})[0];R.fecha=f;var H=horarios(f);R.hora=H[3].t;R.hd=H[3].did;
  if(q[1]==='ok'){R.ci='5.555.123';R.n='Ana Giménez';R.tel='0981 222 333';confirmar()}})();
draw();
