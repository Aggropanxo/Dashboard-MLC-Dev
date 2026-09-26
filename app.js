(() => {
  'use strict';

  var firebaseConfig = {
    apiKey: "AIzaSyBd5MEZdMmgzBs1xCyeGYeKtQx5gJIeY3w",
    authDomain: "dashboard-vulnerabilidades-mlc.firebaseapp.com",
    databaseURL: "https://dashboard-vulnerabilidades-mlc-default-rtdb.firebaseio.com",
    projectId: "dashboard-vulnerabilidades-mlc"
  };

  var GOOGLE_SHEETS_WEBHOOK_URL = "https://script.google.com/macros/s/AKfycbxxSrWh52i2QlHP5KG9mI9BOdlBFgwbtD7Sx0zgE0VOyK6bRWokkFJy3raUvC8_x0IOnQ/exec";
  var GEMINI_API_KEY = localStorage.getItem("GEMINI_API_KEY") || "";

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

  var horaAperturaTabMs = Date.now();

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
    componenteIndexDetalle: -1,
    siteMapVisible: false,
    authMode: 'login',
    mapaSite: null,
    capaSite: null,
    equipos: [],
    alertasTerreno: [],
    tempEvidenciasEdicion: [],
    tipoSubidaActual: 'espectro',
    tempEvidenciasReporte: []
  };

  function sanitize(str) {
    return (str || '').replace(/[<>&"']/g, function(m) {
      return { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[m];
    });
  }

  function limpiarPrefijosIA(texto) {
    if (!texto) return '';
    return texto
      .replace(/^\[.*?\]:\s*/gi, '')
      .replace(/^\[IA.*?\]\s*/gi, '')
      .trim();
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
    return {
      dias: dias,
      vencido: dias > 30,
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
          pares.push({
            componente: (c.nombre || 'Componente') + (c.punto ? ' (' + c.punto + ')' : ''),
            aviso: av || 'S/A',
            om: om || 'S/OM'
          });
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

  function actualizarBadgeContadorAlertas(total) {
    var btnBit = document.getElementById('labelBitacoraBtn');
    if (btnBit) {
      btnBit.innerText = 'Bitácora Alertas (' + total + ')';
    }
  }

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

      card.innerHTML = 
        '<div class="card-top-bar">' +
          '<span class="label-muted">Faena Operativa CMP</span>' +
          '<span class="badge-indicator" style="background:' + SEV_COLOR[d.maxSev] + '; color:#fff;">' + d.maxSev.toUpperCase() + '</span>' +
        '</div>' +
        '<h3 class="value-strong" style="margin:4px 0 10px 0;">' + sanitize(d.name) + '</h3>' +
        '<div style="display:flex; justify-content:space-between; border-top:1px solid var(--glass-border); padding-top:8px;">' +
          '<div><span class="label-muted">Activos</span><div class="value-strong">' + d.count + '</div></div>' +
          '<div><span class="label-muted">Condición</span><div class="value-strong" style="color:' + SEV_COLOR[d.maxSev] + '">' + (d.critical > 0 ? (d.critical + ' Alertas') : 'Normal') + '</div></div>' +
        '</div>';
      container.appendChild(card);
    });
  }

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

      var sortedAreas = Object.keys(areas).map(function(a) {
        var obj = { name: a };
        for (var k in areas[a]) { obj[k] = areas[a][k]; }
        return obj;
      }).sort(function(a, b) { return (b.maxPeso - a.maxPeso) || (b.critical - a.critical); });

      container.className = 'grid-container';
      container.innerHTML = '';

      if (sortedAreas.length === 0) {
        container.innerHTML = '<div class="label-muted" style="padding:20px;">Sin áreas registradas. Realiza una carga masiva.</div>';
        return;
      }

      sortedAreas.forEach(function(a) {
        var card = document.createElement('article');
        card.className = 'card-area ' + (a.maxSev === 'Rojo' || a.maxSev === 'Naranja' ? 'anim-' + a.maxSev.toLowerCase() : '');
        card.onclick = function() { window.CIO.seleccionarArea(a.name); };

        card.innerHTML = 
          '<div class="card-top-bar">' +
            '<span class="label-muted">Área Operacional</span>' +
            '<span class="badge-indicator" style="background:' + SEV_COLOR[a.maxSev] + '; color:#fff;">' + a.maxSev.toUpperCase() + '</span>' +
          '</div>' +
          '<h3 class="value-strong" style="margin:4px 0 10px 0;">' + sanitize(a.name) + '</h3>' +
          '<div style="display:flex; justify-content:space-between; border-top:1px solid var(--glass-border); padding-top:8px;">' +
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
      navHeader.style.cssText = "grid-column: 1/-1; display:flex; align-items:center; gap:10px; margin-bottom:4px; padding:8px 12px; border-radius:8px; background:var(--glass-card); border:1px solid var(--glass-border);";
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
        card.onclick = function() { window.CIO.irANivel3Equipo(eq.id); };

        var badgeTerreno = fieldReports.length > 0 ? ('<span class="badge-indicator badge-reportes">💬 ' + fieldReports.length + '</span>') : '';
        var badgeRuta = aud.vencido 
          ? ('<span class="badge-indicator badge-vencido">⏱️ >30d</span>') 
          : ('<span class="badge-indicator badge-al-dia">✅ Al día</span>');
        
        var badgeSap = saps.countAvisos > 0 
          ? ('<div style="font-size:0.68rem; color:#2563eb; font-weight:700;">AV: ' + saps.countAvisos + ' | OM: ' + saps.countOms + '</div>') 
          : '';

        card.innerHTML = 
          '<div class="card-top-bar">' +
            '<span class="eq-type">' + sanitize(eq.tipo || eq.area) + '</span>' +
            '<div style="display:flex; gap:4px;">' + badgeTerreno + badgeRuta + '</div>' +
          '</div>' +
          '<div class="eq-tag code-font">' + sanitize(tagValue) + '</div>' +
          '<div style="display:flex; justify-content:space-between; align-items:center; margin-top:6px;">' +
            '<span style="color:' + SEV_COLOR[s] + '; font-weight:800; font-size:0.8rem;">' + s.toUpperCase() + '</span>' +
            badgeSap +
          '</div>';

        container.appendChild(card);
      });
    }
  }

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
    
    var bCrumb = document.getElementById('n3Breadcrumb');
    if (bCrumb) bCrumb.innerText = (eq.siteId || '') + ' | ' + (eq.area || '') + ' | TAG: ' + tagValue;
    
    var titleN3 = document.getElementById('n3Title');
    if (titleN3) titleN3.innerText = (eq.tipo || 'Activo') + ' - ' + (eq.area || '');

    var aud = calcularDiasDesdeMedicion(eq.fechaMedicion);
    var bannerMed = document.getElementById('n3BannerMedicion');
    if (bannerMed) {
      bannerMed.innerHTML = aud.vencido
        ? ('<span class="banner-contador-alerta vencido">⚠️ RUTA VENCIDA: ' + aud.texto + ' (>30 días)</span>')
        : ('<span class="banner-contador-alerta al-dia">✅ RUTA AL DÍA: ' + aud.texto + '</span>');
    }

    var grid = document.getElementById('n3GridCards');
    if (!grid) return;
    grid.innerHTML = '';

    var compsIndexed = (eq.componentes || []).map(function(c, idx) { return { comp: c, originalIndex: idx }; });
    compsIndexed.sort(function(a, b) { return SEV_PESO[b.comp.severidad || 'Plomo'] - SEV_PESO[a.comp.severidad || 'Plomo']; });

    compsIndexed.forEach(function(item) {
      var c = item.comp;
      var s = c.severidad || 'Verde';
      var card = document.createElement('article');
      card.className = 'card-equipo sev-' + s.toLowerCase() + ' ' + (s === 'Rojo' || s === 'Naranja' ? 'anim-' + s.toLowerCase() : '');
      
      card.onclick = function() {
        if (state.usuarioActivo) {
          window.CIO.abrirEditorComponenteIndividual(item.originalIndex);
        } else {
          window.CIO.abrirDetalleComponenteModal(item.originalIndex);
        }
      };

      var cantEvidencias = (c.espectros && c.espectros.length > 0) ? c.espectros.length : 0;
      var badgeFotos = cantEvidencias > 0 ? ('<span class="badge-indicator badge-reportes">📷 ' + cantEvidencias + ' Evidencias</span>') : '';

      var sapsCount = (c.paresSap && c.paresSap.length > 0) ? c.paresSap.length : 0;
      var badgeSap = sapsCount > 0 ? ('<div style="font-size:0.65rem; color:#2563eb; font-weight:700;">SAP: ' + sapsCount + ' Par(es)</div>') : '';

      card.innerHTML = 
        '<div class="card-top-bar">' +
          '<span class="eq-type" style="color:#2563eb; font-weight:800;">' + sanitize(c.nombre || 'Componente') + '</span>' +
          badgeFotos +
        '</div>' +
        '<div class="eq-tag code-font" style="font-size:0.88rem;">' + sanitize(c.punto || 'Punto General') + '</div>' +
        '<div style="display:flex; justify-content:space-between; align-items:center; margin-top:6px;">' +
          '<span style="font-weight:800; font-size:0.8rem; color:' + SEV_COLOR[s] + ';">' + s.toUpperCase() + ' (' + (c.rms || '0.0') + ' mm/s)</span>' +
          badgeSap +
        '</div>';

      grid.appendChild(card);
    });

    var myReports = state.alertasTerreno
      .filter(function(a) { return matchTags(a.tag, tagValue); })
      .sort(function(a, b) { return new Date(b.timestamp || 0) - new Date(a.timestamp || 0); });

    var cardTerreno = document.createElement('article');
    cardTerreno.className = 'card-equipo';
    cardTerreno.style.borderColor = 'rgba(2, 132, 199, 0.4)';
    cardTerreno.onclick = function() { window.CIO.abrirModalHistoricoTerreno(); };

    cardTerreno.innerHTML = 
      '<div class="card-top-bar">' +
        '<span class="eq-type" style="color:#0284c7; font-weight:bold;">RONDA EN PLANTA</span>' +
        '<span class="badge-indicator badge-reportes">' + myReports.length + ' Reportes</span>' +
      '</div>' +
      '<div class="eq-tag code-font" style="font-size:0.88rem; color:#0284c7;">📸 Terreno</div>' +
      '<div style="margin-top:6px; font-size:0.75rem; color:var(--text-muted);">Ver Historial Completo</div>';

    grid.appendChild(cardTerreno);
  }

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
      card.innerHTML = 
        '<div class="card-top-bar">' +
          '<span class="label-muted">' + sanitize(eq.siteId) + '</span>' +
          '<span class="badge-indicator" style="background:' + SEV_COLOR[s] + '; color:#fff;">' + s.toUpperCase() + '</span>' +
        '</div>' +
        '<div class="eq-tag code-font">' + sanitize(tagValue) + '</div>' +
        '<div style="margin-top:6px;">' +
          '<button class="btn-base btn-primary" type="button" style="padding:2px 8px; font-size:0.65rem;" onclick="window.CIO.irANivel3Equipo(\'' + eq.id + '\')">🔍 Ver Nivel 3</button>' +
        '</div>';
      container.appendChild(card);
    });
  }

  function renderScreen5() {
    var eq = state.equipos.find(function(e) { return e.id === state.equipoIdNivel3; });
    if (!eq) {
      window.CIO.goScreen(3);
      return;
    }

    var idx = state.componenteIndexEdit;
    var c = (eq.componentes && eq.componentes[idx]) ? eq.componentes[idx] : {
      nombre: 'Nuevo Componente', punto: 'Punto de Medición', rms: '2.0', severidad: 'Verde', paresSap: [], analisis: '', recomendacion: '', espectros: []
    };

    var bCrumb = document.getElementById('n4Breadcrumb');
    if (bCrumb) bCrumb.innerText = eq.siteId + ' | ' + eq.area + ' | TAG: ' + (eq.tag || eq.id);

    var titleN4 = document.getElementById('n4Title');
    if (titleN4) titleN4.innerText = 'Edición: ' + (c.nombre || 'Componente') + ' (' + (c.punto || 'Punto') + ')';

    document.getElementById('edCompIndex').value = idx;
    document.getElementById('indCompNombre').value = c.nombre || '';
    document.getElementById('indCompPunto').value = c.punto || '';
    document.getElementById('indCompRms').value = c.rms || '2.0';
    document.getElementById('indCompSev').value = c.severidad || 'Verde';

    document.getElementById('indCompAnalisis').value = limpiarPrefijosIA(c.analisis);
    document.getElementById('indCompRecom').value = limpiarPrefijosIA(c.recomendacion);

    document.getElementById('indSugAnalisis').value = '';
    document.getElementById('indSugRecom').value = '';

    state.tempEvidenciasEdicion = (c.espectros || []).map(function(item) {
      if (typeof item === 'string') {
        return { src: item, tipo: 'espectro' };
      }
      return item;
    });

    window.CIO.renderMiniaturasEvidencias();

    var paresBox = document.getElementById('indParesSapContainer');
    if (paresBox) {
      paresBox.innerHTML = '';
      if (c.paresSap && c.paresSap.length > 0) {
        c.paresSap.forEach(function(p) { window.CIO.insertarFilaParSapEnContenedor(paresBox, p.aviso, p.om); });
      } else {
        window.CIO.insertarFilaParSapEnContenedor(paresBox, '', '');
      }
    }
  }

  // -------------------------------------------------------------
  // SINCRONIZACIÓN REACTIVA CON FIREBASE (ROBUSTA & REALTIME)
  // -------------------------------------------------------------
  if (db) {
    db.on('value', function(snap) {
      var raw = snap.val();
      if (raw && Object.keys(raw).length > 0) {
        state.equipos = Object.keys(raw).map(function(k) {
          var item = raw[k] || {};
          return {
            id: k,
            siteId: normalizarFaena(item.siteId || item.site || item.faena || 'Planta, Mina los Colorados'),
            domain: item.domain || 'planta',
            area: item.area || 'Sin Área',
            tag: item.tag || item.Tag || item.TAG || item.equipo || k,
            tipo: item.tipo || 'Activo',
            lat: item.lat || '',
            lng: item.lng || '',
            componentes: item.componentes || [],
            fechaMedicion: item.fechaMedicion || '',
            fechaHallazgo: item.fechaHallazgo || '',
            estatusHallazgo: item.estatusHallazgo || 'Abierto'
          };
        });
      }
      refresh();
    });

    if (dbAlertasTerreno) {
      // 1. Escuchar la colección completa de alertas en tiempo real
      dbAlertasTerreno.on('value', function(snap) {
        var raw = snap.val();
        var lista = [];

        if (raw) {
          Object.keys(raw).forEach(function(k) {
            var item = raw[k] || {};
            item.id = k;

            // Normalización para desempacar TODAS las evidencias (fotos y videos)
            if (!item.evidencias && item.fotoBase64) {
              item.evidencias = [{ tipo: 'imagen', data: item.fotoBase64 }];
            } else if (item.evidencias && Array.isArray(item.evidencias)) {
              // Ya viene como arreglo completo
            } else {
              item.evidencias = [];
            }

            lista.push(item);
          });
        }

        // Ordenar: el más reciente primero
        lista.sort(function(a, b) {
          return new Date(b.timestamp || 0) - new Date(a.timestamp || 0);
        });

        state.alertasTerreno = lista;
        actualizarBadgeContadorAlertas(lista.length);
        refresh();
      });

      // 2. Disparar alarma flotante interactiva ante nueva inserción
      dbAlertasTerreno.on('child_added', function(snap) {
        var alerta = snap.val();
        if (!alerta) return;
        alerta.id = snap.key;

        var timeAlerta = new Date(alerta.timestamp || 0).getTime();
        // Si el reporte fue emitido en los últimos 25 segundos o durante la sesión activa
        if (timeAlerta >= (horaAperturaTabMs - 25000)) {
          window.CIO.dispararAlarmaFlotante(alerta);
        }
      });
    }
  }

  function refresh() {
    try {
      if (state.currentScreen === 1) renderScreen1();
      else if (state.currentScreen === 2) renderScreen2();
      else if (state.currentScreen === 3) renderScreen3();
      else if (state.currentScreen === 4) renderScreen4();
      else if (state.currentScreen === 5) renderScreen5();
    } catch (e) {
      console.error("Error al refrescar interfaz:", e);
    }
  }

  window.CIO = {
    dispararAlarmaFlotante: function(reporte) {
      var toast = document.getElementById('liveAlertToast');
      if (!toast) return;

      var sevBadge = document.getElementById('toastBadgeSev');
      var tagTitle = document.getElementById('toastTagTitle');
      var detalleTxt = document.getElementById('toastDetalle');
      var btnVer = document.getElementById('toastBtnVer');

      var sev = reporte.severidad || 'Rojo';
      if (sevBadge) {
        sevBadge.innerText = sev.toUpperCase();
        sevBadge.style.background = SEV_COLOR[sev] || '#ef4444';
      }
      if (tagTitle) {
        tagTitle.innerText = (reporte.tag || 'EQUIPO') + (reporte.componente ? ' (' + reporte.componente + ')' : '');
      }
      if (detalleTxt) {
        detalleTxt.innerText = reporte.detalle || 'Nueva alerta de terreno registrada.';
      }

      if (btnVer) {
        btnVer.onclick = function() {
          toast.style.display = 'none';
          window.CIO.abrirModalEditarReporteTerreno(reporte.id);
        };
      }

      toast.style.display = 'flex';

      try {
        var audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        var osc = audioCtx.createOscillator();
        var gain = audioCtx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(659.25, audioCtx.currentTime);
        osc.frequency.setValueAtTime(880.00, audioCtx.currentTime + 0.15);
        gain.gain.setValueAtTime(0.25, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.35);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.35);
      } catch (e) {}

      setTimeout(function() {
        if (toast.style.display === 'flex') toast.style.display = 'none';
      }, 14000);
    },

    abrirBitacoraAlertasTurno: function() {
      window.CIO.renderizarFeedBitacora();
      var modal = document.getElementById('modalBitacoraTurno');
      if (modal) modal.showModal();
    },

    renderizarFeedBitacora: function() {
      var cont = document.getElementById('bitacoraFeedContainer');
      if (!cont) return;

      var filtro = document.getElementById('filterBitacoraSev')?.value || 'TODAS';
      var lista = state.alertasTerreno.slice();

      if (filtro !== 'TODAS') {
        lista = lista.filter(function(a) { return a.severidad === filtro; });
      }

      if (lista.length === 0) {
        cont.innerHTML = '<div style="padding:28px; text-align:center; color:var(--text-muted); font-style:italic;">No hay alertas registradas en este turno.</div>';
        return;
      }

      cont.innerHTML = lista.map(function(r) {
        var hora = r.timestamp ? new Date(r.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'S/H';
        var fecha = r.timestamp ? new Date(r.timestamp).toLocaleDateString() : '';
        var col = SEV_COLOR[r.severidad] || '#0284c7';

        // Contabilizar total de fotos/videos de esta alerta
        var cantEvid = (r.evidencias && r.evidencias.length) ? r.evidencias.length : (r.fotoBase64 ? 1 : 0);

        return '<div style="background:var(--card-inner-bg); border:1px solid var(--glass-border); border-left:5px solid ' + col + '; border-radius:10px; padding:14px 18px; margin-bottom:12px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;">' +
            '<div style="flex:1; min-width:260px;">' +
              '<div style="display:flex; align-items:center; gap:8px;">' +
                '<span class="badge-indicator" style="background:' + col + '; color:#fff;">' + (r.severidad || 'Seguimiento').toUpperCase() + '</span>' +
                '<strong class="code-font" style="font-size:1.05rem; color:var(--text-main);">' + sanitize(r.tag) + '</strong>' +
                (r.componente ? ('<span style="font-size:0.84rem; color:#38bdf8; font-weight:700;">➔ ' + sanitize(r.componente) + '</span>') : '') +
                (cantEvid > 0 ? ('<span class="badge-indicator badge-reportes">📷 ' + cantEvid + ' Archivo(s)</span>') : '') +
              '</div>' +
              '<div style="font-size:0.86rem; color:var(--text-muted); margin-top:6px; line-height:1.4;">' + sanitize(r.detalle) + '</div>' +
              '<div style="font-size:0.72rem; color:var(--text-muted); margin-top:4px;">Faena: ' + sanitize(r.faena || 'CMP') + ' | Área: ' + sanitize(r.area || 'General') + ' | ⏱️ ' + fecha + ' ' + hora + '</div>' +
            '</div>' +
            '<div style="display:flex; gap:8px;">' +
              '<button class="btn-base btn-primary" type="button" style="padding:6px 14px; font-size:0.78rem;" onclick="window.CIO.abrirModalEditarReporteTerreno(\'' + r.id + '\')">👁️ Ver Evidencias (' + cantEvid + ')</button>' +
              '<button class="btn-base" type="button" style="padding:6px 14px; font-size:0.78rem;" onclick="window.CIO.navegarDesdeAlerta(\'' + r.tag + '\')">🎯 Ir al Activo</button>' +
            '</div>' +
          '</div>';
      }).join('');
    },

    navegarDesdeAlerta: function(tag) {
      var eq = state.equipos.find(function(e) { return matchTags(e.tag, tag); });
      var modal = document.getElementById('modalBitacoraTurno');
      if (modal) modal.close();

      if (eq) {
        window.CIO.irANivel3Equipo(eq.id);
      } else {
        alert("ℹ️ El activo " + tag + " es un hallazgo libre no registrado formalmente en el catastro de activos.");
      }
    },

    goScreen: function(num) {
      state.currentScreen = num;
      document.querySelectorAll('.screen-view, [id^="screen-"]').forEach(function(el) { 
        el.classList.remove('active');
        el.style.display = 'none';
      });
      
      var sc = document.getElementById('screen-' + num);
      if (sc) {
        sc.classList.add('active');
        sc.style.display = 'block';
      }

      var headerTitle = document.getElementById('headerScreenTitle');
      var titles = { 
        1: 'Vista Pública (Global - DEV)', 
        2: 'Faena: ' + (state.faenaSeleccionada || 'Operativa'), 
        3: 'Nivel 3: Tren Motriz & Puntos de Inspección', 
        4: 'Consola SuperAdmin (DEV)',
        5: 'Nivel 4: Consola de Diagnóstico & Espectros'
      };
      if (headerTitle) headerTitle.innerText = titles[num] || 'CIO';
      refresh();
    },

    seleccionarFaena: function(f) {
      state.faenaSeleccionada = f;
      state.areaSeleccionada = null;
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

    irANivel3Equipo: function(id) {
      state.equipoIdNivel3 = id;
      window.CIO.goScreen(3);
    },

    volverDeNivel3: function() {
      window.CIO.goScreen(2);
    },

    volverDeNivel4: function() {
      window.CIO.goScreen(3);
    },

    toggleTheme: function() {
      document.body.classList.toggle('light-mode');
      var isLight = document.body.classList.contains('light-mode');
      localStorage.setItem('CIO_THEME', isLight ? 'light' : 'dark');
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

    salirSuperAdmin: function() {
      state.isSuperAdmin = false;
      window.CIO.goScreen(1);
    },

    renderScreen4Global: function() {
      renderScreen4();
    },

    exportarReporteGerenciaAlta: function() {
      var txt = 'REPORTE GERENCIA GENERAL CIO - CMP\nTotal Activos: ' + state.equipos.length + '\nFecha: ' + new Date().toISOString();
      var blob = new Blob([txt], { type: 'text/plain;charset=utf-8' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'Reporte_Gerencia_CIO_' + Date.now() + '.txt';
      a.click();
    },

    exportarReporteGerenciaPorFaena: function() {
      var filterEl = document.getElementById('superAdminFilterSite');
      var target = filterEl ? filterEl.value : (state.faenaSeleccionada || FAENAS[0]);
      var count = state.equipos.filter(function(e) { return normalizarFaena(e.siteId) === target; }).length;
      var txt = 'REPORTE FAENA [' + target + ']\nTotal Activos: ' + count + '\nFecha: ' + new Date().toISOString();
      var blob = new Blob([txt], { type: 'text/plain;charset=utf-8' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'Reporte_' + target.replace(/[^a-zA-Z0-9]/g, '_') + '.txt';
      a.click();
    },

    abrirEdicionGlobalNuevo: function() {
      if (!state.usuarioActivo) {
        alert("🔒 Inicia sesión para registrar nuevos activos.");
        return;
      }
      window.CIO.abrirEdicionEquipoNuevoAuth();
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
      if (boxName) boxName.style.setProperty('display', isReg ? 'flex' : 'none', 'important');
      if (boxSite) boxSite.style.setProperty('display', isReg ? 'flex' : 'none', 'important');

      var tabLogin = document.getElementById('tabBtnLogin');
      var tabReg = document.getElementById('tabBtnRegister');
      var btnSubmit = document.getElementById('authSubmitActionBtn');

      if (tabLogin) tabLogin.classList.toggle('is-active', !isReg);
      if (tabReg) tabReg.classList.toggle('is-active', isReg);
      if (btnSubmit) btnSubmit.innerText = isReg ? 'Registrarse y Entrar' : 'Ingresar al Sistema';
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
            loginLocal(fullname, selectedSite);
          });
        } else {
          loginLocal(fullname, selectedSite);
        }
      } else {
        if (dbUsers) {
          dbUsers.child(lookupId).once('value', function(snap) {
            var uData = snap.val();
            if (uData && uData.password === p) {
              loginLocal(uData.nombreCompleto || uData.usuario, uData.faenaAsignada || 'Planta, Mina los Colorados');
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
        if (dropInfo) dropInfo.innerText = 'Operador: ' + nombre + ' | ' + faena;
        var modal = document.getElementById('modalAuth');
        if (modal) modal.close();
        alert('✅ Bienvenido ' + nombre);
        refresh();
      }
    },

    cerrarSesionUsuario: function() {
      state.usuarioActivo = null;
      state.faenaAsignada = null;
      state.isSuperAdmin = false;

      document.body.classList.remove('user-authenticated');

      var lbl = document.getElementById('labelUsuarioBtn');
      if (lbl) lbl.innerText = 'Entrar';
      var dropInfo = document.getElementById('dropUserInfo');
      if (dropInfo) dropInfo.innerText = 'Invitado (Solo Lectura)';
      var uMenu = document.getElementById('userDropdownMenu');
      if (uMenu) uMenu.classList.remove('is-active');
      window.CIO.goScreen(1);
    },

    sincronizarConGoogleSheets: function(payload) {
      if (!GOOGLE_SHEETS_WEBHOOK_URL || GOOGLE_SHEETS_WEBHOOK_URL.indexOf("http") !== 0) return;

      fetch(GOOGLE_SHEETS_WEBHOOK_URL, {
        method: "POST",
        mode: "no-cors",
        cache: "no-cache",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(payload)
      }).then(function() {
        console.log("☁️ Transmitido a Google Sheets:", payload.tag, payload.componente);
      }).catch(function(err) {
        console.warn("Aviso al sincronizar con Sheets:", err);
      });
    },

    abrirDetalleComponenteModal: function(realIndex) {
      var eq = state.equipos.find(function(e) { return e.id === state.equipoIdNivel3; });
      if (!eq || !eq.componentes || !eq.componentes[realIndex]) return;

      state.componenteIndexDetalle = realIndex;
      var c = eq.componentes[realIndex];
      var s = c.severidad || 'Verde';
      var col = SEV_COLOR[s] || '#22c55e';

      var hTag = document.getElementById('detCompTagHeader');
      if (hTag) hTag.innerText = (eq.tag || 'EQUIPO') + ' | TREN MOTRIZ';

      var hTitle = document.getElementById('detCompTitle');
      if (hTitle) hTitle.innerText = (c.nombre || 'Componente') + ' - ' + (c.punto || 'Punto');
      
      var badgeSev = document.getElementById('detCompBadgeSev');
      if (badgeSev) {
        badgeSev.innerText = s.toUpperCase() + ' (' + (c.rms || '0.0') + ' mm/s)';
        badgeSev.style.color = col;
        badgeSev.style.borderColor = col;
      }

      var sapBox = document.getElementById('detCompParesSapBox');
      if (sapBox) {
        if (c.paresSap && c.paresSap.length > 0) {
          sapBox.innerHTML = '<span class="label-muted" style="color:#1d4ed8; margin-bottom:4px; display:block;">Órdenes SAP Asignadas:</span>' +
            c.paresSap.map(function(p) {
              return '<span style="display:inline-block; margin-right:14px; margin-top:4px;"><strong>AV:</strong> ' + sanitize(p.aviso || 'S/A') + ' ➔ <strong>OM:</strong> ' + sanitize(p.om || 'S/OM') + '</span>';
            }).join('');
        } else {
          sapBox.innerHTML = '<span style="color:var(--text-muted); font-size:0.8rem; font-style:italic;">Sin Avisos / Órdenes SAP vinculadas</span>';
        }
      }

      var txtAn = document.getElementById('detCompAnalisisTxt');
      if (txtAn) txtAn.innerText = limpiarPrefijosIA(c.analisis) || 'Sin análisis de vibraciones registrado.';

      var txtRec = document.getElementById('detCompRecomTxt');
      if (txtRec) txtRec.innerText = limpiarPrefijosIA(c.recomendacion) || 'Mantener monitoreo rutinario.';

      var galeria = document.getElementById('detCompGaleriaFotos');
      if (galeria) {
        if (c.espectros && c.espectros.length > 0) {
          galeria.innerHTML = c.espectros.map(function(item) {
            var src = typeof item === 'string' ? item : item.src;
            return '<div class="item-espectro-preview"><img src="' + src + '" alt="Evidencia" onclick="window.CIO.abrirFotoEnNuevaPestana(\'' + src + '\')" style="max-height:80px; border-radius:4px; cursor:pointer;" /></div>';
          }).join('');
        } else {
          galeria.innerHTML = '<div style="font-size:0.8rem; color:var(--text-muted); font-style:italic;">No hay espectros cargados.</div>';
        }
      }

      var btnEditDetalle = document.getElementById('btnEditarDesdeDetalle');
      if (btnEditDetalle) {
        btnEditDetalle.style.display = state.usuarioActivo ? 'inline-block' : 'none';
      }

      var mDet = document.getElementById('modalDetalleComponente');
      if (mDet) mDet.showModal();
    },

    editarComponenteDesdeDetalleModal: function() {
      if (!state.usuarioActivo) {
        alert("🔒 Debes iniciar sesión para editar.");
        return;
      }
      var idx = state.componenteIndexDetalle;
      var mDet = document.getElementById('modalDetalleComponente');
      if (mDet) mDet.close();
      window.CIO.abrirEditorComponenteIndividual(idx);
    },

    abrirEditorComponenteIndividual: function(idx) {
      if (!state.usuarioActivo) {
        alert("🔒 Acción restringida: Solo usuarios registrados pueden editar componentes.");
        return;
      }

      state.componenteIndexEdit = idx;
      window.CIO.goScreen(5);
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
        nombre: 'Nuevo Componente',
        punto: 'Lado Libre',
        rms: '2.0',
        severidad: 'Verde',
        paresSap: [],
        analisis: '',
        recomendacion: '',
        espectros: []
      });

      window.CIO.abrirEditorComponenteIndividual(nuevoIdx);
    },

    agregarFilaParSapIndividual: function() {
      var box = document.getElementById('indParesSapContainer');
      if (box) window.CIO.insertarFilaParSapEnContenedor(box, '', '');
    },

    insertarFilaParSapEnContenedor: function(container, avisoVal, omVal) {
      var row = document.createElement('div');
      row.style.cssText = "display:grid; grid-template-columns: 1fr 1fr auto; gap:10px; align-items:center; margin-bottom:8px;";
      row.className = 'fila-par-sap';
      row.innerHTML = '<input type="text" class="p-aviso code-font" placeholder="Aviso SAP" value="' + sanitize(avisoVal || '') + '" style="font-size:0.84rem; padding:8px 12px;">' +
        '<input type="text" class="p-om code-font" placeholder="OM SAP" value="' + sanitize(omVal || '') + '" style="font-size:0.84rem; padding:8px 12px;">' +
        '<button type="button" class="btn-base btn-danger" style="padding:6px 10px; font-size:0.75rem;" onclick="this.parentElement.remove()">&times;</button>';
      container.appendChild(row);
    },

    seleccionarTipoSubida: function(tipo) {
      state.tipoSubidaActual = tipo;
      var lbl = document.getElementById('labelZonaSubida');
      var nombres = {
        espectro: '📈 Espectro / Cascada FFT',
        termografia: '🌡️ Imagen Termográfica (IR)',
        terreno: '🔍 Foto Evidencia de Terreno'
      };
      if (lbl) lbl.innerText = '📷 Clic para adjuntar archivo (Tipo: ' + nombres[tipo] + ')';
      document.getElementById('subirEvidenciasMulti').click();
    },

    procesarSubidaEvidencias: function(event) {
      var files = Array.from(event.target.files);
      if (!files || files.length === 0) return;

      var canvas = document.getElementById('resizeCanvas') || document.createElement('canvas');
      var ctx = canvas.getContext('2d');
      var procesados = 0;
      var tipoSeleccionado = state.tipoSubidaActual || 'espectro';

      files.forEach(function(file) {
        var reader = new FileReader();
        reader.onload = function(e) {
          var img = new Image();
          img.onload = function() {
            var MAX_WIDTH = 950;
            var width = img.width;
            var height = img.height;
            if (width > MAX_WIDTH) {
              height = Math.round((height * MAX_WIDTH) / width);
              width = MAX_WIDTH;
            }
            canvas.width = width;
            canvas.height = height;
            ctx.drawImage(img, 0, 0, width, height);

            var base64 = canvas.toDataURL('image/jpeg', 0.70);
            state.tempEvidenciasEdicion.push({
              src: base64,
              tipo: tipoSeleccionado
            });
            procesados++;

            if (procesados === files.length) {
              window.CIO.renderMiniaturasEvidencias();
            }
          };
          img.src = e.target.result;
        };
        reader.readAsDataURL(file);
      });

      event.target.value = '';
    },

    renderMiniaturasEvidencias: function() {
      var cont = document.getElementById('previewEspectrosContainer');
      if (!cont) return;

      if (!state.tempEvidenciasEdicion || state.tempEvidenciasEdicion.length === 0) {
        cont.innerHTML = '<div style="font-size:0.8rem; color:var(--text-muted); font-style:italic;">No hay imágenes cargadas para este punto.</div>';
        return;
      }

      var badgesTipo = {
        espectro: '<span style="position:absolute; bottom:4px; left:4px; font-size:0.6rem; background:#0284c7; color:#fff; padding:1px 5px; border-radius:3px;">FFT</span>',
        termografia: '<span style="position:absolute; bottom:4px; left:4px; font-size:0.6rem; background:#ea580c; color:#fff; padding:1px 5px; border-radius:3px;">TERM</span>',
        terreno: '<span style="position:absolute; bottom:4px; left:4px; font-size:0.6rem; background:#16a34a; color:#fff; padding:1px 5px; border-radius:3px;">FOTO</span>'
      };

      cont.innerHTML = state.tempEvidenciasEdicion.map(function(item, i) {
        var src = typeof item === 'string' ? item : item.src;
        var tipo = typeof item === 'string' ? 'espectro' : (item.tipo || 'espectro');
        return '<div class="item-espectro-preview">' +
            '<img src="' + src + '" alt="Evidencia" onclick="window.CIO.abrirFotoEnNuevaPestana(\'' + src + '\')" />' +
            (badgesTipo[tipo] || '') +
            '<button type="button" onclick="window.CIO.eliminarFotoEvidencia(' + i + ')">&times;</button>' +
          '</div>';
      }).join('');
    },

    eliminarFotoEvidencia: function(index) {
      state.tempEvidenciasEdicion.splice(index, 1);
      window.CIO.renderMiniaturasEvidencias();
    },

    generarDictamenTecnicoIso: async function() {
      var nom = document.getElementById('indCompNombre')?.value.trim() || 'Componente';
      var punto = document.getElementById('indCompPunto')?.value.trim() || 'Punto de medición';
      var rms = parseFloat(document.getElementById('indCompRms')?.value) || 0;
      var textoAnalista = document.getElementById('indCompAnalisis')?.value.trim();
      var txtSugDiag = document.getElementById('indSugAnalisis');
      var txtSugRecom = document.getElementById('indSugRecom');

      var generarLocal = function() {
        var diag = '', recom = '';
        if (rms >= 7.1) {
          diag = 'Condición Crítica según ISO 20816-3 (Zona D) en ' + nom + ' (' + punto + ') con velocidad RMS de ' + rms.toFixed(1) + ' mm/s. Nivel vibratorio severo con riesgo inminente de daño mecánico.';
          recom = '1) Detención correctiva programada urgente. 2) Alineamiento láser y chequeo de holguras. 3) Inspección termográfica en descansos.';
        } else if (rms >= 4.5) {
          diag = 'Condición Inadmisible según ISO 20816-3 (Límite Zona D) en ' + nom + ' (' + punto + ') registrando ' + rms.toFixed(1) + ' mm/s RMS.';
          recom = '1) Programar intervención a corto plazo. 2) Chequear apriete de fijaciones mecánicas y estado de lubricante.';
        } else if (rms >= 2.8) {
          diag = 'Condición de Alerta según ISO 20816-3 (Zona C) en ' + nom + ' (' + punto + ') con ' + rms.toFixed(1) + ' mm/s RMS. Desgaste incipiente o deficiencia de lubricación.';
          recom = '1) Relubricar descanso según especificación. 2) Reducir frecuencia de monitoreo a 15 días.';
        } else {
          diag = 'Condición Admisible y Satisfactoria según ISO 20816-3 (Zona A/B) en ' + nom + ' (' + punto + ') con ' + rms.toFixed(1) + ' mm/s RMS. Operación continua sin restricciones.';
          recom = 'Mantener monitoreo mensual de rutina estándar (30 días).';
        }
        if (txtSugDiag) txtSugDiag.value = limpiarPrefijosIA(diag);
        if (txtSugRecom) txtSugRecom.value = limpiarPrefijosIA(recom);
      };

      if (!GEMINI_API_KEY) {
        var inputKey = prompt("🔑 Ingresa tu API Key de Gemini de Google AI Studio (se guardará de forma privada en tu navegador):");
        if (inputKey && inputKey.trim().length > 10) {
          GEMINI_API_KEY = inputKey.trim();
          localStorage.setItem("GEMINI_API_KEY", GEMINI_API_KEY);
        } else {
          generarLocal();
          return;
        }
      }

      if (txtSugDiag) txtSugDiag.value = "⏳ Evaluando evidencias multimodales y parámetros mecánicos bajo norma ISO 20816-3...";
      if (txtSugRecom) txtSugRecom.value = "⏳ Generando plan de acción pericial...";

      try {
        var promptText = "Actúa como Ingeniero Especialista en Mantenimiento Predictivo, Vibraciones Mecánicas (ISO 18436-2) y Termografía Infrarroja (ISO 18436-7).\n" +
          "Equipo/Componente: " + nom + " | Punto: " + punto + "\n" +
          "Velocidad Global RMS: " + rms + " mm/s (Norma ISO 20816-3).\n" +
          "Comentarios Previos: " + (textoAnalista || "Sin comentarios previos") + "\n\n" +
          "INSTRUCCIONES MULTIMODALES:\n" +
          "- Se te proporcionan imágenes adjuntas que pueden incluir: Espectros FFT (frecuencias/amplitudes), Termogramas Infrarrojos (puntos calientes, deltas de temperatura) o Fotografías de Terreno.\n" +
          "- Correlaciona la severidad RMS con el espectro de vibración, el gradiente térmico observado y la condición visual.\n" +
          "- NO uses corchetes, prefijos de IA ni introducciones robóticas. Redacta como informe pericial humano.\n\n" +
          "Responde EXCLUSIVAMENTE con un JSON en este formato:\n" +
          "{\"diagnostico\": \"diagnóstico pericial correlacionado\", \"recomendacion\": \"recomendaciones mecánicas priorizadas 1), 2), 3)\"}";

        var contentsParts = [{ text: promptText }];

        if (state.tempEvidenciasEdicion && state.tempEvidenciasEdicion.length > 0) {
          state.tempEvidenciasEdicion.forEach(function(item) {
            var rawData = typeof item === 'string' ? item : item.src;
            var base64Img = rawData.replace(/^data:image\/(png|jpeg|jpg);base64,/, "");
            contentsParts.push({
              inlineData: {
                mimeType: "image/jpeg",
                data: base64Img
              }
            });
          });
        }

        var response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" + GEMINI_API_KEY, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: contentsParts }],
            generationConfig: {
              temperature: 0.2,
              responseMimeType: "application/json"
            }
          })
        });

        if (!response.ok) throw new Error("Error HTTP Gemini: " + response.statusText);

        var data = await response.json();
        var resultado = JSON.parse(data.candidates[0].content.parts[0].text);

        if (txtSugDiag) txtSugDiag.value = limpiarPrefijosIA(resultado.diagnostico);
        if (txtSugRecom) txtSugRecom.value = limpiarPrefijosIA(resultado.recomendacion);

        var selSev = document.getElementById('indCompSev');
        if (selSev) {
          if (rms >= 4.5) selSev.value = 'Rojo';
          else if (rms >= 2.8) selSev.value = 'Amarillo';
          else selSev.value = 'Verde';
        }

      } catch (err) {
        console.warn("Gemini devolvió error, aplicando regla local:", err);
        generarLocal();
      }
    },

    adoptarDiagnosticoSugerido: function() {
      var sug = document.getElementById('indSugAnalisis')?.value;
      if (!sug) return;
      var el = document.getElementById('indCompAnalisis');
      if (el) el.value = limpiarPrefijosIA(sug);
    },

    adoptarRecomendacionSugerida: function() {
      var sug = document.getElementById('indSugRecom')?.value;
      if (!sug) return;
      var el = document.getElementById('indCompRecom');
      if (el) el.value = limpiarPrefijosIA(sug);
    },

    adoptarTodoDiagnosticoRecomendacion: function() {
      window.CIO.adoptarDiagnosticoSugerido();
      window.CIO.adoptarRecomendacionSugerida();
    },

    evaluarIsoRmsEnVivo: function() {
      var val = parseFloat(document.getElementById('indCompRms')?.value);
      if (isNaN(val)) return;
      var selSev = document.getElementById('indCompSev');
      if (!selSev) return;

      if (val >= 4.5) selSev.value = 'Rojo';
      else if (val >= 2.8) selSev.value = 'Amarillo';
      else selSev.value = 'Verde';
    },

    guardarComponenteIndividual: function() {
      if (!state.usuarioActivo) {
        alert("🔒 Inicia sesión para guardar cambios.");
        return;
      }

      var eq = state.equipos.find(function(e) { return e.id === state.equipoIdNivel3; });
      if (!eq) return;

      var idx = parseInt(document.getElementById('edCompIndex')?.value, 10);
      if (isNaN(idx) || idx < 0) return;

      var pares = [];
      document.querySelectorAll('#indParesSapContainer .fila-par-sap').forEach(function(row) {
        var av = row.querySelector('.p-aviso')?.value.trim() || '';
        var om = row.querySelector('.p-om')?.value.trim() || '';
        if (av || om) pares.push({ aviso: av, om: om });
      });

      var compNom = document.getElementById('indCompNombre')?.value.trim() || 'Componente';
      var compPunto = document.getElementById('indCompPunto')?.value.trim() || 'Punto';
      var compRms = document.getElementById('indCompRms')?.value.trim() || '2.0';
      var compSev = document.getElementById('indCompSev')?.value || 'Verde';
      var compDiag = limpiarPrefijosIA(document.getElementById('indCompAnalisis')?.value);
      var compRecom = limpiarPrefijosIA(document.getElementById('indCompRecom')?.value);

      eq.componentes[idx] = {
        nombre: compNom,
        punto: compPunto,
        rms: compRms,
        severidad: compSev,
        paresSap: pares,
        analisis: compDiag,
        recomendacion: compRecom,
        espectros: state.tempEvidenciasEdicion.slice()
      };

      if (db) {
        db.child(eq.id).child('componentes').set(eq.componentes);
      }

      var avisosArr = pares.map(function(p) { return p.aviso; }).filter(Boolean).join(", ");
      var omsArr = pares.map(function(p) { return p.om; }).filter(Boolean).join(", ");

      window.CIO.sincronizarConGoogleSheets({
        idEquipo: eq.id,
        faena: eq.siteId,
        area: eq.area,
        tag: eq.tag || eq.id,
        tipo: eq.tipo || "Activo Crítico",
        componente: compNom,
        punto: compPunto,
        rms: compRms,
        severidad: compSev,
        avisosSap: avisosArr,
        omSap: omsArr,
        diagnostico: compDiag,
        recomendacion: compRecom
      });

      alert('✅ Componente guardado exitosamente.');
      window.CIO.goScreen(3);
    },

    eliminarComponenteActual: function() {
      if (!state.usuarioActivo) {
        alert("🔒 Acción restringida: Inicia sesión para eliminar componentes.");
        return;
      }
      var eq = state.equipos.find(function(e) { return e.id === state.equipoIdNivel3; });
      if (!eq) return;

      var idx = parseInt(document.getElementById('edCompIndex')?.value, 10);
      if (confirm('¿Eliminar este componente y su punto asociado?')) {
        eq.componentes.splice(idx, 1);
        if (db) {
          db.child(eq.id).child('componentes').set(eq.componentes);
        }
        window.CIO.goScreen(3);
      }
    },

    // HISTORIAL Y EDICIÓN DE REPORTES DE TERRENO MULTIMODAL (TODAS LAS FOTOS)
    abrirModalHistoricoTerreno: function() {
      var eq = state.equipos.find(function(e) { return e.id === state.equipoIdNivel3; });
      if (!eq) return;

      var tagValue = eq.tag || eq.Tag || eq.id || 'S/T';
      var hTitle = document.getElementById('histTerrenoTitle');
      if (hTitle) hTitle.innerText = 'Historial de Ronda: ' + tagValue;

      var cont = document.getElementById('histTerrenoListContainer');
      var myReports = state.alertasTerreno
        .filter(function(a) { return matchTags(a.tag, tagValue); })
        .sort(function(a, b) { return new Date(b.timestamp || 0) - new Date(a.timestamp || 0); });

      if (cont) {
        if (myReports.length === 0) {
          cont.innerHTML = '<div style="padding:20px; font-style:italic; color:var(--text-muted);">No hay reportes de ronda registrados para este activo.</div>';
        } else {
          cont.innerHTML = myReports.map(function(r) {
            // DESEMPAQUETAR TODAS LAS FOTOS Y VIDEOS
            var evidenciasHtml = '';
            var listaArchivos = [];

            if (r.evidencias && Array.isArray(r.evidencias) && r.evidencias.length > 0) {
              listaArchivos = r.evidencias;
            } else if (r.fotoBase64) {
              listaArchivos = [{ tipo: 'imagen', data: r.fotoBase64 }];
            }

            if (listaArchivos.length > 0) {
              evidenciasHtml = '<div style="display:flex; flex-wrap:wrap; gap:10px; margin-top:10px;">' +
                listaArchivos.map(function(ev) {
                  var src = ev.data || ev.src || ev;
                  if (ev.tipo === 'video') {
                    return '<div style="text-align:center;"><video src="' + src + '" controls style="max-height:130px; max-width:190px; border-radius:6px; border:1px solid #38bdf8;"></video></div>';
                  } else {
                    return '<div style="text-align:center;"><img src="' + src + '" style="max-height:120px; max-width:180px; border-radius:6px; cursor:pointer; border:1px solid var(--glass-border); object-fit:contain;" onclick="window.CIO.abrirFotoEnNuevaPestana(\'' + src + '\')" /></div>';
                  }
                }).join('') + '</div>';
            }

            var botonesAdmin = state.usuarioActivo ? (
              '<div style="display:flex; gap:8px;">' +
                '<button class="btn-base btn-primary" type="button" style="padding:4px 10px; font-size:0.7rem;" onclick="window.CIO.abrirModalEditarReporteTerreno(\'' + r.id + '\')">✏️ Editar</button>' +
              '</div>'
            ) : '';

            return '<div class="card-terreno-item">' +
                '<div style="display:flex; justify-content:space-between; align-items:center;">' +
                  '<div>' +
                    '<span class="badge-indicator" style="background:' + (SEV_COLOR[r.severidad] || '#0284c7') + '; color:#fff;">' + (r.severidad || 'Seguimiento').toUpperCase() + '</span>' +
                    '<span style="font-size:0.75rem; color:var(--text-muted); margin-left:8px;">⏱️ ' + (r.timestamp ? new Date(r.timestamp).toLocaleString() : 'N/D') + '</span>' +
                    (listaArchivos.length > 0 ? ('<span class="badge-indicator badge-reportes" style="margin-left:6px;">📷 ' + listaArchivos.length + ' Foto(s)</span>') : '') +
                  '</div>' +
                  botonesAdmin +
                '</div>' +
                '<p style="font-size:0.9rem; line-height:1.45; margin:6px 0; color:var(--text-main);">' + sanitize(r.detalle) + '</p>' +
                evidenciasHtml +
              '</div>';
          }).join('');
        }
      }

      var mHist = document.getElementById('modalHistoricoTerreno');
      if (mHist) mHist.showModal();
    },

    abrirModalEditarReporteTerreno: function(reporteId) {
      if (!state.usuarioActivo) {
        alert("🔒 Debes iniciar sesión para editar reportes.");
        return;
      }

      var rep = state.alertasTerreno.find(function(a) { return a.id === reporteId; });
      if (!rep) return;

      document.getElementById('editReporteId').value = rep.id;
      document.getElementById('editReporteSev').value = rep.severidad || 'Verde';
      document.getElementById('editReporteDetalle').value = rep.detalle || '';

      // DESEMPAQUETAR TODAS LAS FOTOS EXISTENTES EN EL MODAL DE EDICIÓN
      state.tempEvidenciasReporte = [];
      if (rep.evidencias && Array.isArray(rep.evidencias)) {
        state.tempEvidenciasReporte = rep.evidencias.slice();
      } else if (rep.fotoBase64) {
        state.tempEvidenciasReporte = [{ tipo: 'imagen', data: rep.fotoBase64 }];
      }

      window.CIO.renderMiniaturasEvidenciasReporte();
      document.getElementById('modalEditarReporteTerreno').showModal();
    },

    renderMiniaturasEvidenciasReporte: function() {
      var cont = document.getElementById('editReporteEvidenciasPreview');
      if (!cont) return;

      if (!state.tempEvidenciasReporte || state.tempEvidenciasReporte.length === 0) {
        cont.innerHTML = '<span style="font-size:0.78rem; color:var(--text-muted); font-style:italic;">Sin evidencias adjuntas en este reporte.</span>';
        return;
      }

      cont.innerHTML = state.tempEvidenciasReporte.map(function(ev, idx) {
        var src = ev.data || ev.src || ev;
        if (ev.tipo === 'video') {
          return '<div class="item-espectro-preview">' +
              '<video src="' + src + '" controls style="width:100px; height:70px; object-fit:cover; border-radius:6px; border:1px solid #38bdf8;"></video>' +
              '<button type="button" onclick="window.CIO.eliminarEvidenciaReporte(' + idx + ')">&times;</button>' +
            '</div>';
        } else {
          return '<div class="item-espectro-preview">' +
              '<img src="' + src + '" style="width:100px; height:70px; object-fit:cover; border-radius:6px; cursor:pointer;" onclick="window.CIO.abrirFotoEnNuevaPestana(\'' + src + '\')" />' +
              '<button type="button" onclick="window.CIO.eliminarEvidenciaReporte(' + idx + ')">&times;</button>' +
            '</div>';
        }
      }).join('');
    },

    eliminarEvidenciaReporte: function(idx) {
      state.tempEvidenciasReporte.splice(idx, 1);
      window.CIO.renderMiniaturasEvidenciasReporte();
    },

    guardarEdicionReporteTerreno: function() {
      if (!state.usuarioActivo) {
        alert("🔒 Inicia sesión para guardar cambios.");
        return;
      }

      var repId = document.getElementById('editReporteId').value;
      if (!repId || !dbAlertasTerreno) return;

      var nuevaSev = document.getElementById('editReporteSev').value;
      var nuevoDetalle = document.getElementById('editReporteDetalle').value.trim();

      var payload = {
        severidad: nuevaSev,
        detalle: nuevoDetalle,
        evidencias: state.tempEvidenciasReporte, // Guarda el arreglo íntegro con todas las fotos y videos
        modificadoPor: state.usuarioActivo,
        modificadoEn: new Date().toISOString()
      };

      var primeraFoto = state.tempEvidenciasReporte.find(function(e) { return e.tipo === 'imagen'; });
      payload.fotoBase64 = primeraFoto ? (primeraFoto.data || primeraFoto.src) : '';

      dbAlertasTerreno.child(repId).update(payload).then(function() {
        alert("✅ Reporte de terreno actualizado exitosamente con todas sus evidencias.");
        document.getElementById('modalEditarReporteTerreno').close();
        window.CIO.abrirModalHistoricoTerreno();
      }).catch(function(err) {
        alert("❌ Error al guardar en Firebase: " + err.message);
      });
    },

    eliminarReporteTerrenoConfirm: function() {
      if (!state.usuarioActivo) {
        alert("🔒 Inicia sesión para eliminar reportes.");
        return;
      }

      var repId = document.getElementById('editReporteId').value;
      if (!repId || !dbAlertasTerreno) return;

      if (confirm("¿Estás seguro de eliminar este reporte de terreno?")) {
        dbAlertasTerreno.child(repId).remove().then(function() {
          alert("✅ Reporte eliminado.");
          document.getElementById('modalEditarReporteTerreno').close();
          window.CIO.abrirModalHistoricoTerreno();
        }).catch(function(err) {
          alert("❌ Error al eliminar: " + err.message);
        });
      }
    },

    abrirFotoEnNuevaPestana: function(base64Data) {
      var win = window.open("");
      win.document.write('<body style="margin:0; background:#0a0a0c; display:flex; justify-content:center; align-items:center; height:100vh;"><img src="' + base64Data + '" style="max-width:98%; max-height:98%; object-fit:contain;" /></body>');
    },

    editarDatosGeneralesActivo: function() {
      if (!state.usuarioActivo) {
        alert("🔒 Acción restringida: Debes iniciar sesión.");
        return;
      }
      var eq = state.equipos.find(function(e) { return e.id === state.equipoIdNivel3; });
      if (!eq) return;

      state.equipoSeleccionado = eq;
      var setVal = function(id, val) { var el = document.getElementById(id); if (el) el.value = val || ''; };

      setVal('edSiteId', eq.siteId);
      setVal('edDomain', eq.domain || 'planta');
      setVal('edArea', eq.area || '');
      setVal('edTag', eq.tag || eq.Tag || eq.id || '');
      setVal('edTipo', eq.tipo || '');
      setVal('edEstatusHallazgo', eq.estatusHallazgo || 'Abierto');
      setVal('edFechaMedicion', eq.fechaMedicion || '');
      setVal('edFechaHallazgo', eq.fechaHallazgo || '');

      var mEd = document.getElementById('modalEdicion');
      if (mEd) mEd.showModal();
    },

    guardarDatosGeneralesActivo: function() {
      if (!state.usuarioActivo || !state.equipoSeleccionado) return;
      var getVal = function(id) { var el = document.getElementById(id); return el ? el.value : ''; };

      var payload = {
        siteId: getVal('edSiteId'),
        domain: getVal('edDomain'),
        area: getVal('edArea'),
        tag: getVal('edTag'),
        tipo: getVal('edTipo'),
        fechaMedicion: getVal('edFechaMedicion'),
        fechaHallazgo: getVal('edFechaHallazgo'),
        estatusHallazgo: getVal('edEstatusHallazgo')
      };

      if (db) db.child(state.equipoSeleccionado.id).update(payload);
      var mEd = document.getElementById('modalEdicion');
      if (mEd) mEd.close();
      renderScreen3();
    },

    eliminarEquipo: function() {
      if (!state.usuarioActivo) {
        alert("🔒 Inicia sesión para eliminar activos.");
        return;
      }
      if (confirm('¿Eliminar activo?') && db && state.equipoSeleccionado) {
        db.child(state.equipoSeleccionado.id).remove();
        var mEd = document.getElementById('modalEdicion');
        if (mEd) mEd.close();
        window.CIO.goScreen(2);
      }
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

    abrirEditorInformeModal: function() {
      if (!state.usuarioActivo) {
        alert("🔒 Acceso Restringido: Como usuario invitado solo tienes permisos de visualización. Inicia sesión para emitir informes.");
        return;
      }

      var eq = state.equipos.find(function(e) { return e.id === state.equipoIdNivel3; });
      if (!eq) return;

      var tagValue = eq.tag || eq.Tag || eq.id || 'S/T';
      var mTitle = document.getElementById('infModalTitle');
      if (mTitle) mTitle.innerText = 'Emisión de Informe: ' + tagValue;

      var saps = consolidarSAPs(eq.componentes);
      var inAv = document.getElementById('infAvisosSap');
      if (inAv) inAv.value = saps.avisosStr !== 'Sin Avisos' ? saps.avisosStr : '';
      var inOm = document.getElementById('infOmSap');
      if (inOm) inOm.value = saps.omsStr !== 'Sin OM' ? saps.omsStr : '';
      var inRes = document.getElementById('infResumenGeneral');
      if (inRes) inRes.value = 'Se efectúa evaluación de condición dinámica al tren motriz del activo ' + tagValue + ' bajo norma ISO 20816-3. Condición global: ' + calcMaxSev(eq.componentes).toUpperCase() + '.';

      var cont = document.getElementById('infComponentesContainer');
      if (cont) {
        cont.innerHTML = (eq.componentes || []).map(function(c) {
          return '<div style="margin-bottom:12px; padding:12px; border:1px solid var(--glass-border); border-radius:8px; background:var(--card-inner-bg);">' +
              '<strong>' + sanitize(c.nombre) + ' - ' + sanitize(c.punto) + ' (' + c.severidad + ')</strong>' +
              '<p style="font-size:0.85rem; margin-top:4px;">' + sanitize(limpiarPrefijosIA(c.analisis)) + '</p>' +
            '</div>';
        }).join('');
      }

      var mInf = document.getElementById('modalEditorInforme');
      if (mInf) mInf.showModal();
    },

    emitirInformeFinalImpresion: function() {
      var eq = state.equipos.find(function(e) { return e.id === state.equipoIdNivel3; });
      if (!eq) return;

      var tagValue = eq.tag || eq.Tag || eq.id || 'S/T';
      var avisosEditados = document.getElementById('infAvisosSap')?.value.trim() || 'Sin Avisos';
      var omsEditadas = document.getElementById('infOmSap')?.value.trim() || 'Sin OM';
      var conclusionGeneral = document.getElementById('infResumenGeneral')?.value.trim() || '';

      var aud = calcularDiasDesdeMedicion(eq.fechaMedicion);
      var sevGlobal = calcMaxSev(eq.componentes);

      var modalInf = document.getElementById('modalEditorInforme');
      if (modalInf) modalInf.close();

      var compsHtml = (eq.componentes || []).map(function(c) {
        var col = SEV_COLOR[c.severidad] || '#4b5563';
        var fotosHtml = (c.espectros && c.espectros.length > 0)
          ? '<div style="margin-top:10px;"><strong style="font-size:0.75rem; color:#4b5563;">Evidencias de Respaldo:</strong><div style="display:flex; flex-wrap:wrap; gap:8px; margin-top:4px;">' +
            c.espectros.map(function(item) {
              var src = typeof item === 'string' ? item : item.src;
              var tipo = typeof item === 'string' ? 'FFT' : (item.tipo || 'FFT').toUpperCase();
              return '<div style="text-align:center;"><img src="' + src + '" style="max-height:160px; max-width:240px; border-radius:4px; border:1px solid #ccc; object-fit:contain;" /><div style="font-size:0.65rem; color:#6b7280; font-weight:bold; margin-top:2px;">' + tipo + '</div></div>';
            }).join('') + '</div></div>'
          : '';

        return '<div style="border:1px solid #d1d5db; border-left:5px solid ' + col + '; border-radius:6px; padding:12px 16px; margin-bottom:12px; page-break-inside:avoid;">' +
          '<div style="display:flex; justify-content:space-between; font-weight:bold; font-size:0.95rem; margin-bottom:6px;">' +
            '<span>' + sanitize(c.nombre || 'Componente') + ' | ' + sanitize(c.punto || 'Punto') + '</span>' +
            '<span style="color:' + col + ';">' + (c.severidad || 'Verde').toUpperCase() + ' (' + (c.rms || '0.0') + ' mm/s)</span>' +
          '</div>' +
          '<div style="font-size:0.86rem; color:#1f2937; margin-bottom:6px; line-height:1.4;"><strong>Diagnóstico:</strong><br>' + sanitize(limpiarPrefijosIA(c.analisis) || 'Sin análisis registrado.') + '</div>' +
          '<div style="font-size:0.86rem; color:#065f46; line-height:1.4;"><strong>Recomendación:</strong><br>' + sanitize(limpiarPrefijosIA(c.recomendacion) || 'Mantener monitoreo.') + '</div>' +
          fotosHtml +
        '</div>';
      }).join('');

      var win = window.open('', '_blank');
      if (!win) {
        alert("⚠️ Por favor permite las ventanas emergentes en tu navegador para ver el informe.");
        return;
      }

      win.document.write(
        '<!DOCTYPE html>' +
        '<html lang="es">' +
        '<head>' +
          '<meta charset="UTF-8">' +
          '<title>Informe Técnico - ' + tagValue + ' - CPF Ingeniería</title>' +
          '<style>' +
            '@page { size: A4 portrait; margin: 15mm; }' +
            'body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; padding: 20px; color: #111827; background: #fff; line-height: 1.4; margin: 0; }' +
            '.header-report { display: flex; justify-content: space-between; align-items: center; border-bottom: 3px solid #0284c7; padding-bottom: 12px; margin-bottom: 16px; }' +
            '.header-report h1 { margin: 0; font-size: 1.3rem; color: #0f172a; text-transform: uppercase; }' +
            '.header-report p { margin: 2px 0 0 0; font-size: 0.78rem; color: #64748b; font-weight: bold; }' +
            '.badge-sev { padding: 5px 12px; border-radius: 6px; font-weight: 800; color: #fff; background: ' + (SEV_COLOR[sevGlobal] || '#4b5563') + '; text-transform: uppercase; font-size: 0.85rem; }' +
            '.data-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 14px; margin-bottom: 16px; font-size: 0.82rem; }' +
            '.data-item strong { display: block; font-size: 0.68rem; color: #64748b; text-transform: uppercase; margin-bottom: 2px; }' +
            '.section-title { font-size: 0.95rem; color: #0284c7; border-left: 4px solid #0284c7; padding-left: 8px; margin: 18px 0 8px 0; text-transform: uppercase; font-weight: 800; }' +
            '.box-conclusion { background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 6px; padding: 10px 14px; font-size: 0.88rem; margin-bottom: 14px; }' +
            '.btn-bar { margin-bottom: 20px; display: flex; gap: 10px; }' +
            '.btn-action { background: #0284c7; color: #fff; border: none; padding: 8px 16px; border-radius: 6px; font-weight: bold; cursor: pointer; }' +
            '@media print { .btn-bar { display: none; } body { padding: 0; } }' +
          '</style>' +
        '</head>' +
        '<body>' +
          '<div class="btn-bar">' +
            '<button class="btn-action" onclick="window.print()">🖨️ Imprimir / Guardar como PDF</button>' +
            '<button class="btn-action" style="background:#64748b;" onclick="window.close()">Cerrar</button>' +
          '</div>' +
          '<div class="header-report">' +
            '<div>' +
              '<h1>INFORME OFICIAL DE MONITOREO TREN MOTRIZ</h1>' +
              '<p>CPF INGENIERÍA LTDA | COMPAÑÍA MINERA DEL PACÍFICO | CIO</p>' +
            '</div>' +
            '<div><span class="badge-sev">CONDICIÓN: ' + sevGlobal + '</span></div>' +
          '</div>' +
          '<div class="data-grid">' +
            '<div class="data-item"><strong>Faena Operativa</strong>' + sanitize(eq.siteId) + '</div>' +
            '<div class="data-item"><strong>Área</strong>' + sanitize(eq.area) + '</div>' +
            '<div class="data-item"><strong>Tag Equipo</strong>' + sanitize(tagValue) + '</div>' +
            '<div class="data-item"><strong>Avisos SAP</strong>' + sanitize(avisosEditados) + '</div>' +
            '<div class="data-item"><strong>Órdenes OM</strong>' + sanitize(omsEditadas) + '</div>' +
            '<div class="data-item"><strong>Última Medición</strong>' + (eq.fechaMedicion || 'S/F') + '</div>' +
          '</div>' +
          '<div class="section-title">1. Resumen Ejecutivo & Conclusiones</div>' +
          '<div class="box-conclusion">' + sanitize(conclusionGeneral) + '</div>' +
          '<div class="section-title">2. Diagnóstico Técnico por Puntos & Espectros</div>' +
          compsHtml +
          '<footer style="margin-top:30px; border-top:1px solid #e2e8f0; padding-top:8px; font-size:0.72rem; color:#94a3b8; text-align:center;">' +
            'Documento Oficial CIO - Emitido por CPF Ingeniería Ltda.' +
          '</footer>' +
        '</body>' +
        '</html>'
      );
      win.document.close();
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
          { nombre: 'Motor M1', punto: 'Lado Libre (NDE)', severidad: 'Verde', rms: '2.0', paresSap: [], analisis: 'Condición normal bajo norma ISO 20816-3.', recomendacion: 'Ruta mensual.', espectros: [] }
        ],
        fechaMedicion: new Date().toISOString().split('T')[0],
        fechaHallazgo: new Date().toISOString().split('T')[0],
        estatusHallazgo: 'Abierto'
      };

      if (db) db.child(newId).set(nuevoEquipo);
      window.CIO.irANivel3Equipo(newId);
    },

    procesarCargaExcelFaena: function(e) {
      if (!state.usuarioActivo) {
        alert("🔒 Acción restringida: Inicia sesión para realizar cargas masivas.");
        return;
      }
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
            Object.keys(row).forEach(function(k) { normalizedRow[k.trim().toUpperCase()] = row[k]; });

            var rawTag = normalizedRow['EQUIPO'] || normalizedRow['TAG'] || normalizedRow['ACTIVO'] || normalizedRow['NOMBRE'];
            var rawArea = normalizedRow['AREA'] || normalizedRow['ÁREA'] || 'Área General';
            var rawTipo = normalizedRow['TIPO EQUIPO'] || normalizedRow['TIPO'] || normalizedRow['CLASE'] || 'Activo';

            if (rawTag && String(rawTag).trim() !== '') {
              var tagStr = String(rawTag).trim();
              var areaStr = String(rawArea).trim() || 'General';
              var tipoStr = String(rawTipo).trim() || 'Activo';
              var recordId = 'EQ_' + tagStr.replace(/[\/\.\#\$\[\]]/g, '_');

              actualizaciones[recordId] = {
                siteId: targetSite,
                domain: areaStr.toUpperCase().indexOf('MINA') !== -1 ? 'mina' : 'planta',
                area: areaStr,
                tag: tagStr,
                tipo: tipoStr,
                lat: '',
                lng: '',
                fechaMedicion: new Date().toISOString().split('T')[0],
                fechaHallazgo: '',
                estatusHallazgo: 'Abierto',
                componentes: [
                  { nombre: 'Motor M1', punto: 'Lado Libre (NDE)', severidad: 'Verde', rms: '2.0', paresSap: [], analisis: 'Condición normal bajo norma ISO 20816-3.', recomendacion: 'Ruta mensual.', espectros: [] }
                ]
              };
              cargados++;
            }
          });

          db.update(actualizaciones).then(function() {
            alert('✅ Carga masiva exitosa: ' + cargados + ' equipos importados en ' + targetSite + '.');
          });

        } catch (err) {
          alert('❌ Error al procesar Excel: ' + err.message);
        }
      };

      reader.readAsArrayBuffer(file);
      e.target.value = '';
    }
  };

  window.salirSuperAdmin = window.CIO.salirSuperAdmin;

  document.addEventListener('DOMContentLoaded', function() {
    if (localStorage.getItem('CIO_THEME') === 'light') {
      document.body.classList.add('light-mode');
    }
    window.CIO.goScreen(1);
  });
})();
