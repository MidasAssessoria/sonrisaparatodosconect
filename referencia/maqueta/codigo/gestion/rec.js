/* Gestión · Recetas, certificados médicos e indicaciones (João Carvalho 19/11 23:59).
   Cada documento sale del doctor responsable: firma digital + sello (variables por doctor), número correlativo,
   código de verificación e impresión A4. Receta avisa si el remedio choca con una alergia de la anamnesis. */
var REC_MED=[
  {n:'Amoxicilina 500 mg',d:'1 cápsula',f:'cada 8 horas',t:'7 días',grupo:'penicilina'},
  {n:'Amoxicilina + ácido clavulánico 875/125 mg',d:'1 comprimido',f:'cada 12 horas',t:'7 días',grupo:'penicilina'},
  {n:'Clindamicina 300 mg',d:'1 cápsula',f:'cada 8 horas',t:'7 días'},
  {n:'Ibuprofeno 400 mg',d:'1 comprimido',f:'cada 8 horas',t:'3 días',grupo:'aine'},
  {n:'Paracetamol 750 mg',d:'1 comprimido',f:'cada 8 horas',t:'3 días'},
  {n:'Ketorolac 10 mg',d:'1 comprimido',f:'cada 8 horas',t:'2 días',grupo:'aine'},
  {n:'Clorhexidina 0,12 % (colutorio)',d:'15 ml',f:'2 veces al día',t:'10 días'}
];
var REC_TIPO={receta:['Receta','c-t'],certificado:['Certificado médico','c-i'],indicaciones:['Indicaciones','c-g']};
var REC_CERT={reposo:'Reposo laboral / escolar',asistencia:'Constancia de asistencia',aptitud:'Certificado de aptitud odontológica'};
function recDocs(){if(!S.recDocs)recSeed();return S.recDocs}
function recDen(d){if(!d.reg){var r={d1:'4.512',d2:'3.987',d3:'5.230'}[d.id]||'1.000';d.reg=r;d.sello=true}return d}
function recSeed(){
  S.recDocs=[];var p=S.patients[0];if(!p)return;
  S.recDocs.push({id:'rd1',num:'REC-0041',tipo:'receta',pid:p.id,did:'d2',date:addDays(TODAY,-12),items:[{n:'Clindamicina 300 mg',d:'1 cápsula',f:'cada 8 horas',t:'7 días'},{n:'Paracetamol 750 mg',d:'1 comprimido',f:'cada 8 horas',t:'3 días'}],obs:'Tomar con abundante agua. Volver si hay fiebre o hinchazón.',firmado:true,cod:'7K2M-91QX'});
  S.recDocs.push({id:'rd2',num:'CER-0018',tipo:'certificado',pid:p.id,did:'d2',date:addDays(TODAY,-12),cert:'reposo',dias:2,dx:'Endodoncia pieza 46',obs:'',firmado:true,cod:'P3ZA-44TN'});
  S.recDocs.push({id:'rd3',num:'IND-0027',tipo:'indicaciones',pid:p.id,did:'d1',date:addDays(TODAY,-30),txt:'Después de la limpieza:\n• No comer ni beber colorantes (café, mate, vino) por 24 horas.\n• Cepillado suave con cepillo blando.\n• Colutorio de clorhexidina 2 veces al día por 10 días.',firmado:true,cod:'H8WC-02LD'});
}
function recNext(t){var pre={receta:'REC',certificado:'CER',indicaciones:'IND'}[t];var n=recDocs().filter(function(x){return x.tipo===t}).length+{receta:41,certificado:18,indicaciones:27}[t];return pre+'-'+String(n).padStart(4,'0')}
function recCode(){var c='ABCDEFGHJKLMNPQRSTUVWXYZ23456789',s='';for(var i=0;i<8;i++){s+=c[Math.floor(Math.random()*c.length)];if(i===3)s+='-'}return s}
function recAlergias(p){var a=typeof lastAnam==='function'?lastAnam(p):null;var o=(a&&a.r&&a.r.alerg&&a.r.alerg.s&&a.r.alerg.o)||[];return o.map(function(x){return x.toLowerCase()})}
function recChoque(p,it){var al=recAlergias(p),m=REC_MED.filter(function(x){return x.n===it.n})[0];if(!m||!m.grupo)return '';if(m.grupo==='penicilina'&&al.some(function(x){return x.indexOf('penicilina')>=0}))return 'Alergia a la penicilina';if(m.grupo==='aine'&&al.some(function(x){return /aine|ibuprofeno|aspirina|antiinflam/.test(x)}))return 'Alergia a antiinflamatorios';return ''}
function recFirma(d){var seed=d.id.charCodeAt(1)*7;return '<svg class="rec-firma" viewBox="0 0 220 70" aria-label="Firma digital de '+esc(d.name)+'"><path d="M10 48 C 30 '+(10+seed%20)+', 48 64, 64 36 S 92 '+(14+seed%15)+', 104 44 C 116 66, 132 18, 150 40 S 186 52, 210 24" fill="none" stroke="#1d2a6b" stroke-width="2.6" stroke-linecap="round"/></svg>'}
function recSello(d){var c=d.color||'#18BFB0';var nm=esc(d.name.toUpperCase());return '<svg class="rec-sello" viewBox="0 0 140 140" aria-label="Sello de '+esc(d.name)+'"><defs><path id="sc-'+d.id+'" d="M70 70 m-50 0 a50 50 0 1 1 100 0 a50 50 0 1 1 -100 0"/></defs><g fill="none" stroke="'+c+'" stroke-width="3" opacity=".85"><circle cx="70" cy="70" r="64"/><circle cx="70" cy="70" r="38"/></g><text font-size="10.5" font-weight="700" fill="'+c+'" opacity=".9" letter-spacing="1.2"><textPath href="#sc-'+d.id+'">'+nm+' · SONRISA PARA TODOS ·</textPath></text><text x="70" y="64" text-anchor="middle" font-size="10" font-weight="700" fill="'+c+'">CIRUJANO</text><text x="70" y="76" text-anchor="middle" font-size="10" font-weight="700" fill="'+c+'">DENTISTA</text><text x="70" y="90" text-anchor="middle" font-size="9" fill="'+c+'">Reg. '+esc(d.reg)+'</text></svg>'}
function recDocHtml(r){
  var p=pat(r.pid),d=recDen(den(r.did));var tit={receta:'Receta',certificado:'Certificado médico',indicaciones:'Indicaciones al paciente'}[r.tipo];
  var cuerpo='';
  if(r.tipo==='receta'){cuerpo='<div class="rec-rp">Rp/</div><ol class="rec-items">'+r.items.map(function(it){return '<li><b>'+esc(it.n)+'</b><div>'+esc(it.d)+' '+esc(it.f)+' durante '+esc(it.t)+'</div></li>'}).join('')+'</ol>'+(r.obs?'<p class="rec-obs"><b>Indicaciones:</b> '+esc(r.obs)+'</p>':'')}
  else if(r.tipo==='certificado'){
    var txt=r.cert==='reposo'?'Certifico que <b>'+esc(p.name)+'</b>, CI '+esc(p.ci||'')+', fue atendido/a en la fecha por <b>'+esc(r.dx||'tratamiento odontológico')+'</b> y requiere <b>'+r.dias+' día'+(r.dias>1?'s':'')+' de reposo</b> a partir del '+fdate(r.date)+'.'
      :r.cert==='asistencia'?'Hago constar que <b>'+esc(p.name)+'</b>, CI '+esc(p.ci||'')+', asistió a consulta odontológica el '+fdateLong(r.date)+(r.hora?' de '+esc(r.hora):'')+' por <b>'+esc(r.dx||'control')+'</b>.'
      :'Certifico que <b>'+esc(p.name)+'</b>, CI '+esc(p.ci||'')+', fue evaluado/a y se encuentra <b>apto/a desde el punto de vista odontológico</b>'+(r.dx?' ('+esc(r.dx)+')':'')+'.';
    cuerpo='<p class="rec-cert">'+txt+'</p>'+(r.obs?'<p class="rec-obs">'+esc(r.obs)+'</p>':'')+'<p class="rec-obs muted">Se extiende el presente a pedido del interesado para los fines que estime conveniente.</p>'}
  else cuerpo='<div class="rec-ind">'+esc(r.txt||'').replace(/\n/g,'<br>')+'</div>';
  return '<div class="invoice rec-doc" id="rec-doc"><div class="rec-top"><div class="rec-logo">'+I.tooth+'<div><b>Sonrisa Para Todos</b><span>Clínica odontológica</span></div></div><div class="rec-num"><b>'+esc(tit)+'</b><span>N.º '+esc(r.num)+'</span><span>'+fdate(r.date)+'</span></div></div>'+
    '<div class="rec-pac"><div><span>Paciente</span><b>'+esc(p.name)+'</b></div><div><span>CI</span><b>'+esc(p.ci||'—')+'</b></div><div><span>Edad</span><b>'+age(p.born)+' años</b></div></div>'+
    '<div class="rec-body">'+cuerpo+'</div>'+
    '<div class="rec-pie"><div class="rec-ver"><div class="rec-qr" aria-hidden="true">'+recQr(r.cod)+'</div><div><b>Verificar documento</b><span>Código '+esc(r.cod)+'</span><span class="muted">Firmado digitalmente el '+fdate(r.date)+'</span></div></div>'+
    '<div class="rec-firmas">'+(d.sello?recSello(d):'')+'<div class="rec-fir">'+recFirma(d)+'<div class="rec-linea"></div><b>'+esc(d.name)+'</b><span>'+esc(d.esp||'Odontología')+' · Reg. Prof. '+esc(d.reg)+'</span></div></div></div></div>'}
function recQr(code){var h=0;for(var i=0;i<code.length;i++)h=(h*31+code.charCodeAt(i))>>>0;var s='<svg viewBox="0 0 21 21" width="64" height="64">';for(var y=0;y<21;y++)for(var x=0;x<21;x++){var f=(x<7&&y<7)||(x>13&&y<7)||(x<7&&y>13);var on=f?((x%6===0||y%6===0||(x>1&&x<5&&y>1&&y<5)||(x>15&&x<19&&y>1&&y<5)||(x>1&&x<5&&y>15&&y<19))&&!(x===6&&y>6)):(((h>>((x*3+y*7)%29))^(x*y))&1);if(x>13&&y<7)on=(x===14||x===20||y===0||y===6||(x>15&&x<19&&y>1&&y<5));if(on)s+='<rect x="'+x+'" y="'+y+'" width="1" height="1"/>'}return s+'</svg>'}
function recTab(p){
  var L=recDocs().filter(function(x){return x.pid===p.id}).sort(function(a,b){return a.date<b.date?1:-1});
  var al=recAlergias(p);
  var bar='<div class="card"><div class="card-h"><h2>Recetas y certificados</h2><div class="row" style="gap:6px;flex-wrap:wrap">'+btn('Nueva receta','rec-new',{c:'pri sm',i:'plus',d:'data-t="receta" data-pid="'+p.id+'"',id:'btn-rec-receta'})+btn('Certificado médico','rec-new',{c:'sm',i:'plus',d:'data-t="certificado" data-pid="'+p.id+'"',id:'btn-rec-cert'})+btn('Indicaciones','rec-new',{c:'sm',i:'plus',d:'data-t="indicaciones" data-pid="'+p.id+'"'})+'</div></div>'+
    (al.length?'<div class="alert bad" style="margin:4px 0 12px">'+I.alert+'<div><b>Alergias registradas:</b> '+al.map(esc).join(', ')+'. La receta avisa si elegís un remedio que choca.</div></div>':'')+
    (L.length?'<div class="tw"><table class="tbl rs"><thead><tr><th>N.º</th><th>Tipo</th><th>Fecha</th><th>Doctor</th><th>Detalle</th><th></th></tr></thead><tbody>'+L.map(function(r){var d=den(r.did);var det=r.tipo==='receta'?r.items.map(function(i){return i.n}).join(', '):r.tipo==='certificado'?REC_CERT[r.cert]+(r.cert==='reposo'?' · '+r.dias+' d':''):(r.txt||'').split('\n')[0];return '<tr class="click" data-act="rec-ver" data-id="'+r.id+'"><td data-l="N.º"><b>'+esc(r.num)+'</b></td><td data-l="Tipo">'+chip(REC_TIPO[r.tipo][0],REC_TIPO[r.tipo][1])+'</td><td data-l="Fecha">'+fdate(r.date)+'</td><td data-l="Doctor">'+esc(d?d.name:'')+'</td><td data-l="Detalle" class="small">'+esc(det)+'</td><td data-l="" class="r">'+chip('Firmado','c-t')+'</td></tr>'}).join('')+'</tbody></table></div>':'<div class="empty">Sin documentos emitidos.</div>')+'</div>';
  var cfg='<div class="card"><div class="card-h"><h2>Firma y sello de cada doctor</h2></div><div class="rec-docs">'+S.dentists.map(function(d){recDen(d);return '<div class="rec-dcard"><div class="rec-dprev">'+recSello(d)+recFirma(d)+'</div><b>'+esc(d.name)+'</b><div class="muted small">Reg. Prof. '+esc(d.reg)+'</div><label class="wa-sw" style="margin-top:8px"><input type="checkbox" data-ch="rec-sello" data-id="'+d.id+'"'+(d.sello?' checked':'')+'><span></span><div class="small">Imprimir con sello</div></label></div>'}).join('')+'</div></div>';
  return '<div class="stack">'+bar+cfg+'</div>';
}
function recForm(){
  var f=ui.rec,p=pat(f.pid);var dsel='<select class="inp" data-ch="rec-f" data-k="did" aria-label="Doctor responsable">'+S.dentists.map(function(d){return '<option value="'+d.id+'"'+(d.id===f.did?' selected':'')+'>'+esc(d.name)+'</option>'}).join('')+'</select>';
  var b='<div class="stack" style="gap:12px"><div><b>Doctor responsable</b><div style="margin-top:6px">'+dsel+'</div><div class="muted small" style="margin-top:4px">La firma digital y el sello salen de este doctor.</div></div>';
  if(f.tipo==='receta'){
    b+='<div><b>Remedios</b><div class="rec-chips">'+REC_MED.map(function(m,i){return '<button class="btn sm" data-act="rec-add" data-i="'+i+'">+ '+esc(m.n)+'</button>'}).join('')+'</div>'+
      (f.items.length?'<div class="rec-list">'+f.items.map(function(it,i){var ch=recChoque(p,it);return '<div class="rec-li'+(ch?' bad':'')+'"><div><b>'+esc(it.n)+'</b><div class="small">'+esc(it.d)+' '+esc(it.f)+' durante '+esc(it.t)+'</div>'+(ch?'<div class="rec-warn">'+I.alert+' '+esc(ch)+': elegí otro remedio</div>':'')+'</div><button class="x" data-act="rec-del" data-i="'+i+'" aria-label="Quitar">×</button></div>'}).join('')+'</div>':'<div class="muted small" style="margin-top:6px">Tocá un remedio para sumarlo.</div>')+'</div>'+
      '<div><b>Indicaciones</b><textarea class="inp" rows="2" style="width:100%" data-in="rec-obs">'+esc(f.obs||'')+'</textarea></div>';
  }else if(f.tipo==='certificado'){
    b+='<div><b>Tipo de certificado</b><div class="row" style="gap:6px;margin-top:6px;flex-wrap:wrap">'+Object.keys(REC_CERT).map(function(k){return '<button class="btn sm'+(f.cert===k?' pri':'')+'" data-act="rec-cert" data-k="'+k+'">'+REC_CERT[k]+'</button>'}).join('')+'</div></div>'+
      (f.cert==='reposo'?'<div><b>Días de reposo</b><input class="inp" type="number" min="1" max="30" value="'+f.dias+'" data-in="rec-dias" style="width:90px;margin-left:8px"></div>':'')+
      '<div><b>Motivo / diagnóstico</b><input class="inp" style="width:100%" value="'+esc(f.dx||'')+'" data-in="rec-dx" placeholder="Ej.: Extracción pieza 38"></div>';
  }else b+='<div><b>Texto</b><textarea class="inp" rows="6" style="width:100%" data-in="rec-txt">'+esc(f.txt||'')+'</textarea></div>';
  return b+'</div>';
}
function recOpenForm(){var f=ui.rec;var bad=f.tipo==='receta'&&f.items.some(function(it){return recChoque(pat(f.pid),it)});modal('Nueva '+(f.tipo==='receta'?'receta':f.tipo==='certificado'?'certificado médico':'indicación')+' · '+esc(pat(f.pid).name),recForm(),'<button class="btn" data-act="close">Cancelar</button><button class="btn pri" data-act="rec-save"'+((f.tipo==='receta'&&!f.items.length)||bad?' disabled':'')+' id="btn-rec-firmar">Firmar y emitir</button>',true)}
ACT['rec-new']=function(el){var t=el.dataset.t;ui.rec={tipo:t,pid:el.dataset.pid,did:(S.dentists[0]||{}).id,items:[],obs:'',cert:'reposo',dias:1,dx:'',txt:t==='indicaciones'?'Después de la extracción:\n• Morder la gasa 30 minutos.\n• No escupir ni enjuagar por 24 horas.\n• Comidas blandas y frías el primer día.':''};recOpenForm()};
ACT['rec-add']=function(el){var m=REC_MED[+el.dataset.i];ui.rec.items.push({n:m.n,d:m.d,f:m.f,t:m.t});recOpenForm()};
ACT['rec-del']=function(el){ui.rec.items.splice(+el.dataset.i,1);recOpenForm()};
ACT['rec-cert']=function(el){ui.rec.cert=el.dataset.k;recOpenForm()};
IN['rec-f']=function(el){ui.rec[el.dataset.k]=el.value};
IN['rec-obs']=function(el){ui.rec.obs=el.value};IN['rec-dx']=function(el){ui.rec.dx=el.value};IN['rec-txt']=function(el){ui.rec.txt=el.value};IN['rec-dias']=function(el){ui.rec.dias=Math.max(1,+el.value||1)};
IN['rec-sello']=function(el){den(el.dataset.id).sello=el.checked;save();render(true)};
ACT['rec-save']=function(){var f=ui.rec;var r={id:'rd'+Date.now(),num:recNext(f.tipo),tipo:f.tipo,pid:f.pid,did:f.did,date:TODAY,firmado:true,cod:recCode()};
  if(f.tipo==='receta'){r.items=f.items.slice();r.obs=f.obs}else if(f.tipo==='certificado'){r.cert=f.cert;r.dias=f.dias;r.dx=f.dx}else r.txt=f.txt;
  recDocs().push(r);save();closeModal();toast(REC_TIPO[r.tipo][0]+' '+r.num+' firmada y emitida');render(true);recShow(r)};
function recShow(r){modal(REC_TIPO[r.tipo][0]+' '+esc(r.num),recDocHtml(r),'<button class="btn" data-act="close">Cerrar</button><button class="btn" data-act="rec-wa" data-id="'+r.id+'">'+I.wa+'Enviar por WhatsApp</button><button class="btn pri" data-act="rec-print">Imprimir</button>',true)}
ACT['rec-ver']=function(el){recShow(recDocs().filter(function(x){return x.id===el.dataset.id})[0])};
ACT['rec-print']=function(){window.print()};
ACT['rec-wa']=function(){toast('PDF firmado enviado al WhatsApp del paciente (demo)')};
(function(){var m=/[?&]doc=(rd\d+)/.exec(location.search);if(!m)return;document.documentElement.classList.add("noanim");setTimeout(function(){var r=recDocs().filter(function(x){return x.id===m[1]})[0];if(r)recShow(r)},700)})();
