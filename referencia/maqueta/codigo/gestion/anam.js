/* Gestión · Anamnesis e historial (versionada) + Alerta médica. Preguntas base: cuestionario del cliente (19/11). */
var ANQ=[
 {id:'s1',t:'1. Motivo de consulta y síntoma actual',q:[
  ['motivo','txt','¿Cuál es el motivo principal de su visita hoy?'],
  ['sintoma','txt','¿Qué molestia, dolor o cambio nota y desde cuándo comenzó?'],
  ['desencadena','multi','¿Qué empeora o alivia la molestia (frío, calor, dulce, masticar)?',['Frío','Calor','Dulce','Masticar']],
  ['encias','multi','¿Ha notado sangrado de encías, inflamación, movilidad dental o mal aliento?',['Sangrado de encías','Inflamación','Movilidad dental','Mal aliento']]]},
 {id:'s2',t:'2. Antecedentes odontológicos',q:[
  ['ultima','txt','¿Cuándo fue su última consulta o limpieza dental?'],
  ['previos','multi','¿Ha tenido tratamientos previos (caries, endodoncias, extracciones, coronas, implantes u ortodoncia)?',['Caries','Endodoncias','Extracciones','Coronas','Implantes','Ortodoncia']],
  ['protesis','yn','¿Usa prótesis removibles o retenedores?'],
  ['experiencia','yn','¿Ha tenido alguna experiencia desagradable, dolorosa o ansiedad al acudir al dentista?'],
  ['atm','yn','¿Nota chasquidos, dolor o tensión en la mandíbula o al abrir la boca?']]},
 {id:'s3',t:'3. Hábitos e higiene oral',q:[
  ['cepillado','txt','¿Con qué frecuencia cepilla sus dientes y qué tipo de cepillo o pasta utiliza?'],
  ['auxiliares','multi','¿Usa hilo dental, cepillos interdentales o enjuague bucal?',['Hilo dental','Cepillos interdentales','Enjuague bucal']],
  ['parafuncion','multi','¿Aprieta o rechina los dientes (bruxismo), se muerde las uñas o respira por la boca?',['Bruxismo','Se muerde las uñas','Respira por la boca']],
  ['sustancias','multi','¿Consume tabaco, alcohol u otras sustancias?',['Tabaco','Alcohol','Otras sustancias']]]},
 {id:'s4',t:'4. Antecedentes médicos y medicación',q:[
  ['enf','multi','¿Padece alguna enfermedad sistémica (diabetes, hipertensión, problemas cardíacos, asma, alteraciones de coagulación o tiroides)?',['Diabetes','Hipertensión','Problemas cardíacos','Asma','Alteraciones de coagulación','Problemas de tiroides']],
  ['med','multi','¿Toma actualmente algún medicamento (en especial anticoagulantes, bifosfonatos, antiinflamatorios o antidiabéticos)?',['Anticoagulantes','Bifosfonatos','Antiinflamatorios','Antidiabéticos','Otros medicamentos']],
  ['alerg','multi','¿Es alérgico a algún medicamento (como penicilina o anestésicos locales), látex o material dental?',['Penicilina','Anestésicos locales','Látex','Material dental','Otro medicamento']],
  ['cir','yn','¿Ha tenido cirugías o internaciones recientes?'],
  ['emb','yn','En caso de pacientes mujeres: ¿está embarazada o en período de lactancia?','F']]},
 {id:'s5',t:'5. Datos clínicos complementarios (sugeridos por el sistema)',q:[
  ['otras','multi','¿Tiene o tuvo alguna de estas condiciones?',['Hepatitis','VIH','Epilepsia','Enfermedad renal','Cáncer / radioterapia']],
  ['pa','txt','Presión arterial (mmHg)'],['pulso','txt','Pulso (lpm)'],['peso','txt','Peso (kg)']]}
];
var ALERTA={alerg:{'Penicilina':'Alergia a la penicilina','Anestésicos locales':'Alergia a anestésicos locales','Látex':'Alergia al látex','Material dental':'Alergia a material dental','Otro medicamento':'Alergia a medicamentos'},
 med:{'Anticoagulantes':'Anticoagulantes'},enf:{'Diabetes':'Diabetes','Problemas cardíacos':'Cardiopatía','Alteraciones de coagulación':'Alteración de la coagulación'}};
function lastAnam(p){var a=p.anam||[];return a.length?a[a.length-1]:null}
function medAlerts(p){
  var a=lastAnam(p);if(!a)return [];var o=[];
  Object.keys(ALERTA).forEach(function(k){var r=a.r[k];if(!r||!r.o)return;var l=r.o.filter(function(x){return ALERTA[k][x]}).map(function(x){return ALERTA[k][x]});if(l.length&&r.d)l[l.length-1]+=' ('+r.d.replace(/\.$/,'')+')';o=o.concat(l)});
  if(a.r.emb&&a.r.emb.s)o.push('Embarazo / lactancia');
  return o;
}
function medBanner(p){var m=medAlerts(p);if(!m.length)return '';return '<div class="alert bad med-alert" role="alert">'+I.alert+'<div><b>Alerta médica:</b> '+m.map(esc).join(' · ')+'</div></div>'}
function viewAnam(p){var a=p.anam||[];if(!a.length)return null;var i=ui.anamV;return (i==null||i>=a.length)?a[a.length-1]:a[i]}
function qVisible(q,p){return !q[3]||typeof q[3]==='string'?(q[3]!=='F'||p.sex==='F'):true}

function anamTab(p){
  var all=p.anam||[],cur=viewAnam(p),latest=lastAnam(p);
  var left;
  if(!cur){
    left='<div class="card empty"><h2>Sin anamnesis registrada</h2><p style="margin:8px 0 16px">Completá el cuestionario médico antes del primer tratamiento.</p><button class="btn pri" id="btn-actualizar-anamnesis" data-act="anam-form">Completar anamnesis</button></div>';
  }else{
    var old=cur!==latest;
    left='<div class="card"><div class="card-h"><h2>Anamnesis · versión '+cur.v+(old?' (anterior)':' vigente')+'</h2>'+(all.length>1?'<select id="anam-version" class="inp" data-ch="anamV" style="width:auto;min-height:38px" aria-label="Ver versión">'+all.map(function(x,i){return '<option value="'+i+'"'+(x===cur?' selected':'')+'>Versión '+x.v+' · '+fdate(x.fecha)+(x===latest?' (vigente)':'')+'</option>'}).join('')+'</select>':'')+'<button class="btn pri" id="btn-actualizar-anamnesis" data-act="anam-form">Actualizar anamnesis</button></div>'+
     (old?'<div class="alert info" style="margin-bottom:12px">'+I.info+'<div>Estás viendo una versión anterior, registrada el '+fdate(cur.fecha)+'. <a href="#" data-act="anam-latest">Volver a la vigente</a></div></div>':'')+
     '<div class="muted small" style="margin-bottom:10px">Registrada el '+fdate(cur.fecha)+' por '+esc(cur.por)+'</div>'+
     ANQ.map(function(s){var h='<div class="qsec"><h3>'+s.t+'</h3>';
       s.q.forEach(function(q){
         if(q[4]==='F'||q[3]==='F'){if(p.sex!=='F')return}
         if(q[1]==='txt'){h+='<div class="arow"><span class="muted">'+q[2]+'</span><b>'+esc(cur.t[q[0]]||'—')+'</b></div>';return}
         var r=cur.r[q[0]]||{s:0},sel=(r.o||[]);
         h+='<div class="arow"><span>'+q[2]+(q[1]==='multi'&&sel.length?'<div style="margin-top:4px">'+sel.map(function(x){return '<span class="yn s" style="margin:0 4px 4px 0">'+esc(x)+'</span>'}).join('')+'</div>':'')+(r.d?'<div class="muted small">'+esc(r.d)+'</div>':'')+'</span><span class="yn '+(r.s?'s':'n')+'">'+(r.s?'SÍ':'NO')+'</span></div>'});
       return h+'</div>'}).join('')+
     '<div class="qsec"><h3>Consentimiento</h3><p class="small">Declaro que la información es verdadera.</p>'+(cur.firma?'<img alt="Firma del paciente" src="'+cur.firma+'" style="max-width:260px;border:1px solid var(--borde);border-radius:10px;background:#fff;margin-top:6px"><div class="muted small">Firmado por '+esc(cur.firmante||p.name)+' el '+fdate(cur.fecha)+'</div>':'<span class="muted">Sin firma</span>')+'</div></div>';
  }
  return (medBanner(p)?'<div style="margin-bottom:16px">'+medBanner(p)+'</div>':'')+'<div class="grid g21" id="anam-tab"><div>'+left+'</div><div class="card"><h2 style="margin-bottom:12px">Historial médico y odontológico</h2>'+histTimeline(p)+'</div></div>';
}
function histTimeline(p){
  var ev=[];
  S.appts.filter(function(a){return a.pid===p.id&&a.status==='atendida'}).forEach(function(a){ev.push({d:a.date,t:'Consulta',c:'c-i',x:tre(a.tid).name,s:den(a.did).name+' · '+a.time})});
  S.budgets.filter(function(b){return b.pid===p.id&&b.status==='aprobado'}).forEach(function(b){ev.push({d:b.approvedOn||b.date,t:'Tratamiento',c:'c-t',x:'Plan aprobado '+b.num+': '+b.items.map(function(i){return i.name}).join(', '),s:'Total '+gs(bTotal(b))})});
  (p.lesions||[]).forEach(function(l){l.evo.forEach(function(v){ev.push({d:v.fecha,t:'Patología',c:'c-s',x:l.tipo+' · '+ZONES[l.zone].n+' ('+v.mm+' mm, '+v.estado+')',s:v.nota})})});
  (p.anam||[]).forEach(function(a){ev.push({d:a.fecha,t:'Anamnesis',c:'c-u',x:a.v===1?'Anamnesis inicial completada y firmada':'Anamnesis actualizada · versión '+a.v,s:'Registró '+a.por,v:a.v})});
  ev.sort(function(a,b){return a.d<b.d?1:a.d>b.d?-1:0});
  if(!ev.length)return '<div class="empty small">Todavía no hay eventos en el historial.</div>';
  return '<div class="tl" id="hist-tl">'+ev.map(function(e){return '<div class="tl-i"><span class="tl-d" style="background:var(--turquesa)"></span><div><b>'+fdate(e.d)+'</b> '+chip(e.t,e.c,true)+'<div>'+esc(e.x)+'</div><div class="muted small">'+esc(e.s)+'</div>'+(e.v?'<a href="#" class="small" data-act="anam-ver" data-v="'+(e.v-1)+'">Ver esta versión</a>':'')+'</div></div>'}).join('')+'</div>';
}
IN.anamV=function(el){ui.anamV=+el.value;render(true)};
ACT['anam-latest']=function(el,e){e.preventDefault();ui.anamV=null;render(true)};
ACT['anam-ver']=function(el,e){e.preventDefault();ui.anamV=+el.dataset.v;render(true)};

function qField(s,cur,p){
  var h='<div class="qsec"><h3>'+s.t+'</h3>';
  s.q.forEach(function(q){
    if(q[3]==='F'||q[4]==='F'){if(p.sex!=='F')return}
    var k=q[0];
    if(q[1]==='txt'){var v=cur?cur.t[k]||'':'';h+='<div class="field"><label for="qt-'+k+'">'+q[2]+'</label>'+(['pa','pulso','peso'].indexOf(k)<0?'<textarea id="qt-'+k+'" rows="2">'+esc(v)+'</textarea>':'<input id="qt-'+k+'" value="'+esc(v)+'">')+'</div>';return}
    var r=cur&&cur.r[k]||{s:0,d:'',o:[]};
    if(q[1]==='yn'){h+='<div class="field"><label>'+q[2]+'</label><div class="qrow" style="grid-template-columns:90px 1fr"><select id="q-'+k+'" aria-label="Respuesta"><option value="0"'+(r.s?'':' selected')+'>No</option><option value="1"'+(r.s?' selected':'')+'>Sí</option></select><input id="qd-'+k+'" placeholder="Detalle" value="'+esc(r.d||'')+'" aria-label="Detalle"></div></div>';return}
    h+='<div class="field"><label>'+q[2]+'</label><div class="ck">'+q[3].map(function(o,i){return '<label><input type="checkbox" id="qo-'+k+'-'+i+'" data-k="'+k+'" value="'+esc(o)+'"'+((r.o||[]).indexOf(o)>=0?' checked':'')+'>'+esc(o)+'</label>'}).join('')+'</div><input id="qd-'+k+'" placeholder="Detalle (opcional)" value="'+esc(r.d||'')+'" style="margin-top:6px" aria-label="Detalle"></div>';
  });
  return h+'</div>';
}
ACT['anam-form']=function(){
  var p=pat(parseHash().a),cur=lastAnam(p);ui.sigDrawn=false;
  modal(cur?'Actualizar anamnesis · '+esc(p.name):'Completar anamnesis · '+esc(p.name),
   (cur?'<div class="alert info" style="margin-bottom:14px">'+I.info+'<div>Se guardará como la versión '+(cur.v+1)+'. La versión '+cur.v+' queda disponible para consulta.</div></div>':'')+
   '<p class="muted small" style="margin-bottom:12px">Alergias, anticoagulantes, problemas cardíacos, diabetes y embarazo generan una <b>alerta médica</b> en la ficha.</p>'+ANQ.map(function(s){return qField(s,cur,p)}).join('')+
   '<div class="qsec"><h3>Firma y consentimiento</h3><canvas id="sig-pad" width="1040" height="300" aria-label="Firma del paciente"></canvas><div class="row" style="margin:8px 0"><button type="button" class="btn sm" id="sig-clear" data-act="sig-clear">Borrar firma</button><span class="muted small">Firmá con el dedo, lápiz táctil o mouse.</span></div><label class="row" style="gap:10px;font-weight:600;cursor:pointer"><input type="checkbox" id="sig-ok" style="width:22px;height:22px"> Declaro que la información es verdadera</label><div id="anam-err" style="margin-top:10px"></div></div>',
   '<button class="btn" data-act="close">Cancelar</button><button class="btn pri" id="anam-save" data-act="anam-save">Guardar anamnesis</button>',true);
  sigInit();
};
function sigInit(){
  var c=$('#sig-pad');if(!c)return;var x=c.getContext('2d'),dr=false;x.lineWidth=5;x.lineCap='round';x.lineJoin='round';x.strokeStyle='#232036';
  function pt(e){var r=c.getBoundingClientRect();return [(e.clientX-r.left)*c.width/r.width,(e.clientY-r.top)*c.height/r.height]}
  c.addEventListener('pointerdown',function(e){dr=true;ui.sigDrawn=true;try{c.setPointerCapture(e.pointerId)}catch(_){}var q=pt(e);x.beginPath();x.moveTo(q[0],q[1]);x.lineTo(q[0]+.1,q[1]+.1);x.stroke();ui.sigDrawn=true;e.preventDefault()});
  c.addEventListener('pointermove',function(e){if(!dr)return;var q=pt(e);x.lineTo(q[0],q[1]);x.stroke()});
  ['pointerup','pointercancel','pointerleave'].forEach(function(n){c.addEventListener(n,function(){dr=false})});
}
ACT['sig-clear']=function(){var c=$('#sig-pad');c.getContext('2d').clearRect(0,0,c.width,c.height);ui.sigDrawn=false};
ACT['anam-save']=function(){
  var p=pat(parseHash().a),err=$('#anam-err');
  if(!ui.sigDrawn){err.innerHTML='<div class="alert bad">'+I.alert+'<div>Falta la firma del paciente.</div></div>';return}
  if(!$('#sig-ok').checked){err.innerHTML='<div class="alert bad">'+I.alert+'<div>Marcá la declaración de veracidad.</div></div>';return}
  var a={v:(p.anam||[]).length+1,fecha:TODAY,por:'Lorena Fretes',t:{},r:{},firmante:p.name,firma:$('#sig-pad').toDataURL('image/png')};
  ANQ.forEach(function(s){s.q.forEach(function(q){var k=q[0];if(q[3]==='F'||q[4]==='F'){if(p.sex!=='F')return}
    if(q[1]==='txt')a.t[k]=val('qt-'+k).trim();
    else if(q[1]==='yn')a.r[k]={s:+val('q-'+k),d:val('qd-'+k).trim()};
    else{var o=$$('input[data-k="'+k+'"]:checked').map(function(c){return c.value});a.r[k]={s:o.length?1:0,o:o,d:val('qd-'+k).trim()}}})});
  p.anam=p.anam||[];p.anam.push(a);ui.anamV=null;save();closeModal();
  var m=medAlerts(p);toast('Anamnesis guardada · versión '+a.v+(m.length?' · alerta médica activa':''));render(true);
};
