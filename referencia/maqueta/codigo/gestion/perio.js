/* Gestión · Periodontograma (Cesar 19/11 23:31). Por diente: movilidad, furca, implante/ausente;
   por sitio (3 vestibulares + 3 palatinos/linguales): sangrado, placa, margen gingival y profundidad de sondaje.
   NIC = MG + PS. Gráfico con línea del margen (azul) y del fondo de bolsa (rojo). */
var PE_UP=[18,17,16,15,14,13,12,11,21,22,23,24,25,26,27,28],PE_LO=[48,47,46,45,44,43,42,41,31,32,33,34,35,36,37,38];
var PE_MOL={18:1,17:1,16:1,26:1,27:1,28:1,48:1,47:1,46:1,36:1,37:1,38:1,14:1,24:1};
ui.pe={fecha:null};
function peSeed(p){
  if(p.perio&&p.perio.length)return p.perio;
  var i=+p.id.slice(1)||1,seed=i*97;function r(){seed=(seed*9301+49297)%233280;return seed/233280}
  function chart(f,worse){var t={};PE_UP.concat(PE_LO).forEach(function(d){
    var aus=(d===18||d===48||(i%3===0&&d===38)),bad=[16,26,36,46,47,17].indexOf(d)>=0;
    var s={aus:aus,mov:aus?0:(bad&&worse&&r()<.4?1:0),fur:aus||!PE_MOL[d]?0:(bad&&worse&&r()<.5?1:0),v:[],l:[]};
    ['v','l'].forEach(function(side){for(var k=0;k<3;k++){var ps=2+Math.round(r()*1.2)+(bad&&worse?Math.round(r()*3):0)+(bad&&!worse&&r()<.3?1:0);
      s[side].push({ps:aus?0:ps,mg:aus?0:(bad&&worse&&r()<.3?1:0)+(r()<.12?-1:0),bop:!aus&&ps>=4&&r()<.8||(!aus&&r()<.08),pl:!aus&&r()<(worse?.45:.2)})}});
    t[d]=s});return {id:'pe'+f,fecha:f,dientes:t,nota:''}}
  p.perio=[chart(addDays(TODAY,-120),true),chart(addDays(TODAY,-10),false)];
  p.perio[0].nota='Periodontitis localizada en molares. Se indica raspado y alisado radicular.';
  p.perio[1].nota='Reevaluación después del tratamiento. Mejoró el sangrado y bajaron las bolsas.';
  return p.perio;
}
function peStats(c){var n=0,b=0,pl=0,d4=0,d6=0,nic=0;Object.keys(c.dientes).forEach(function(d){var s=c.dientes[d];if(s.aus)return;['v','l'].forEach(function(x){s[x].forEach(function(z){n++;if(z.bop)b++;if(z.pl)pl++;if(z.ps>=4)d4++;if(z.ps>=6)d6++;nic+=z.ps+z.mg})})});
  return {bop:n?Math.round(b*100/n):0,pl:n?Math.round(pl*100/n):0,d4:d4,d6:d6,nic:n?(nic/n).toFixed(1):'0',n:n}}
function peDx(st){if(st.d6>2||st.nic>=4)return ['Periodontitis · revisar estadio','c-c'];if(st.d4>0)return ['Periodontitis leve / bolsas localizadas','c-s'];if(st.bop>10)return ['Gingivitis','c-s'];return ['Salud periodontal','c-t']}
function peGraph(c,teeth,side,up){
  var W=teeth.length*52+20,H=150,base=up?40:110,mm=8,o='<svg viewBox="0 0 '+W+' '+H+'" class="pe-g" aria-label="Gráfico periodontal">';
  for(var k=0;k<=10;k+=2){var y=up?base+k*mm:base-k*mm;o+='<line x1="10" x2="'+(W-10)+'" y1="'+y+'" y2="'+y+'" stroke="#EEE6D8" stroke-width="1"/>'}
  var pm=[],pb=[];
  teeth.forEach(function(d,i){var s=c.dientes[d],x=10+i*52;
    var crownY=up?base-30:base,rootY=up?base:base-70;
    if(s.aus){o+='<text x="'+(x+26)+'" y="'+(up?base+30:base-30)+'" text-anchor="middle" font-size="22" fill="#CFC6B8">×</text>';return}
    o+='<path d="M'+(x+12)+' '+(up?base:base)+' L'+(x+16)+' '+(up?base+80:base-80)+' L'+(x+26)+' '+(up?base+86:base-86)+' L'+(x+36)+' '+(up?base+80:base-80)+' L'+(x+40)+' '+base+'Z" fill="#FBF6EA" stroke="#D9CFBF"/>';
    o+='<rect x="'+(x+8)+'" y="'+(up?base-30:base)+'" width="36" height="30" rx="10" fill="#fff" stroke="#D9CFBF"/>';
    if(s.mov)o+='<text x="'+(x+26)+'" y="'+(up?base-12:base+20)+'" text-anchor="middle" font-size="11" font-weight="700" fill="#E07A00">M'+s.mov+'</text>';
    if(s.fur)o+='<path d="M'+(x+20)+' '+(up?base+22:base-22)+' l6 '+(up?-8:8)+' l6 '+(up?8:-8)+'" fill="none" stroke="#8B5CF6" stroke-width="2.5"/>';
    s[side].forEach(function(z,k){var sx=x+14+k*12,my=up?base+z.mg*mm:base-z.mg*mm,by=up?base+(z.mg+z.ps)*mm:base-(z.mg+z.ps)*mm;pm.push(sx+','+my);pb.push(sx+','+by);
      if(z.bop)o+='<circle cx="'+sx+'" cy="'+(up?H-6:6)+'" r="4" fill="#FF5D5D"/>';
      if(z.pl)o+='<circle cx="'+sx+'" cy="'+(up?H-17:17)+'" r="3.5" fill="#2E9BEC"/>'})});
  o+='<polyline points="'+pm.join(' ')+'" fill="none" stroke="#2E9BEC" stroke-width="2"/><polyline points="'+pb.join(' ')+'" fill="none" stroke="#FF5D5D" stroke-width="2"/>';
  return o+'</svg>';
}
function peRows(c,teeth,side,lbl){
  var h='<tr class="pe-num"><th>'+lbl+'</th>'+teeth.map(function(d){return '<td>'+d+'</td>'}).join('')+'</tr>';
  function row(name,fn){return '<tr><th>'+name+'</th>'+teeth.map(function(d){var s=c.dientes[d];return '<td'+(s.aus?' class="aus"':'')+'>'+(s.aus?'':fn(s,d))+'</td>'}).join('')+'</tr>'}
  if(side==='v'){
    h+=row('Movilidad',function(s,d){return '<button class="pe-mv" data-act="pe-mov" data-d="'+d+'">'+s.mov+'</button>'});
    h+=row('Furca',function(s,d){return PE_MOL[d]?'<button class="pe-mv'+(s.fur?' on':'')+'" data-act="pe-fur" data-d="'+d+'">'+(s.fur||'–')+'</button>':''});
  }
  h+=row('Sangrado',function(s,d){return '<div class="pe-3">'+s[side].map(function(z,k){return '<button class="pe-b'+(z.bop?' on':'')+'" data-act="pe-bop" data-d="'+d+'" data-s="'+side+'" data-k="'+k+'" aria-label="Sangrado '+d+'"></button>'}).join('')+'</div>'});
  h+=row('Placa',function(s,d){return '<div class="pe-3">'+s[side].map(function(z,k){return '<button class="pe-p'+(z.pl?' on':'')+'" data-act="pe-pl" data-d="'+d+'" data-s="'+side+'" data-k="'+k+'" aria-label="Placa '+d+'"></button>'}).join('')+'</div>'});
  h+=row('Margen',function(s,d){return '<div class="pe-3">'+s[side].map(function(z,k){return '<input class="pe-i" inputmode="numeric" value="'+z.mg+'" data-ch="pe-mg" data-d="'+d+'" data-s="'+side+'" data-k="'+k+'" aria-label="Margen '+d+'">'}).join('')+'</div>'});
  h+=row('Sondaje',function(s,d){return '<div class="pe-3">'+s[side].map(function(z,k){return '<input class="pe-i'+(z.ps>=6?' d6':z.ps>=4?' d4':'')+'" inputmode="numeric" value="'+z.ps+'" data-ch="pe-ps" data-d="'+d+'" data-s="'+side+'" data-k="'+k+'" aria-label="Sondaje '+d+'">'}).join('')+'</div>'});
  return h;
}
function perioTab(p){
  var L=peSeed(p).slice().sort(function(a,b){return a.fecha<b.fecha?1:-1});
  if(!ui.pe.fecha||!L.some(function(c){return c.id===ui.pe.fecha})||ui.pe.pid!==p.id){ui.pe.fecha=L[0].id;ui.pe.pid=p.id}
  var c=L.filter(function(x){return x.id===ui.pe.fecha})[0],st=peStats(c),dx=peDx(st),prev=L[L.indexOf(c)+1],ps=prev&&peStats(prev);
  function kpi(t,v,u,old,good){var d=old==null?'':(+v<+old?(good?'<span class="ok">▼ '+(old-v).toFixed(u==='mm'?1:0)+'</span>':''):+v>+old?'<span class="bad">▲ '+(v-old).toFixed(u==='mm'?1:0)+'</span>':'');return '<div class="pe-k"><span class="muted small">'+t+'</span><b>'+v+u+'</b>'+(d?'<small>'+d+' vs. anterior</small>':'')+'</div>'}
  var head='<div class="card"><div class="card-h"><h2>Periodontograma</h2><div class="row" style="gap:6px">'+L.map(function(x){return '<button class="btn sm'+(x.id===c.id?' pri':'')+'" data-act="pe-ver" data-id="'+x.id+'">'+fdate(x.fecha)+'</button>'}).join('')+btn('Nuevo control','pe-new',{c:'sm',i:'plus',id:'btn-pe-nuevo'})+'</div></div>'+
    '<div class="pe-ks">'+kpi('Sangrado al sondaje',st.bop,'%',ps&&ps.bop,true)+kpi('Índice de placa',st.pl,'%',ps&&ps.pl,true)+kpi('Sitios ≥ 4 mm',st.d4,'',ps&&ps.d4,true)+kpi('Sitios ≥ 6 mm',st.d6,'',ps&&ps.d6,true)+kpi('NIC promedio',st.nic,' mm',ps&&ps.nic,true)+'<div class="pe-k"><span class="muted small">Diagnóstico orientativo</span>'+chip(dx[0],dx[1])+'</div></div>'+
    '<p class="small" style="margin-top:10px">'+esc(c.nota||'')+'</p></div>';
  function arch(teeth,up){return '<div class="card pe-arch"><h3>'+(up?'Arcada superior':'Arcada inferior')+'</h3><div class="pe-scroll"><div class="pe-w">'+
    '<table class="pe-t1">'+peRows(c,teeth,'v',up?'Vestibular':'Vestibular')+'</table>'+peGraph(c,teeth,'v',up)+peGraph(c,teeth,'l',!up)+'<table class="pe-t1">'+peRows(c,teeth,'l',up?'Palatino':'Lingual')+'</table></div></div></div>'}
  var leg='<div class="legend" style="margin:6px 0 14px"><span><i style="background:#2E9BEC"></i>Margen gingival</span><span><i style="background:#FF5D5D"></i>Fondo de bolsa (sondaje)</span><span><i style="background:#FF5D5D;border-radius:50%"></i>Sangrado</span><span><i style="background:#2E9BEC;border-radius:50%"></i>Placa</span><span><i style="background:#8B5CF6"></i>Furca</span><span><i style="background:#FFE3B0"></i>4–5 mm</span><span><i style="background:#FFD0D0"></i>≥ 6 mm</span></div>';
  return '<div class="stack">'+head+leg+arch(PE_UP,true)+arch(PE_LO,false)+'</div>';
}
function peCur(){return (pat(parseHash().a).perio||[]).filter(function(x){return x.id===ui.pe.fecha})[0]}
function peZ(el){var c=peCur();return c.dientes[el.dataset.d][el.dataset.s][+el.dataset.k]}
ACT['pe-ver']=function(el){ui.pe.fecha=el.dataset.id;render(true)};
ACT['pe-bop']=function(el){var z=peZ(el);z.bop=!z.bop;save();render(true)};
ACT['pe-pl']=function(el){var z=peZ(el);z.pl=!z.pl;save();render(true)};
ACT['pe-mov']=function(el){var s=peCur().dientes[el.dataset.d];s.mov=(s.mov+1)%4;save();render(true)};
ACT['pe-fur']=function(el){var s=peCur().dientes[el.dataset.d];s.fur=(s.fur+1)%4;save();render(true)};
ACT['pe-new']=function(){var p=pat(parseHash().a),last=peCur(),n=JSON.parse(JSON.stringify(last));n.id='pe'+Date.now();n.fecha=TODAY;n.nota='Control nuevo: copia del anterior para editar.';p.perio.push(n);ui.pe.fecha=n.id;save();toast('Nuevo control periodontal con los datos del anterior');render(true)};
IN['pe-ps']=function(el){var z=peZ(el);z.ps=Math.max(0,Math.min(15,parseInt(el.value,10)||0));save();render(true)};
IN['pe-mg']=function(el){var z=peZ(el);z.mg=Math.max(-5,Math.min(10,parseInt(el.value,10)||0));save();render(true)};
