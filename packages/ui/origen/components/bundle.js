/* @ds-bundle: {"format":4,"namespace":"Conecta","components":[{"name":"Boton"},{"name":"MenuExportar"},{"name":"BarraLateral"},{"name":"BarraSuperior"},{"name":"BarraInferior"},{"name":"SelectorIdioma"},{"name":"Buscador"},{"name":"TarjetaPaciente"},{"name":"Avatar"},{"name":"Chip"},{"name":"AlertaClinica"},{"name":"AvisoExito"},{"name":"AvisoConexion"},{"name":"EstadoVacio"},{"name":"Campo"},{"name":"HojaInferior"},{"name":"TablaLista"},{"name":"TarjetaMetrica"},{"name":"GraficoBarras"},{"name":"LeyendaOdontograma"},{"name":"MarcoVisor3D"},{"name":"PieMaqueta"},{"name":"Icono"}]} */
(function () {
  "use strict";
  var R = window.React;
  var h = R.createElement;
  var useState = R.useState;
  var useEffect = R.useEffect;
  var useId = R.useId;

  function cx() {
    return Array.prototype.filter.call(arguments, Boolean).join(" ");
  }
  function omit(obj, keys) {
    var out = {};
    for (var k in obj) if (Object.prototype.hasOwnProperty.call(obj, k) && keys.indexOf(k) < 0) out[k] = obj[k];
    return out;
  }
  function hash(s) {
    var n = 0;
    for (var i = 0; i < s.length; i++) n = (n * 31 + s.charCodeAt(i)) >>> 0;
    return n;
  }

  /* ---------- Íconos: trazo 2px, puntas redondeadas, caja 24 ---------- */
  function P(d) { return ["path", { d: d }]; }
  function C(x, y, r, fill) { return ["circle", { cx: x, cy: y, r: r, fill: fill ? "currentColor" : "none" }]; }
  function Q(x, y, w, hh, rx) { return ["rect", { x: x, y: y, width: w, height: hh, rx: rx }]; }

  var ICONOS = {
    inicio: [P("M4 11.5 12 5l8 6.5"), P("M6 10v9.5h12V10"), P("M10 19.5v-5h4v5")],
    agenda: [Q(3, 5, 18, 16, 3), P("M3 10h18"), P("M8 3v4"), P("M16 3v4")],
    pacientes: [C(9, 8, 3.5), P("M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"), C(17, 9, 2.5), P("M17.5 14c2 .3 3.5 2 3.5 4.2")],
    caja: [Q(3, 6, 18, 14, 3), P("M3 10.5h18"), P("M15.5 15h2.5")],
    odontologia: [P("M12 6.2C10.6 4.8 9.1 4 7.6 4 5.1 4 3.5 6 3.5 8.6c0 2 .8 3.5 1.3 5.2.6 2 .9 6.2 2.7 6.2 1.8 0 1.8-4.6 4.5-4.6s2.7 4.6 4.5 4.6c1.8 0 2.1-4.2 2.7-6.2.5-1.7 1.3-3.2 1.3-5.2C20.5 6 18.9 4 16.4 4c-1.5 0-3 .8-4.4 2.2z")],
    personal: [Q(4, 3, 16, 18, 3), C(12, 10, 2.5), P("M8 17c.6-1.8 2.2-3 4-3s3.4 1.2 4 3")],
    inventario: [P("M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5z"), P("M3.5 7.5 12 12l8.5-4.5"), P("M12 12v9")],
    comunitaria: [P("M12 20s-7.5-4.4-7.5-10.2A4.1 4.1 0 0 1 12 7.4a4.1 4.1 0 0 1 7.5 2.4C19.5 15.6 12 20 12 20z")],
    estadisticas: [P("M4 20h16"), P("M7 16v-5"), P("M12 16V6"), P("M17 16v-8")],
    buscar: [C(11, 11, 6.5), P("M20 20l-4.3-4.3")],
    campana: [P("M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15z"), P("M10 20.5a2 2 0 0 0 4 0")],
    mas: [P("M12 5v14"), P("M5 12h14")],
    "menu-mas": [C(5, 12, 1.4, true), C(12, 12, 1.4, true), C(19, 12, 1.4, true)],
    check: [P("M5 12.5l4.5 4.5L19 7.5")],
    cerrar: [P("M6 6l12 12"), P("M18 6L6 18")],
    alerta: [P("M10.3 4.9 3 17.5A2 2 0 0 0 4.7 20.5h14.6a2 2 0 0 0 1.7-3L13.7 4.9a2 2 0 0 0-3.4 0z"), P("M12 9.5v4.5"), P("M12 17.2v.1")],
    info: [C(12, 12, 9), P("M12 11v5.5"), P("M12 7.8v.1")],
    exportar: [P("M12 4v11"), P("M7.5 10.5 12 15l4.5-4.5"), P("M5 19.5h14")],
    candado: [Q(5, 10.5, 14, 10, 2.5), P("M8 10.5V8a4 4 0 0 1 8 0v2.5")],
    "sin-conexion": [P("M3 3l18 18"), P("M8.5 16.3a5 5 0 0 1 5.6-.9"), P("M5 12.8a10 10 0 0 1 4-2.4"), P("M14.6 10.3a10 10 0 0 1 4.4 2.5"), P("M2 9.3a15 15 0 0 1 4.2-2.7"), P("M10.5 5.6A15 15 0 0 1 22 9.3"), C(12, 19.8, 1, true)],
    idioma: [C(12, 12, 9), P("M3 12h18"), P("M12 3c2.4 2.6 3.6 5.6 3.6 9s-1.2 6.4-3.6 9c-2.4-2.6-3.6-5.6-3.6-9S9.6 5.6 12 3z")],
    chevron: [P("M9 6l6 6-6 6")],
    "chevron-abajo": [P("M6 9l6 6 6-6")],
    telefono: [P("M5 4h3.5L10 8l-2 1.5a11 11 0 0 0 6.5 6.5l1.5-2 4 1.5V19a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z")],
    mensaje: [P("M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v9a1.5 1.5 0 0 1-1.5 1.5H9l-5 4z")],
    reloj: [C(12, 12, 9), P("M12 7v5l3.5 2")],
    ojo: [P("M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"), C(12, 12, 3)],
    "ojo-cerrado": [P("M3 3l18 18"), P("M10.6 6A9.9 9.9 0 0 1 12 5.5C18 5.5 21.5 12 21.5 12a17 17 0 0 1-2.7 3.5"), P("M6.5 7.2C4 9 2.5 12 2.5 12S6 18.5 12 18.5c1.6 0 3-.4 4.2-1.1"), P("M9.9 10a3 3 0 0 0 4.1 4.1")],
    imprimir: [P("M7 9V4h10v5"), Q(3.5, 9, 17, 8, 2), P("M7 14h10v6H7z")],
    archivo: [P("M6 3h8l4 4v14H6z"), P("M14 3v4h4")],
    familia: [C(8, 7, 2.5), C(16, 7, 2.5), C(12, 14, 2), P("M3.5 20c0-3 2-5 4.5-5"), P("M20.5 20c0-3-2-5-4.5-5"), P("M9 21c0-1.7 1.3-3 3-3s3 1.3 3 3")],
    sube: [P("M4 16l5-5 4 4 7-7"), P("M15 8h5v5")],
    baja: [P("M4 8l5 5 4-4 7 7"), P("M15 16h5v-5")],
    sincronizar: [P("M20 11a8 8 0 0 0-14.3-4.3L4 8.5"), P("M4 4v4.5h4.5"), P("M4 13a8 8 0 0 0 14.3 4.3L20 15.5"), P("M20 20v-4.5h-4.5")],
    sede: [P("M4 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16"), P("M16 9h2a2 2 0 0 1 2 2v10"), P("M3 21h18"), P("M8 7h4"), P("M8 11h4"), P("M8 15h4")],
    tabla: [Q(3, 4, 18, 16, 2.5), P("M3 9.5h18"), P("M3 14.5h18"), P("M9.5 9.5V20")]
  };

  function Icono(p) {
    var forma = ICONOS[p.nombre] || ICONOS.info;
    var s = p.tamano || 24;
    return h(
      "svg",
      {
        className: cx("cn-icono", p.className),
        width: s, height: s, viewBox: "0 0 24 24",
        fill: "none", stroke: "currentColor", strokeWidth: 2,
        strokeLinecap: "round", strokeLinejoin: "round",
        focusable: "false",
        role: p.titulo ? "img" : undefined,
        "aria-label": p.titulo || undefined,
        "aria-hidden": p.titulo ? undefined : true
      },
      forma.map(function (e, i) { return h(e[0], Object.assign({ key: i }, e[1])); })
    );
  }
  Icono.nombres = Object.keys(ICONOS);

  /* ---------- Acciones ---------- */
  function Giro() { return h("span", { className: "cn-giro", "aria-hidden": true }); }

  function Boton(p) {
    var variante = p.variante || "secundario";
    var tamano = p.tamano || "md";
    var resto = omit(p, ["variante", "tamano", "icono", "iconoFinal", "cargando", "bloque", "className", "children"]);
    return h(
      "button",
      Object.assign({ type: "button" }, resto, {
        className: cx("cn-boton", "cn-boton--" + variante, "cn-boton--" + tamano, p.bloque && "cn-boton--bloque", !p.children && "cn-boton--icono", p.className),
        disabled: p.disabled || p.cargando,
        "aria-busy": p.cargando || undefined
      }),
      p.cargando ? h(Giro) : p.icono ? h(Icono, { nombre: p.icono, tamano: 20 }) : null,
      p.children != null ? h("span", null, p.children) : null,
      p.iconoFinal && !p.cargando ? h(Icono, { nombre: p.iconoFinal, tamano: 20 }) : null
    );
  }

  var FORMATOS = [
    { id: "pdf", nombre: "PDF", icono: "archivo" },
    { id: "excel", nombre: "Excel / CSV", icono: "tabla" },
    { id: "imprimir", nombre: "Imprimir", icono: "imprimir" }
  ];

  function MenuExportar(p) {
    var a = useState(!!p.abierto);
    var abierto = a[0], setAbierto = a[1];
    var id = useId();
    var estado = p.estado || "inactivo";
    useEffect(function () {
      if (!abierto) return;
      function tecla(e) { if (e.key === "Escape") setAbierto(false); }
      document.addEventListener("keydown", tecla);
      return function () { document.removeEventListener("keydown", tecla); };
    }, [abierto]);
    return h(
      "div",
      { className: cx("cn-exportar", p.className) },
      h(Boton, {
        variante: "secundario",
        icono: estado === "preparando" ? null : "exportar",
        cargando: estado === "preparando",
        "aria-haspopup": "menu", "aria-expanded": abierto, "aria-controls": id,
        "aria-label": p.soloIcono ? "Exportar" : undefined,
        onClick: function () { setAbierto(!abierto); }
      }, p.soloIcono ? null : "Exportar"),
      abierto && h(
        "ul",
        { id: id, role: "menu", className: "cn-menu" },
        FORMATOS.map(function (f) {
          return h("li", { key: f.id, role: "none" },
            h("button", {
              type: "button", role: "menuitem", className: "cn-menu__item",
              onClick: function () { setAbierto(false); if (p.onElegir) p.onElegir(f.id); }
            }, h(Icono, { nombre: f.icono, tamano: 20 }), f.nombre));
        })
      ),
      estado !== "inactivo" && h(
        "p",
        { className: cx("cn-exportar__estado", "cn-exportar__estado--" + estado), role: "status" },
        estado === "preparando" ? h(Giro) : h(Icono, { nombre: estado === "error" ? "alerta" : "check", tamano: 18 }),
        estado === "preparando" ? "Preparando archivo…" : estado === "error" ? "No se pudo preparar. Probá de nuevo." : "Listo · ya podés descargarlo"
      )
    );
  }

  /* ---------- Navegación ---------- */
  var MODULOS = [
    { id: "inicio", nombre: "Inicio", icono: "inicio" },
    { id: "pacientes", nombre: "Pacientes", icono: "pacientes" },
    { id: "odontologia", nombre: "Odontología", icono: "odontologia" },
    { id: "agenda", nombre: "Agenda", icono: "agenda" },
    { id: "caja", nombre: "Caja", icono: "caja" },
    { id: "personal", nombre: "Personal", icono: "personal" },
    { id: "inventario", nombre: "Inventario", icono: "inventario" },
    { id: "comunitaria", nombre: "Sonrisa Comunitaria", icono: "comunitaria" },
    { id: "estadisticas", nombre: "Estadísticas", icono: "estadisticas" }
  ];
  var DESTINOS_MOVIL = ["inicio", "agenda", "pacientes", "caja"];

  function Marca(p) {
    if (p.logo) return h("div", { className: "cn-marca" }, p.logo);
    return h("div", { className: "cn-marca" },
      h("span", { className: "cn-marca__sobre" }, "Sonrisa Para Todos"),
      h("span", { className: "cn-marca__nombre" }, "Conecta"));
  }

  function BarraLateral(p) {
    var visibles = p.modulos || MODULOS.map(function (m) { return m.id; });
    return h(
      "nav",
      { className: cx("cn-lateral", p.className), "aria-label": "Módulos" },
      h(Marca, { logo: p.logo }),
      h("ul", { className: "cn-lateral__lista" },
        MODULOS.filter(function (m) { return visibles.indexOf(m.id) >= 0; }).map(function (m) {
          var activo = p.activo === m.id;
          return h("li", { key: m.id },
            h("a", {
              href: p.rutas ? p.rutas[m.id] : "#" + m.id,
              className: cx("cn-lateral__item", activo && "is-activo"),
              "aria-current": activo ? "page" : undefined,
              onClick: p.onNavegar ? function (e) { e.preventDefault(); p.onNavegar(m.id); } : undefined
            }, h(Icono, { nombre: m.icono, tamano: 22 }), h("span", null, m.nombre)));
        })),
      h("p", { className: "cn-lateral__pie" }, p.pie || "Un proyecto de Sonrisa Para Todos")
    );
  }

  function SelectorIdioma(p) {
    var s = useState(p.valor || "es");
    var valor = p.valor || s[0];
    function elegir(v) { s[1](v); if (p.onCambio) p.onCambio(v); }
    var opciones = [
      { id: "es", corto: "ES", largo: "Español" },
      { id: "gn", corto: "GN", largo: "Guaraní" }
    ];
    return h("div", { className: cx("cn-segmento", "cn-idioma", p.className), role: "radiogroup", "aria-label": "Idioma de la interfaz" },
      opciones.map(function (o) {
        var activo = valor === o.id;
        return h("button", {
          key: o.id, type: "button", role: "radio", "aria-checked": activo,
          "aria-label": o.largo, title: o.largo,
          className: cx("cn-segmento__opcion", activo && "is-activo"),
          onClick: function () { elegir(o.id); }
        }, o.corto);
      }));
  }

  function BarraSuperior(p) {
    return h(
      "header",
      { className: cx("cn-superior", p.className) },
      p.conMarca && h(Marca, { logo: p.logo }),
      h(Buscador, { compacto: true, resultados: p.resultados, onElegir: p.onElegirPaciente }),
      h("div", { className: "cn-superior__acciones" },
        h(SelectorIdioma, { valor: p.idioma, onCambio: p.onIdioma }),
        p.sede && h("button", { type: "button", className: "cn-superior__sede", "aria-label": "Sede: " + p.sede },
          h(Icono, { nombre: "sede", tamano: 20 }), h("span", null, p.sede), h(Icono, { nombre: "chevron-abajo", tamano: 18 })),
        h("button", {
          type: "button", className: "cn-superior__campana",
          "aria-label": p.notificaciones ? "Notificaciones: " + p.notificaciones + " sin leer" : "Notificaciones"
        }, h(Icono, { nombre: "campana", tamano: 22 }), p.notificaciones ? h("span", { className: "cn-punto", "aria-hidden": true }, p.notificaciones) : null),
        p.usuario && h("button", { type: "button", className: "cn-superior__perfil", "aria-label": "Perfil de " + p.usuario.nombre },
          h(Avatar, { nombre: p.usuario.nombre, tamano: "sm", decorativo: true }),
          h("span", { className: "cn-superior__perfil-texto" },
            h("span", { className: "cn-superior__perfil-nombre" }, p.usuario.nombre),
            p.usuario.rol && h("span", { className: "cn-superior__perfil-rol" }, p.usuario.rol))))
    );
  }

  function BarraInferior(p) {
    var items = DESTINOS_MOVIL.map(function (id) { return MODULOS.filter(function (m) { return m.id === id; })[0]; })
      .concat([{ id: "mas", nombre: "Más", icono: "menu-mas" }]);
    return h(
      "nav",
      { className: cx("cn-inferior", p.fija && "cn-inferior--fija", p.className), "aria-label": "Navegación principal" },
      h("ul", null, items.map(function (m) {
        var activo = p.activo === m.id;
        return h("li", { key: m.id },
          h("a", {
            href: p.rutas ? p.rutas[m.id] : "#" + m.id,
            className: cx("cn-inferior__item", activo && "is-activo"),
            "aria-current": activo ? "page" : undefined,
            onClick: p.onNavegar ? function (e) { e.preventDefault(); p.onNavegar(m.id); } : undefined
          }, h("span", { className: "cn-inferior__icono" }, h(Icono, { nombre: m.icono, tamano: 24 })), h("span", null, m.nombre)));
      }))
    );
  }

  /* ---------- Pacientes ---------- */
  var TONOS_AVATAR = ["turquesa", "cielo", "uva", "rosa", "sol", "coral"];
  function iniciales(n) {
    return (n || "?").replace(/^Dra?\.\s*/, "").split(/\s+/).filter(Boolean).slice(0, 2)
      .map(function (s) { return s.charAt(0); }).join("").toUpperCase();
  }
  function Avatar(p) {
    var n = p.nombre || "";
    var tono = p.tono || TONOS_AVATAR[hash(n) % TONOS_AVATAR.length];
    return h("span", {
      className: cx("cn-avatar", "cn-avatar--" + tono, "cn-avatar--" + (p.tamano || "md"), p.className),
      role: p.decorativo ? undefined : "img",
      "aria-label": p.decorativo ? undefined : n,
      "aria-hidden": p.decorativo ? true : undefined
    }, iniciales(n));
  }

  function Buscador(p) {
    var id = useId();
    var s = useState(p.valorInicial || "");
    var valor = p.valor != null ? p.valor : s[0];
    function cambio(e) { s[1](e.target.value); if (p.onCambio) p.onCambio(e.target.value); }
    var q = valor.trim().toLowerCase();
    var res = p.resultados;
    if (res && p.valor == null) {
      res = res.filter(function (r) {
        return (r.nombre + " " + (r.documento || "") + " " + (r.telefono || "")).toLowerCase().indexOf(q) >= 0;
      });
    }
    var abierto = q.length > 0 && !!res;
    return h(
      "div",
      { className: cx("cn-buscador", p.compacto && "cn-buscador--compacto", p.className), role: "search" },
      h("label", { htmlFor: id, className: "cn-oculto" }, p.etiqueta || "Buscar paciente"),
      h(Icono, { nombre: "buscar", tamano: 20, className: "cn-buscador__icono" }),
      h("input", {
        id: id, type: "search", className: "cn-buscador__campo", value: valor, onChange: cambio,
        placeholder: p.placeholder || "Buscar paciente: nombre, CI o teléfono", autoComplete: "off"
      }),
      abierto && h("div", { className: "cn-buscador__resultados" },
        res.length
          ? h("ul", null, res.map(function (r, i) {
            return h("li", { key: i },
              h("button", { type: "button", className: "cn-buscador__item", onClick: function () { if (p.onElegir) p.onElegir(r); } },
                h(Avatar, { nombre: r.nombre, tamano: "sm", decorativo: true }),
                h("span", { className: "cn-buscador__texto" },
                  h("span", { className: "cn-buscador__nombre" }, r.nombre),
                  h("span", { className: "cn-buscador__meta" }, [r.documento, r.telefono].filter(Boolean).join(" · "))),
                r.alerta ? h(Chip, { tono: "atencion" }, r.alerta) : null));
          }))
          : h("p", { className: "cn-buscador__vacio" }, "Sin resultados para «" + valor + "». Revisá cómo está escrito o buscá por CI."))
    );
  }

  function TarjetaPaciente(p) {
    var meta = [p.edad != null ? p.edad + " años" : null, p.telefono].filter(Boolean).join(" · ");
    return h(
      "article",
      { className: cx("cn-tarjeta-paciente", p.desactivado && "is-desactivado", p.className) },
      h("button", { type: "button", className: "cn-tarjeta-paciente__boton", onClick: p.onAbrir },
        h(Avatar, { nombre: p.nombre, decorativo: true }),
        h("span", { className: "cn-tarjeta-paciente__cuerpo" },
          h("span", { className: "cn-tarjeta-paciente__nombre" }, p.nombre),
          meta && h("span", { className: "cn-tarjeta-paciente__meta" }, meta),
          p.proximoTurno && h("span", { className: "cn-tarjeta-paciente__turno" },
            h(Icono, { nombre: "agenda", tamano: 16 }), "Próximo turno: " + p.proximoTurno),
          p.chips && p.chips.length ? h("span", { className: "cn-tarjeta-paciente__chips" },
            p.chips.map(function (c, i) { return h(Chip, { key: i, tono: c.tono, icono: c.icono }, c.texto); })) : null),
        h(Icono, { nombre: "chevron", tamano: 20, className: "cn-tarjeta-paciente__flecha" }))
    );
  }

  /* ---------- Estado ---------- */
  var ICONO_TONO = { exito: "check", atencion: "alerta", progreso: "reloj", info: "info", categoria: null, familia: "familia", neutro: null };

  function Chip(p) {
    var tono = p.tono || "neutro";
    var icono = p.icono === undefined ? ICONO_TONO[tono] : p.icono;
    return h("span", { className: cx("cn-chip", "cn-chip--" + tono, p.className) },
      icono ? h(Icono, { nombre: icono, tamano: 16 }) : null,
      h("span", null, p.children));
  }

  function AlertaClinica(p) {
    var alertas = p.alertas || [];
    if (!alertas.length) {
      return h("div", { className: cx("cn-alertas", "cn-alertas--vacia", p.className) },
        h(Icono, { nombre: "check", tamano: 18 }), h("span", null, "Sin alertas clínicas registradas"));
    }
    return h(
      "section",
      { className: cx("cn-alertas", p.compacta && "cn-alertas--compacta", p.className), "aria-label": "Alertas clínicas" },
      p.compacta ? null : h("span", { className: "cn-alertas__titulo" }, "Alertas clínicas"),
      h("ul", { className: "cn-alertas__lista" }, alertas.map(function (a, i) {
        var tipo = a.tipo === "alergia" ? "alergia" : "condicion";
        return h("li", { key: i, className: "cn-alerta cn-alerta--" + tipo },
          h(Icono, { nombre: tipo === "alergia" ? "alerta" : "info", tamano: 18 }),
          h("span", null, a.texto));
      }))
    );
  }

  function AvisoExito(p) {
    return h(
      "div",
      { className: cx("cn-aviso", p.flotante && "cn-aviso--flotante", p.className), role: "status" },
      h("span", { className: "cn-aviso__sello", "aria-hidden": true }, h(Icono, { nombre: "check", tamano: 22 })),
      h("div", { className: "cn-aviso__cuerpo" },
        h("p", { className: "cn-aviso__titulo" }, p.titulo),
        p.texto && h("p", { className: "cn-aviso__texto" }, p.texto),
        p.accion && h("div", { className: "cn-aviso__accion" }, p.accion)),
      p.onCerrar && h("button", { type: "button", className: "cn-aviso__cerrar", "aria-label": "Cerrar aviso", onClick: p.onCerrar },
        h(Icono, { nombre: "cerrar", tamano: 20 }))
    );
  }

  var CONEXION = {
    "sin-conexion": { icono: "sin-conexion", texto: "Sin conexión · se guardará y sincronizará" },
    sincronizando: { icono: "sincronizar", texto: "Sincronizando…" },
    sincronizado: { icono: "check", texto: "Sincronizado" }
  };
  function AvisoConexion(p) {
    var e = p.estado || "sin-conexion";
    var d = CONEXION[e];
    return h("p", { className: cx("cn-conexion", "cn-conexion--" + e, p.className), role: "status" },
      h(Icono, { nombre: d.icono, tamano: 20 }),
      h("span", null, d.texto),
      p.pendientes ? h("span", { className: "cn-conexion__cuenta" }, p.pendientes + (p.pendientes === 1 ? " registro pendiente" : " registros pendientes")) : null);
  }

  function IlustracionVacia() {
    return h("svg", { className: "cn-vacio__ilustracion", viewBox: "0 0 120 120", width: 120, height: 120, "aria-hidden": true, focusable: "false" },
      h("circle", { cx: 60, cy: 60, r: 56, className: "cn-vacio__fondo" }),
      h("path", {
        className: "cn-vacio__diente",
        d: "M60 39c-5-4.7-10.2-7-15.4-7C36 32 30.5 38.8 30.5 47.6c0 6.9 2.8 12 4.5 17.8 2 6.9 3 21.3 9.3 21.3 6.2 0 6.2-15.8 15.7-15.8s9.5 15.8 15.7 15.8c6.3 0 7.3-14.4 9.3-21.3 1.7-5.8 4.5-10.9 4.5-17.8C89.5 38.8 84 32 75.4 32c-5.2 0-10.4 2.3-15.4 7z"
      }),
      h("path", { className: "cn-vacio__sonrisa", d: "M50 55c5.5 5 14.5 5 20 0" }));
  }
  function EstadoVacio(p) {
    return h("div", { className: cx("cn-vacio", p.className) },
      p.ilustracion === false ? null : (p.ilustracion || h(IlustracionVacia)),
      h("p", { className: "cn-vacio__titulo" }, p.titulo),
      p.texto && h("p", { className: "cn-vacio__texto" }, p.texto),
      p.accion && h("div", { className: "cn-vacio__accion" }, p.accion));
  }

  /* ---------- Formularios ---------- */
  function Campo(p) {
    var id = useId();
    var ver = useState(false);
    var tipo = p.tipo || "text";
    var idAyuda = id + "-ayuda", idError = id + "-error";
    var describe = [p.ayuda && idAyuda, p.error && idError].filter(Boolean).join(" ") || undefined;
    var resto = omit(p, ["etiqueta", "ayuda", "error", "requerido", "tipo", "opciones", "className", "id"]);
    var comunes = Object.assign({}, resto, {
      id: id, className: "cn-campo__control", required: p.requerido || undefined,
      "aria-invalid": p.error ? true : undefined, "aria-describedby": describe
    });
    var control;
    if (tipo === "select") {
      control = h("div", { className: "cn-campo__select" },
        h("select", comunes, (p.opciones || []).map(function (o) {
          var v = typeof o === "string" ? o : o.valor;
          return h("option", { key: v, value: v }, typeof o === "string" ? o : o.texto);
        })),
        h(Icono, { nombre: "chevron-abajo", tamano: 20, className: "cn-campo__flecha" }));
    } else if (tipo === "textarea") {
      control = h("textarea", Object.assign(comunes, { rows: p.rows || 3 }));
    } else if (tipo === "password") {
      control = h("div", { className: "cn-campo__clave" },
        h("input", Object.assign(comunes, { type: ver[0] ? "text" : "password" })),
        h("button", {
          type: "button", className: "cn-campo__ver", "aria-pressed": ver[0],
          "aria-label": ver[0] ? "Ocultar contraseña" : "Mostrar contraseña",
          onClick: function () { ver[1](!ver[0]); }
        }, h(Icono, { nombre: ver[0] ? "ojo-cerrado" : "ojo", tamano: 20 })));
    } else {
      control = h("input", Object.assign(comunes, { type: tipo }));
    }
    return h("div", { className: cx("cn-campo", p.error && "is-error", p.className) },
      h("label", { htmlFor: id, className: "cn-campo__etiqueta" }, p.etiqueta,
        p.requerido ? h("span", { className: "cn-campo__requerido" }, " · obligatorio") : null),
      control,
      p.ayuda && !p.error ? h("p", { id: idAyuda, className: "cn-campo__ayuda" }, p.ayuda) : null,
      p.error ? h("p", { id: idError, className: "cn-campo__error" }, h(Icono, { nombre: "alerta", tamano: 18 }), h("span", null, p.error)) : null);
  }

  /* ---------- Contenedores ---------- */
  function HojaInferior(p) {
    var id = useId();
    useEffect(function () {
      if (!p.abierta || !p.onCerrar) return;
      function tecla(e) { if (e.key === "Escape") p.onCerrar(); }
      document.addEventListener("keydown", tecla);
      return function () { document.removeEventListener("keydown", tecla); };
    }, [p.abierta, p.onCerrar]);
    if (!p.abierta) return null;
    var hoja = h("div", {
      className: cx("cn-hoja", p.className), role: "dialog", "aria-modal": p.enLinea ? undefined : true, "aria-labelledby": id
    },
      h("span", { className: "cn-hoja__asa", "aria-hidden": true }),
      h("div", { className: "cn-hoja__cabecera" },
        h("h2", { id: id, className: "cn-hoja__titulo" }, p.titulo),
        p.onCerrar && h("button", { type: "button", className: "cn-hoja__cerrar", "aria-label": "Cerrar", onClick: p.onCerrar },
          h(Icono, { nombre: "cerrar", tamano: 22 }))),
      h("div", { className: "cn-hoja__cuerpo" }, p.children),
      p.acciones && h("div", { className: "cn-hoja__acciones" }, p.acciones));
    return h("div", {
      className: cx("cn-hoja-fondo", p.enLinea && "cn-hoja-fondo--en-linea"),
      onClick: function (e) { if (e.target === e.currentTarget && p.onCerrar) p.onCerrar(); }
    }, hoja);
  }

  function TablaLista(p) {
    var cols = p.columnas || [];
    var filas = p.filas || [];
    function celda(c, f) { return c.render ? c.render(f) : f[c.clave]; }
    var principal = cols[0];
    return h("div", { className: cx("cn-tabla", p.className) },
      h("table", { className: "cn-tabla__tabla" },
        p.titulo && h("caption", { className: "cn-oculto" }, p.titulo),
        h("thead", null, h("tr", null, cols.map(function (c) {
          return h("th", { key: c.clave, scope: "col", className: c.alinear === "fin" ? "is-fin" : undefined }, c.titulo);
        }))),
        h("tbody", null, filas.map(function (f, i) {
          return h("tr", { key: f.id || i }, cols.map(function (c, j) {
            return h(j === 0 ? "th" : "td", { key: c.clave, scope: j === 0 ? "row" : undefined, className: c.alinear === "fin" ? "is-fin" : undefined }, celda(c, f));
          }));
        }))),
      h("ul", { className: "cn-tabla__tarjetas", "aria-label": p.titulo }, filas.map(function (f, i) {
        return h("li", { key: f.id || i, className: "cn-tabla__tarjeta" },
          h("p", { className: "cn-tabla__principal" }, celda(principal, f)),
          h("dl", null, cols.slice(1).map(function (c) {
            return h("div", { key: c.clave, className: "cn-tabla__par" }, h("dt", null, c.titulo), h("dd", null, celda(c, f)));
          })));
      })));
  }

  /* ---------- Datos ---------- */
  function TarjetaMetrica(p) {
    var t = p.tendencia || "igual";
    return h("div", { className: cx("cn-metrica", p.className) },
      h("p", { className: "cn-metrica__etiqueta" }, p.icono ? h(Icono, { nombre: p.icono, tamano: 20 }) : null, p.etiqueta),
      h("p", { className: "cn-metrica__valor" }, p.valor),
      p.cambio && h("p", { className: cx("cn-metrica__cambio", "cn-metrica__cambio--" + (p.tono || "neutro")) },
        t !== "igual" ? h(Icono, { nombre: t === "sube" ? "sube" : "baja", tamano: 18 }) : null,
        h("span", null, p.cambio), p.nota ? h("span", { className: "cn-metrica__nota" }, " " + p.nota) : null));
  }

  function GraficoBarras(p) {
    var s = useState(false);
    var tabla = s[0];
    var datos = p.datos || [];
    var max = p.maximo || Math.max.apply(null, datos.map(function (d) { return d.valor; }).concat([1]));
    var fmt = p.formato || function (v) { return String(v); };
    return h("figure", { className: cx("cn-grafico", p.className) },
      h("figcaption", { className: "cn-grafico__cabecera" },
        h("span", { className: "cn-grafico__titulo" }, p.titulo),
        h("button", { type: "button", className: "cn-grafico__alternar", "aria-pressed": tabla, onClick: function () { s[1](!tabla); } },
          h(Icono, { nombre: tabla ? "estadisticas" : "tabla", tamano: 18 }), tabla ? "Ver gráfico" : "Ver como tabla")),
      tabla
        ? h("table", { className: "cn-grafico__tabla" },
          h("thead", null, h("tr", null, h("th", { scope: "col" }, p.columnaEtiqueta || "Dato"), h("th", { scope: "col", className: "is-fin" }, p.columnaValor || "Valor"))),
          h("tbody", null, datos.map(function (d, i) {
            return h("tr", { key: i }, h("th", { scope: "row" }, d.etiqueta), h("td", { className: "is-fin" }, fmt(d.valor)));
          })))
        : h("ul", { className: "cn-grafico__barras" }, datos.map(function (d, i) {
          var pct = Math.max(2, Math.round((d.valor / max) * 100));
          return h("li", { key: i, className: "cn-grafico__fila" },
            h("span", { className: "cn-grafico__etiqueta" }, d.etiqueta),
            h("span", { className: "cn-grafico__pista", "aria-hidden": true },
              h("span", { className: "cn-grafico__barra cn-grafico__barra--" + (d.tono || p.tono || "turquesa"), style: { width: pct + "%" } })),
            h("span", { className: "cn-grafico__valor" }, fmt(d.valor)),
            d.nota ? h(Chip, { tono: d.notaTono || "atencion" }, d.nota) : null);
        })),
      p.pie && h("p", { className: "cn-grafico__pie" }, p.pie));
  }

  /* ---------- Odontología ---------- */
  var MARCAS = [
    { id: "caries", nombre: "Caries" },
    { id: "extraccion", nombre: "Extracción" },
    { id: "periodontal", nombre: "Periodontal" },
    { id: "sano", nombre: "Sano" }
  ];
  function GlifoMarca(p) {
    var hijos;
    if (p.tipo === "caries") hijos = [h("circle", { key: 1, cx: 12, cy: 12, r: 6, className: "cn-glifo--caries" })];
    else if (p.tipo === "extraccion") hijos = [h("path", { key: 1, d: "M6 6l12 12M18 6L6 18", className: "cn-glifo--extraccion" })];
    else if (p.tipo === "periodontal") hijos = [h("path", { key: 1, d: "M4.5 15c4-5.3 11-5.3 15 0", className: "cn-glifo--periodontal" })];
    else hijos = [h("circle", { key: 1, cx: 12, cy: 12, r: 6.5, className: "cn-glifo--sano" })];
    return h("svg", { className: "cn-glifo", viewBox: "0 0 24 24", width: 24, height: 24, "aria-hidden": true, focusable: "false" }, hijos);
  }
  function LeyendaOdontograma(p) {
    var s = useState(p.seleccion || "caries");
    var sel = p.seleccion || s[0];
    var interactiva = !p.soloLeyenda;
    return h("div", {
      className: cx("cn-leyenda", interactiva && "cn-leyenda--herramientas", p.vertical && "cn-leyenda--vertical", p.className),
      role: interactiva ? "toolbar" : undefined, "aria-label": "Marcar en el odontograma"
    },
      h("span", { className: "cn-leyenda__rotulo" }, "Marcar"),
      MARCAS.map(function (m) {
        if (!interactiva) return h("span", { key: m.id, className: "cn-leyenda__item" }, h(GlifoMarca, { tipo: m.id }), m.nombre);
        var activo = sel === m.id;
        return h("button", {
          key: m.id, type: "button", className: cx("cn-leyenda__item", activo && "is-activo"), "aria-pressed": activo,
          onClick: function () { s[1](m.id); if (p.onElegir) p.onElegir(m.id); }
        }, h(GlifoMarca, { tipo: m.id }), m.nombre);
      }));
  }

  function MarcoVisor3D(p) {
    var s = useState(p.denticion || "adulto");
    var den = p.denticion || s[0];
    function elegir(v) { s[1](v); if (p.onDenticion) p.onDenticion(v); }
    var ops = [{ id: "adulto", texto: "Adulto 11–48" }, { id: "pediatrico", texto: "Pediátrico 51–85" }];
    return h("section", { className: cx("cn-visor", p.className), "aria-label": "Odontograma" },
      h("div", { className: "cn-visor__cabecera" },
        h("p", { className: "cn-visor__titulo" }, p.titulo || "Odontograma"),
        h("div", { className: "cn-segmento", role: "radiogroup", "aria-label": "Dentición" }, ops.map(function (o) {
          var a = den === o.id;
          return h("button", { key: o.id, type: "button", role: "radio", "aria-checked": a, className: cx("cn-segmento__opcion", a && "is-activo"), onClick: function () { elegir(o.id); } }, o.texto);
        }))),
      h("div", { className: "cn-visor__escena" },
        h("span", { className: "cn-visor__rotulo cn-visor__rotulo--sup" }, "▲ Superior"),
        h("span", { className: "cn-visor__rotulo cn-visor__rotulo--inf" }, "▼ Inferior"),
        h("span", { className: "cn-visor__rotulo cn-visor__rotulo--der" }, "Derecha"),
        h("span", { className: "cn-visor__rotulo cn-visor__rotulo--izq" }, "Izquierda"),
        h("div", { className: "cn-visor__lienzo", "aria-busy": p.cargando || undefined },
          p.children || (p.cargando
            ? h("p", { className: "cn-visor__marcador" }, h(Giro), "Cargando visor…")
            : h("p", { className: "cn-visor__marcador" }, h(Icono, { nombre: "odontologia", tamano: 32 }),
              h("span", { className: "cn-visor__marcador-titulo" }, "Visor 3D del odontograma"),
              h("span", null, den === "adulto" ? "Numeración FDI 11–48" : "Numeración FDI 51–85"))))),
      h("p", { className: "cn-visor__ayuda" }, p.ayuda || "Tocá la cara del diente: la clase de Black sale sola. Derecha e izquierda del paciente."));
  }

  function PieMaqueta(p) {
    return h("p", { className: cx("cn-pie", p.className) }, p.texto || "Maqueta de concepto · los datos son un ejemplo");
  }

  var api = {
    Boton: Boton, MenuExportar: MenuExportar, BarraLateral: BarraLateral, BarraSuperior: BarraSuperior,
    BarraInferior: BarraInferior, SelectorIdioma: SelectorIdioma, Buscador: Buscador, TarjetaPaciente: TarjetaPaciente,
    Avatar: Avatar, Chip: Chip, AlertaClinica: AlertaClinica, AvisoExito: AvisoExito, AvisoConexion: AvisoConexion,
    EstadoVacio: EstadoVacio, Campo: Campo, HojaInferior: HojaInferior, TablaLista: TablaLista,
    TarjetaMetrica: TarjetaMetrica, GraficoBarras: GraficoBarras, LeyendaOdontograma: LeyendaOdontograma,
    MarcoVisor3D: MarcoVisor3D, PieMaqueta: PieMaqueta, Icono: Icono, MODULOS: MODULOS
  };
  window.Conecta = Object.assign(window.Conecta || {}, api);
})();
