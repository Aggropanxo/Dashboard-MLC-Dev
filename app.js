/**
 * Dashboard-MLC-Dev - app.js
 * Centro Integrado de Operaciones (CIO) - Predictivo & Confiabilidad MLC (CMP)
 */
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
      if (!firebase.apps || firebase.apps.length === 0) {
        firebase.initializeApp(firebaseConfig);
      }
      var databaseService = firebase.database();
      db = databaseService.ref('activos_criticos_dev');
      dbUsers = databaseService.ref('usuarios_registrados_dev');
      dbAlertasTerreno = databaseService.ref('alertas_terreno_dev');
    }
  } catch (err) {
    console.warn("Firebase Init fallback:", err);
  }

  var FAENAS = Object.freeze([
    'Planta, Mina los Colorados',
    'Mina, Mina los Colorados',
    'Planta de Pellets',
    'Planta, Mina el Romeral',
    'Mina, Mina el Romeral'
  ]);

  var FAENA_COORDS = Object.freeze({
    'Planta, Mina los Colorados': [-28.3294, -70.9392],
    'Mina, Mina los Colorados': [-28.3180, -70.9450],
    'Planta de Pellets': [-28.6720, -71.2850],
    'Planta, Mina el Romeral': [-29.7280, -71.2450],
    'Mina, Mina el Romeral': [-29.7150, -71.2380]
  });

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
    filtroBusqueda: '',
    mapaSite: null,
    capaMarcadores: null,
    mapaPicker: null,
    marcadorPicker: null,
    pickerCoordsTemp: null,
    equipos: [],
    alertasTerreno: [],
    tempEvidenciasEdicion: [],
    tipoSubidaActual: 'espectro',
    tempEvidenciasReporte: []
  };

  // =============================================================
  // AUTO-LOGOUT POR INACTIVIDAD (15 MINUTOS)
  // =============================================================
  var temporizadorInactividad = null;
  var TIEMPO_LIMITE_INACTIVIDAD = 15 * 60 * 1000;

  function reiniciarVigilanteInactividad() {
    if (temporizadorInactividad) clearTimeout(temporizadorInactividad);
    if (!state.usuarioActivo) return;

    temporizadorInactividad = setTimeout(function() {
      if (state.usuarioActivo) {
        alert("🔒 SESIÓN CERRADA POR INACTIVIDAD: No se detectó actividad durante 15 minutos.");
        window.CIO.cerrarSesionUsuario();
      }
    }, TIEMPO_LIMITE_INACTIVIDAD);
  }

  ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart'].forEach(function(evento) {
    window.addEventListener(evento, reiniciarVigilanteInactividad, { passive: true });
  });

  // =============================================================
  // INDICADORES DE MERCADO & CLIMA (CADA 10 MIN)
  // =============================================================
  var MARKET_STATE = { usdClp: 945.0, feUsd: 98.02 };

  async function actualizarTickerMercadoYClima() {
    try {
      var resDolar = await fetch('https://mindicador.cl/api/dolar');
      if (resDolar.ok) {
        var dataDolar = await resDolar.json();
        var valorDolar = dataDolar?.serie?.[0]?.valor;
        if (valorDolar) {
          MARKET_STATE.usdClp = valorDolar;
          var elUsd = document.getElementById('tickerUsdClp');
          if (elUsd) elUsd.innerText = valorDolar.toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        }
      }
    } catch (err) {}

    try {
      var elFeUsd = document.getElementById('tickerFeUsd');
      var elFeClp = document.getElementById('tickerFeClp');
      var feClpTotal = Math.round(MARKET_STATE.feUsd * MARKET_STATE.usdClp);
      if (elFeUsd) elFeUsd.innerText = MARKET_STATE.feUsd.toFixed(2) + " USD/t";
      if (elFeClp) elFeClp.innerText = feClpTotal.toLocaleString('es-CL') + " CLP/t";
    } catch (err) {}

    try {
      var latVallenar = -28.5708;
      var lonVallenar = -70.7581;
      var resClima = await fetch('https://api.open-meteo.com/v1/forecast?latitude=' + latVallenar + '&longitude=' + lonVallenar + '&current_weather=true');
      if (resClima.ok) {
        var dataClima = await resClima.json();
        var temp = dataClima?.current_weather?.temperature;
        var weatherCode = dataClima?.current_weather?.weathercode;
        if (temp !== undefined) {
          var elClima = document.getElementById('tickerClimaVal');
          var elIcono = document.getElementById('tickerClimaIcon');
          var icono = "☀️";
          if (weatherCode >= 1 && weatherCode <= 3) icono = "⛅";
          else if (weatherCode >= 45 && weatherCode <= 48) icono = "🌫️";
          else if (weatherCode >= 51 && weatherCode <= 67) icono = "🌧️";
          else if (weatherCode >= 80) icono = "🌦️";
          if (elIcono) elIcono.innerText = icono;
          if (elClima) elClima.innerText = Math.round(temp) + "°C (Vallenar)";
        }
      }
    } catch (err) {}
  }

  function sanitize(str) {
    return (str || '').replace(/[<>&"']/g, function(m) {
      return { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[m];
    });
  }

  function limpiarPrefijosIA(texto) {
    if (!texto) return '';
    return texto.replace(/^\[.*?\]:\s*/gi, '').replace(/^\[IA.*?\]\s*/gi, '').trim();
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
    if (btnBit) btnBit.innerText = 'Bitácora Alertas (' + total + ')';
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

      if (state.filtroBusqueda && state.filtroBusqueda.trim() !== '') {
        var query = state.filtroBusqueda.trim().toUpperCase();
        eqsArea = eqsArea.filter(function(e) {
          var tagStr = (e.tag || e.Tag || e.TAG || e.id || '').toUpperCase();
          var tipoStr = (e.tipo || '').toUpperCase();
          return tagStr.includes(query) || tipoStr.includes(query);
        });
      }

      eqsArea.sort(function(a, b) { return SEV_PESO[calcMaxSev(b.componentes)] - SEV_PESO[calcMaxSev(a.componentes)]; });

      var navHeader = document.createElement('div');
      navHeader.style.cssText = "grid-column: 1/-1; display:flex; align-items:center; gap:10px; margin-bottom:4px; padding:8px 12px; border-radius:8px; background:var(--glass-card); border:1px solid var(--glass-border);";
      navHeader.innerHTML = '<button class="btn-base" type="button" onclick="window.CIO.volverAreas()">⬅️ Volver a Áreas</button>' +
        '<span style="font-weight:700; color:var(--accent-color); font-size:0.85rem;">Área: ' + sanitize(state.areaSeleccionada) + '</span>' +
        (state.filtroBusqueda ? ('<span style="font-size:0.75rem; color:var(--text-muted); margin-left:auto;">Filtro: "' + sanitize(state.filtroBusqueda) + '" (' + eqsArea.length + ')</span>') : '');
      container.appendChild(navHeader);

      if (eqsArea.length === 0) {
        var noResults = document.createElement('div');
        noResults.style.cssText = "grid-column: 1/-1; padding:20px; text-align:center; color:var(--text-muted); font-style:italic;";
        noResults.innerText = "No se encontraron equipos que coincidan con la búsqueda.";
        container.appendChild(noResults);
        return;
      }

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
          ? ('<div style="font-size:0.62rem; color:#2563eb; font-weight:700;">AV:' + saps.countAvisos + ' | OM:' + saps.countOms + '</div>') 
          : '';

        var hasGeo = (eq.lat !== '' && eq.lat !== undefined && eq.lng !== '' && eq.lng !== undefined);
        var geoDot = hasGeo ? '<span title="Activo Georreferenciado" style="color:#22c55e; font-size:0.75rem;">📍</span>' : '';

        card.innerHTML = 
          '<div class="card-top-bar">' +
            '<span class="eq-type">' + sanitize(eq.tipo || eq.area) + '</span>' +
            '<div style="display:flex; gap:3px; align-items:center;">' + geoDot + badgeTerreno + badgeRuta + '</div>' +
          '</div>' +
          '<div class="eq-tag code-font">' + sanitize(tagValue) + '</div>' +
          '<div style="display:flex; justify-content:space-between; align-items:center; margin-top:4px;">' +
            '<span style="color:' + SEV_COLOR[s] + '; font-weight:800; font-size:0.75rem;">' + s.toUpperCase() + '</span>' +
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
  // MAPA GIS LEAFLET (SATELLITE & COMPACT PULSING NODES)
  // -------------------------------------------------------------
  function inicializarMapaSite() {
    var mapDiv = document.getElementById('view-site-map');
    if (!mapDiv || state.mapaSite) return;

    state.mapaSite = L.map('view-site-map', {
      zoomControl: true,
      attributionControl: false
    }).setView([-28.3294, -70.9392], 15);

    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19
    }).addTo(state.mapaSite);

    state.capaMarcadores = L.layerGroup().addTo(state.mapaSite);
  }

  function actualizarMapaSite(equiposFaena) {
    if (!state.mapaSite) inicializarMapaSite();
    if (!state.mapaSite || !state.capaMarcadores) return;

    state.capaMarcadores.clearLayers();

    var targetFaena = state.faenaSeleccionada || FAENAS[0];
    var centroide = FAENA_COORDS[targetFaena] || [-28.3294, -70.9392];
    var bounds = [];

    (equiposFaena || []).forEach(function(eq) {
      var lat = parseFloat(eq.lat);
      var lng = parseFloat(eq.lng);

      if (!isNaN(lat) && !isNaN(lng)) {
        bounds.push([lat, lng]);
        var maxSev = calcMaxSev(eq.componentes);
        var colorPin = SEV_COLOR[maxSev] || '#6b7280';
        var tagVal = eq.tag || eq.id;

        var clasePulso = (maxSev === 'Rojo' || maxSev === 'Naranja') ? 'anim-pulso' : '';

        var iconoCustom = L.divIcon({
          className: 'custom-leaflet-marker-wrapper',
          html: '<div class="pin-marcador-gis ' + clasePulso + '" style="background:' + colorPin + ';"></div>',
          iconSize: [14, 14],
          iconAnchor: [7, 7],
          popupAnchor: [0, -10]
        });

        var marcador = L.marker([lat, lng], { icon: iconoCustom });

        var popupHtml = 
          '<div style="color:#0f172a; font-family:Inter,sans-serif; min-width:180px;">' +
            '<div style="font-weight:800; font-size:0.95rem; margin-bottom:2px;">' + sanitize(tagVal) + '</div>' +
            '<div style="font-size:0.75rem; color:#64748b; margin-bottom:6px;">' + sanitize(eq.tipo || 'Activo') + ' - ' + sanitize(eq.area || '') + '</div>' +
            '<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">' +
              '<span style="font-size:0.75rem; font-weight:800; color:' + colorPin + ';">' + maxSev.toUpperCase() + '</span>' +
              '<span style="font-size:0.7rem; color:#64748b;">' + (eq.fechaMedicion || '') + '</span>' +
            '</div>' +
            '<button type="button" style="width:100%; padding:7px; background:#0284c7; color:#fff; border:none; border-radius:6px; font-weight:bold; font-size:0.78rem; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:6px;" onclick="window.CIO.irANivel3Equipo(\'' + eq.id + '\')">🔍 Abrir Tren Motriz</button>' +
          '</div>';

        marcador.bindPopup(popupHtml);
        state.capaMarcadores.addLayer(marcador);
      }
    });

    if (bounds.length > 0) {
      state.mapaSite.fitBounds(bounds, { padding: [40, 40], maxZoom: 17 });
    } else {
      state.mapaSite.setView(centroide, 15);
    }

    setTimeout(function() {
      state.mapaSite.invalidateSize();
    }, 200);
  }

  // -------------------------------------------------------------
  // SINCRONIZACIÓN REACTIVA CON FIREBASE
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
      if (state.siteMapVisible) {
        var targetFaena = state.faenaSeleccionada || FAENAS[0];
        actualizarMapaSite(state.equipos.filter(function(e) { return normalizarFaena(e.siteId) === targetFaena; }));
      }
    });

    if (dbAlertasTerreno) {
      dbAlertasTerreno.on('value', function(snap) {
        var raw = snap.val();
        var lista = [];

        if (raw) {
          Object.keys(raw).forEach(function(k) {
            var item = raw[k] || {};
            item.id = k;
            if (!item.evidencias && item.fotoBase64) {
              item.evidencias = [{ tipo: 'imagen', data: item.fotoBase64 }];
            } else if (item.evidencias && Array.isArray(item.evidencias)) {
              // Validado
            } else {
              item.evidencias = [];
            }
            lista.push(item);
          });
        }

        lista.sort(function(a, b) { return new Date(b.timestamp || 0) - new Date(a.timestamp || 0); });
        state.alertasTerreno = lista;
        actualizarBadgeContadorAlertas(lista.length);
        refresh();
      });

      dbAlertasTerreno.on('child_added', function(snap) {
        var alerta = snap.val();
        if (!alerta) return;
        alerta.id = snap.key;

        var timeAlerta = new Date(alerta.timestamp || 0).getTime();
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

  // =============================================================
  // FUNCIÓN MAESTRA DE IMPRESIÓN BLINDADA (BLOB URL)
  // =============================================================
  function imprimirMedianteBlob(htmlContent) {
    try {
      var blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
      var blobUrl = URL.createObjectURL(blob);
      
      var win = window.open(blobUrl, '_blank');
      if (!win) {
        alert("⚠️ Habilita las ventanas emergentes (pop-ups) en tu navegador para ver el informe.");
        return;
      }

      setTimeout(function() {
        URL.revokeObjectURL(blobUrl);
      }, 10000);
    } catch (e) {
      console.error("Error al generar blob de impresión:", e);
      alert("❌ No se pudo abrir la vista de impresión.");
    }
  }

  var reportePendienteImpresion = null;

  // =============================================================
  // OBJETO GLOBAL CIO (CON TODAS LAS FUNCIONES INCLUIDAS)
  // =============================================================
  window.CIO = {
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

    irAInicio: function() {
      document.querySelectorAll('dialog').forEach(function(d) {
        if (d && typeof d.close === 'function') {
          try { d.close(); } catch (e) {}
        }
      });

      state.areaSeleccionada = null;
      state.equipoIdNivel3 = null;
      state.equipoSeleccionado = null;
      state.siteMapVisible = false;
      state.filtroBusqueda = '';

      var searchInp = document.getElementById('inputBuscarEquipo');
      if (searchInp) searchInp.value = '';

      var mapBox = document.getElementById('view-site-map');
      if (mapBox) mapBox.style.display = 'none';

      window.CIO.goScreen(1);
    },

    seleccionarFaena: function(f) {
      state.faenaSeleccionada = f;
      state.areaSeleccionada = null;
      state.filtroBusqueda = '';
      window.CIO.goScreen(2);
    },

    seleccionarArea: function(a) {
      state.areaSeleccionada = a;
      state.filtroBusqueda = '';
      var searchInp = document.getElementById('inputBuscarEquipo');
      if (searchInp) searchInp.value = '';
      renderScreen2();
    },

    volverAreas: function() {
      state.areaSeleccionada = null;
      state.filtroBusqueda = '';
      var searchInp = document.getElementById('inputBuscarEquipo');
      if (searchInp) searchInp.value = '';
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

    filtrarEquiposYMapa: function(texto) {
      state.filtroBusqueda = texto || '';
      renderScreen2();

      if (state.siteMapVisible && state.mapaSite && state.capaMarcadores) {
        var query = (texto || '').trim().toUpperCase();
        var targetFaena = state.faenaSeleccionada || FAENAS[0];
        var eqs = state.equipos.filter(function(e) { return normalizarFaena(e.siteId) === targetFaena; });

        if (query.length >= 2) {
          var coincidencia = eqs.find(function(e) {
            return (e.tag || e.Tag || e.TAG || e.id || '').toUpperCase().includes(query);
          });

          if (coincidencia && coincidencia.lat && coincidencia.lng) {
            var lat = parseFloat(coincidencia.lat);
            var lng = parseFloat(coincidencia.lng);
            if (!isNaN(lat) && !isNaN(lng)) {
              state.mapaSite.setView([lat, lng], 18, { animate: true });

              state.capaMarcadores.eachLayer(function(layer) {
                var pos = layer.getLatLng();
                if (Math.abs(pos.lat - lat) < 0.0001 && Math.abs(pos.lng - lng) < 0.0001) {
                  layer.openPopup();
                }
              });
            }
          }
        }
      }
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

        actualizarMapaSite(state.equipos.filter(function(e) { return normalizarFaena(e.siteId) === target; }));
      } else {
        if (mapBox) mapBox.style.display = 'none';
        if (container) container.style.display = '';
        if (lbl) lbl.innerText = 'Ver Mapa de Faena';
      }
    },

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
          window.CIO.verEvidenciasEIrAlActivo(reporte.tag);
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

    verEvidenciasEIrAlActivo: function(tag) {
      var modalBitacora = document.getElementById('modalBitacoraTurno');
      if (modalBitacora) modalBitacora.close();

      var eq = state.equipos.find(function(e) { return matchTags(e.tag, tag); });

      if (eq) {
        state.faenaSeleccionada = normalizarFaena(eq.siteId);
        state.areaSeleccionada = eq.area;
        state.equipoIdNivel3 = eq.id;
        window.CIO.goScreen(3);
        setTimeout(function() {
          window.CIO.abrirModalHistoricoTerreno();
        }, 180);
      } else {
        alert("ℹ️ El activo [" + tag + "] fue registrado como hallazgo libre. Abriendo el historial directo...");
        window.CIO.abrirModalHistoricoTerrenoDirectoPorTag(tag);
      }
    },

    abrirModalHistoricoTerreno: function() {
      var eq = state.equipos.find(function(e) { return e.id === state.equipoIdNivel3; });
      if (!eq) return;
      var tagValue = eq.tag || eq.Tag || eq.id || 'S/T';
      window.CIO.abrirModalHistoricoTerrenoDirectoPorTag(tagValue);
    },

    abrirModalHistoricoTerrenoDirectoPorTag: function(tagValue) {
      var hTitle = document.getElementById('histTerrenoTitle');
      if (hTitle) hTitle.innerText = 'Historial de Ronda: ' + tagValue;

      var cont = document.getElementById('histTerrenoListContainer');
      var myReports = state.alertasTerreno
        .filter(function(a) { return matchTags(a.tag, tagValue); })
        .sort(function(a, b) { return new Date(b.timestamp || 0) - new Date(a.timestamp || 0); });

      if (cont) {
        if (myReports.length === 0) {
          cont.innerHTML = '<div style="padding:20px; font-style:italic; color:var(--text-muted);">No hay reportes de ronda registrados para este TAG.</div>';
        } else {
          cont.innerHTML = myReports.map(function(r) {
            var listaArchivos = (r.evidencias && Array.isArray(r.evidencias) && r.evidencias.length > 0)
              ? r.evidencias
              : (r.fotoBase64 ? [{ tipo: 'imagen', data: r.fotoBase64 }] : []);

            var evidenciasHtml = '';
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

            var badgeAviso = r.avisoSap ? ('<span class="badge-indicator" style="background:#2563eb; color:#fff; margin-left:6px;">SAP: ' + sanitize(r.avisoSap) + '</span>') : '';

            var botonesAdmin = state.usuarioActivo ? (
              '<div style="display:flex; gap:8px;">' +
                '<button class="btn-base btn-primary" type="button" style="padding:4px 10px; font-size:0.7rem;" onclick="window.CIO.abrirModalEditarReporteTerreno(\'' + r.id + '\')">✏️ Editar / Adoptar</button>' +
              '</div>'
            ) : '';

            return '<div class="card-terreno-item">' +
                '<div style="display:flex; justify-content:space-between; align-items:center;">' +
                  '<div>' +
                    '<span class="badge-indicator" style="background:' + (SEV_COLOR[r.severidad] || '#0284c7') + '; color:#fff;">' + (r.severidad || 'Seguimiento').toUpperCase() + '</span>' +
                    badgeAviso +
                    '<span style="font-size:0.75rem; color:var(--text-muted); margin-left:8px;">⏱️ ' + (r.timestamp ? new Date(r.timestamp).toLocaleString() : 'N/D') + '</span>' +
                    (listaArchivos.length > 0 ? ('<span class="badge-indicator badge-reportes" style="margin-left:6px;">📷 ' + listaArchivos.length + ' Archivo(s)</span>') : '') +
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
        var cantEvid = (r.evidencias && r.evidencias.length) ? r.evidencias.length : (r.fotoBase64 ? 1 : 0);
        var badgeAviso = r.avisoSap ? ('<span class="badge-indicator" style="background:#2563eb; color:#fff; font-size:0.7rem;">AV: ' + sanitize(r.avisoSap) + '</span>') : '';

        return '<div style="background:var(--card-inner-bg); border:1px solid var(--glass-border); border-left:5px solid ' + col + '; border-radius:10px; padding:14px 18px; margin-bottom:12px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;">' +
            '<div style="flex:1; min-width:260px;">' +
              '<div style="display:flex; align-items:center; gap:8px;">' +
                '<span class="badge-indicator" style="background:' + col + '; color:#fff;">' + (r.severidad || 'Seguimiento').toUpperCase() + '</span>' +
                '<strong class="code-font" style="font-size:1.05rem; color:var(--text-main);">' + sanitize(r.tag) + '</strong>' +
                (r.componente ? ('<span style="font-size:0.84rem; color:#38bdf8; font-weight:700;">➔ ' + sanitize(r.componente) + '</span>') : '') +
                badgeAviso +
                (cantEvid > 0 ? ('<span class="badge-indicator badge-reportes">📷 ' + cantEvid + ' Archivo(s)</span>') : '') +
              '</div>' +
              '<div style="font-size:0.86rem; color:var(--text-muted); margin-top:6px; line-height:1.4;">' + sanitize(r.detalle) + '</div>' +
              '<div style="font-size:0.72rem; color:var(--text-muted); margin-top:4px;">Faena: ' + sanitize(r.faena || 'CMP') + ' | Área: ' + sanitize(r.area || 'General') + ' | ⏱️ ' + fecha + ' ' + hora + '</div>' +
            '</div>' +
            '<div style="display:flex; gap:8px;">' +
              '<button class="btn-base btn-primary" type="button" style="padding:8px 16px; font-size:0.82rem; font-weight:800;" onclick="window.CIO.verEvidenciasEIrAlActivo(\'' + r.tag + '\')">👁️ Ver Evidencias (' + cantEvid + ')</button>' +
            '</div>' +
          '</div>';
      }).join('');
    },

    abrirFiltrosReporteTerreno: function() {
      if (!state.usuarioActivo) {
        alert("🔒 Acceso Restringido: Inicia sesión para emitir reportes de ronda.");
        return;
      }

      var selEq = document.getElementById('repTerrenoTagSelect');
      if (selEq) {
        selEq.innerHTML = '<option value="">-- Selecciona el Equipo --</option>';
        var tagsConReportes = [];
        state.alertasTerreno.forEach(function(r) {
          var t = (r.tag || '').trim().toUpperCase();
          if (t && tagsConReportes.indexOf(t) === -1) {
            tagsConReportes.push(t);
          }
        });

        tagsConReportes.sort().forEach(function(tagItem) {
          var opt = document.createElement('option');
          opt.value = tagItem;
          opt.innerText = tagItem;
          selEq.appendChild(opt);
        });
      }

      window.CIO.cambiarOpcionesFiltroReporte();
      var modal = document.getElementById('modalFiltrosReporteTerreno');
      if (modal) modal.showModal();
    },

    cambiarOpcionesFiltroReporte: function() {
      var tipo = document.getElementById('repTerrenoFiltroTipo').value;
      var boxTag = document.getElementById('boxFiltroTagRep');
      var boxComp = document.getElementById('boxFiltroCompRep');

      if (boxTag) boxTag.style.display = (tipo === 'equipo') ? 'block' : 'none';
      if (boxComp) boxComp.style.display = (tipo === 'componente') ? 'block' : 'none';
    },

    ejecutarGeneracionReporteTerreno: function() {
      var tipo = document.getElementById('repTerrenoFiltroTipo').value;
      var tagQuery = (document.getElementById('repTerrenoTagSelect')?.value || '').trim().toUpperCase();
      var compQuery = (document.getElementById('repTerrenoCompInput')?.value || '').trim().toUpperCase();

      var lista = state.alertasTerreno.slice();
      var ahora = Date.now();
      var tituloFiltro = "Reporte General de Rondas de Terreno";

      if (tipo === 'dia') {
        tituloFiltro = "Reporte de Turno Diario (Últimas 24 Horas)";
        lista = lista.filter(function(r) {
          var t = new Date(r.timestamp || 0).getTime();
          return (ahora - t) <= (24 * 60 * 60 * 1000);
        });
      } else if (tipo === 'rojo') {
        tituloFiltro = "Reporte de Hallazgos Críticos (Condición Roja)";
        lista = lista.filter(function(r) { return r.severidad === 'Rojo'; });
      } else if (tipo === 'equipo') {
        if (!tagQuery) { alert("⚠️ Por favor selecciona un equipo de la lista."); return; }
        tituloFiltro = "Reporte de Hallazgos de Terreno para el Activo: " + tagQuery;
        lista = lista.filter(function(r) { return matchTags(r.tag, tagQuery); });
      } else if (tipo === 'componente') {
        if (!compQuery) { alert("⚠️ Ingresa un componente para filtrar."); return; }
        tituloFiltro = "Reporte de Hallazgos por Componente: " + compQuery;
        lista = lista.filter(function(r) {
          return (r.componente || '').toUpperCase().includes(compQuery);
        });
      }

      if (lista.length === 0) {
        alert("⚠️ No se encontraron hallazgos registrados para el criterio seleccionado.");
        return;
      }

      document.getElementById('modalFiltrosReporteTerreno').close();
      window.CIO.emitirReporteTerrenoImpresion(lista, tituloFiltro);
    },

    emitirReporteTerrenoImpresion: function(reportes, tituloInforme) {
      var itemsHtml = reportes.map(function(r) {
        var col = SEV_COLOR[r.severidad] || '#0284c7';
        var listaArchivos = (r.evidencias && Array.isArray(r.evidencias) && r.evidencias.length > 0)
          ? r.evidencias
          : (r.fotoBase64 ? [{ tipo: 'imagen', data: r.fotoBase64 }] : []);

        var fotosHtml = '';
        if (listaArchivos.length > 0) {
          fotosHtml = '<div style="margin-top:10px;"><strong style="font-size:0.75rem; color:#4b5563;">Registros Multimedia:</strong><div style="display:flex; flex-wrap:wrap; gap:8px; margin-top:4px;">' +
            listaArchivos.map(function(ev) {
              var src = ev.data || ev.src || ev;
              if (ev.tipo === 'video') {
                return '<div style="text-align:center;"><video src="' + src + '" style="max-height:120px; max-width:180px; border-radius:4px; border:1px solid #ccc;"></video><div style="font-size:0.65rem; color:#647280; font-weight:bold;">VIDEO</div></div>';
              } else {
                return '<div style="text-align:center;"><img src="' + src + '" style="max-height:120px; max-width:180px; border-radius:4px; border:1px solid #ccc; object-fit:contain;" /><div style="font-size:0.65rem; color:#64748b; font-weight:bold;">FOTO</div></div>';
              }
            }).join('') + '</div></div>';
        }

        var avisoHtml = r.avisoSap ? ('<span style="font-size:0.78rem; background:#eff6ff; color:#1d4ed8; border:1px solid #bfdbfe; padding:2px 8px; border-radius:4px; font-weight:bold; margin-left:8px;">AVISO SAP: ' + sanitize(r.avisoSap) + '</span>') : '';

        return '<div style="border:1px solid #d1d5db; border-left:5px solid ' + col + '; border-radius:6px; padding:12px 16px; margin-bottom:14px; page-break-inside:avoid;">' +
            '<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">' +
              '<div>' +
                '<strong style="font-size:1.05rem; color:#0f172a;">' + sanitize(r.tag) + '</strong>' +
                (r.componente ? ('<span style="font-size:0.9rem; color:#0284c7; font-weight:bold; margin-left:6px;">➔ ' + sanitize(r.componente) + '</span>') : '') +
                avisoHtml +
              '</div>' +
              '<div>' +
                '<span style="padding:4px 8px; border-radius:4px; background:' + col + '; color:#fff; font-size:0.75rem; font-weight:800; text-transform:uppercase;">' + (r.severidad || 'Seguimiento') + '</span>' +
              '</div>' +
            '</div>' +
            '<div style="font-size:0.88rem; line-height:1.45; color:#1f2937; margin:6px 0;">' + sanitize(r.detalle) + '</div>' +
            '<div style="font-size:0.72rem; color:#64748b;">Faena: ' + sanitize(r.faena || 'CMP') + ' | Área: ' + sanitize(r.area || 'General') + ' | Fecha Registro: ' + (r.timestamp ? new Date(r.timestamp).toLocaleString() : 'N/D') + '</div>' +
            fotosHtml +
          '</div>';
      }).join('');

      var elTitulo = document.getElementById('prevTituloReporte');
      if (elTitulo) elTitulo.value = tituloInforme;
      var elCont = document.getElementById('prevContenidoReporte');
      if (elCont) elCont.value = "Listado consolidado de hallazgos detectados en terreno durante el turno operativo activo.";

      reportePendienteImpresion = {
        tipo: 'ronda_terreno',
        reportes: reportes,
        tituloInforme: tituloInforme,
        itemsHtml: itemsHtml
      };

      var modalPrev = document.getElementById('modalVistaPreviaImpresion');
      if (modalPrev) modalPrev.showModal();
    },

    abrirEditorInformeModal: function() {
      if (!state.usuarioActivo) {
        alert("🔒 Acceso Restringido: Inicia sesión para emitir informes.");
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
              return '<div style="text-align:center;"><img src="' + src + '" style="max-height:140px; max-width:220px; border-radius:4px; border:1px solid #ccc; object-fit:contain;" /><div style="font-size:0.65rem; color:#647280; font-weight:bold; margin-top:2px;">' + tipo + '</div></div>';
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

      var elTitulo = document.getElementById('prevTituloReporte');
      if (elTitulo) elTitulo.value = "INFORME OFICIAL DE MONITOREO TREN MOTRIZ - TAG: " + tagValue;
      var elCont = document.getElementById('prevContenidoReporte');
      if (elCont) elCont.value = conclusionGeneral;

      reportePendienteImpresion = {
        tipo: 'tren_motriz',
        eq: eq,
        tagValue: tagValue,
        avisosEditados: avisosEditados,
        omsEditadas: omsEditadas,
        sevGlobal: sevGlobal,
        compsHtml: compsHtml
      };

      var modalPrev = document.getElementById('modalVistaPreviaImpresion');
      if (modalPrev) modalPrev.showModal();
    },

    confirmarEImprimirReporteEditado: function() {
      if (!reportePendienteImpresion) return;

      var nuevoTitulo = document.getElementById('prevTituloReporte').value.trim();
      var nuevoContenido = document.getElementById('prevContenidoReporte').value.trim();

      document.getElementById('modalVistaPreviaImpresion').close();

      var htmlDoc = '';

      if (reportePendienteImpresion.tipo === 'tren_motriz') {
        var r = reportePendienteImpresion;
        htmlDoc = 
          '<!DOCTYPE html>' +
          '<html lang="es">' +
          '<head>' +
            '<meta charset="UTF-8">' +
            '<title>Informe Técnico - ' + r.tagValue + '</title>' +
            '<style>' +
              '@page { size: A4 portrait; margin: 12mm; }' +
              'body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; padding: 24px; color: #111827; background: #fff; line-height: 1.4; margin: 0; }' +
              '.header-report { display: flex; justify-content: space-between; align-items: center; border-bottom: 3px solid #0284c7; padding-bottom: 12px; margin-bottom: 16px; }' +
              '.header-left { display: flex; align-items: center; gap: 14px; }' +
              '.logo-cpf { height: 44px; width: auto; object-fit: contain; }' +
              '.header-report h1 { margin: 0; font-size: 1.15rem; color: #0f172a; text-transform: uppercase; }' +
              '.header-report p { margin: 2px 0 0 0; font-size: 0.74rem; color: #64748b; font-weight: bold; }' +
              '.badge-sev { padding: 5px 12px; border-radius: 6px; font-weight: 800; color: #fff; background: ' + (SEV_COLOR[r.sevGlobal] || '#4b5563') + '; text-transform: uppercase; font-size: 0.85rem; }' +
              '.data-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px 14px; margin-bottom: 14px; font-size: 0.8rem; }' +
              '.data-item strong { display: block; font-size: 0.65rem; color: #64748b; text-transform: uppercase; margin-bottom: 2px; }' +
              '.section-title { font-size: 0.9rem; color: #0284c7; border-left: 4px solid #0284c7; padding-left: 8px; margin: 16px 0 8px 0; text-transform: uppercase; font-weight: 800; }' +
              '.box-conclusion { background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 6px; padding: 10px 14px; font-size: 0.85rem; margin-bottom: 12px; }' +
              '@media print { body { padding: 0; } }' +
            '</style>' +
          '</head>' +
          '<body>' +
            '<div class="header-report">' +
              '<div class="header-left">' +
                '<img src="logo-cpf.png" class="logo-cpf" alt="CPF Ingeniería" onerror="this.style.display=\'none\'" />' +
                '<div>' +
                  '<h1>' + sanitize(nuevoTitulo) + '</h1>' +
                  '<p>CPF INGENIERÍA LTDA | COMPAÑÍA MINERA DEL PACÍFICO | CIO</p>' +
                '</div>' +
              '</div>' +
              '<div><span class="badge-sev">CONDICIÓN: ' + r.sevGlobal + '</span></div>' +
            '</div>' +
            '<div class="data-grid">' +
              '<div class="data-item"><strong>Faena Operativa</strong>' + sanitize(r.eq.siteId) + '</div>' +
              '<div class="data-item"><strong>Área</strong>' + sanitize(r.eq.area) + '</div>' +
              '<div class="data-item"><strong>Tag Equipo</strong>' + sanitize(r.tagValue) + '</div>' +
              '<div class="data-item"><strong>Avisos SAP</strong>' + sanitize(r.avisosEditados) + '</div>' +
              '<div class="data-item"><strong>Órdenes OM</strong>' + sanitize(r.omsEditadas) + '</div>' +
              '<div class="data-item"><strong>Última Medición</strong>' + (r.eq.fechaMedicion || 'S/F') + '</div>' +
            '</div>' +
            '<div class="section-title">1. Resumen Ejecutivo & Conclusiones</div>' +
            '<div class="box-conclusion">' + sanitize(nuevoContenido) + '</div>' +
            '<div class="section-title">2. Diagnóstico Técnico por Puntos & Espectros</div>' +
            r.compsHtml +
            '<footer style="margin-top:24px; border-top:1px solid #e2e8f0; padding-top:8px; font-size:0.7rem; color:#94a3b8; text-align:center;">' +
              'Documento Oficial CIO - Emitido por CPF Ingeniería Ltda.' +
            '</footer>' +
          '</body>' +
          '</html>';
      } else {
        var r2 = reportePendienteImpresion;
        htmlDoc = 
          '<!DOCTYPE html>' +
          '<html lang="es">' +
          '<head>' +
            '<meta charset="UTF-8">' +
            '<title>Reporte de Ronda Terreno - CPF</title>' +
            '<style>' +
              '@page { size: A4 portrait; margin: 12mm; }' +
              'body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; padding: 24px; color: #111827; background: #fff; line-height: 1.4; margin: 0; }' +
              '.header-report { display: flex; justify-content: space-between; align-items: center; border-bottom: 3px solid #0284c7; padding-bottom: 12px; margin-bottom: 16px; }' +
              '.header-left { display: flex; align-items: center; gap: 14px; }' +
              '.logo-cpf { height: 44px; width: auto; object-fit: contain; }' +
              '.header-report h1 { margin: 0; font-size: 1.15rem; color: #0f172a; text-transform: uppercase; }' +
              '.header-report p { margin: 2px 0 0 0; font-size: 0.74rem; color: #64748b; font-weight: bold; }' +
              '@media print { body { padding: 0; } }' +
            '</style>' +
          '</head>' +
          '<body>' +
            '<div class="header-report">' +
              '<div class="header-left">' +
                '<img src="logo-cpf.png" class="logo-cpf" alt="CPF Ingeniería" onerror="this.style.display=\'none\'" />' +
                '<div>' +
                  '<h1>' + sanitize(nuevoTitulo) + '</h1>' +
                  '<p>CPF INGENIERÍA LTDA | COMPAÑÍA MINERA DEL PACÍFICO | CIO</p>' +
                '</div>' +
              '</div>' +
              '<div style="text-align:right; font-size:0.75rem; color:#64748b;">' +
                '<div>Total Registros: <strong>' + r2.reportes.length + '</strong></div>' +
                '<div>Emisión: ' + new Date().toLocaleString() + '</div>' +
              '</div>' +
            '</div>' +
            '<div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:6px; padding:10px 14px; font-size:0.85rem; margin-bottom:14px;">' +
              '<strong>Nota Operativa:</strong> ' + sanitize(nuevoContenido) +
            '</div>' +
            r2.itemsHtml +
            '<footer style="margin-top:24px; border-top:1px solid #e2e8f0; padding-top:8px; font-size:0.7rem; color:#94a3b8; text-align:center;">' +
              'Documento Oficial de Ronda de Terreno CIO - Emitido por CPF Ingeniería Ltda.' +
            '</footer>' +
          '</body>' +
          '</html>';
      }

      imprimirMedianteBlob(htmlDoc);
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
      setVal('edLat', eq.lat || '');
      setVal('edLng', eq.lng || '');

      window.CIO.actualizarBadgeGeoEstado(eq.lat, eq.lng);

      var mEd = document.getElementById('modalEdicion');
      if (mEd) mEd.showModal();
    },

    abrirModalEditarReporteTerreno: function(reporteId) {
      if (!state.usuarioActivo) {
        alert("🔒 Debes iniciar sesión para editar reportes.");
        return;
      }

      var rep = state.alertasTerreno.find(function(a) { return a.id === reporteId; });
      if (!rep) return;

      document.getElementById('editReporteId').value = rep.id;
      document.getElementById('editReporteTag').value = rep.tag || '';
      document.getElementById('editReporteComp').value = rep.componente || '';
      document.getElementById('editReporteSev').value = rep.severidad || 'Verde';
      document.getElementById('editReporteDetalle').value = rep.detalle || '';
      document.getElementById('editReporteAviso').value = rep.avisoSap || '';

      state.tempEvidenciasReporte = [];
      if (rep.evidencias && Array.isArray(rep.evidencias)) {
        state.tempEvidenciasReporte = rep.evidencias.slice();
      } else if (rep.fotoBase64) {
        state.tempEvidenciasReporte = [{ tipo: 'imagen', data: rep.fotoBase64 }];
      }

      window.CIO.renderMiniaturasEvidenciasReporte();
      document.getElementById('modalEditarReporteTerreno').showModal();
    },

    procesarNuevasEvidenciasEdicionReporte: function(event, tipo) {
      var files = Array.from(event.target.files);
      if (!files.length) return;

      var canvas = document.getElementById('resizeCanvas') || document.createElement('canvas');
      var ctx = canvas.getContext('2d');
      var procesados = 0;

      files.forEach(function(file) {
        if (tipo === 'imagen' && file.type.startsWith('image/')) {
          var reader = new FileReader();
          reader.onload = function(e) {
            var img = new Image();
            img.onload = function() {
              var MAX = 1100;
              var w = img.width, h = img.height;
              if (w > MAX || h > MAX) {
                if (w > h) { h = Math.round((h * MAX) / w); w = MAX; }
                else { w = Math.round((w * MAX) / h); h = MAX; }
              }
              canvas.width = w; canvas.height = h;
              ctx.drawImage(img, 0, 0, w, h);

              state.tempEvidenciasReporte.push({
                tipo: 'imagen',
                data: canvas.toDataURL('image/jpeg', 0.65)
              });

              procesados++;
              if (procesados === files.length) {
                window.CIO.renderMiniaturasEvidenciasReporte();
              }
            };
            img.src = e.target.result;
          };
          reader.readAsDataURL(file);
        } else if (tipo === 'video' && file.type.startsWith('video/')) {
          if (file.size > 8 * 1024 * 1024) {
            alert("⚠️ El video supera los 8 MB. Adjunta un clip más breve.");
            return;
          }
          var vid = document.createElement('video');
          vid.preload = 'metadata';
          vid.onloadedmetadata = function() {
            window.URL.revokeObjectURL(vid.src);
            if (vid.duration > 11) {
              alert("⚠️ El video dura " + Math.round(vid.duration) + "s. El límite máximo son 10 segundos.");
              return;
            }
            var reader = new FileReader();
            reader.onload = function(e) {
              state.tempEvidenciasReporte.push({
                tipo: 'video',
                data: e.target.result
              });
              window.CIO.renderMiniaturasEvidenciasReporte();
            };
            reader.readAsDataURL(file);
          };
          vid.src = URL.createObjectURL(file);
        }
      });

      event.target.value = '';
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
      var nuevoAviso = document.getElementById('editReporteAviso').value.trim();

      var payload = {
        severidad: nuevaSev,
        detalle: nuevoDetalle,
        avisoSap: nuevoAviso,
        evidencias: state.tempEvidenciasReporte,
        modificadoPor: state.usuarioActivo,
        modificadoEn: new Date().toISOString()
      };

      var primeraFoto = state.tempEvidenciasReporte.find(function(e) { return e.tipo === 'imagen'; });
      payload.fotoBase64 = primeraFoto ? (primeraFoto.data || primeraFoto.src) : '';

      dbAlertasTerreno.child(repId).update(payload).then(function() {
        alert("✅ Reporte de terreno actualizado exitosamente.");
        document.getElementById('modalEditarReporteTerreno').close();
        window.CIO.abrirModalHistoricoTerreno();
      }).catch(function(err) {
        alert("❌ Error al guardar en Firebase: " + err.message);
      });
    },

    adoptarEvidenciasAComponenteDefinitivo: function() {
      if (!state.usuarioActivo) {
        alert("🔒 Inicia sesión para traspasar evidencias al catastro.");
        return;
      }

      var tag = document.getElementById('editReporteTag').value;
      var componenteNombre = document.getElementById('editReporteComp').value;
      var severidad = document.getElementById('editReporteSev').value;
      var observacion = document.getElementById('editReporteDetalle').value;
      var avisoSap = document.getElementById('editReporteAviso').value.trim();

      if (!tag) {
        alert("⚠️ No hay un TAG asociado.");
        return;
      }

      var eq = state.equipos.find(function(e) { return matchTags(e.tag, tag); });
      if (!eq) {
        alert("⚠️ El equipo [" + tag + "] no existe en el catastro oficial.");
        return;
      }

      eq.componentes = eq.componentes || [];
      var compIndex = eq.componentes.findIndex(function(c) {
        return (c.nombre || '').toUpperCase().includes(componenteNombre.toUpperCase()) ||
               componenteNombre.toUpperCase().includes((c.nombre || '').toUpperCase());
      });

      var nuevasEvidencias = state.tempEvidenciasReporte.map(function(ev) {
        return {
          src: ev.data || ev.src || ev,
          tipo: ev.tipo === 'video' ? 'video' : 'terreno'
        };
      });

      if (compIndex === -1) {
        compIndex = eq.componentes.length;
        eq.componentes.push({
          nombre: componenteNombre || 'Componente Terreno',
          punto: 'Inspección de Ronda',
          rms: '3.5',
          severidad: severidad,
          paresSap: avisoSap ? [{ aviso: avisoSap, om: '' }] : [],
          analisis: observacion,
          recomendacion: 'Intervención y seguimiento técnico derivado de ronda en terreno.',
          espectros: nuevasEvidencias
        });
      } else {
        var compExistente = eq.componentes[compIndex];
        compExistente.severidad = severidad;
        compExistente.analisis = (compExistente.analisis ? compExistente.analisis + "\n" : "") + "[Ronda Terreno]: " + observacion;
        compExistente.espectros = (compExistente.espectros || []).concat(nuevasEvidencias);
        
        if (avisoSap) {
          compExistente.paresSap = compExistente.paresSap || [];
          compExistente.paresSap.push({ aviso: avisoSap, om: '' });
        }
      }

      if (db) {
        db.child(eq.id).child('componentes').set(eq.componentes).then(function() {
          alert("✅ ÉXITO: El hallazgo y sus " + nuevasEvidencias.length + " imagen(es) quedaron fijados en el tren motriz de " + tag + ".");
          document.getElementById('modalEditarReporteTerreno').close();
          window.CIO.irANivel3Equipo(eq.id);
        });
      }
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
        });
      }
    },

    abrirFotoEnNuevaPestana: function(base64Data) {
      var win = window.open("");
      win.document.write('<body style="margin:0; background:#0a0a0c; display:flex; justify-content:center; align-items:center; height:100vh;"><img src="' + base64Data + '" style="max-width:98%; max-height:98%; object-fit:contain;" /></body>');
    },

    handleUserBtnClick: function(e) {
      if (e && e.preventDefault) e.preventDefault();
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
        
        reiniciarVigilanteInactividad();
        alert('✅ Bienvenido ' + nombre);
        refresh();
      }
    },

    cerrarSesionUsuario: function() {
      state.usuarioActivo = null;
      state.faenaAsignada = null;
      state.isSuperAdmin = false;

      if (temporizadorInactividad) clearTimeout(temporizadorInactividad);

      document.body.classList.remove('user-authenticated');

      var lbl = document.getElementById('labelUsuarioBtn');
      if (lbl) lbl.innerText = 'Entrar';
      var dropInfo = document.getElementById('dropUserInfo');
      if (dropInfo) dropInfo.innerText = 'Invitado (Solo Lectura)';
      var uMenu = document.getElementById('userDropdownMenu');
      if (uMenu) uMenu.classList.remove('is-active');
      window.CIO.goScreen(1);
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

    abrirEdicionEquipoNuevoAuth: function() {
      var targetSite = state.faenaSeleccionada || state.faenaAsignada || FAENAS[0];
      var newId = 'EQ_' + Date.now();
      var coordsDefault = FAENA_COORDS[targetSite] || [-28.3294, -70.9392];

      var nuevoEquipo = {
        id: newId,
        siteId: targetSite,
        domain: 'planta',
        area: state.areaSeleccionada || 'Área General',
        tag: 'MH' + Math.floor(1000 + Math.random() * 9000),
        tipo: 'Activo Crítico',
        lat: coordsDefault[0],
        lng: coordsDefault[1],
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
      }).catch(function(err) {});
    }
  };

  // Exposición en ámbito global para listeners inline
  window.handleUserBtnClick = window.CIO.handleUserBtnClick;
  window.salirSuperAdmin = window.CIO.salirSuperAdmin;

  document.addEventListener('DOMContentLoaded', function() {
    if (localStorage.getItem('CIO_THEME') === 'light') {
      document.body.classList.add('light-mode');
    }
    window.CIO.goScreen(1);

    actualizarTickerMercadoYClima();
    setInterval(actualizarTickerMercadoYClima, 10 * 60 * 1000);
  });
})();
