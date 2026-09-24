(() => {
  'use strict';

  var firebaseConfig = {
    apiKey: "AIzaSyBd5MEZdMmgzBs1xCyeGYeKtQx5gJIeY3w",
    authDomain: "dashboard-vulnerabilidades-mlc.firebaseapp.com",
    databaseURL: "https://dashboard-vulnerabilidades-mlc-default-rtdb.firebaseio.com",
    projectId: "dashboard-vulnerabilidades-mlc"
  };

  var db = null;
  var dbUsers = null;
  var dbAlertasTerreno = null;

  try {
    if (typeof firebase !== 'undefined') {
      if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
      db = firebase.database().ref('activos_criticos_dev');
      dbUsers = firebase.database().ref('usuarios_registrados_dev');
      dbAlertasTerreno = firebase.database().ref('alertas_terreno_dev');
    }
  } catch (err) {
    console.warn("Firebase Dev fallback:", err);
  }

  var FAENAS = Object.freeze([
    'Planta, Mina los Colorados',
    'Mina, Mina los Colorados',
    'Planta de Pellets',
    'Planta, Mina el Romeral',
    'Mina, Mina el Romeral'
  ]);

  var SEV_PESO = Object.freeze({ Rojo: 5, Naranja: 4, Amarillo: 3, Verde: 2, Plomo: 1 });
  var SEV_COLOR = Object.freeze({ Rojo: '#ef4444', Naranja: '#f97316', Amarillo: '#eab308', Verde: '#22c55e', Plomo: '#6b7280' });

  var state = {
    currentScreen: 1,
    usuarioActivo: null,
    faenaAsignada: null,
    isSuperAdmin: false,
    faenaSeleccionada: null,
    areaSeleccionada: null,
    equipoSeleccionado: null,
    equipoIdNivel3: null,
    componenteIndexEdit: -1,
    siteMapVisible: false,
    authMode: 'login',
    mapaSite: null,
    capaSite: null,
    equipos: [],
    alertasTerreno: []
  };

  function sanitize(str) {
    return (str || '').replace(/[<>&"']/g, function(m) {
      return { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[m];
    });
  }

  function normalizarFaena(f) {
    return FAENAS.indexOf(f) !== -1 ? f : FAENAS[0];
  }

  function matchTags(t1, t2) {
    if (!t1 || !t2) return false;
    var clean = function(s) { return String(s).trim().toUpperCase().replace(/[\s\-_]/g, ''); };
    return clean(t1) === clean(t2);
  }

  function calcularDiasDesdeMedicion(fechaStr) {
    if (!fechaStr) return { dias: null, vencido: true, texto: 'Sin fecha registrada' };
    var partes = String(fechaStr).split('-');
    if (partes.length !== 3) return { dias: null, vencido: true, texto: 'Fecha no válida' };
    
    var fechaMed = new Date(parseInt(partes[0], 10), parseInt(partes[1], 10) - 1, parseInt(partes[2], 10));
    var hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    fechaMed.setHours(0, 0, 0, 0);

    var diffMs = hoy.getTime() - fechaMed.getTime();
    var dias = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    var vencido = dias > 30;

    return {
      dias: dias,
      vencido: vencido,
      texto: dias >= 0 ? ('Hace ' + dias + ' día(s)') : ('En ' + Math.abs(dias) + ' día(s)')
    };
  }

  function calcMaxSev(comps) {
    if (!comps || !comps.length) return 'Plomo';
    var max = 1;
    var maxSev = 'Plomo';
    comps.forEach(function(c) {
      if (c && SEV_PESO[c.severidad] > max) {
        max = SEV_PESO[c.severidad];
        maxSev = c.severidad;
      }
    });
    return maxSev;
  }

  function consolidarSAPs(comps) {
    var pares = [];
    var avisosUnicos = [];
    var omsUnicas = [];

    (comps || []).forEach(function(c) {
      (c.paresSap || []).forEach(function(p) {
        var av = p.aviso ? p.aviso.trim() : '';
        var om = p.om ? p.om.trim() : '';
        if (av || om) {
          pares.push({ componente: c.nombre || 'Componente', aviso: av || 'S/A', om: om || 'S/OM' });
          if (av && avisosUnicos.indexOf(av) === -1) avisosUnicos.push(av);
          if (om && omsUnicas.indexOf(om) === -1) omsUnicas.push(om);
        }
      });
    });

    return {
      pares: pares,
      avisosStr: avisosUnicos.length > 0 ? avisosUnicos.join(', ') : 'Sin Avisos',
      omsStr: omsUnicas.length > 0 ? omsUnicas.join(', ') : 'Sin OM',
      countAvisos: avisosUnicos.length,
      countOms: omsUnicas.length
    };
  }

  function generarSeedLocal() {
    var list = [];
    var areas = ['AREA 61', 'AREA 55', 'AREA 54', 'AREA 52', 'AREA 50', 'SSEE'];
    var now = new Date();

    for (var i = 1; i <= 24; i++) {
      var area = areas[i % areas.length];
      var sevRand = i % 5 === 0 ? 'Rojo' : (i % 3 === 0 ? 'Naranja' : 'Verde');
      var diasAtras = (i % 4 === 0) ? 35 : 12;
      var fechaMed = new Date(now.getTime() - diasAtras * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      list.push({
        id: 'seed_eq_' + i,
        siteId: 'Planta, Mina los Colorados',
        domain: 'planta',
        area: area,
        tag: 'MH' + (2700 + i),
        tipo: i % 2 === 0 ? 'Transportador' : 'Modulo',
        lat: (-28.2876 + (Math.random() * 0.01 - 0.005)).toFixed(5),
        lng: (-70.8130 + (Math.random() * 0.01 - 0.005)).toFixed(5),
        fechaMedicion: fechaMed,
        fechaHallazgo: fechaMed,
        estatusHallazgo: sevRand === 'Rojo' ? 'Abierto' : 'Cerrado / Normal',
        componentes: [
          {
            nombre: 'M1 (Motor)',
            rms: '4.0',
            severidad: 'Rojo',
            paresSap: [ { aviso: '123456', om: '123456' } ],
            analisis: '[IA - Criticidad Alta]: Energía vibratoria crítica en M1 (4 mm/s). Posible soltura mecánica estructural o holgura basal.',
            recomendacion: '1) Inspección termográfica inmediata y reapriete de pernos basales.'
          },
          {
            nombre: 'G1 (Reductor)',
            rms: '11.0',
            severidad: 'Rojo',
            paresSap: [ { aviso: '445566666', om: '4521444444' } ],
            analisis: '[IA - Criticidad Alta]: Energía vibratoria crítica en G1 (11 mm/s). Posible soltura mecánica estructural o holgura basal.',
            recomendacion: '1) Inspección termográfica inmediata y reapriete de pernos basales.'
          },
          {
            nombre: 'M2 (Polea / Soporte)',
            rms: '1.0',
            severidad: 'Verde',
            paresSap: [],
            analisis: '[IA - Normal]: Comportamiento dinámico de M2 dentro de tolerancia admisible (RMS: 1 mm/s).',
            recomendacion: 'Mantener frecuencia de medición mensual estándar (30 días).'
          }
        ]
      });
    }
    return list;
  }

  state.equipos = generarSeedLocal();

  // PANTALLA 1
  function renderScreen1() {
    var container = document.getElementById('viewScreen1Content');
    if (!container) return;

    var stats = {};
    FAENAS.forEach(function(f) { stats[f] = { count: 0, critical: 0, maxSev: 'Plomo', maxPeso: 1 }; });

    state.equipos.forEach(function(eq) {
      var f = normalizarFaena(eq.siteId);
      stats[f].count++;
      var s = calcMaxSev(eq.componentes);
      if (s === 'Rojo' || s === 'Naranja') stats[f].critical++;
      if (SEV_PESO[s] > stats[f].maxPeso) {
        stats[f].maxPeso = SEV_PESO[s];
        stats[f].maxSev = s;
      }
    });

    var sortedFaenas = FAENAS.map(function(f) {
      var obj = { name: f };
      for (var k in stats[f]) { obj[k] = stats[f][k]; }
      return obj;
    }).sort(function(a, b) { return (b.maxPeso - a.maxPeso) || (b.critical - a.critical); });

    container.innerHTML = '';
    sortedFaenas.forEach(function(d) {
      var card = document.createElement('article');
      card.className = 'card-area ' + (d.maxSev === 'Rojo' || d.maxSev === 'Naranja' ? 'anim-' + d.maxSev.toLowerCase() : '');
      card.onclick = function() { window.CIO.seleccionarFaena(d.name); };

      card.innerHTML = '<header>' +
          '<span class="label-muted">Faena Operativa CMP</span>' +
          '<h3 class="value-strong" style="margin:4px 0 8px 0;">' + sanitize(d.name) + '</h3>' +
        '</header>' +
        '<div style="display:flex; justify-content:space-between; border-top:1px solid var(--border-card); padding-top:8px;">' +
          '<div><span class="label-muted">Activos</span><div class="value-strong">' + d.count + '</div></div>' +
          '<div><span class="label-muted">Condición</span><div class="value-strong" style="color:' + SEV_COLOR[d.maxSev] + '">' + (d.critical > 0 ? (d.critical + ' Alertas') : 'Normal') + '</div></div>' +
        '</div>';
      container.appendChild(card);
    });
  }

  // PANTALLA 2
  function renderScreen2() {
    var target = state.faenaSeleccionada || state.faenaAsignada || FAENAS[0];
    var titleEl = document.getElementById('screen2SiteTitle');
    if (titleEl) titleEl.innerText = target;

    var container = document.getElementById('viewScreen2Container');
    if (!container) return;
    container.style.display = state.siteMapVisible ? 'none' : '';

    var eqsFaena = state.equipos.filter(function(e) { return normalizarFaena(e.siteId) === target; });

    if (!state.areaSeleccionada) {
      var areas = {};
      eqsFaena.forEach(function(eq) {
        var a = eq.area || 'Sin Área';
        if (!areas[a]) areas[a] = { count: 0, critical: 0, maxSev: 'Plomo', maxPeso: 1 };
        areas[a].count++;
        var s = calcMaxSev(eq.componentes);
        if (s === 'Rojo' || s === 'Naranja') areas[a].critical++;
        if (SEV_PESO[s] > areas[a].maxPeso) {
          areas[a].maxPeso = SEV_PESO[s];
          areas[a].maxSev = s;
        }
      });

      var areaKeys = Object.keys(areas);
      var sortedAreas = areaKeys.map(function(a) {
        var obj = { name: a };
        for (var k in areas[a]) { obj[k] = areas[a][k]; }
        return obj;
      }).sort(function(a, b) { return (b.maxPeso - a.maxPeso) || (b.critical - a.critical); });

      container.className = 'grid-container';
      container.innerHTML = '';

      if (sortedAreas.length === 0) {
        container.innerHTML = '<div class="label-muted" style="padding:20px;">Sin áreas registradas. Realiza una Carga Masiva.</div>';
        return;
      }

      sortedAreas.forEach(function(a) {
        var card = document.createElement('article');
        card.className = 'card-area ' + (a.maxSev === 'Rojo' || a.maxSev === 'Naranja' ? 'anim-' + a.maxSev.toLowerCase() : '');
        card.onclick = function() { window.CIO.seleccionarArea(a.name); };

        card.innerHTML = '<span class="label-muted">Área Operacional</span>' +
          '<h3 class="value-strong" style="margin:4px 0 8px 0;">' + sanitize(a.name) + '</h3>' +
          '<div style="display:flex; justify-content:space-between; border-top:1px solid var(--border-card); padding-top:8px;">' +
            '<div><span class="label-muted">Activos</span><div class="value-strong">' + a.count + '</div></div>' +
            '<div><span class="label-muted">Condición</span><div class="value-strong" style="color:' + SEV_COLOR[a.maxSev] + '">' + (a.critical > 0 ? (a.critical + ' Alertas') : 'Normal') + '</div></div>' +
          '</div>';
        container.appendChild(card);
      });
    } else {
      container.className = 'grid-equipos';
      container.innerHTML = '';

      var eqsArea = eqsFaena.filter(function(e) { return (e.area || 'Sin Área') === state.areaSeleccionada; });
      eqsArea.sort(function(a, b) { return SEV_PESO[calcMaxSev(b.componentes)] - SEV_PESO[calcMaxSev(a.componentes)]; });

      var navHeader = document.createElement('div');
      navHeader.style.cssText = "grid-column: 1/-1; display:flex; align-items:center; gap:10px; margin-bottom:4px; background:var(--glass-card); backdrop-filter:blur(8px); padding:8px 12px; border-radius:8px; border:1px solid var(--glass-border);";
      navHeader.innerHTML = '<button class="btn-base" type="button" onclick="window.CIO.volverAreas()">⬅️ Volver a Áreas</button>' +
        '<span style="font-weight:700; color:var(--accent-color); font-size:0.85rem;">Área: ' + sanitize(state.areaSeleccionada) + '</span>';
      container.appendChild(navHeader);

      eqsArea.forEach(function(eq) {
        var s = calcMaxSev(eq.componentes);
        var tagValue = eq.tag || eq.Tag || eq.TAG || eq.equipo || eq.id || 'S/T';
        var fieldReports = state.alertasTerreno.filter(function(a) { return matchTags(a.tag, tagValue); });
        var aud = calcularDiasDesdeMedicion(eq.fechaMedicion);
        var saps = consolidarSAPs(eq.componentes);

        var card = document.createElement('article');
        card.className = 'card-equipo sev-' + s.toLowerCase() + ' ' + (s === 'Rojo' || s === 'Naranja' ? 'anim-' + s.toLowerCase() : '');
        // Clic en la tarjeta abre el NIVEL 3 nativo como nueva pantalla
        card.onclick = function() { window.CIO.irANivel3Equipo(eq.id); };

        var badgeTerreno = fieldReports.length > 0 ? ('<span class="badge-field-floating">💬 Ronda (' + fieldReports.length + ')</span>') : '';
        var badgeSap = saps.countAvisos > 0 ? ('<div style="font-size:0.58rem; color:#60a5fa; font-weight:700; margin-top:2px;">AV: ' + saps.countAvisos + ' | OM: ' + saps.countOms + '</div>') : '';

        card.innerHTML = badgeTerreno +
          (aud.vencido ? ('<span class="badge-vencido-floating" title="Medición vencida: ' + aud.texto + '">⏱️ >30d</span>') : '') +
          '<span class="eq-type">' + sanitize(eq.tipo || eq.area) + '</span>' +
          '<div class="eq-tag code-font">' + sanitize(tagValue) + '</div>' +
          '<span class="eq-type" style="color:' + SEV_COLOR[s] + '; font-weight:bold;">' + s.toUpperCase() + '</span>' +
          badgeSap;
        container.appendChild(card);
      });
    }
  }

  // PANTALLA 3: NIVEL 3 NATIVO EN PANTALLA COMPLETA
  function renderScreen3() {
    if (!state.equipoIdNivel3) {
      window.CIO.goScreen(2);
      return;
    }

    var eq = state.equipos.find(function(e) { return e.id === state.equipoIdNivel3; });
    if (!eq) {
      window.CIO.goScreen(2);
      return;
    }

    var tagValue = eq.tag || eq.Tag || eq.id || 'S/T';
    document.getElementById('n3Breadcrumb').innerText = eq.siteId + ' | ' + eq.area + ' | TAG: ' + tagValue;
    document.getElementById('n3Title').innerText = (eq.tipo || 'Activo') + ' - ' + eq.area;

    var aud = calcularDiasDesdeMedicion(eq.fechaMedicion);
    var bannerMed = document.getElementById('n3BannerMedicion');
    if (bannerMed) {
      bannerMed.innerHTML = aud.vencido
        ? ('<span class="banner-contador-alerta vencido">⚠️ ALERTA RUTA: Medición realizada ' + aud.texto + ' (> 30 días sin inspeccionar)</span>')
        : ('<span class="banner-contador-alerta al-dia">✅ RUTA AL DÍA: Última medición ' + aud.texto + ' (dentro de ciclo)</span>');
    }

    var sevGlobal = calcMaxSev(eq.componentes);
    var saps = consolidarSAPs(eq.componentes);

    // Banner Superior
    var diagBox = document.getElementById('n3DiagnosticoBox');
    if (diagBox) {
      var paresHtml = '';
      if (saps.pares.length > 0) {
        paresHtml = saps.pares.map(function(p) {
          return '<span style="background:rgba(30,58,138,0.3); border:1px solid #3b82f6; padding:3px 8px; border-radius:5px; margin-right:6px; margin-bottom:4px; display:inline-block; font-size:0.75rem;">' +
            '<strong>' + sanitize(p.componente) + ':</strong> <span style="color:#60a5fa;">AV ' + sanitize(p.aviso) + '</span> ➔ <span style="color:#34d399;">OM ' + sanitize(p.om) + '</span>' +
          '</span>';
        }).join('');
      } else {
        paresHtml = '<span style="color:var(--text-muted); font-size:0.8rem; font-style:italic;">Sin Avisos / OM SAP asociadas</span>';
      }

      diagBox.innerHTML = '<div style="display:flex; justify-content:space-between; flex-wrap:wrap; gap:12px; align-items:center; border-bottom:1px solid var(--glass-border); padding-bottom:10px; margin-bottom:10px;">' +
          '<div>' +
            '<span class="label-muted">Condición Crítica Heredada</span>' +
            '<div style="font-weight:900; font-size:1.15rem; color:' + SEV_COLOR[sevGlobal] + ';">' + sevGlobal.toUpperCase() + '</div>' +
          '</div>' +
          '<div><span class="label-muted">Estatus Hallazgo</span><div style="font-weight:700; margin-top:2px;">' + sanitize(eq.estatusHallazgo || 'Abierto') + '</div></div>' +
          '<div><span class="label-muted">Última Medición</span><div style="font-weight:700; margin-top:2px;">' + (eq.fechaMedicion || 'S/F') + '</div></div>' +
        '</div>' +
        '<div>' +
          '<span class="label-muted">Avisos & Órdenes OM SAP Vinculadas:</span>' +
          '<div style="margin-top:6px;">' + paresHtml + '</div>' +
        '</div>';
    }

    // Grilla de Tarjetas Nivel 3 (Componentes + Terreno)
    var grid = document.getElementById('n3GridCards');
    if (!grid) return;
    grid.innerHTML = '';

    var comps = (eq.componentes || []).slice().sort(function(a, b) {
      return SEV_PESO[b.severidad || 'Plomo'] - SEV_PESO[a.severidad || 'Plomo'];
    });

    comps.forEach(function(c, idx) {
      var col = SEV_COLOR[c.severidad] || '#6b7280';
      var card = document.createElement('article');
      card.className = 'card-nivel3-comp';
      card.style.borderLeft = '5px solid ' + col;

      var paresHtml = '';
      if (c.paresSap && c.paresSap.length > 0) {
        paresHtml = '<div style="background:rgba(20,25,35,0.7); padding:6px 8px; border-radius:6px; font-size:0.75rem; margin:8px 0;">' +
          c.paresSap.map(function(p) {
            return '<div><strong>Aviso:</strong> <span class="code-font" style="color:#60a5fa;">' + sanitize(p.aviso || 'S/A') + '</span> ➔ <strong>OM:</strong> <span class="code-font" style="color:#34d399;">' + sanitize(p.om || 'S/OM') + '</span></div>';
          }).join('') +
        '</div>';
      }

      card.innerHTML = '<div>' +
          '<div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:6px;">' +
            '<div>' +
              '<span class="label-muted">Componente</span>' +
              '<h4 style="margin:2px 0 0 0; font-size:1.1rem; color:#fff;">' + sanitize(c.nombre || 'Componente') + '</h4>' +
            '</div>' +
            '<span style="font-weight:800; font-size:0.85rem; color:' + col + '; background:rgba(0,0,0,0.3); padding:4px 8px; border-radius:5px; border:1px solid ' + col + ';">' +
              (c.severidad || 'Verde').toUpperCase() + ' (' + (c.rms || '0.0') + ' mm/s)' +
            '</span>' +
          '</div>' +
          paresHtml +
          '<div style="margin-top:8px; font-size:0.82rem; color:#e5e7eb; line-height:1.35;">' +
            '<strong>Diagnóstico:</strong> ' + sanitize(c.analisis || 'Sin análisis registrado.') +
          '</div>' +
          '<div style="margin-top:6px; font-size:0.82rem; color:#a7f3d0; line-height:1.35;">' +
            '<strong>Recomendación:</strong> ' + sanitize(c.recomendacion || 'Mantener ruta rutinaria.') +
          '</div>' +
        '</div>' +
        '<div style="margin-top:14px; display:flex; justify-content:flex-end; border-top:1px solid var(--glass-border); padding-top:10px;">' +
          '<button type="button" class="btn-base btn-primary auth-only" onclick="window.CIO.abrirEditorComponenteIndividual(' + idx + ')">' +
            '✏️ Editar este Componente' +
          '</button>' +
        '</div>';

      grid.appendChild(card);
    });

    // Tarjeta de Terreno integrada
    var myReports = state.alertasTerreno
      .filter(function(a) { return matchTags(a.tag, tagValue); })
      .sort(function(a, b) { return new Date(b.timestamp || 0) - new Date(a.timestamp || 0); });

    var cardTerreno = document.createElement('article');
    cardTerreno.className = 'card-nivel3-comp card-nivel3-terreno';
    cardTerreno.onclick = function() { window.CIO.abrirModalHistoricoTerreno(); };

    var ultReporte = myReports.length > 0 ? myReports[0] : null;
    var ultFecha = ultReporte && ultReporte.timestamp ? new Date(ultReporte.timestamp).toLocaleDateString() : 'Sin registros';
    var ultSev = ultReporte ? ultReporte.severidad : 'Normal';

    cardTerreno.innerHTML = '<div>' +
        '<div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:6px;">' +
          '<div>' +
            '<span class="label-muted" style="color:#38bdf8;">Ronda en Planta & Terreno</span>' +
            '<h4 style="margin:2px 0 0 0; font-size:1.1rem; color:#38bdf8;">📸 Bitácora de Terreno</h4>' +
          '</div>' +
          '<span style="font-weight:800; font-size:0.85rem; color:#38bdf8; background:rgba(56,189,248,0.15); padding:4px 8px; border-radius:5px; border:1px solid rgba(56,189,248,0.4);">' +
            myReports.length + ' Hallazgos' +
          '</span>' +
        '</div>' +
        '<div style="margin:10px 0; font-size:0.84rem; color:#e2e8f0; line-height:1.4;">' +
          (ultReporte ? ('<strong>Último reporte (' + ultFecha + '):</strong> ' + sanitize(ultReporte.detalle)) : 'No se registran hallazgos de ronda en terreno para este activo.') +
        '</div>' +
        (ultReporte && ultReporte.fotoBase64 ? ('<div style="font-size:0.75rem; color:#38bdf8; font-weight:bold;">📷 Contiene evidencia fotográfica adjunta</div>') : '') +
      '</div>' +
      '<div style="margin-top:14px; display:flex; justify-content:space-between; align-items:center; border-top:1px solid rgba(56,189,248,0.2); padding-top:10px;">' +
        '<span style="font-size:0.75rem; color:var(--text-muted);">Condición: <strong style="color:' + (SEV_COLOR[ultSev] || '#fff') + ';">' + ultSev + '</strong></span>' +
        '<button type="button" class="btn-base" style="border-color:#38bdf8; color:#38bdf8; background:rgba(56,189,248,0.1);">' +
          '🔍 Abrir Historial Completo ➔' +
        '</button>' +
      '</div>';

    grid.appendChild(cardTerreno);
  }

  // PANTALLA 4: SUPERADMIN
  function renderScreen4() {
    var filterEl = document.getElementById('superAdminFilterSite');
    var filter = filterEl ? filterEl.value : 'TODAS';
    var eqs = filter === 'TODAS' ? state.equipos : state.equipos.filter(function(e) { return normalizarFaena(e.siteId) === filter; });
    eqs.sort(function(a, b) { return SEV_PESO[calcMaxSev(b.componentes)] - SEV_PESO[calcMaxSev(a.componentes)]; });

    var container = document.getElementById('viewScreen4Global');
    if (!container) return;

    container.innerHTML = '';
    eqs.forEach(function(eq) {
      var s = calcMaxSev(eq.componentes);
      var tagValue = eq.tag || eq.Tag || eq.TAG || eq.id || 'S/T';

      var card = document.createElement('article');
      card.className = 'card-equipo sev-' + s.toLowerCase() + ' ' + (s === 'Rojo' || s === 'Naranja' ? 'anim-' + s.toLowerCase() : '');
      card.innerHTML = '<span class="label-muted">' + sanitize(eq.siteId) + '</span>' +
        '<div class="eq-tag code-font">' + sanitize(tagValue) + '</div>' +
        '<div style="margin-top:6px;">' +
          '<button class="btn-base btn-primary" type="button" style="padding:2px 8px; font-size:0.65rem;" onclick="window.CIO.irANivel3Equipo(\'' + eq.id + '\')">🔍 Ver Nivel 3</button>' +
        '</div>';
      container.appendChild(card);
    });
  }

  function actualizarMapaSite(eqs) {
    if (typeof L === 'undefined') return;
    var mapBox = document.getElementById('view-site-map');
    if (!mapBox) return;

    try {
      if (!state.mapaSite) {
        state.mapaSite = L.map('view-site-map').setView([-28.2876, -70.8130], 13);
        L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19 }).addTo(state.mapaSite);
        state.capaSite = L.layerGroup().addTo(state.mapaSite);
      } else {
        state.mapaSite.invalidateSize();
      }

      state.capaSite.clearLayers();
      var bounds = [];

      eqs.forEach(function(eq) {
        var lat = parseFloat(eq.lat);
        var lng = parseFloat(eq.lng);
        if (!isNaN(lat) && !isNaN(lng) && lat !== 0) {
          var s = calcMaxSev(eq.componentes);
          var col = SEV_COLOR[s] || '#6b7280';
          var pulse = s === 'Rojo' ? 'map-pin-pulse' : '';
          var tagValue = eq.tag || eq.Tag || eq.id || 'S/T';
          var icon = L.divIcon({
            className: 'custom-pin',
            html: '<div class="' + pulse + '" style="background:' + col + '; width:20px; height:20px; border-radius:50%; border:2px solid #fff; box-shadow:0 0 10px ' + col + ';"></div>',
            iconSize: [20, 20],
            iconAnchor: [10, 10]
          });
          L.marker([lat, lng], { icon: icon }).bindPopup('<strong>' + sanitize(tagValue) + '</strong><br>' + sanitize(eq.area) + '<br><span style="color:' + col + ';font-weight:bold;">' + s + '</span>').addTo(state.capaSite);
          bounds.push([lat, lng]);
        }
      });

      if (bounds.length) state.mapaSite.fitBounds(L.latLngBounds(bounds), { padding: [30, 30] });
    } catch (e) {
      console.warn("Error mapa:", e);
    }
  }

  // Recepción en tiempo real desde Firebase DEV
  if (db) {
    db.on('value', function(snap) {
      var raw = snap.val();
      if (raw && Object.keys(raw).length > 0) {
        state.equipos = Object.keys(raw).map(function(k) {
          var item = raw[k] || {};
          var detectedTag = item.tag || item.Tag || item.TAG || item.equipo || item.Equipo || item.nombre || k;
          var detectedArea = item.area || item.Area || item.AREA || 'Sin Área';
          var detectedSite = item.siteId || item.site || item.faena || item.Faena || 'Planta, Mina los Colorados';

          return {
            id: k,
            siteId: normalizarFaena(detectedSite),
            domain: item.domain || 'planta',
            area: detectedArea,
            tag: detectedTag,
            tipo: item.tipo || item.Tipo || item['Tipo equipo'] || 'Activo',
            lat: item.lat || '',
            lng: item.lng || '',
            componentes: item.componentes || [
              { nombre: 'Motor Eléctrico', severidad: 'Verde', rms: '2.0', paresSap: [], analisis: '', recomendacion: '' },
              { nombre: 'Reductor', severidad: 'Verde', rms: '2.0', paresSap: [], analisis: '', recomendacion: '' }
            ],
            fechaMedicion: item.fechaMedicion || item.fecha || '',
            fechaHallazgo: item.fechaHallazgo || '',
            estatusHallazgo: item.estatusHallazgo || 'Abierto'
          };
        });
      }
      refresh();
    });

    if (dbAlertasTerreno) {
      dbAlertasTerreno.on('value', function(snap) {
        var raw = snap.val();
        state.alertasTerreno = raw ? Object.keys(raw).map(function(k) {
          var alertData = raw[k] || {};
          alertData.id = k;
          return alertData;
        }) : [];
        refresh();
      });
    }
  }

  function refresh() {
    try {
      if (state.currentScreen === 1) renderScreen1();
      else if (state.currentScreen === 2) renderScreen2();
      else if (state.currentScreen === 3) renderScreen3();
      else if (state.currentScreen === 4) renderScreen4();
    } catch (e) {
      console.error("Error al refrescar interfaz:", e);
    }
  }

  // ==========================================================================
  // OBJETO GLOBAL WINDOW.CIO
  // ==========================================================================
  window.CIO = {
    goScreen: function(num) {
      state.currentScreen = num;
      document.querySelectorAll('.screen-view').forEach(function(el) { el.classList.remove('active'); });
      var sc = document.getElementById('screen-' + num);
      if (sc) sc.classList.add('active');
      var titles = { 1: 'Vista Pública (Global - DEV)', 2: 'Faena: ' + (state.faenaSeleccionada || 'Operativa (DEV)'), 3: 'Nivel 3: Tren Motriz & Componentes', 4: 'Consola SuperAdmin (DEV)' };
      var headerTitle = document.getElementById('headerScreenTitle');
      if (headerTitle) headerTitle.innerText = titles[num] || 'CIO';
      if (num !== 2) state.siteMapVisible = false;
      refresh();
    },

    seleccionarFaena: function(f) {
      state.faenaSeleccionada = f;
      state.areaSeleccionada = null;
      state.siteMapVisible = false;
      var b = document.getElementById('badgeFaenaAsignada');
      if (b) b.innerText = f;
      window.CIO.goScreen(2);
    },

    seleccionarArea: function(a) {
      state.areaSeleccionada = a;
      renderScreen2();
    },

    volverAreas: function() {
      state.areaSeleccionada = null;
      renderScreen2();
    },

    stepBackScreen2: function() {
      if (state.siteMapVisible) {
        window.CIO.toggleSiteMapTab();
        return;
      }
      if (state.areaSeleccionada) {
        window.CIO.volverAreas();
        return;
      }
      window.CIO.goScreen(1);
    },

    // TRANSICIÓN AL NIVEL 3 COMO PANTALLA COMPLETA
    irANivel3Equipo: function(id) {
      state.equipoIdNivel3 = id;
      window.CIO.goScreen(3);
    },

    volverDeNivel3: function() {
      window.CIO.goScreen(2);
    },

    toggleSiteMapTab: function() {
      state.siteMapVisible = !state.siteMapVisible;
      var mapBox = document.getElementById('view-site-map');
      var container = document.getElementById('viewScreen2Container');
      var lbl = document.getElementById('labelToggleSiteMap');
      var target = state.faenaSeleccionada || FAENAS[0];

      if (state.siteMapVisible) {
        if (mapBox) mapBox.style.display = 'block';
        if (container) container.style.display = 'none';
        if (lbl) lbl.innerText = 'Ver Tarjetas';
        setTimeout(function() {
          actualizarMapaSite(state.equipos.filter(function(e) { return normalizarFaena(e.siteId) === target; }));
        }, 150);
      } else {
        if (mapBox) mapBox.style.display = 'none';
        if (container) container.style.display = '';
        if (lbl) lbl.innerText = 'Ver Mapa de Faena';
      }
    },

    toggleTheme: function() {
      document.body.classList.toggle('light-mode');
    },

    handleUserBtnClick: function() {
      if (!state.usuarioActivo) {
        window.CIO.setAuthMode('login');
        var m = document.getElementById('modalAuth');
        if (m) m.showModal();
      } else {
        var uMenu = document.getElementById('userDropdownMenu');
        if (uMenu) uMenu.classList.toggle('is-active');
      }
    },

    setAuthMode: function(mode) {
      state.authMode = mode;
      var isReg = (mode === 'register');
      
      var boxName = document.getElementById('boxFullName');
      var boxSite = document.getElementById('boxFaenaSite');
      var tabLogin = document.getElementById('tabBtnLogin');
      var tabRegister = document.getElementById('tabBtnRegister');
      var title = document.getElementById('authModalHeaderTitle');
      var desc = document.getElementById('authModalHeaderDesc');
      var btn = document.getElementById('authSubmitActionBtn');

      if (boxName) boxName.style.setProperty('display', isReg ? 'flex' : 'none', 'important');
      if (boxSite) boxSite.style.setProperty('display', isReg ? 'flex' : 'none', 'important');

      if (tabLogin) tabLogin.classList.toggle('is-active', !isReg);
      if (tabRegister) tabRegister.classList.toggle('is-active', isReg);

      if (isReg) {
        if (title) title.innerText = 'Crear Cuenta de Operador (DEV)';
        if (desc) desc.innerText = 'Regístrate y selecciona tu faena base para habilitar la edición de condición.';
        if (btn) btn.innerText = 'Registrarse y Entrar';
      } else {
        if (title) title.innerText = 'Acceso Operador CIO (DEV)';
        if (desc) desc.innerText = 'Ingresa tus credenciales autorizadas por CPF para gestionar condición de activos.';
        if (btn) btn.innerText = 'Ingresar al Sistema';
      }
    },

    handleAuthSubmission: function() {
      var uEl = document.getElementById('authUsername');
      var pEl = document.getElementById('authPassword');
      var fnEl = document.getElementById('authFullname');
      var stEl = document.getElementById('authSelectedSite');

      var u = uEl ? uEl.value.trim() : '';
      var p = pEl ? pEl.value.trim() : '';
      var fullname = fnEl ? fnEl.value.trim() : '';
      var selectedSite = stEl ? stEl.value : 'Planta, Mina los Colorados';

      if (!u || !p) {
        alert("⚠️ Completa usuario y contraseña.");
        return;
      }

      var lookupId = u.replace(/[^a-zA-Z0-9]/g, '_');

      if (state.authMode === 'register') {
        if (!fullname) {
          alert("⚠️ Ingresa tu nombre y apellido para crear la cuenta.");
          return;
        }
        if (dbUsers) {
          dbUsers.child(lookupId).set({
            nombreCompleto: fullname,
            usuario: u,
            password: p,
            faenaAsignada: selectedSite,
            creadoEn: new Date().toISOString()
          }).then(function() {
            alert('✅ Cuenta DEV registrada: ' + selectedSite);
            loginLocal(fullname, selectedSite);
          }).catch(function(err) { alert("Error: " + err.message); });
        } else {
          loginLocal(fullname, selectedSite);
        }
      } else {
        if (dbUsers) {
          dbUsers.child(lookupId).once('value', function(snap) {
            var uData = snap.val();
            if (uData && uData.password === p) {
              var nombreFinal = uData.nombreCompleto || uData.usuario || u.split('@')[0];
              var faenaLigada = uData.faenaAsignada || 'Planta, Mina los Colorados';
              loginLocal(nombreFinal, faenaLigada);
            } else if (uData && uData.password !== p) {
              alert("❌ Contraseña incorrecta.");
            } else {
              loginLocal(u.split('@')[0], 'Planta, Mina los Colorados');
            }
          });
        } else {
          loginLocal(u.split('@')[0], 'Planta, Mina los Colorados');
        }
      }

      function loginLocal(nombre, faena) {
        state.usuarioActivo = nombre;
        state.faenaAsignada = faena;
        document.body.classList.add('user-authenticated');
        var lbl = document.getElementById('labelUsuarioBtn');
        if (lbl) lbl.innerText = nombre.split(' ')[0];
        var dropInfo = document.getElementById('dropUserInfo');
        if (dropInfo) dropInfo.innerText = 'Activo (DEV): ' + nombre + ' | Faena: ' + faena;
        var modal = document.getElementById('modalAuth');
        if (modal) modal.close();
        alert('✅ Bienvenido ' + nombre + ' al Entorno DEV.');
      }
    },

    cerrarSesionUsuario: function() {
      state.usuarioActivo = null;
      state.faenaAsignada = null;
      document.body.classList.remove('user-authenticated');
      var lbl = document.getElementById('labelUsuarioBtn');
      if (lbl) lbl.innerText = 'Entrar';
      var dropInfo = document.getElementById('dropUserInfo');
      if (dropInfo) dropInfo.innerText = 'Invitado (Solo Lectura)';
      var uMenu = document.getElementById('userDropdownMenu');
      if (uMenu) uMenu.classList.remove('is-active');
      window.CIO.goScreen(1);
    },

    solicitarPermisoSuperAdmin: function() {
      var p = prompt("🔑 Clave SuperAdmin (DEV):");
      if (p === "Moncon2026") {
        state.isSuperAdmin = true;
        window.CIO.goScreen(4);
      } else if (p !== null) {
        alert("❌ Clave incorrecta.");
      }
    },

    renderScreen4Global: function() {
      renderScreen4();
    },

    exportarReporteGerenciaAlta: function() {
      var txt = 'REPORTE ALTA GERENCIA CIO - CMP [DEV]\nTotal: ' + state.equipos.length + '\nFecha: ' + new Date().toISOString();
      var blob = new Blob([txt], { type: 'text/plain' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'Reporte_DEV_' + Date.now() + '.txt';
      a.click();
    },

    exportarReporteGerenciaPorFaena: function() {
      var filterEl = document.getElementById('superAdminFilterSite');
      var target = filterEl ? filterEl.value : FAENAS[0];
      var count = state.equipos.filter(function(e) { return normalizarFaena(e.siteId) === target; }).length;
      var txt = 'REPORTE FAENA [' + target + '] [DEV]\nTotal Activos: ' + count + '\nFecha: ' + new Date().toISOString();
      var blob = new Blob([txt], { type: 'text/plain' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'Reporte_' + target.replace(/[^a-zA-Z0-9]/g, '_') + '_DEV.txt';
      a.click();
    },

    auditarDiasMedicionForm: function() {
      var medEl = document.getElementById('edFechaMedicion');
      var val = medEl ? medEl.value : '';
      var box = document.getElementById('edFeedbackContadorDias');
      if (!box) return;

      var aud = calcularDiasDesdeMedicion(val);
      if (!val) {
        box.innerHTML = '';
        return;
      }

      box.innerHTML = aud.vencido
        ? ('<span class="banner-contador-alerta vencido" style="font-size:0.7rem; padding:4px 8px;">⚠️ RUTA VENCIDA: ' + aud.dias + ' días sin medir</span>')
        : ('<span class="banner-contador-alerta al-dia" style="font-size:0.7rem; padding:4px 8px;">✅ Medición vigente: ' + aud.texto + '</span>');
    },

    // EDICIÓN INDIVIDUAL DE UN COMPONENTE
    abrirEditorComponenteIndividual: function(idx) {
      if (!state.usuarioActivo) {
        alert("🔒 Acción restringida: Debes iniciar sesión para editar componentes.");
        return;
      }

      var eq = state.equipos.find(function(e) { return e.id === state.equipoIdNivel3; });
      if (!eq) return;

      state.componenteIndexEdit = idx;
      var c = (eq.componentes && eq.componentes[idx]) ? eq.componentes[idx] : {
        nombre: 'Nuevo Componente', rms: '2.0', severidad: 'Verde', paresSap: [], analisis: '', recomendacion: ''
      };

      document.getElementById('edCompIndex').value = idx;
      document.getElementById('edCompModalTitle').innerText = 'Editar: ' + (c.nombre || 'Componente');
      document.getElementById('indCompNombre').value = c.nombre || '';
      document.getElementById('indCompRms').value = c.rms || '2.0';
      document.getElementById('indCompSev').value = c.severidad || 'Verde';
      document.getElementById('indCompAnalisis').value = c.analisis || '';
      document.getElementById('indCompRecom').value = c.recomendacion || '';

      var paresBox = document.getElementById('indParesSapContainer');
      paresBox.innerHTML = '';
      if (c.paresSap && c.paresSap.length > 0) {
        c.paresSap.forEach(function(p) {
          window.CIO.insertarFilaParSapEnContenedor(paresBox, p.aviso, p.om);
        });
      } else {
        window.CIO.insertarFilaParSapEnContenedor(paresBox, '', '');
      }

      document.getElementById('modalEditarComponenteIndividual').showModal();
    },

    agregarNuevoComponenteDirecto: function() {
      if (!state.usuarioActivo) {
        alert("🔒 Acción restringida: Debes iniciar sesión.");
        return;
      }
      var eq = state.equipos.find(function(e) { return e.id === state.equipoIdNivel3; });
      if (!eq) return;

      eq.componentes = eq.componentes || [];
      var nuevoIdx = eq.componentes.length;
      eq.componentes.push({
        nombre: 'Nuevo Componente ' + (nuevoIdx + 1),
        rms: '2.0',
        severidad: 'Verde',
        paresSap: [],
        analisis: '',
        recomendacion: ''
      });

      window.CIO.abrirEditorComponenteIndividual(nuevoIdx);
    },

    agregarFilaParSapIndividual: function() {
      var box = document.getElementById('indParesSapContainer');
      window.CIO.insertarFilaParSapEnContenedor(box, '', '');
    },

    insertarFilaParSapEnContenedor: function(container, avisoVal, omVal) {
      var row = document.createElement('div');
      row.style.cssText = "display:grid; grid-template-columns: 1fr 1fr auto; gap:10px; align-items:center; margin-bottom:6px;";
      row.className = 'fila-par-sap';
      row.innerHTML = '<input type="text" class="p-aviso code-font" placeholder="Aviso SAP (Ej: 10054321)" value="' + sanitize(avisoVal || '') + '" style="font-size:0.82rem; padding:6px 10px;">' +
        '<input type="text" class="p-om code-font" placeholder="OM SAP (Ej: 40012984)" value="' + sanitize(omVal || '') + '" style="font-size:0.82rem; padding:6px 10px;">' +
        '<button type="button" class="btn-base btn-danger" style="padding:4px 8px; font-size:0.65rem;" onclick="this.parentElement.remove()">&times;</button>';
      container.appendChild(row);
    },

    ejecutarIAComponenteIndividual: function() {
      var nom = document.getElementById('indCompNombre').value.trim() || 'Componente';
      var rms = document.getElementById('indCompRms').value.trim() || '2.0';
      var sev = document.getElementById('indCompSev').value;

      var diag = '';
      var recom = '';

      if (sev === 'Rojo') {
        if (nom.toLowerCase().indexOf('motor') !== -1 || nom.toLowerCase().indexOf('m1') !== -1) {
          diag = '[IA - Criticidad Alta en ' + nom + ']: Nivel RMS crítico (' + rms + ' mm/s). Predominio de armónico 1X y 2X axial compatible con desalineación angular severa o entrehierro excéntrico.';
          recom = '1) Chequear alineamiento láser motor-reductor. 2) Medir resistencia de aislamiento y temperatura de descansos.';
        } else if (nom.toLowerCase().indexOf('reductor') !== -1 || nom.toLowerCase().indexOf('g1') !== -1) {
          diag = '[IA - Criticidad Alta en ' + nom + ']: Nivel RMS crítico (' + rms + ' mm/s). Modulación en frecuencias de engrane (GMF) indicativa de desgaste severo en dentado o desalineación interna.';
          recom = '1) Detención programada para boroscopía de piñón/corona. 2) Toma de muestra de aceite para ferrografía analítica.';
        } else if (nom.toLowerCase().indexOf('polea') !== -1) {
          diag = '[IA - Criticidad Alta en ' + nom + ']: Nivel RMS (' + rms + ' mm/s) con energía en alta frecuencia (PeakVue) consistente con daño en pista de rodamiento.';
          recom = '1) Reemplazo de rodamiento en próxima ventana operativa. 2) Verificar apriete de fijaciones y estado de sellos laberínticos.';
        } else {
          diag = '[IA - Criticidad Alta]: Energía vibratoria crítica en ' + nom + ' (' + rms + ' mm/s). Posible soltura mecánica estructural o holgura basal.';
          recom = '1) Inspección termográfica inmediata y reapriete de pernos basales.';
        }
      } else if (sev === 'Naranja') {
        diag = '[IA - Alerta en ' + nom + ']: Nivel RMS (' + rms + ' mm/s) en zona de degradación incipiente. Sugiere desbalanceo dinámico o lubricación deficiente.';
        recom = '1) Reducir frecuencia de monitoreo a 7 días. 2) Relubricar con grasa recomendada verificando temperatura.';
      } else {
        diag = '[IA - Normal]: Comportamiento dinámico de ' + nom + ' dentro de tolerancia admisible (RMS: ' + rms + ' mm/s).';
        recom = 'Mantener frecuencia de medición mensual estándar (30 días).';
      }

      document.getElementById('indCompAnalisis').value = diag;
      document.getElementById('indCompRecom').value = recom;
    },

    guardarComponenteIndividual: function() {
      var eq = state.equipos.find(function(e) { return e.id === state.equipoIdNivel3; });
      if (!eq) return;

      var idx = parseInt(document.getElementById('edCompIndex').value, 10);
      if (isNaN(idx) || idx < 0) return;

      var pares = [];
      document.querySelectorAll('#indParesSapContainer .fila-par-sap').forEach(function(row) {
        var av = row.querySelector('.p-aviso')?.value.trim() || '';
        var om = row.querySelector('.p-om')?.value.trim() || '';
        if (av || om) {
          pares.push({ aviso: av, om: om });
        }
      });

      eq.componentes[idx] = {
        nombre: document.getElementById('indCompNombre').value.trim() || 'Componente',
        rms: document.getElementById('indCompRms').value.trim() || '2.0',
        severidad: document.getElementById('indCompSev').value,
        paresSap: pares,
        analisis: document.getElementById('indCompAnalisis').value.trim(),
        recomendacion: document.getElementById('indCompRecom').value.trim()
      };

      if (db) {
        db.child(eq.id).child('componentes').set(eq.componentes);
      }

      document.getElementById('modalEditarComponenteIndividual').close();
      renderScreen3();
    },

    eliminarComponenteActual: function() {
      var eq = state.equipos.find(function(e) { return e.id === state.equipoIdNivel3; });
      if (!eq) return;

      var idx = parseInt(document.getElementById('edCompIndex').value, 10);
      if (confirm('¿Eliminar este componente del activo?')) {
        eq.componentes.splice(idx, 1);
        if (db) {
          db.child(eq.id).child('componentes').set(eq.componentes);
        }
        document.getElementById('modalEditarComponenteIndividual').close();
        renderScreen3();
      }
    },

    // VISOR HISTÓRICO DE TERRENO
    abrirModalHistoricoTerreno: function() {
      var eq = state.equipos.find(function(e) { return e.id === state.equipoIdNivel3; });
      if (!eq) return;

      var tagValue = eq.tag || eq.Tag || eq.id || 'S/T';
      document.getElementById('histTerrenoTitle').innerText = 'Historial de Terreno: ' + tagValue + ' (' + eq.siteId + ')';

      var cont = document.getElementById('histTerrenoListContainer');
      var myReports = state.alertasTerreno
        .filter(function(a) { return matchTags(a.tag, tagValue); })
        .sort(function(a, b) { return new Date(b.timestamp || 0) - new Date(a.timestamp || 0); });

      if (myReports.length === 0) {
        cont.innerHTML = '<div class="label-muted" style="padding:20px; font-style:italic;">No hay reportes de ronda para este activo.</div>';
      } else {
        cont.innerHTML = myReports.map(function(r, i) {
          var fotoHtml = r.fotoBase64 ? ('<div style="margin-top:10px;"><img src="' + r.fotoBase64 + '" class="img-terreno-preview-lg" alt="Evidencia" onclick="window.CIO.abrirFotoEnNuevaPestana(\'' + r.fotoBase64 + '\')" /></div>') : '';
          return '<article class="card-reporte-terreno-lg">' +
              '<div style="display:flex; justify-content:space-between; color:var(--text-muted); font-size:0.75rem;">' +
                '<span>🕒 <strong>Reporte #' + (myReports.length - i) + '</strong> | Fecha: ' + (r.timestamp ? new Date(r.timestamp).toLocaleString() : 'N/D') + '</span>' +
                '<span style="color:' + (SEV_COLOR[r.severidad] || '#fff') + '; font-weight:bold; font-size:0.85rem;">' + (r.severidad || 'Seguimiento') + '</span>' +
              '</div>' +
              '<div style="font-size:0.92rem; color:#fff; line-height:1.4; margin-top:6px;">' + sanitize(r.detalle) + '</div>' +
              fotoHtml +
            '</article>';
        }).join('');
      }

      document.getElementById('modalHistoricoTerreno').showModal();
    },

    abrirFotoEnNuevaPestana: function(base64Data) {
      var win = window.open("");
      win.document.write('<body style="margin:0; background:#0a0a0c; display:flex; justify-content:center; align-items:center; height:100vh;"><img src="' + base64Data + '" style="max-width:98%; max-height:98%; object-fit:contain; border-radius:6px; box-shadow:0 0 30px rgba(0,0,0,0.8);" /></body>');
    },

    // EDICIÓN GENERAL DEL ACTIVO (CABECERA)
    editarDatosGeneralesActivo: function() {
      if (!state.usuarioActivo) {
        alert("🔒 Acción restringida: Inicia sesión para editar datos del activo.");
        return;
      }
      var eq = state.equipos.find(function(e) { return e.id === state.equipoIdNivel3; });
      if (!eq) return;

      state.equipoSeleccionado = eq;
      var setVal = function(id, val) {
        var el = document.getElementById(id);
        if (el) el.value = val || '';
      };

      setVal('edSiteId', eq.siteId);
      setVal('edDomain', eq.domain || 'planta');
      setVal('edArea', eq.area || '');
      setVal('edTag', eq.tag || eq.Tag || eq.id || '');
      setVal('edTipo', eq.tipo || '');
      setVal('edLat', eq.lat || '');
      setVal('edLng', eq.lng || '');
      setVal('edEstatusHallazgo', eq.estatusHallazgo || 'Abierto');
      setVal('edFechaMedicion', eq.fechaMedicion || eq.fecha || '');
      setVal('edFechaHallazgo', eq.fechaHallazgo || '');

      window.CIO.auditarDiasMedicionForm();
      document.getElementById('modalEdicion').showModal();
    },

    guardarDatosGeneralesActivo: function() {
      if (!state.equipoSeleccionado) return;
      var getVal = function(id) { var el = document.getElementById(id); return el ? el.value : ''; };

      var payload = {
        siteId: getVal('edSiteId'),
        domain: getVal('edDomain'),
        area: getVal('edArea'),
        tag: getVal('edTag'),
        tipo: getVal('edTipo'),
        lat: getVal('edLat'),
        lng: getVal('edLng'),
        fechaMedicion: getVal('edFechaMedicion'),
        fechaHallazgo: getVal('edFechaHallazgo'),
        estatusHallazgo: getVal('edEstatusHallazgo')
      };

      if (db) db.child(state.equipoSeleccionado.id).update(payload);
      document.getElementById('modalEdicion').close();
      renderScreen3();
    },

    abrirEdicionEquipoNuevoAuth: function() {
      var targetSite = state.faenaSeleccionada || state.faenaAsignada || FAENAS[0];
      var newId = 'EQ_' + Date.now();
      var nuevoEquipo = {
        id: newId,
        siteId: targetSite,
        domain: 'planta',
        area: state.areaSeleccionada || 'Área General',
        tag: 'MH' + Math.floor(1000 + Math.random() * 9000),
        tipo: 'Activo Crítico',
        componentes: [
          { nombre: 'M1 (Motor)', severidad: 'Verde', rms: '2.0', paresSap: [], analisis: 'Condición normal.', recomendacion: 'Ruta mensual.' },
          { nombre: 'G1 (Reductor)', severidad: 'Verde', rms: '2.0', paresSap: [], analisis: 'Condición normal.', recomendacion: 'Ruta mensual.' }
        ],
        fechaMedicion: new Date().toISOString().split('T')[0],
        fechaHallazgo: new Date().toISOString().split('T')[0],
        estatusHallazgo: 'Abierto'
      };

      if (db) db.child(newId).set(nuevoEquipo);
      window.CIO.irANivel3Equipo(newId);
    },

    eliminarEquipo: function() {
      if (confirm('¿Eliminar activo en DEV?') && db && state.equipoSeleccionado) {
        db.child(state.equipoSeleccionado.id).remove();
        document.getElementById('modalEdicion').close();
        window.CIO.goScreen(2);
      }
    },

    // INFORME TÉCNICO EDITABLE PRE-IMPRESIÓN (CON LOGO CPF)
    abrirEditorInformeModal: function() {
      if (!state.usuarioActivo) {
        alert("🔒 Acción restringida: Debes iniciar sesión con tu cuenta de usuario para emitir o editar informes ejecutivos.");
        return;
      }

      var eq = state.equipos.find(function(e) { return e.id === state.equipoIdNivel3; });
      if (!eq) return;

      var tagValue = eq.tag || eq.Tag || eq.id || 'S/T';
      document.getElementById('infModalTitle').innerText = 'Edición de Informe: ' + tagValue + ' (' + eq.siteId + ')';

      var saps = consolidarSAPs(eq.componentes);
      document.getElementById('infAvisosSap').value = saps.avisosStr !== 'Sin Avisos' ? saps.avisosStr : '';
      document.getElementById('infOmSap').value = saps.omsStr !== 'Sin OM' ? saps.omsStr : '';
      document.getElementById('infResumenGeneral').value = 'Se realiza evaluación de condición dinámica al tren motriz del activo ' + tagValue + '. Condición global evaluada: ' + calcMaxSev(eq.componentes).toUpperCase() + '.';

      var cont = document.getElementById('infComponentesContainer');
      cont.innerHTML = '';

      (eq.componentes || []).forEach(function(c) {
        var card = document.createElement('div');
        card.className = 'card-component-editor';
        card.style.padding = '12px 16px';
        card.innerHTML = '<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">' +
            '<strong style="color:#60a5fa;">Componente: ' + sanitize(c.nombre || 'Componente') + '</strong>' +
            '<span style="font-weight:bold; color:' + (SEV_COLOR[c.severidad] || '#fff') + ';">' + (c.severidad || 'Verde') + ' (' + (c.rms || '0.0') + ' mm/s)</span>' +
          '</div>' +
          '<div style="margin-bottom:8px;">' +
            '<label style="font-size:0.7rem; color:var(--text-muted);">Diagnóstico Técnico del Componente (Editable):</label>' +
            '<textarea class="inf-c-analisis" rows="2">' + sanitize(c.analisis || '') + '</textarea>' +
          '</div>' +
          '<div>' +
            '<label style="font-size:0.7rem; color:var(--text-muted);">Recomendación Operativa / Mantención (Editable):</label>' +
            '<textarea class="inf-c-recom" rows="2">' + sanitize(c.recomendacion || '') + '</textarea>' +
          '</div>';
        cont.appendChild(card);
      });

      document.getElementById('modalEditorInforme').showModal();
    },

    emitirInformeFinalImpresion: function() {
      var eq = state.equipos.find(function(e) { return e.id === state.equipoIdNivel3; });
      if (!eq) return;

      var tagValue = eq.tag || eq.Tag || eq.id || 'S/T';
      var avisosEditados = document.getElementById('infAvisosSap').value.trim() || 'Sin Avisos';
      var omsEditadas = document.getElementById('infOmSap').value.trim() || 'Sin OM';
      var conclusionGeneral = document.getElementById('infResumenGeneral').value.trim();

      var aud = calcularDiasDesdeMedicion(eq.fechaMedicion);
      var sevGlobal = calcMaxSev(eq.componentes);

      var compCards = document.querySelectorAll('#infComponentesContainer .card-component-editor');
      var compsHtml = '';

      (eq.componentes || []).forEach(function(c, i) {
        var card = compCards[i];
        var analisisTxt = card ? card.querySelector('.inf-c-analisis').value : c.analisis;
        var recomTxt = card ? card.querySelector('.inf-c-recom').value : c.recomendacion;
        var col = SEV_COLOR[c.severidad] || '#4b5563';

        var sapsHtml = '';
        if (c.paresSap && c.paresSap.length > 0) {
          sapsHtml = '<div style="font-size:0.8rem; color:#1e40af; margin-bottom:6px;">' +
            c.paresSap.map(function(p) { return '<strong>Aviso:</strong> ' + sanitize(p.aviso || 'S/A') + ' ➔ <strong>OM:</strong> ' + sanitize(p.om || 'S/OM'); }).join(' | ') +
          '</div>';
        }

        compsHtml += '<div style="border:1px solid #e5e7eb; border-left:5px solid ' + col + '; border-radius:6px; padding:12px 14px; margin-bottom:12px; page-break-inside:avoid;">' +
            '<div style="display:flex; justify-content:space-between; font-weight:bold; font-size:0.95rem; margin-bottom:6px;">' +
              '<span>' + sanitize(c.nombre || 'Componente') + '</span>' +
              '<span style="color:' + col + ';">' + (c.severidad || 'Verde').toUpperCase() + ' (' + (c.rms || '0.0') + ' mm/s)</span>' +
            '</div>' +
            sapsHtml +
            '<div style="font-size:0.88rem; color:#1f2937; margin-bottom:6px; line-height:1.4;"><strong>Diagnóstico Técnico:</strong><br>' + sanitize(analisisTxt || 'Sin análisis registrado.') + '</div>' +
            '<div style="font-size:0.88rem; color:#065f46; line-height:1.4;"><strong>Recomendación Mecánica:</strong><br>' + sanitize(recomTxt || 'Mantener monitoreo.') + '</div>' +
          '</div>';
      });

      var myReports = state.alertasTerreno
        .filter(function(a) { return matchTags(a.tag, tagValue); })
        .sort(function(a, b) { return new Date(b.timestamp || 0) - new Date(a.timestamp || 0); });

      var reportsHtml = '';
      if (myReports.length > 0) {
        myReports.forEach(function(r, i) {
          var imgTag = r.fotoBase64 ? ('<div><img src="' + r.fotoBase64 + '" style="max-width:320px; max-height:220px; border-radius:4px; margin-top:8px; border:1px solid #ccc;" alt="Evidencia"></div>') : '';
          reportsHtml += '<div style="border:1px solid #e5e7eb; border-radius:6px; padding:10px 14px; margin-bottom:10px; page-break-inside:avoid;">' +
              '<div style="display:flex; justify-content:space-between; font-size:0.75rem; color:#6b7280; margin-bottom:4px;">' +
                '<span><strong>Reporte #' + (myReports.length - i) + '</strong> | ' + (r.timestamp ? new Date(r.timestamp).toLocaleString() : 'N/D') + '</span>' +
                '<span style="font-weight:bold; color:' + (SEV_COLOR[r.severidad] || '#000') + ';">' + r.severidad + '</span>' +
              '</div>' +
              '<div style="font-size:0.9rem;">' + sanitize(r.detalle) + '</div>' +
              imgTag +
            '</div>';
        });
      } else {
        reportsHtml = '<div style="font-size:0.85rem; color:#6b7280; font-style:italic;">No se registran eventos de terreno para este activo.</div>';
      }

      var win = window.open('', '_blank');
      win.document.write(
        '<!DOCTYPE html>' +
        '<html lang="es">' +
        '<head>' +
          '<meta charset="UTF-8">' +
          '<title>Informe Técnico Oficial - ' + tagValue + ' - CPF Ingeniería</title>' +
          '<style>' +
            'body { font-family: "Helvetica Neue", Arial, sans-serif; padding: 30px; color: #1f2937; margin: 0; background: #fff; line-height:1.4; }' +
            '.header-report { display: flex; justify-content: space-between; align-items: center; border-bottom: 3px solid #1e3a8a; padding-bottom: 14px; margin-bottom: 18px; }' +
            '.header-report h1 { margin: 0; font-size: 1.35rem; color: #1e3a8a; text-transform: uppercase; }' +
            '.header-report p { margin: 2px 0 0 0; font-size: 0.8rem; color: #6b7280; font-weight: bold; }' +
            '.badge-sev { display: inline-block; padding: 4px 12px; border-radius: 4px; font-weight: bold; color: #fff; background: ' + (SEV_COLOR[sevGlobal] || '#4b5563') + '; text-transform: uppercase; }' +
            '.data-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; padding: 14px; margin-bottom: 18px; font-size: 0.85rem; }' +
            '.data-item strong { display: block; font-size: 0.7rem; color: #4b5563; text-transform: uppercase; margin-bottom:2px; }' +
            '.section-title { font-size: 1rem; color: #1e3a8a; border-left: 4px solid #1e3a8a; padding-left: 8px; margin: 22px 0 10px 0; text-transform: uppercase; font-weight: bold; }' +
            '.box-conclusion { background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 6px; padding: 12px 14px; font-size: 0.9rem; margin-bottom: 18px; }' +
            '.print-btn-bar { margin-bottom: 20px; display: flex; gap: 10px; }' +
            '.btn-print { background: #1e3a8a; color: #fff; border: none; padding: 8px 18px; border-radius: 6px; font-weight: bold; cursor: pointer; }' +
            '@media print { .print-btn-bar { display: none; } body { padding: 10px; } }' +
          '</style>' +
        '</head>' +
        '<body>' +
          '<div class="print-btn-bar">' +
            '<button class="btn-print" onclick="window.print()">🖨️ Imprimir / Guardar como PDF</button>' +
            '<button class="btn-print" style="background:#4b5563;" onclick="window.close()">Cerrar</button>' +
          '</div>' +
          '<div class="header-report">' +
            '<div style="display: flex; align-items: center; gap: 16px;">' +
              '<div style="background: #ffffff; padding: 6px 14px; border-radius: 8px; border: 1px solid #d1d5db; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 6px rgba(0,0,0,0.08);">' +
                '<img src="logo-cpf.png" alt="Logo CPF" style="height: 48px; width: auto; object-fit: contain; display: block;" onerror="this.style.display=\'none\'" />' +
              '</div>' +
              '<div>' +
                '<h1>INFORME OFICIAL DE MONITOREO TREN MOTRIZ</h1>' +
                '<p>CPF INGENIERÍA LTDA | COMPAÑÍA MINERA DEL PACÍFICO | CIO</p>' +
              '</div>' +
            '</div>' +
            '<div><span class="badge-sev">CONDICIÓN: ' + sevGlobal + '</span></div>' +
          '</div>' +
          '<div class="data-grid">' +
            '<div class="data-item"><strong>Faena Operativa</strong>' + sanitize(eq.siteId) + '</div>' +
            '<div class="data-item"><strong>Área</strong>' + sanitize(eq.area) + '</div>' +
            '<div class="data-item"><strong>Tag Equipo</strong>' + sanitize(tagValue) + '</div>' +
            '<div class="data-item"><strong>Clase</strong>' + sanitize(eq.tipo || 'Activo Crítico') + '</div>' +
            '<div class="data-item"><strong>Avisos SAP Totales</strong>' + sanitize(avisosEditados) + '</div>' +
            '<div class="data-item"><strong>Órdenes OM SAP</strong>' + sanitize(omsEditadas) + '</div>' +
            '<div class="data-item"><strong>Última Medición</strong>' + (eq.fechaMedicion || 'S/F') + ' (' + aud.texto + ')</div>' +
            '<div class="data-item"><strong>Auditoría de Ruta</strong>' + (aud.vencido ? '⚠️ RUTA VENCIDA (>30 Días)' : '✅ RUTA AL DÍA') + '</div>' +
            '<div class="data-item"><strong>Especialista Emisor</strong>' + sanitize(state.usuarioActivo || 'Supervisor Predictivo') + '</div>' +
          '</div>' +
          '<div class="section-title">1. Resumen Ejecutivo & Conclusiones Generales</div>' +
          '<div class="box-conclusion">' + sanitize(conclusionGeneral) + '</div>' +
          '<div class="section-title">2. Diagnóstico Técnico por Componente & Avisos Asignados</div>' +
          compsHtml +
          '<div class="section-title">3. Bitácora de Inspecciones y Hallazgos en Terreno (' + myReports.length + ')</div>' +
          reportsHtml +
          '<footer style="margin-top:35px; border-top:1px solid #ccc; padding-top:10px; font-size:0.75rem; color:#6b7280; text-align:center;">' +
            'Documento Técnico Emitido por el Centro Integrado de Operaciones (CIO) - CPF Ingeniería Ltda.' +
          '</footer>' +
        '</body>' +
        '</html>'
      );
      win.document.close();
      document.getElementById('modalEditorInforme').close();
    },

    procesarCargaExcelFaena: function(e) {
      var file = e.target.files[0];
      if (!file || !db) return;

      var targetSite = state.faenaSeleccionada || state.faenaAsignada || FAENAS[0];
      var reader = new FileReader();

      reader.onload = function(evt) {
        try {
          var data = new Uint8Array(evt.target.result);
          var wb = XLSX.read(data, { type: 'array', cellDates: true });
          var firstSheetName = wb.SheetNames[0];
          var worksheet = wb.Sheets[firstSheetName];
          var rawRows = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

          if (!rawRows || rawRows.length === 0) {
            alert("⚠️ La planilla seleccionada está vacía.");
            return;
          }

          var cargados = 0;
          var actualizaciones = {};

          rawRows.forEach(function(row) {
            var normalizedRow = {};
            Object.keys(row).forEach(function(k) {
              normalizedRow[k.trim().toUpperCase()] = row[k];
            });

            var rawTag = normalizedRow['EQUIPO'] || normalizedRow['TAG'] || normalizedRow['ACTIVO'] || normalizedRow['NOMBRE'];
            var rawArea = normalizedRow['AREA'] || normalizedRow['ÁREA'] || 'Área General';
            var rawTipo = normalizedRow['TIPO EQUIPO'] || normalizedRow['TIPO'] || normalizedRow['CLASE'] || 'Activo';
            var rawFecha = normalizedRow['ULTIMA FECHA'] || normalizedRow['FECHA MEDICION'] || normalizedRow['FECHA'];

            if (rawTag && String(rawTag).trim() !== '') {
              var tagStr = String(rawTag).trim();
              var areaStr = String(rawArea).trim() || 'General';
              var tipoStr = String(rawTipo).trim() || 'Activo';

              var fechaMedicionFinal = '';
              if (rawFecha instanceof Date && !isNaN(rawFecha.getTime())) {
                fechaMedicionFinal = rawFecha.toISOString().split('T')[0];
              } else if (typeof rawFecha === 'string' && rawFecha.trim() !== '') {
                var dateParsed = new Date(rawFecha);
                if (!isNaN(dateParsed.getTime())) {
                  fechaMedicionFinal = dateParsed.toISOString().split('T')[0];
                }
              }

              var safeTagId = tagStr.replace(/[\/\.\#\$\[\]]/g, '_');
              var recordId = 'EQ_' + safeTagId;

              actualizaciones[recordId] = {
                siteId: targetSite,
                domain: areaStr.toUpperCase().indexOf('MINA') !== -1 ? 'mina' : 'planta',
                area: areaStr,
                tag: tagStr,
                tipo: tipoStr,
                lat: '',
                lng: '',
                fechaMedicion: fechaMedicionFinal,
                fechaHallazgo: '',
                estatusHallazgo: 'Abierto',
                componentes: [
                  { nombre: 'M1 (Motor)', severidad: 'Verde', rms: '2.0', paresSap: [], analisis: 'Condición normal.', recomendacion: 'Ruta mensual.' },
                  { nombre: 'G1 (Reductor)', severidad: 'Verde', rms: '2.0', paresSap: [], analisis: 'Condición normal.', recomendacion: 'Ruta mensual.' }
                ]
              };

              cargados++;
            }
          });

          if (cargados === 0) {
            alert("⚠️ No se encontraron equipos válidos en las columnas.");
            return;
          }

          db.update(actualizaciones)
            .then(function() {
              alert('✅ Carga masiva exitosa: ' + cargados + ' equipos importados en ' + targetSite + '.');
            })
            .catch(function(err) {
              alert('❌ Error al guardar en Firebase: ' + err.message);
            });

        } catch (err) {
          console.error("Error al procesar Excel:", err);
          alert('❌ Error al leer el archivo Excel: ' + err.message);
        }
      };

      reader.readAsArrayBuffer(file);
      e.target.value = '';
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', refresh);
  } else {
    refresh();
  }
})();
