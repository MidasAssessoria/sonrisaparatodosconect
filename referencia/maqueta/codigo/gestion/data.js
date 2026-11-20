/* Sonrisa Para Todos Conecta · Gestión — datos de demostración y utilidades (todo ficticio) */
var KEY = 'sptc-gestion-v1';
var S = null;

/* ---------- utilidades ---------- */
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function gs(n){n=Math.round(n||0);var neg=n<0;n=Math.abs(n);return (neg?'−':'')+'₲ '+String(n).replace(/\B(?=(\d{3})+(?!\d))/g,'.')}
function pad(n){return (n<10?'0':'')+n}
function ymd(d){return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())}
function pd(s){var a=s.split('-');return new Date(+a[0],+a[1]-1,+a[2])}
function addDays(s,n){var d=pd(s);d.setDate(d.getDate()+n);return ymd(d)}
function daysBetween(a,b){return Math.round((pd(b)-pd(a))/86400000)}
function fdate(s){var a=s.split('-');return a[2]+'/'+a[1]+'/'+a[0]}
var DN=['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
var DNS=['dom','lun','mar','mié','jue','vie','sáb'];
var MN=['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
function fdateLong(s){var d=pd(s);return DN[d.getDay()]+' '+d.getDate()+' de '+MN[d.getMonth()]+' de '+d.getFullYear()}
function mondayOf(s){var d=pd(s);var k=(d.getDay()+6)%7;return addDays(s,-k)}
var TODAY = ymd(new Date());
function nowHM(){var d=new Date();return pad(d.getHours())+':'+pad(d.getMinutes())}
function toMin(t){var a=t.split(':');return +a[0]*60+ +a[1]}
function fromMin(m){return pad(Math.floor(m/60))+':'+pad(m%60)}
function initials(n){var p=n.replace(/^(Dra?\.)\s*/,'').split(' ');return (p[0][0]+(p[1]?p[1][0]:'')).toUpperCase()}
function age(born){var b=pd(born),n=new Date();var a=n.getFullYear()-b.getFullYear();if(n.getMonth()<b.getMonth()||(n.getMonth()==b.getMonth()&&n.getDate()<b.getDate()))a--;return a}
function rng(seed){return function(){seed|=0;seed=seed+0x6D2B79F5|0;var t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
function nid(k){S.seq[k]=(S.seq[k]||0)+1;return S.seq[k]}
function save(){try{localStorage.setItem(KEY,JSON.stringify(S))}catch(e){}}
function load(){try{var s=localStorage.getItem(KEY);if(s){S=JSON.parse(s);if(S&&S.v===4)return true}}catch(e){}return false}

var COLORS={turquesa:'#18BFB0',coral:'#FF5D5D',sol:'#FFC23C',cielo:'#2E9BEC',uva:'#8B5CF6',rosa:'#FF7BB0'};
var METHODS={efectivo:'Efectivo',tarjeta:'Tarjeta',transferencia:'Transferencia',qr:'QR'};

/* ---------- semilla ---------- */
function seed(closedCash){
  var r=rng(1911);
  var T=TODAY;
  S={v:4,seq:{pay:0,exp:0,apt:0,bud:0,inv:0,ses:0,pat:0,cxp:0,stf:0},cajaVariant:!!closedCash};
  S.dentists=[
    {id:'d1',name:'Dra. Marta Acosta',chair:'Sillón 1',color:COLORS.turquesa,esp:'Odontología general'},
    {id:'d2',name:'Dr. Esteban Rojas',chair:'Sillón 2',color:COLORS.cielo,esp:'Endodoncia y cirugía'},
    {id:'d3',name:'Dra. Camila Duarte',chair:'Sillón 3',color:COLORS.uva,esp:'Ortodoncia'}
  ];
  S.treatments=[
    {id:'t1',name:'Consulta y diagnóstico',price:120000,iva:10,dur:30},
    {id:'t2',name:'Limpieza dental (profilaxis)',price:250000,iva:10,dur:30},
    {id:'t3',name:'Resina compuesta · 1 cara',price:280000,iva:10,dur:45},
    {id:'t4',name:'Resina compuesta · 2 caras',price:380000,iva:10,dur:60},
    {id:'t5',name:'Endodoncia unirradicular',price:900000,iva:10,dur:60},
    {id:'t6',name:'Endodoncia multirradicular',price:1400000,iva:10,dur:90},
    {id:'t7',name:'Extracción simple',price:200000,iva:10,dur:30},
    {id:'t8',name:'Extracción de tercer molar',price:600000,iva:10,dur:60},
    {id:'t9',name:'Corona de porcelana',price:1800000,iva:10,dur:60},
    {id:'t10',name:'Blanqueamiento dental',price:1100000,iva:10,dur:60},
    {id:'t11',name:'Control de ortodoncia',price:250000,iva:10,dur:30},
    {id:'t12',name:'Radiografía panorámica',price:150000,iva:10,dur:30},
    {id:'t15',name:'Implante dental',price:4500000,iva:10,dur:90},
    {id:'t13',name:'Kit de higiene bucal',price:45000,iva:5,dur:30},
    {id:'t14',name:'Atención social de jornada (exenta)',price:80000,iva:0,dur:30}
  ];
  var P=[
    ['Laura Benítez','4.321.001','0981 000 101','1990-03-14',['Alergia a la penicilina'],'es'],
    ['Mateo Benítez','5.900.114','0981 000 101','2019-06-02',['Alergia al látex'],'gn'],
    ['Carlos Ayala','3.210.552','0982 000 202','1984-09-21',['Hipertensión'],'es'],
    ['Rosa Duarte','2.987.331','0983 000 303','1971-01-30',['Diabetes tipo 2'],'gn'],
    ['Tomás Villalba','5.771.920','0984 000 404','2016-11-08',[],'gn'],
    ['Lucía Ferreira','4.665.208','0985 000 505','2001-05-17',[],'es'],
    ['Derlis Martínez','3.845.671','0986 000 606','1988-12-03',[],'es'],
    ['Sofía Ocampo','5.102.884','0981 000 707','2007-07-25',[],'es'],
    ['Néstor Samaniego','2.455.019','0982 000 808','1965-04-09',['Hipertensión','Anticoagulantes'],'es'],
    ['Valeria Franco','4.980.337','0983 000 909','1995-10-11',['Embarazo (2.º trimestre)'],'es'],
    ['Gustavo Báez','3.560.442','0984 000 010','1979-08-28',[],'gn'],
    ['Nidia Romero','2.701.866','0985 000 111','1958-02-19',['Diabetes tipo 2'],'gn'],
    ['Fabiola Cabrera','4.412.095','0986 000 212','1992-06-06',[],'es'],
    ['Rubén Cáceres','4.039.778','0981 000 313','1986-11-23',[],'es']
  ];
  S.patients=P.map(function(p,i){var o={id:'p'+(i+1),name:p[0],ci:p[1],tel:p[2],born:p[3],alerts:p[4],lang:p[5],ruc:p[1].replace(/\./g,'')+'-'+((i*3+4)%10),city:'Asunción',email:p[0].toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/ /g,'.')+'@ejemplo.com.py',family:[],note:'',marks:{},lesions:[],anam:[],sex:{'Laura': 'F', 'Mateo': 'M', 'Carlos': 'M', 'Rosa': 'F', 'Tomás': 'M', 'Lucía': 'F', 'Derlis': 'M', 'Sofía': 'F', 'Néstor': 'M', 'Valeria': 'F', 'Gustavo': 'M', 'Nidia': 'F', 'Fabiola': 'F', 'Rubén': 'M'}[p[0].split(' ')[0]]||'F'};return o});
  S.seq.pat=S.patients.length;
  S.patients[0].family=['p2'];S.patients[1].family=['p1'];
  S.patients[3].note='Pedir que llamen en 2 semanas para control. Prefiere turnos de mañana.';
  S.patients[8].note='Control de implante cada 3 meses.';
  var M=function(i,o){S.patients[i].marks=o};
  M(0,{'26':['caries'],'28':['ext'],'41':['perio'],'42':['perio'],'36':['caries'],'16':['caries']});
  M(1,{'54':['caries'],'64':['caries']});
  M(2,{'46':['caries'],'47':['caries'],'18':['ext']});
  M(3,{'11':['perio'],'21':['perio'],'36':['ext'],'27':['caries']});
  M(8,{'14':['caries'],'24':['ext'],'46':['ext'],'45':['perio']});
  M(9,{'15':['caries'],'37':['caries']});
  M(10,{'26':['caries'],'16':['ext']});
  M(11,{'31':['perio'],'41':['perio'],'48':['ext']});
  M(4,{'74':['caries']});
  M(5,{'12':['caries']});
  M(12,{'25':['caries'],'35':['caries']});

  S.patients[0].lesions=[{id:'l1',zone:'yugal_d',tipo:'Leucoplasia',mm:6,color:'Blanquecina',consist:'Placa firme, no se desprende al raspado',dolor:false,fecha:addDays(TODAY,-75),obs:'Hallazgo en control de rutina. Sin antecedente de tabaquismo. Se indica seguimiento cada 30 días.',estado:'en observación',
    evo:[{fecha:addDays(TODAY,-75),mm:6,estado:'en observación',nota:'Primer registro. Placa blanca de 6 mm en mucosa yugal derecha.'},{fecha:addDays(TODAY,-45),mm:6,estado:'en observación',nota:'Sin cambios de tamaño ni de color.'},{fecha:addDays(TODAY,-14),mm:5,estado:'en observación',nota:'Leve reducción tras eliminar irritante (borde de la 46).'}]}];
  var sig="data:image/svg+xml;utf8,"+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="100" viewBox="0 0 300 100"><path d="M20 70 C40 20 60 20 55 60 S80 90 95 50 S115 20 125 55 S150 80 170 45 Q190 30 200 60 T260 55" fill="none" stroke="#232036" stroke-width="3" stroke-linecap="round"/></svg>');
  var an1={v:1,fecha:addDays(TODAY,-75),por:'Dra. Marta Acosta',
    t:{motivo:'Dolor al masticar en el lado derecho y control general.',sintoma:'Molestia en la muela inferior derecha hace 2 semanas, más fuerte con lo frío.',ultima:'Hace 2 años',cepillado:'2 veces al día; cepillo suave y pasta con flúor',pa:'115/75',pulso:'72',peso:'64'},
    r:{desencadena:{s:1,o:['Frío','Masticar'],d:''},encias:{s:1,o:['Sangrado de encías'],d:'Al cepillar'},previos:{s:1,o:['Caries','Endodoncias'],d:'Resinas y una endodoncia'},protesis:{s:0},experiencia:{s:0},atm:{s:0},auxiliares:{s:0,o:[]},parafuncion:{s:1,o:['Bruxismo'],d:'Aprieta de noche'},sustancias:{s:1,o:['Alcohol'],d:'Ocasional'},enf:{s:0,o:[]},med:{s:0,o:[]},alerg:{s:1,o:['Penicilina'],d:'Urticaria con amoxicilina en la infancia'},cir:{s:1,d:'Cesárea (2019)'},emb:{s:0},otras:{s:0,o:[]}},firma:sig,firmante:'Laura Benítez'};
  var an2=JSON.parse(JSON.stringify(an1));an2.v=2;an2.fecha=addDays(TODAY,-12);an2.por='Lorena Fretes';an2.t.motivo='Control y plan de endodoncia + corona.';an2.t.cepillado='3 veces al día; cepillo suave y pasta con flúor';an2.t.pa='118/76';an2.t.peso='63';an2.r.auxiliares={s:1,o:['Hilo dental'],d:'Empezó a usarlo'};an2.r.encias={s:0,o:[],d:''};an2.r.med={s:1,o:['Otros medicamentos'],d:'Anticonceptivo oral'};
  S.patients[0].anam=[an1,an2];
  var did=function(){return 'd'+(1+Math.floor(r()*3))};
  /* turnos */
  S.appts=[];
  function apt(date,time,dur,pid,d,tid,st){S.appts.push({id:'a'+nid('apt'),date:date,time:time,dur:dur,pid:pid,did:d,tid:tid,status:st})}
  var A=[ // hoy
   ['08:00',30,'p3','d1','t1','atendida'],['09:00',60,'p1','d1','t6','en sala'],['10:30',30,'p4','d1','t10','confirmada'],['11:30',30,'p13','d1','t2','agendada'],['14:00',45,'p7','d1','t3','confirmada'],['15:30',30,'p10','d1','t7','agendada'],
   ['08:30',30,'p2','d2','t1','atendida'],['09:30',45,'p5','d2','t7','en sala'],['11:00',90,'p11','d2','t5','confirmada'],['14:30',60,'p12','d2','t9','agendada'],
   ['08:00',30,'p6','d3','t11','atendida'],['09:00',60,'p8','d3','t11','confirmada'],['10:30',30,'p14','d3','t11','confirmada'],['16:00',30,'p9','d3','t12','agendada']
  ];
  A.forEach(function(a){apt(T,a[0],a[1],a[2],a[3],a[4],a[5])});
  for(var off=-9;off<=9;off++){
    if(off===0)continue;var ds=addDays(T,off);if(pd(ds).getDay()===0)continue;
    ['d1','d2','d3'].forEach(function(d){
      var n=3+Math.floor(r()*2),used=[];
      for(var k=0;k<n;k++){
        var tr=S.treatments[Math.floor(r()*12)];var start=480+30*Math.floor(r()*17);
        if(start+tr.dur>1080)continue;
        var clash=used.some(function(u){return start<u[1]&&start+tr.dur>u[0]});if(clash)continue;
        used.push([start,start+tr.dur]);
        apt(ds,fromMin(start),tr.dur,'p'+(1+Math.floor(r()*14)),d,tr.id,off<0?'atendida':(r()<.6?'confirmada':'agendada'));
      }
    });
  }

  /* presupuestos */
  S.budgets=[];S.payments=[];S.expenses=[];S.invoices=[];S.sessions=[];
  function it(tid,qty){var t=S.treatments.filter(function(x){return x.id===tid})[0];return {tid:tid,name:t.name,price:t.price,qty:qty||1,iva:t.iva}}
  function bud(pid,d,items,status,date,disc){var b={id:'b'+nid('bud'),num:'P-'+(1000+S.seq.bud),pid:pid,did:d,items:items,status:status,date:date,discPct:disc||0,approvedOn:status==='aprobado'?date:null};S.budgets.push(b);return b}
  var b1=bud('p1','d1',[it('t6'),it('t9')],'aprobado',addDays(T,-12));
  var b2=bud('p3','d1',[it('t4',2),it('t2')],'aprobado',addDays(T,-40));
  var b3=bud('p4','d1',[it('t10')],'aprobado',addDays(T,-75));
  var b4=bud('p5','d2',[it('t7',2),it('t13')],'aprobado',addDays(T,-5));
  var b5=bud('p9','d2',[it('t15'),it('t12')],'aprobado',addDays(T,-100));
  bud('p8','d3',[it('t3',3),it('t2')],'borrador',addDays(T,-1));
  bud('p13','d1',[it('t5'),it('t9')],'borrador',addDays(T,-2));

  /* pagos */
  var PT=function(a,k){var s={g10:0,g5:0,ex:0};s[k]=a;return s};
  function pay(o){o.id='y'+nid('pay');o.tx=o.tx||PT(o.amount,'g10');S.payments.push(o);return o}
  function budpay(b,date,time,amount,method,did){
    var sub=0,sh={g10:0,g5:0,ex:0};b.items.forEach(function(i){var v=i.price*i.qty;sub+=v;sh[i.iva===10?'g10':i.iva===5?'g5':'ex']+=v});
    var tx={g10:Math.round(amount*sh.g10/sub),g5:Math.round(amount*sh.g5/sub),ex:Math.round(amount*sh.ex/sub)};tx.g10+=amount-tx.g10-tx.g5-tx.ex;
    return pay({date:date,time:time,pid:b.pid,bid:b.id,amount:amount,method:method,concept:'Pago a cuenta · Presupuesto '+b.num,trat:b.items[0].name,did:b.did,sid:'h',tx:tx,invId:null});
  }
  budpay(b1,addDays(T,-12),'10:05',1000000,'transferencia');
  budpay(b2,addDays(T,-39),'09:40',300000,'efectivo');
  budpay(b5,addDays(T,-98),'11:20',1500000,'tarjeta');
  budpay(b4,addDays(T,-4),'15:10',100000,'qr');
  /* pagos generales de los últimos 45 días */
  var wm=['efectivo','efectivo','efectivo','tarjeta','tarjeta','transferencia','transferencia','qr'];
  for(var o=45;o>=1;o--){
    var ds=addDays(T,-o);if(pd(ds).getDay()===0)continue;
    var n=1+(r()<.75?1:0)+(r()<.3?1:0);
    for(var k=0;k<n;k++){
      var tr=S.treatments[Math.floor(r()*12)];if(r()<.12)tr=S.treatments[12];if(r()<.05)tr=S.treatments[14];
      var pt=S.patients[Math.floor(r()*S.patients.length)];
      var key=tr.iva===10?'g10':tr.iva===5?'g5':'ex';
      pay({date:ds,time:fromMin(480+Math.floor(r()*540)).slice(0,5),pid:pt.id,bid:null,amount:tr.price,method:wm[Math.floor(r()*wm.length)],concept:tr.name,trat:tr.name,did:did(),sid:'h',tx:PT(tr.price,key),invId:null});
    }
  }
  /* pagos de hoy */
  var s1={id:'s'+nid('ses'),date:T,openedAt:'07:45',opening:500000,closedAt:null,by:'Lorena Fretes'};
  S.sessions.push(s1);
  pay({date:T,time:'08:12',pid:'p3',bid:null,amount:120000,method:'efectivo',concept:'Consulta y diagnóstico',trat:'Consulta y diagnóstico',did:'d1',sid:s1.id});
  pay({date:T,time:'08:47',pid:'p2',bid:null,amount:120000,method:'qr',concept:'Consulta y diagnóstico',trat:'Consulta y diagnóstico',did:'d2',sid:s1.id});
  pay({date:T,time:'09:05',pid:'p6',bid:null,amount:250000,method:'tarjeta',concept:'Control de ortodoncia',trat:'Control de ortodoncia',did:'d3',sid:s1.id});
  /* egresos */
  function exp(date,time,concept,cat,amount,method,iva,prov,sid){S.expenses.push({id:'e'+nid('exp'),date:date,time:time,concept:concept,cat:cat,amount:amount,method:method,iva:iva,prov:prov||'',sid:sid||'h'})}
  var m0=T.slice(0,8);var cl=function(d){return d>T?T:d};
  exp(cl(m0+'03'),'09:00','Alquiler del local · noviembre','Alquiler',3500000,'transferencia',0,'Inmobiliaria Rojas Hnos.');
  exp(cl(m0+'05'),'10:30','Sueldos del personal','Sueldos',9200000,'transferencia',0,'');
  exp(cl(m0+'10'),'11:00','Energía eléctrica','Servicios',480000,'transferencia',10,'ANDE');
  exp(cl(m0+'10'),'11:20','Internet fibra óptica','Servicios',290000,'transferencia',10,'Proveedor de internet');
  exp(addDays(T,-14),'16:15','Resinas y adhesivos','Insumos',1980000,'transferencia',10,'Dental Import S.A.');
  exp(addDays(T,-9),'12:00','Prótesis · Laboratorio','Laboratorio',1150000,'transferencia',10,'Lab Dental Sur');
  exp(addDays(T,-20),'10:10','Mantenimiento de compresor','Mantenimiento',350000,'efectivo',10,'Técnico independiente');
  exp(addDays(T,-7),'14:00','Publicidad en redes','Marketing',400000,'tarjeta',10,'');
  exp(addDays(T,-4),'09:30','Papelería y limpieza','Otros',95000,'efectivo',5,'');
  exp(T,'09:20','Compra de guantes (caja x100)','Insumos',85000,'efectivo',10,'Insumos Paraguay SRL',s1.id);

  /* facturas de pagos ya cobrados (menos hoy y 2 pendientes de ayer) */
  S.payments.forEach(function(p){
    if(p.date===T)return;
    if(p.date===addDays(T,-1)&&r()<.6)return;
    makeInvoice(p,true);
  });

  /* cuentas por pagar */
  S.payables=[
    {id:'c1',prov:'Lab Dental Sur',concept:'Prótesis y coronas (3 piezas)',amount:1250000,due:addDays(T,6),paid:false,iva:10},
    {id:'c2',prov:'Dental Import S.A.',concept:'Resinas, adhesivos y ácido grabador',amount:2480000,due:addDays(T,-3),paid:false,iva:10},
    {id:'c3',prov:'Insumos Paraguay SRL',concept:'Guantes, mascarillas y campos',amount:640000,due:addDays(T,12),paid:false,iva:10},
    {id:'c4',prov:'Radiología Digital Asunción',concept:'Placas periapicales del mes',amount:380000,due:addDays(T,2),paid:false,iva:10}
  ];
  S.seq.cxp=4;

  /* inventario */
  S.inventory=[
    {id:'i1',name:'Guantes de látex (caja x100)',cat:'Descartables',stock:2,min:6,unit:'cajas',prov:'Insumos Paraguay SRL',exp:addDays(T,420)},
    {id:'i2',name:'Resina compuesta A2 (jeringa)',cat:'Restauración',stock:14,min:8,unit:'jeringas',prov:'Dental Import S.A.',exp:addDays(T,300)},
    {id:'i3',name:'Anestesia lidocaína 2% (caja x50)',cat:'Anestesia',stock:5,min:4,unit:'cajas',prov:'Dental Import S.A.',exp:addDays(T,24)},
    {id:'i4',name:'Cemento de ionómero de vidrio',cat:'Restauración',stock:9,min:3,unit:'unidades',prov:'Dental Import S.A.',exp:addDays(T,500)},
    {id:'i5',name:'Agujas dentales cortas (caja x100)',cat:'Anestesia',stock:1,min:4,unit:'cajas',prov:'Insumos Paraguay SRL',exp:addDays(T,600)},
    {id:'i6',name:'Mascarillas descartables (caja x50)',cat:'Descartables',stock:8,min:5,unit:'cajas',prov:'Insumos Paraguay SRL',exp:addDays(T,700)},
    {id:'i7',name:'Hipoclorito de sodio 2,5%',cat:'Endodoncia',stock:3,min:2,unit:'frascos',prov:'Dental Import S.A.',exp:addDays(T,18)},
    {id:'i8',name:'Fresas diamantadas (set)',cat:'Instrumental',stock:22,min:10,unit:'sets',prov:'Dental Import S.A.',exp:''}
  ];
  S.staff=[
    {id:'f1',name:'Dra. Marta Acosta',rol:'Odontóloga',sede:'Sede Centro',hor:'Lun a vie · 08:00 a 16:00',extra:'Sillón 1',on:true},
    {id:'f2',name:'Dr. Esteban Rojas',rol:'Odontólogo',sede:'Sede Centro',hor:'Lun a sáb · 08:00 a 17:00',extra:'Sillón 2',on:true},
    {id:'f3',name:'Dra. Camila Duarte',rol:'Ortodoncista',sede:'Sede Centro',hor:'Mar, jue y sáb · 08:00 a 17:00',extra:'Sillón 3',on:true},
    {id:'f4',name:'Gloria Páez',rol:'Asistente dental',sede:'Sede Centro',hor:'Lun a vie · 07:30 a 16:30',extra:'Apoya sillón 1 y 2',on:true},
    {id:'f5',name:'Lorena Fretes',rol:'Recepción y caja',sede:'Sede Centro',hor:'Lun a sáb · 07:30 a 16:00',extra:'Agenda, pacientes y caja',on:true},
    {id:'f6',name:'Marcos Insfrán',rol:'Administración',sede:'Sede Centro',hor:'Lun a vie · 09:00 a 17:00',extra:'Contabilidad y facturación',on:true},
    {id:'f7',name:'Ivana Colmán',rol:'Asistente dental',sede:'Sede Centro',hor:'Pendiente de activar',extra:'Invitación enviada',on:false}
  ];
  /* historial de meses anteriores (ingresos / egresos en guaraníes) */
  var hist=[[21400000,17200000],[24800000,18900000],[19900000,16400000],[26300000,19800000],[23100000,18100000]];
  var d0=pd(T);S.hist=hist.map(function(h,i){var m=new Date(d0.getFullYear(),d0.getMonth()-(5-i),1);return {key:m.getFullYear()+'-'+pad(m.getMonth()+1),label:MN[m.getMonth()].slice(0,3),ing:h[0],egr:h[1]}});

  /* variante: caja cerrada con turno de mañana ya arqueado */
  if(closedCash){
    var exp0=cashExpected(s1.id);
    s1.closedAt='12:30';s1.expected=exp0;s1.counted=exp0;s1.diff=0;
  }
  save();
}

/* ---------- cálculos ---------- */
function bTotal(b){var s=0;b.items.forEach(function(i){s+=i.price*i.qty});return Math.round(s*(1-(b.discPct||0)/100))}
function bSub(b){var s=0;b.items.forEach(function(i){s+=i.price*i.qty});return s}
function bPaid(b){var s=0;S.payments.forEach(function(p){if(p.bid===b.id)s+=p.amount});return s}
function bBal(b){return b.status==='aprobado'?Math.max(0,bTotal(b)-bPaid(b)):0}
function patBal(pid){var s=0;S.budgets.forEach(function(b){if(b.pid===pid)s+=bBal(b)});return s}
function totalBal(){var s=0;S.budgets.forEach(function(b){s+=bBal(b)});return s}
function pat(id){return S.patients.filter(function(p){return p.id===id})[0]}
function den(id){return S.dentists.filter(function(p){return p.id===id})[0]}
function tre(id){return S.treatments.filter(function(p){return p.id===id})[0]}
function bud(id){return S.budgets.filter(function(p){return p.id===id})[0]}
function inv(id){return S.invoices.filter(function(p){return p.id===id})[0]}
function payById(id){return S.payments.filter(function(p){return p.id===id})[0]}
function openSes(){return S.sessions.filter(function(s){return !s.closedAt})[0]||null}
function cashExpected(sid){
  var s=S.sessions.filter(function(x){return x.id===sid})[0],t=s.opening;
  S.payments.forEach(function(p){if(p.sid===sid&&p.method==='efectivo')t+=p.amount});
  S.expenses.forEach(function(e){if(e.sid===sid&&e.method==='efectivo')t-=e.amount});
  return t;
}
function sum(arr,f){var s=0;arr.forEach(function(x){s+=f(x)});return s}
function payIn(a,b){return S.payments.filter(function(p){return p.date>=a&&p.date<=b})}
function expIn(a,b){return S.expenses.filter(function(p){return p.date>=a&&p.date<=b})}
function monthRange(key){var a=key.split('-');var last=new Date(+a[0],+a[1],0).getDate();return [key+'-01',key+'-'+pad(last)]}
function curMonth(){return TODAY.slice(0,7)}
function iva10(g){return Math.round(g/11)}
function iva5(g){return Math.round(g/21)}
function aging(days){return days<=30?0:days<=60?1:days<=90?2:3}
var AGE_LB=['0 a 30 días','31 a 60 días','61 a 90 días','+ de 90 días'];
var AGE_CH=['c-t','c-s','c-c','c-c'];

/* ---------- facturación ---------- */
function digits(seedStr,n){var h=0;for(var i=0;i<seedStr.length;i++)h=(h*31+seedStr.charCodeAt(i))|0;var r=rng(h);var o='';for(var k=0;k<n;k++)o+=Math.floor(r()*10);return o}
function makeInvoice(p,approved){
  var n=nid('inv');
  var f={id:'f'+n,num:'001-001-'+String(411+n).padStart(7,'0'),pid:p.pid,payId:p.id,date:p.date,time:p.time,total:p.amount,tx:p.tx,concept:p.concept,
    cdc:digits('cdc'+n+p.id,44),status:approved?'aprobada':'enviando',cond:'Contado'};
  S.invoices.push(f);p.invId=f.id;return f;
}
function qrSvg(seedStr,size){
  var N=25,h=0;for(var i=0;i<seedStr.length;i++)h=(h*33+seedStr.charCodeAt(i))|0;var r=rng(h),c=size/N,o='';
  var fin=function(x,y){return (x<7&&y<7)||(x>=N-7&&y<7)||(x<7&&y>=N-7)};
  for(var y=0;y<N;y++)for(var x=0;x<N;x++){
    var on;
    if(fin(x,y)){var lx=x%(N-7>x?7:1);var ax=x<7?x:x-(N-7),ay=y<7?y:y-(N-7);on=(ax===0||ax===6||ay===0||ay===6)||(ax>=2&&ax<=4&&ay>=2&&ay<=4)}
    else on=r()<.5;
    if(on)o+='<rect x="'+(x*c).toFixed(1)+'" y="'+(y*c).toFixed(1)+'" width="'+(c+.3).toFixed(1)+'" height="'+(c+.3).toFixed(1)+'"/>';
  }
  return '<svg viewBox="0 0 '+size+' '+size+'" width="'+size+'" height="'+size+'" fill="#232036" role="img" aria-label="Código QR de demostración">'+o+'</svg>';
}

if(!load())seed(false);
