/* Gestión · Radiografías: visor dentro de la ficha (Cesar 19/11 23:26).
   Estudios por paciente, unidos al diente; zoom, desplazar, brillo, contraste, negativo y comparar lado a lado.
   Las radiografías de ejemplo son esquemas dibujados (no son de pacientes reales). */
var RX_TIPOS={peri:'Periapical',bite:'Bite-wing',pano:'Panorámica',foto:'Foto intraoral'};
ui.rx={sel:null,cmp:null,z:1,x:0,y:0,b:100,c:100,inv:false,tooth:null,pid:null};

/* ---------- esquemas de ejemplo ---------- */
function rxTooth(x,y,w,h,up,o){o=o||{};
  var cr=h*.38,rt=h-cr,d=up?1:-1,cy=up?y+h-cr:y,ry=up?y:y+cr,s='';
  var root='M'+(x+w*.18)+' '+(up?cy:ry)+' Q'+(x+w*.22)+' '+(up?ry+rt*.15:ry+rt*.85)+' '+(x+w*.4)+' '+(up?ry:ry+rt)+' Q'+(x+w*.5)+' '+(up?ry+rt*.25:ry+rt*.75)+' '+(x+w*.6)+' '+(up?ry:ry+rt)+' Q'+(x+w*.78)+' '+(up?ry+rt*.15:ry+rt*.85)+' '+(x+w*.82)+' '+(up?cy:ry)+'Z';
  s+='<path d="'+root+'" fill="#9a9a9a"/>';
  s+='<rect x="'+x+'" y="'+cy+'" width="'+w+'" height="'+cr+'" rx="'+w*.45+'" fill="#d8d8d8"/>';
  s+='<rect x="'+(x+w*.12)+'" y="'+(cy+cr*.12)+'" width="'+w*.76+'" height="'+cr*.76+'" rx="'+w*.38+'" fill="#b8b8b8"/>';
  s+='<path d="M'+(x+w*.5)+' '+(up?cy+cr*.6:ry+cr*.4-cr)+' L'+(x+w*.5)+' '+(up?ry+rt*.1:ry+rt*.9)+'" stroke="#555" stroke-width="'+w*.08+'" stroke-linecap="round"/>';
  if(o.rest)s+='<path d="M'+(x+w*.2)+' '+(up?cy+cr*.55:cy+cr*.1)+' h'+w*.6+' v'+cr*.35+' h-'+w*.6+'Z" fill="#fff"/>';
  if(o.endo)s+='<path d="M'+(x+w*.5)+' '+(up?cy+cr*.5:cy+cr*.5)+' L'+(x+w*.5)+' '+(up?ry+rt*.06:ry+rt*.94)+'" stroke="#fff" stroke-width="'+w*.09+'" stroke-linecap="round"/>';
  if(o.car)s+='<ellipse cx="'+(x+w*.78)+'" cy="'+(cy+cr*(up?.35:.65))+'" rx="'+w*.14+'" ry="'+cr*.18+'" fill="#3a3a3a"/>';
  if(o.les)s+='<ellipse cx="'+(x+w*.5)+'" cy="'+(up?ry:ry+rt)+'" rx="'+w*.38+'" ry="'+w*.3+'" fill="#2a2a2a" opacity=".85"/>';
  return s;
}
function rxSvg(kind,teeth,flags){
  var W=kind==='pano'?1400:800,H=kind==='pano'?700:600,s='';
  s+='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '+W+' '+H+'"><defs><filter id="n"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="4"/><feColorMatrix values="0 0 0 0 .5 0 0 0 0 .5 0 0 0 0 .5 0 0 0 .18 0"/><feComposite in2="SourceGraphic" operator="in"/></filter><filter id="b"><feGaussianBlur stdDeviation="2.2"/></filter><radialGradient id="v"><stop offset=".55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".75"/></radialGradient></defs>';
  s+='<rect width="'+W+'" height="'+H+'" fill="#151515"/><g filter="url(#b)">';
  if(kind==='pano'){
    s+='<path d="M80 330 Q700 120 1320 330 L1320 380 Q700 600 80 380Z" fill="#3c3c3c"/>';
    s+='<path d="M70 120 Q700 -40 1330 120 L1330 280 Q700 140 70 280Z" fill="#2c2c2c"/><path d="M90 420 Q700 720 1310 420 L1330 640 Q700 760 70 640Z" fill="#383838"/>';
    var up=[18,17,16,15,14,13,12,11,21,22,23,24,25,26,27,28],lo=[48,47,46,45,44,43,42,41,31,32,33,34,35,36,37,38];
    up.forEach(function(t,i){var x=150+i*69,cx=x-700,y=110+Math.pow(cx/700,2)*90;s+=rxTooth(x,y,56,220,true,flags[t])});
    lo.forEach(function(t,i){var x=150+i*69,cx=x-700,y=370-Math.pow(cx/700,2)*60;s+=rxTooth(x,y,56,230,false,flags[t])});
  }else{
    s+='<rect x="0" y="'+(kind==='bite'?260:0)+'" width="'+W+'" height="'+(kind==='bite'?80:H)+'" fill="#323232"/>';
    var n=teeth.length,w=kind==='bite'?150:200,gap=(W-n*w)/(n+1);
    teeth.forEach(function(t,i){var x=gap+i*(w+gap),upT=Math.floor(t/10)%2===1&&t<30||(t>=50&&t<70);
      if(kind==='bite'){s+=rxTooth(x,40,w,250,true,flags[t]||{});s+=rxTooth(x,310,w,250,false,flags[t+20]||{})}
      else s+=rxTooth(x,upT?20:40,w,540,upT,flags[t]||{})});
  }
  s+='</g><rect width="'+W+'" height="'+H+'" fill="url(#v)"/><rect width="'+W+'" height="'+H+'" filter="url(#n)" fill="#fff"/></svg>';
  return 'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(s);
}
function rxSeed(p){
  if(p.rx)return p.rx;
  var i=+p.id.slice(1)||1,f={};
  f[36]={car:true};f[46]={rest:true};f[16]={rest:true,endo:true};f[26]={les:true,endo:true};
  if(i%2)f[47]={car:true};
  p.rx=[
   {id:'rx'+i+'a',tipo:'pano',fecha:addDays(TODAY,-180),dientes:[],nota:'Panorámica inicial. Evaluación general.',src:rxSvg('pano',[],f)},
   {id:'rx'+i+'b',tipo:'peri',fecha:addDays(TODAY,-60),dientes:[35,36,37],nota:'Caries distal en 36. Sin lesión periapical.',src:rxSvg('peri',[35,36,37],{36:{car:true}})},
   {id:'rx'+i+'c',tipo:'peri',fecha:addDays(TODAY,-7),dientes:[35,36,37],nota:'Control después de la resina en 36.',src:rxSvg('peri',[35,36,37],{36:{rest:true}})},
   {id:'rx'+i+'d',tipo:'bite',fecha:addDays(TODAY,-30),dientes:[16,26],nota:'Bite-wing de control. Endodoncia en 16.',src:rxSvg('bite',[15,16,17],{16:{rest:true,endo:true},36:{car:true}})}
  ];
  return p.rx;
}

/* ---------- pestaña ---------- */
function rxTab(p){
  var R=rxSeed(p),q=parseHash().q,st=ui.rx;
  if(st.pid!==p.id){ui.rx={sel:null,cmp:null,z:1,x:0,y:0,b:100,c:100,inv:false,tooth:q.d?+q.d:null,pid:p.id};st=ui.rx}
  else if(q.d&&st.tooth===null)st.tooth=+q.d;
  if(q.cmp&&!st.cmp&&R.length>2){st.cmp=R[1].id;st.sel=R[2].id;st.c=140}
  var list=R.filter(function(r){return !st.tooth||r.dientes.indexOf(st.tooth)>=0||r.tipo==='pano'}).sort(function(a,b){return a.fecha<b.fecha?1:-1});
  if(!st.sel||!R.some(function(r){return r.id===st.sel}))st.sel=(list[0]||R[0]||{}).id;
  var all={};R.forEach(function(r){r.dientes.forEach(function(d){all[d]=1})});
  var teeth=Object.keys(all).map(Number).sort(function(a,b){return a-b});
  var flt='<div class="row" style="gap:6px;flex-wrap:wrap;margin:10px 0 4px"><span class="muted small">Diente:</span><button class="btn sm'+(st.tooth?'':' pri')+'" data-act="rx-tooth" data-d="">Todos</button>'+teeth.map(function(d){return '<button class="btn sm'+(st.tooth===d?' pri':'')+'" data-act="rx-tooth" data-d="'+d+'">'+d+'</button>'}).join('')+'</div>';
  var items=list.map(function(r){return '<div class="rx-item'+(r.id===st.sel?' on':'')+(r.id===st.cmp?' cmp':'')+'" data-act="rx-sel" data-id="'+r.id+'" role="button" tabindex="0"><img src="'+r.src+'" alt=""><div><b>'+RX_TIPOS[r.tipo]+'</b><div class="muted small">'+fdate(r.fecha)+(r.dientes.length?' · '+r.dientes.join(', '):' · boca completa')+'</div>'+(r.id===st.cmp?'<span class="chip c-s nodot" style="margin-top:4px">Comparando</span>':'')+'</div></div>'}).join('')||'<div class="empty">Sin estudios para este diente.</div>';
  var a=R.filter(function(r){return r.id===st.sel})[0],b=st.cmp&&R.filter(function(r){return r.id===st.cmp})[0];
  var flt2='filter:brightness('+st.b/100+') contrast('+st.c/100+')'+(st.inv?' invert(1)':'')+';transform:translate('+st.x+'px,'+st.y+'px) scale('+st.z+')';
  function pane(r,lbl){return '<div class="rx-pane"><div class="rx-cap">'+(lbl?'<b>'+lbl+'</b> · ':'')+RX_TIPOS[r.tipo]+' · '+fdate(r.fecha)+'</div><div class="rx-stage" data-rxstage="1"><img class="rx-img" src="'+r.src+'" alt="'+RX_TIPOS[r.tipo]+' del '+fdate(r.fecha)+'" draggable="false" style="'+flt2+'"></div></div>'}
  var tools='<div class="rx-tools"><button class="btn sm" data-act="rx-z" data-v="-1" aria-label="Alejar">−</button><span class="num small" style="min-width:46px;text-align:center">'+Math.round(st.z*100)+'%</span><button class="btn sm" data-act="rx-z" data-v="1" aria-label="Acercar">+</button><button class="btn sm" data-act="rx-z" data-v="0">Ajustar</button>'+
    '<label class="rx-sl">Brillo<input type="range" min="40" max="200" value="'+st.b+'" data-in="rx-b"></label><label class="rx-sl">Contraste<input type="range" min="40" max="250" value="'+st.c+'" data-in="rx-c"></label>'+
    '<button class="btn sm'+(st.inv?' pri':'')+'" data-act="rx-inv">Negativo</button><button class="btn sm'+(st.cmp?' pri':'')+'" data-act="rx-cmp">'+(st.cmp?'Salir de comparar':'Comparar')+'</button></div>';
  var viewer=a?'<div class="card"><div class="card-h"><h2>Visor</h2>'+tools+'</div>'+(st.cmp===true?'<div class="alert info" style="margin-bottom:10px">Elegí en la lista la radiografía para comparar con esta.</div>':'')+'<div class="rx-view'+(b?' two':'')+'">'+(b?pane(b,'Antes')+pane(a,'Después'):pane(a))+'</div>'+
    '<p class="muted small" style="margin-top:8px">Rueda o botones para el zoom · arrastrá para mover · el zoom y los ajustes se aplican a las dos al comparar.</p>'+
    '<div class="row" style="gap:16px;margin-top:10px;align-items:flex-start;flex-wrap:wrap"><div style="flex:1;min-width:220px"><h3 style="margin-bottom:6px">Nota del estudio</h3><p>'+esc(a.nota||'Sin nota.')+'</p></div><div style="min-width:220px"><h3 style="margin-bottom:6px">Dientes</h3><input class="inp" style="width:100%" value="'+a.dientes.join(', ')+'" placeholder="Ej.: 36, 37" data-ch="rx-teeth" aria-label="Dientes de este estudio"><select class="inp" style="width:100%;margin-top:6px" data-ch="rx-tipo" aria-label="Tipo de estudio">'+Object.keys(RX_TIPOS).map(function(k){return '<option value="'+k+'"'+(k===a.tipo?' selected':'')+'>'+RX_TIPOS[k]+'</option>'}).join('')+'</select></div></div></div>':'<div class="card"><div class="empty">Subí la primera radiografía.</div></div>';
  return '<div class="grid g12 rx"><div class="card"><div class="card-h"><h2>Estudios</h2><label class="btn pri sm" id="btn-rx-subir">'+I.plus+'Subir<input type="file" accept="image/*" hidden data-ch="rx-up"></label></div>'+flt+'<div class="rx-list">'+items+'</div><a class="btn sm" style="margin-top:12px" href="#/pacientes/'+p.id+'/odontograma">'+I.tooth+'Ver en el odontograma</a></div>'+viewer+'</div>';
}

/* ---------- acciones ---------- */
function rxPat(){var r=parseHash();return pat(r.a)}
function rxCur(){var p=rxPat();return (p.rx||[]).filter(function(r){return r.id===ui.rx.sel})[0]}
function rxApply(){var st=ui.rx,f='brightness('+st.b/100+') contrast('+st.c/100+')'+(st.inv?' invert(1)':'');$$('.rx-img').forEach(function(im){im.style.filter=f;im.style.transform='translate('+st.x+'px,'+st.y+'px) scale('+st.z+')'});var z=document.querySelector('.rx-tools .num');if(z)z.textContent=Math.round(st.z*100)+'%'}
ACT['rx-sel']=function(el){var st=ui.rx;if(st.cmp===true){if(el.dataset.id!==st.sel){st.cmp=st.sel;st.sel=el.dataset.id;var p=rxPat(),A=p.rx.filter(function(r){return r.id===st.sel})[0],B=p.rx.filter(function(r){return r.id===st.cmp})[0];if(A.fecha<B.fecha){st.sel=B.id;st.cmp=A.id}}}else{st.sel=el.dataset.id;if(st.cmp===st.sel)st.cmp=null}st.z=1;st.x=st.y=0;render(true)};
ACT['rx-tooth']=function(el){ui.rx.tooth=el.dataset.d?+el.dataset.d:null;ui.rx.sel=null;ui.rx.cmp=null;render(true)};
ACT['rx-z']=function(el){var v=+el.dataset.v,st=ui.rx;if(!v){st.z=1;st.x=st.y=0}else st.z=Math.max(.5,Math.min(6,st.z*(v>0?1.35:1/1.35)));rxApply()};
ACT['rx-inv']=function(){ui.rx.inv=!ui.rx.inv;render(true)};
ACT['rx-cmp']=function(){ui.rx.cmp=ui.rx.cmp?null:true;render(true)};
IN['rx-b']=function(el){ui.rx.b=+el.value;rxApply()};
IN['rx-c']=function(el){ui.rx.c=+el.value;rxApply()};
IN['rx-teeth']=function(el){var r=rxCur();if(!r)return;r.dientes=(el.value.match(/\d{2}/g)||[]).map(Number);save();toast('Estudio unido a '+(r.dientes.length?'la pieza '+r.dientes.join(', '):'la boca completa'));render(true)};
IN['rx-tipo']=function(el){var r=rxCur();if(!r)return;r.tipo=el.value;save();render(true)};
IN['rx-up']=function(el){var f=el.files&&el.files[0];if(!f)return;var rd=new FileReader();rd.onload=function(){var p=rxPat(),d=ui.rx.tooth;rxSeed(p);
  var r={id:'rx'+Date.now(),tipo:'peri',fecha:TODAY,dientes:d?[d]:[],nota:'Subida el '+fdate(TODAY)+'.',src:rd.result};p.rx.push(r);ui.rx.sel=r.id;ui.rx.cmp=null;save();toast('Radiografía guardada en la ficha'+(d?' · pieza '+d:''));render(true)};rd.readAsDataURL(f)};

/* zoom con rueda y arrastre */
document.addEventListener('wheel',function(e){if(!e.target.closest('[data-rxstage]'))return;e.preventDefault();var st=ui.rx;st.z=Math.max(.5,Math.min(6,st.z*(e.deltaY<0?1.12:1/1.12)));rxApply()},{passive:false});
(function(){var dr=null;
 document.addEventListener('pointerdown',function(e){var s=e.target.closest('[data-rxstage]');if(!s)return;dr={x:e.clientX,y:e.clientY,ox:ui.rx.x,oy:ui.rx.y};s.setPointerCapture&&s.setPointerCapture(e.pointerId)});
 document.addEventListener('pointermove',function(e){if(!dr)return;ui.rx.x=dr.ox+(e.clientX-dr.x);ui.rx.y=dr.oy+(e.clientY-dr.y);rxApply()});
 document.addEventListener('pointerup',function(){dr=null});
})();
