/* Gestión · Recordatorios de turnos por WhatsApp (Cesar 19/11 23:31). Maqueta: no envía mensajes reales.
   Configuración (24 h y 2 h antes, confirmación con botones), plantilla con variables, vista previa en el celular
   y la lista de turnos de mañana con el estado de cada recordatorio. */
NAV.splice(2,0,['recordatorios','Recordatorios','wa']);
TITLES.recordatorios='Recordatorios WhatsApp';
I.wa='<svg viewBox="0 0 24 24"><path d="M4 20l1.3-3.8A8 8 0 1 1 8 19z"/><path d="M9 9.5c0 3 2.5 5.5 5.5 5.5l1-1.5-2-1-1 1c-1-.5-2-1.5-2.5-2.5l1-1-1-2z"/></svg>';
var WA_DEF={on:true,h24:true,h2:true,conf:true,cumple:false,txt:'Hola {nombre} 👋 Te recordamos tu turno en *Sonrisa Para Todos* el {dia} a las {hora} con {doctor}.\n\nPor favor confirmá tocando un botón.'};
var WA_ST={enviado:['Enviado','c-g'],confirmado:['Confirmó','c-t'],reprogramar:['Pidió reprogramar','c-s'],sin:['Sin respuesta','c-c'],pend:['Se envía hoy 09:00','c-i']};
function waCfg(){if(!S.wa)S.wa=JSON.parse(JSON.stringify(WA_DEF));return S.wa}
function waFill(t,a){var p=pat(a.pid),d=den(a.did);return t.replace(/\{nombre\}/g,p.name.split(' ')[0]).replace(/\{dia\}/g,fdateLong(a.date).replace(/ de \d{4}$/,'')).replace(/\{hora\}/g,a.time).replace(/\{doctor\}/g,d?d.name:'tu doctor')}
function waState(a,i){if(!S.waSt)S.waSt={};if(!S.waSt[a.id])S.waSt[a.id]=['confirmado','confirmado','enviado','reprogramar','confirmado','sin','enviado','confirmado'][i%8];return S.waSt[a.id]}
VIEWS.recordatorios=function(){
  var c=waCfg(),tom=addDays(TODAY,1),list=S.appts.filter(function(a){return a.date===tom}).sort(function(a,b){return a.time<b.time?-1:1});
  if(!list.length)list=S.appts.filter(function(a){return a.date>TODAY}).slice(0,8);
  var cnt={confirmado:0,enviado:0,reprogramar:0,sin:0};list.forEach(function(a,i){cnt[waState(a,i)]=(cnt[waState(a,i)]||0)+1});
  var ex=list[0]||{pid:S.patients[0].id,did:S.dentists[0].id,date:tom,time:'09:00'};
  function sw(k,l,d){return '<label class="wa-sw"><input type="checkbox" data-ch="wa-cfg" data-k="'+k+'"'+(c[k]?' checked':'')+'><span></span><div><b>'+l+'</b><div class="muted small">'+d+'</div></div></label>'}
  var cfg='<div class="card"><div class="card-h"><h2>Configuración</h2>'+chip(c.on?'Activo':'Pausado',c.on?'c-t':'c-g')+'</div><div class="stack" style="gap:12px;margin-top:6px">'+
    sw('on','Enviar recordatorios automáticos','Desde el número de WhatsApp de la clínica')+sw('h24','24 horas antes','Primer aviso, con botones para confirmar')+sw('h2','2 horas antes','Segundo aviso el mismo día')+sw('conf','Pedir confirmación','Botones «Confirmo» y «Reprogramar»; la agenda se actualiza sola')+sw('cumple','Saludo de cumpleaños','Mensaje automático el día del cumpleaños')+
    '<div><b>Mensaje</b><div class="muted small" style="margin:2px 0 6px">Variables: {nombre} {dia} {hora} {doctor}</div><textarea class="inp" rows="5" style="width:100%;resize:vertical" data-in="wa-txt" aria-label="Texto del recordatorio">'+esc(c.txt)+'</textarea></div></div></div>';
  var phone='<div class="wa-phone" aria-label="Vista previa en WhatsApp"><div class="wa-top"><div class="avatar c-t" style="width:34px;height:34px;font-size:13px">SP</div><div><b>Sonrisa Para Todos</b><span>en línea</span></div></div><div class="wa-chat"><div class="wa-day">HOY</div><div class="wa-msg" id="wa-prev">'+esc(waFill(c.txt,ex)).replace(/\*([^*]+)\*/g,'<b>$1</b>').replace(/\n/g,'<br>')+'<i>09:00</i></div>'+(c.conf?'<div class="wa-btns"><span>✅ Confirmo</span><span>📅 Reprogramar</span></div>':'')+'<div class="wa-msg me">Confirmo ✅<i>09:14 ✓✓</i></div><div class="wa-msg">¡Gracias! Te esperamos 😊<i>09:14</i></div></div></div>';
  var rows=list.map(function(a,i){var p=pat(a.pid),d=den(a.did),s=waState(a,i);return '<tr><td data-l="Hora"><b>'+a.time+'</b></td><td data-l="Paciente">'+esc(p.name)+'<div class="muted small">'+p.tel+'</div></td><td data-l="Doctor">'+esc(d?d.name:'')+'</td><td data-l="Estado">'+chip(WA_ST[s][0],WA_ST[s][1])+'</td><td data-l="" class="r">'+(s==='sin'||s==='enviado'?'<button class="btn sm" data-act="wa-send" data-id="'+a.id+'">Reenviar</button>':s==='reprogramar'?'<a class="btn sm" href="#/agenda">Ver agenda</a>':'')+'</td></tr>'}).join('');
  var tbl='<div class="card"><div class="card-h"><h2>Turnos de mañana · '+fdate(tom)+'</h2>'+btn('Enviar todos ahora','wa-all',{c:'pri sm',i:'wa',id:'btn-wa-todos'})+'</div>'+
    '<div class="row" style="gap:8px;margin:4px 0 12px;flex-wrap:wrap">'+chip(cnt.confirmado+' confirmaron','c-t')+chip(cnt.enviado+' enviados','c-g')+chip((cnt.reprogramar||0)+' piden reprogramar','c-s')+chip((cnt.sin||0)+' sin respuesta','c-c')+'</div>'+
    (list.length?'<div class="tw"><table class="tbl rs"><thead><tr><th>Hora</th><th>Paciente</th><th>Doctor</th><th>Recordatorio</th><th></th></tr></thead><tbody>'+rows+'</tbody></table></div>':'<div class="empty">No hay turnos mañana.</div>')+'</div>';
  return '<div class="page-h"><h1>Recordatorios por WhatsApp</h1><p class="muted">Menos ausencias: cada paciente recibe su turno y confirma con un toque.</p></div><div class="grid g21"><div class="stack">'+tbl+cfg+'</div><div>'+phone+'</div></div>';
};
IN['wa-cfg']=function(el){waCfg()[el.dataset.k]=el.checked;save();render(true)};
IN['wa-txt']=function(el){var c=waCfg();c.txt=el.value;save();var tom=addDays(TODAY,1),a=S.appts.filter(function(x){return x.date===tom})[0]||S.appts[0];var pv=document.getElementById('wa-prev');if(pv)pv.innerHTML=esc(waFill(c.txt,a)).replace(/\*([^*]+)\*/g,'<b>$1</b>').replace(/\n/g,'<br>')+'<i>09:00</i>'};
ACT['wa-send']=function(el){S.waSt[el.dataset.id]='enviado';save();toast('Recordatorio reenviado por WhatsApp (demo)');render(true)};
ACT['wa-all']=function(){toast('Recordatorios de mañana enviados (demo)');};
