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
    equipoIdModal: null,
    siteMapVisible: false,
    authMode: 'login',
    mapaSite: null,
    capaSite: null,
    equipos: [],
    alertasTerreno: []
  };

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
        avisoSap: '',
        omSap: '',
        analisis: 'Monitoreo de vibraciones rutinario.',
        recomendacion: 'Mantener frecuencia.',
        analisisIA: '',
        recomendacionIA: '',
        componentes: [{ nombre: 'Spot Principal', severidad: sevRand, rms: '2.5', om: '' }]
      });
    }
    return list;
  }

  state.equipos = generarSeedLocal();

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

    var cards = sortedFaenas.map(function(d) {
      var anim = (d.maxSev === 'Rojo' || d.maxSev === 'Naranja') ? ('anim-' + d.maxSev.toLowerCase()) : '';
      return [
        '<article class="card-area ', anim, '" onclick="window.CIO.seleccionarFaena(\'', sanitize(d.name), '\')">',
          '<header>',
            '<span class="label-muted">Faena Operativa CMP</span>',
            '<h3 class="value-strong" style="margin:4px 0 8px 0;">', sanitize(d.name), '</h3>',
          '</header>',
          '<div style="display:flex; justify-content:space-between; border-top:1px solid var(--border-card); padding-top:8px;">',
            '<div><span class="label-muted">Activos</span><div class="value-strong">', d.count, '</div></div>',
            '<div><span class="label-muted">Condición</span><div class="value-strong" style="color:', SEV_COLOR[d.maxSev], '">', (d.critical > 0 ? (d.critical + ' Alertas') : 'Normal'), '</div></div>',
          '</div>',
        '</article>'
      ].join('');
    });
    container.innerHTML = cards.join('');
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

      var areaKeys = Object.keys(areas);
      var sortedAreas = areaKeys.map(function(a) {
        var obj = { name: a };
        for (var k in areas[a]) { obj[k] = areas[a][k]; }
        return obj;
      }).sort(function(a, b) { return (b.maxPeso - a.maxPeso) || (b.critical - a.critical); });

      container.className = 'grid-container';
      if (sortedAreas.length === 0) {
        container.innerHTML = '<div class="label-muted" style="padding:20px;">Sin áreas registradas. Realiza una Carga Masiva.</div>';
        return;
      }

      var areaCards = sortedAreas.map(function(a) {
        var anim = (a.maxSev === 'Rojo' || a.maxSev === 'Naranja') ? ('anim-' + a.maxSev.toLowerCase()) : '';
        return [
          '<article class="card-area ', anim, '" onclick="window.CIO.seleccionarArea(\'', sanitize(a.name), '\')">',
            '<span class="label-muted">Área Operacional</span>',
            '<h3 class="value-strong" style="margin:4px 0 8px 0;">', sanitize(a.name), '</h3>',
            '<div style="display:flex; justify-content:space-between; border-top:1px solid var(--border-card); padding-top:8px;">',
              '<div><span class="label-muted">Activos</span><div class="value-strong">', a.count, '</div></div>',
              '<div><span class="label-muted">Condición</span><div class="value-strong" style="color:', SEV_COLOR[a.maxSev], '">', (a.critical > 0 ? (a.critical + ' Alertas') : 'Normal'), '</div></div>',
            '</div>',
          '</article>'
        ].join('');
      });
      container.innerHTML = areaCards.join('');
    } else {
      container.className = 'grid-equipos';
      var eqsArea = eqsFaena.filter(function(e) { return (e.area || 'Sin Área') === state.areaSeleccionada; });
      eqsArea.sort(function(a, b) { return SEV_PESO[calcMaxSev(b.componentes)] - SEV_PESO[calcMaxSev(a.componentes)]; });

      var navHeader = [
        '<div style="grid-column: 1/-1; display:flex; align-items:center; gap:10px; margin-bottom:4px; background:var(--glass-card); backdrop-filter:blur(8px); padding:8px 12px; border-radius:8px; border:1px solid var(--glass-border);">',
          '<button class="btn-base" type="button" onclick="window.CIO.volverAreas()">⬅️ Volver a Áreas</button>',
          '<span style="font-weight:700; color:var(--accent-color); font-size:0.85rem;">Área: ', sanitize(state.areaSeleccionada), '</span>',
        '</div>'
      ].join('');

      var eqCards = eqsArea.map(function(eq) {
        var s = calcMaxSev(eq.componentes);
        var anim = (s === 'Rojo' || s === 'Naranja') ? ('anim-' + s.toLowerCase()) : '';
        var tagValue = eq.tag || eq.Tag || eq.TAG || eq.equipo || eq.id || 'S/T';
        var fieldCount = state.alertasTerreno.filter(function(a) { return matchTags(a.tag, tagValue); }).length;
        var badge = fieldCount > 0 ? ('<span class="badge-field-floating">💬 Terreno (' + fieldCount + ')</span>') : '';
        var aud = calcularDiasDesdeMedicion(eq.fechaMedicion);
        var badgeVencido = aud.vencido ? ('<span class="badge-vencido-floating" title="Medición vencida: ' + aud.texto + '">⏱️ >30d</span>') : '';

        return [
          '<article class="card-equipo sev-', s.toLowerCase(), ' ', anim, '" onclick="window.CIO.abrirDetalle(\'', eq.id, '\')">',
            badge,
            badgeVencido,
            '<span class="eq-type">', sanitize(eq.tipo || eq.area), '</span>',
            '<div class="eq-tag code-font">', sanitize(tagValue), '</div>',
            '<span class="eq-type" style="color:', SEV_COLOR[s], '">', s.toUpperCase(), '</span>',
          '</article>'
        ].join('');
      });
      container.innerHTML = navHeader + eqCards.join('');
    }
  }

  function renderScreen3() {
    var filterEl = document.getElementById('superAdminFilterSite');
    var filter = filterEl ? filterEl.value : 'TODAS';
    var eqs = filter === 'TODAS' ? state.equipos : state.equipos.filter(function(e) { return normalizarFaena(e.siteId) === filter; });
    eqs.sort(function(a, b) { return SEV_PESO[calcMaxSev(b.componentes)] - SEV_PESO[calcMaxSev(a.componentes)]; });

    var container = document.getElementById('viewScreen3Global');
    if (!container) return;

    var html = eqs.map(function(eq) {
      var s = calcMaxSev(eq.componentes);
      var anim = (s === 'Rojo' || s === 'Naranja') ? ('anim-' + s.toLowerCase()) : '';
      var tagValue = eq.tag || eq.Tag || eq.TAG || eq.id || 'S/T';
      return [
        '<article class="card-equipo sev-', s.toLowerCase(), ' ', anim, '">',
          '<span class="label-muted">', sanitize(eq.siteId), '</span>',
          '<div class="eq-tag code-font">', sanitize(tagValue), '</div>',
          '<div style="margin-top:6px;">',
            '<button class="btn-base btn-primary" type="button" style="padding:2px 8px; font-size:0.65rem;" onclick="window.CIO.abrirEdicion(\'', eq.id, '\')">✏️ Editar</button>',
          '</div>',
        '</article>'
      ].join('');
    }).join('');
    container.innerHTML = html;
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
            componentes: item.componentes || item.spots || [{ nombre: 'Spot Principal', severidad: 'Verde', rms: '2.0', om: '' }],
            fechaMedicion: item.fechaMedicion || item.fecha || '',
            fechaHallazgo: item.fechaHallazgo || '',
            estatusHallazgo: item.estatusHallazgo || 'Abierto',
            avisoSap: item.avisoSap || '',
            omSap: item.omSap || '',
            analisis: item.analisis || '',
            recomendacion: item.recomendacion || '',
            analisisIA: item.analisisIA || '',
            recomendacionIA: item.recomendacionIA || ''
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

        if (state.equipoIdModal) {
          var currentEq = state.equipos.find(function(e) { return e.id === state.equipoIdModal; });
          if (currentEq) {
            window.CIO.renderBitacoraTerreno(currentEq);
          }
        }
      });
    }
  }

  function refresh() {
    try {
      if (state.currentScreen === 1) renderScreen1();
      else if (state.currentScreen === 2) renderScreen2();
      else if (state.currentScreen === 3) renderScreen3();
    } catch (e) {
      console.error("Error al refrescar interfaz:", e);
    }
  }

  window.CIO = {
    goScreen: function(num) {
      state.currentScreen = num;
      document.querySelectorAll('.screen-view').forEach(function(el) { el.classList.remove('active'); });
      var sc = document.getElementById('screen-' + num);
      if (sc) sc.classList.add('active');
      var titles = { 1: 'Vista Pública (Global - DEV)', 2: 'Faena: ' + (state.faenaSeleccionada || 'Operativa (DEV)'), 3: 'Consola SuperAdmin (DEV)' };
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

    renderBitacoraTerreno: function(eq) {
      var terList = document.getElementById('detTerrenoList');
      if (!terList) return;
      var tagValue = eq.tag || eq.Tag || eq.id || 'S/T';
      
      var myReports = state.alertasTerreno
        .filter(function(a) { return matchTags(a.tag, tagValue); })
        .sort(function(a, b) { return new Date(b.timestamp || 0) - new Date(a.timestamp || 0); });

      if (myReports.length === 0) {
        terList.innerHTML = '<div class="label-muted" style="padding:14px; font-style:italic;">No hay reportes de ronda para este activo.</div>';
        return;
      }

      var htmlReports = myReports.map(function(r) {
        var fotoHtml = r.fotoBase64 ? ('<div style="margin-top:8px;"><img src="' + r.fotoBase64 + '" class="img-terreno-preview-lg" alt="Evidencia" onclick="window.CIO.abrirFotoEnNuevaPestana(\'' + r.fotoBase64 + '\')" /></div>') : '';
        return [
          '<article class="card-reporte-terreno-lg">',
            '<div style="display:flex; justify-content:space-between; color:var(--text-muted); font-size:0.75rem;">',
              '<span>🕒 <strong>', (r.timestamp ? new Date(r.timestamp).toLocaleString() : 'N/D'), '</strong></span>',
              '<span style="color:', (SEV_COLOR[r.severidad] || '#fff'), '; font-weight:bold; font-size:0.85rem;">', (r.severidad || 'Seguimiento'), '</span>',
            '</div>',
            '<div style="font-size:0.9rem; color:#fff; line-height:1.4;">', sanitize(r.detalle), '</div>',
            fotoHtml,
          '</article>'
        ].join('');
      });
      terList.innerHTML = htmlReports.join('');
    },

    exportarReporteTerrenoPDF: function(id) {
      var eq = state.equipos.find(function(e) { return e.id === id; });
      if (!eq) return;

      var tagValue = eq.tag || eq.Tag || eq.id || 'S/T';
      var myReports = state.alertasTerreno
        .filter(function(a) { return matchTags(a.tag, tagValue); })
        .sort(function(a, b) { return new Date(b.timestamp || 0) - new Date(a.timestamp || 0); });

      var aud = calcularDiasDesdeMedicion(eq.fechaMedicion);
      var sevGlobal = calcMaxSev(eq.componentes);

      var reportsHtml = '';
      if (myReports.length > 0) {
        reportsHtml = myReports.map(function(r, i) {
          var imgTag = r.fotoBase64 ? ('<div><img src="' + r.fotoBase64 + '" class="img-report" alt="Evidencia"></div>') : '';
          return [
            '<div class="report-card">',
              '<div class="report-card-header">',
                '<span><strong>Hallazgo #', (myReports.length - i), '</strong> | Fecha: ', (r.timestamp ? new Date(r.timestamp).toLocaleString() : 'N/D'), '</span>',
                '<span style="font-weight:bold; color:', (SEV_COLOR[r.severidad] || '#000'), ';">Severidad: ', r.severidad, '</span>',
              '</div>',
              '<div style="font-size:0.9rem; margin-top:4px;">', sanitize(r.detalle), '</div>',
              imgTag,
            '</div>'
          ].join('');
        }).join('');
      } else {
        reportsHtml = '<div style="font-size:0.85rem; color:#6b7280; font-style:italic;">No se registran eventos tácticos de terreno para este activo.</div>';
      }

      var win = window.open('', '_blank');
      win.document.write([
        '<!DOCTYPE html>',
        '<html lang="es">',
        '<head>',
          '<meta charset="UTF-8">',
          '<title>Informe Técnico - ', tagValue, ' - CPF Ingeniería</title>',
          '<style>',
            'body { font-family: "Helvetica Neue", Arial, sans-serif; padding: 30px; color: #1f2937; margin: 0; background: #fff; }',
            '.header-report { display: flex; justify-content: space-between; align-items: center; border-bottom: 3px solid #1e3a8a; padding-bottom: 14px; margin-bottom: 20px; }',
            '.header-report h1 { margin: 0; font-size: 1.4rem; color: #1e3a8a; text-transform: uppercase; }',
            '.header-report p { margin: 2px 0 0 0; font-size: 0.8rem; color: #6b7280; font-weight: bold; }',
            '.badge-sev { display: inline-block; padding: 4px 10px; border-radius: 4px; font-weight: bold; color: #fff; background: ', (SEV_COLOR[sevGlobal] || '#4b5563'), '; text-transform: uppercase; }',
            '.data-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; padding: 14px; margin-bottom: 20px; font-size: 0.85rem; }',
            '.data-item strong { display: block; font-size: 0.7rem; color: #4b5563; text-transform: uppercase; }',
            '.section-title { font-size: 1rem; color: #1e3a8a; border-left: 4px solid #1e3a8a; padding-left: 8px; margin: 22px 0 10px 0; text-transform: uppercase; font-weight: bold; }',
            '.box-text { background: #f3f4f6; border-radius: 6px; padding: 12px; font-size: 0.88rem; line-height: 1.5; margin-bottom: 15px; }',
            '.report-card { border: 1px solid #e5e7eb; border-radius: 6px; padding: 12px; margin-bottom: 14px; page-break-inside: avoid; }',
            '.report-card-header { display: flex; justify-content: space-between; font-size: 0.75rem; color: #6b7280; margin-bottom: 6px; }',
            '.img-report { max-width: 320px; max-height: 240px; border-radius: 4px; border: 1px solid #d1d5db; margin-top: 8px; object-fit: cover; }',
            '.print-btn-bar { margin-bottom: 20px; display: flex; gap: 10px; }',
            '.btn-print { background: #1e3a8a; color: #fff; border: none; padding: 8px 16px; border-radius: 6px; font-weight: bold; cursor: pointer; }',
            '@media print { .print-btn-bar { display: none; } body { padding: 10px; } }',
          '</style>',
        '</head>',
        '<body>',
          '<div class="print-btn-bar">',
            '<button class="btn-print" onclick="window.print()">🖨️ Imprimir / Guardar como PDF</button>',
            '<button class="btn-print" style="background:#4b5563;" onclick="window.close()">Cerrar</button>',
          '</div>',
          '<div class="header-report">',
            '<div>',
              '<h1>INFORME DE CONDICIÓN & HALLAZGOS DE TERRENO [DEV]</h1>',
              '<p>CPF INGENIERÍA LTDA | COMPAÑÍA MINERA DEL PACÍFICO</p>',
            '</div>',
            '<div><span class="badge-sev">CONDICIÓN: ', sevGlobal, '</span></div>',
          '</div>',
          '<div class="data-grid">',
            '<div class="data-item"><strong>Faena Operativa</strong>', sanitize(eq.siteId), '</div>',
            '<div class="data-item"><strong>Área</strong>', sanitize(eq.area), '</div>',
            '<div class="data-item"><strong>Tag Equipo</strong>', sanitize(tagValue), '</div>',
            '<div class="data-item"><strong>Clase</strong>', sanitize(eq.tipo || 'Activo Crítico'), '</div>',
            '<div class="data-item"><strong>Estatus Hallazgo</strong>', sanitize(eq.estatusHallazgo || 'Abierto'), '</div>',
            '<div class="data-item"><strong>Aviso / OM SAP</strong>', sanitize(eq.avisoSap || 'S/N'), ' / ', sanitize(eq.omSap || 'S/N'), '</div>',
            '<div class="data-item"><strong>Última Medición</strong>', (eq.fechaMedicion || 'S/F'), ' (', aud.texto, ')</div>',
            '<div class="data-item"><strong>Fecha Emisión</strong>', new Date().toLocaleString(), '</div>',
            '<div class="data-item"><strong>Auditoría de Ruta</strong>', (aud.vencido ? '⚠️ RUTA VENCIDA (>30 Días)' : '✅ RUTA DENTRO DE CICLO'), '</div>',
          '</div>',
          '<div class="section-title">1. Diagnóstico Predictivo & Estado Dinámico</div>',
          '<div class="box-text"><strong>Análisis Técnico:</strong><br>', sanitize(eq.analisis || 'Sin análisis técnico registrado.'), '</div>',
          '<div class="box-text" style="background:#ecfdf5; border:1px solid #a7f3d0;"><strong style="color:#065f46;">Recomendación Operativa / Mantención:</strong><br>', sanitize(eq.recomendacion || 'Sin recomendación registrada.'), '</div>',
          '<div class="section-title">2. Bitácora de Inspecciones y Hallazgos en Terreno (', myReports.length, ')</div>',
          reportsHtml,
        '</body>',
        '</html>'
      ].join(''));
      win.document.close();
    },

    abrirDetalle: function(id) {
      state.equipoIdModal = id;
      var eq = state.equipos.find(function(e) { return e.id === id; });
      if (!eq) return;

      var tagValue = eq.tag || eq.Tag || eq.id || 'S/T';
      var detTag = document.getElementById('detSiteTag');
      if (detTag) detTag.innerText = eq.siteId + ' | TAG: ' + tagValue;
      var detTit = document.getElementById('detTitle');
      if (detTit) detTit.innerText = (eq.tipo || 'Activo') + ' - ' + eq.area;

      var aud = calcularDiasDesdeMedicion(eq.fechaMedicion);
      var contadorBox = document.getElementById('detContadorMedicionBanner');
      if (contadorBox) {
        contadorBox.innerHTML = aud.vencido
          ? ('<span class="banner-contador-alerta vencido">⚠️ ALERTA RUTA: Medición realizada ' + aud.texto + ' (> 30 días sin inspeccionar)</span>')
          : ('<span class="banner-contador-alerta al-dia">✅ RUTA AL DÍA: Última medición ' + aud.texto + ' (dentro de ciclo)</span>');
      }

      var diagBox = document.getElementById('detDiagnosticoBox');
      if (diagBox) {
        diagBox.innerHTML = [
          '<div style="display:flex; justify-content:space-between; flex-wrap:wrap; gap:10px; border-bottom:1px solid var(--glass-border); padding-bottom:10px;">',
            '<div><span class="label-muted">Estatus de Hallazgo</span><div style="font-weight:800; font-size:0.95rem; margin-top:2px;">', sanitize(eq.estatusHallazgo || 'Abierto'), '</div></div>',
            '<div><span class="label-muted">Aviso SAP</span><div class="code-font" style="font-weight:700; color:#60a5fa; margin-top:2px;">', sanitize(eq.avisoSap || 'Sin Aviso'), '</div></div>',
            '<div><span class="label-muted">OM SAP</span><div class="code-font" style="font-weight:700; color:#34d399; margin-top:2px;">', sanitize(eq.omSap || 'Sin OM'), '</div></div>',
            '<div style="display:flex; align-items:center;">',
              '<button type="button" class="btn-base btn-primary" onclick="window.CIO.exportarReporteTerrenoPDF(\'', eq.id, '\')">',
                '📄 Exportar Informe Jefatura',
              '</button>',
            '</div>',
          '</div>',
          '<div style="margin-top:6px;"><span class="label-muted">Análisis Diagnóstico del Activo</span><div style="font-size:0.88rem; color:#f3f4f6; margin-top:4px; line-height:1.4;">', sanitize(eq.analisis || 'Sin análisis registrado'), '</div></div>',
          '<div style="margin-top:6px;"><span class="label-muted" style="color:#34d399;">Recomendación Operativa / Mantención</span><div style="font-size:0.88rem; color:#a7f3d0; margin-top:4px; line-height:1.4;">', sanitize(eq.recomendacion || 'Sin recomendación formulada'), '</div></div>'
        ].join('');
      }

      var list = document.getElementById('detComponentesList');
      if (list) {
        var comps = (eq.componentes || []).slice().sort(function(a, b) {
          return SEV_PESO[b.severidad || 'Plomo'] - SEV_PESO[a.severidad || 'Plomo'];
        });

        if (comps.length === 0) {
          list.innerHTML = '<div class="label-muted" style="padding:14px;">Sin spots oficiales registrados.</div>';
        } else {
          var htmlSpots = comps.map(function(c) {
            return [
              '<div style="background:var(--input-bg); padding:12px 16px; border-radius:8px; border:1px solid var(--glass-border); ', (c.severidad === 'Rojo' ? 'border-left:4px solid #ef4444;' : ''), '">',
                '<div style="display:flex; justify-content:space-between; align-items:center;">',
                  '<strong style="font-size:0.95rem;">', sanitize(c.nombre || c.spot), '</strong>',
                  '<span style="color:', SEV_COLOR[c.severidad], '; font-weight:800; text-transform:uppercase;">', c.severidad, '</span>',
                '</div>',
                '<div style="font-size:0.8rem; color:var(--text-muted); margin-top:6px;">RMS: <strong>', (c.rms || 'N/D'), '</strong> | Orden de Trabajo: <strong>', (c.om || 'S/N'), '</strong></div>',
              '</div>'
            ].join('');
          }).join('');
          list.innerHTML = htmlSpots;
        }
      }

      window.CIO.renderBitacoraTerreno(eq);
      var modalDet = document.getElementById('modalDetalleActivo');
      if (modalDet) modalDet.showModal();
    },

    abrirDetallePorTag: function(tag) {
      var eq = state.equipos.find(function(e) { return matchTags(e.tag, tag); });
      if (eq) {
        window.CIO.abrirDetalle(eq.id);
      }
    },

    abrirFotoEnNuevaPestana: function(base64Data) {
      var win = window.open("");
      win.document.write('<body style="margin:0; background:#0a0a0c; display:flex; justify-content:center; align-items:center; height:100vh;"><img src="' + base64Data + '" style="max-width:98%; max-height:98%; object-fit:contain; border-radius:6px; box-shadow:0 0 30px rgba(0,0,0,0.8);" /></body>');
    },

    cerrarModalDetalle: function() {
      state.equipoIdModal = null;
      var modalDet = document.getElementById('modalDetalleActivo');
      if (modalDet) modalDet.close();
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
            alert('✅ Cuenta DEV registrada exitosamente.\nFaena ligada: ' + selectedSite);
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
              alert("❌ Contraseña incorrecta. Por favor verifica tus credenciales.");
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
        window.CIO.goScreen(3);
      } else if (p !== null) {
        alert("❌ Clave incorrecta.");
      }
    },

    renderScreen3Global: function() {
      renderScreen3();
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

    seleccionarPestanaAnalisis: function(tab) {
      var pnlHumano = document.getElementById('panelAnalisisHumano');
      var pnlIA = document.getElementById('panelAnalisisIA');
      var tabHumano = document.getElementById('tabAnalistaHumano');
      var tabIA = document.getElementById('tabAnalisisIA');

      if (tab === 'humano') {
        if (pnlHumano) pnlHumano.style.display = 'block';
        if (pnlIA) pnlIA.style.display = 'none';
        if (tabHumano) tabHumano.classList.add('is-active');
        if (tabIA) tabIA.classList.remove('is-active');
      } else {
        if (pnlHumano) pnlHumano.style.display = 'none';
        if (pnlIA) pnlIA.style.display = 'block';
        if (tabHumano) tabHumano.classList.remove('is-active');
        if (tabIA) tabIA.classList.add('is-active');
      }
    },

    ejecutarGeneracionIA: function() {
      var tagEl = document.getElementById('edTag');
      var tag = tagEl ? tagEl.value : 'Activo';
      var tipoEl = document.getElementById('edTipo');
      var clase = tipoEl ? tipoEl.value : 'Equipo Mecánico';
      var areaEl = document.getElementById('edArea');
      var area = areaEl ? areaEl.value : 'Planta';
      
      var spots = [];
      document.querySelectorAll('.comp-item').forEach(function(el) {
        var nomIn = el.querySelector('.c-nom');
        var rmsIn = el.querySelector('.c-rms');
        var sevIn = el.querySelector('.c-sev');
        spots.push({
          nom: nomIn ? nomIn.value : 'Punto',
          rms: rmsIn ? (parseFloat(rmsIn.value) || 0) : 0,
          sev: sevIn ? sevIn.value : 'Verde'
        });
      });

      var maxComp = spots.reduce(function(prev, curr) {
        return (SEV_PESO[curr.sev] > SEV_PESO[prev.sev]) ? curr : prev;
      }, { sev: 'Plomo', rms: 0, nom: '' });

      var sevMax = maxComp.sev;
      var diagnosticoGenerado = "";
      var recomendacionGenerada = "";

      if (sevMax === 'Rojo') {
        diagnosticoGenerado = '[IA Predictiva - Criticidad Alta en ' + tag + ']: Energía vibratoria crítica en ' + maxComp.nom + ' (RMS: ' + (maxComp.rms || 'Elevado') + '). Patrón armónico a 1X y 2X consistente con desalineación angular/paralela severa acoplada a holgura mecánica. Probabilidad de degradación en pistas (>85%).';
        recomendacionGenerada = '1) Realizar inspección termográfica en descansos y acople en las próximas 24h. 2) Programar detención para alineamiento láser de precisión. 3) Tomar muestra de aceite para ferrografía.';
      } else if (sevMax === 'Naranja') {
        diagnosticoGenerado = '[IA Predictiva - Condición de Alerta en ' + tag + ']: Se registra incremento de vibración global en ' + maxComp.nom + '. Sugiere inicio de desbalanceo dinámico o desgaste incipiente en elementos rodantes.';
        recomendacionGenerada = '1) Reducir frecuencia de inspección de ruta de 30 a 7 días. 2) Efectuar relubricación según carta de mantención. 3) Planificar chequeo estroboscópico de correas.';
      } else if (sevMax === 'Amarillo') {
        diagnosticoGenerado = '[IA Predictiva - Seguimiento]: Parámetros dentro de zona de advertencia según norma ISO 10816-3. Ligera modulación sin impacto en disponibilidad inmediata.';
        recomendacionGenerada = 'Mantener monitoreo regular en próxima ruta mensual. Comparar espectros en cascada (Waterfall).';
      } else {
        diagnosticoGenerado = '[IA Predictiva - Condición Normal]: Estado mecánico y dinámico del activo ' + tag + ' (' + clase + ' en ' + area + ') satisfactorio. Valores RMS dentro de norma.';
        recomendacionGenerada = 'Continuar con la frecuencia de medición rutinaria estándar cada 30 días.';
      }

      var anIA = document.getElementById('edAnalisisIA');
      var recIA = document.getElementById('edRecomendacionIA');
      if (anIA) anIA.value = diagnosticoGenerado;
      if (recIA) recIA.value = recomendacionGenerada;
      window.CIO.seleccionarPestanaAnalisis('ia');
    },

    adoptarDiagnosticoIA: function(tipo) {
      var anIA = document.getElementById('edAnalisisIA');
      var recIA = document.getElementById('edRecomendacionIA');
      var iaAnalisis = anIA ? anIA.value : '';
      var iaRecom = recIA ? recIA.value : '';

      if (!iaAnalisis && !iaRecom) {
        alert("Primero presiona 'Generar Diagnóstico IA'.");
        return;
      }

      if (tipo === 'analisis' || tipo === 'todo') {
        var hum = document.getElementById('edAnalisisHumano');
        if (hum) hum.value = iaAnalisis;
      }
      if (tipo === 'recomendacion' || tipo === 'todo') {
        var rec = document.getElementById('edRecomendacionHumano');
        if (rec) rec.value = iaRecom;
      }

      window.CIO.seleccionarPestanaAnalisis('humano');
      alert("✅ Diagnóstico de la IA transferido a tu panel de experto.");
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
        ? ('<span class="banner-contador-alerta vencido" style="font-size:0.7rem; padding:4px 8px;">⚠️ RUTA VENCIDA: Han transcurrido ' + aud.dias + ' días (> 30 días sin medir)</span>')
        : ('<span class="banner-contador-alerta al-dia" style="font-size:0.7rem; padding:4px 8px;">✅ Medición vigente: ' + aud.texto + ' (dentro de plazo)</span>');
    },

    abrirEdicionEquipoNuevoAuth: function() {
      var targetSite = state.faenaSeleccionada || state.faenaAsignada || FAENAS[0];
      state.equipoSeleccionado = {
        id: 'EQ_' + Date.now(),
        siteId: targetSite,
        domain: 'planta',
        area: state.areaSeleccionada || 'Área General',
        componentes: [],
        fechaMedicion: new Date().toISOString().split('T')[0],
        fechaHallazgo: new Date().toISOString().split('T')[0],
        estatusHallazgo: 'Abierto',
        avisoSap: '',
        omSap: '',
        analisis: '',
        recomendacion: '',
        analisisIA: '',
        recomendacionIA: ''
      };
      window.CIO.abrirEdicionModalObj();
    },

    abrirEdicionGlobalNuevo: function() {
      state.equipoSeleccionado = {
        id: 'EQ_' + Date.now(),
        siteId: FAENAS[0],
        domain: 'planta',
        componentes: [],
        fechaMedicion: new Date().toISOString().split('T')[0],
        fechaHallazgo: new Date().toISOString().split('T')[0],
        estatusHallazgo: 'Abierto',
        avisoSap: '',
        omSap: '',
        analisis: '',
        recomendacion: '',
        analisisIA: '',
        recomendacionIA: ''
      };
      window.CIO.abrirEdicionModalObj();
    },

    abrirEdicion: function(id) {
      state.equipoSeleccionado = state.equipos.find(function(e) { return e.id === id; });
      if (state.equipoSeleccionado) window.CIO.abrirEdicionModalObj();
    },

    abrirEdicionModalObj: function() {
      var eq = state.equipoSeleccionado;
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
      setVal('edAvisoSap', eq.avisoSap || '');
      setVal('edOmSap', eq.omSap || '');
      setVal('edFechaMedicion', eq.fechaMedicion || eq.fecha || '');
      setVal('edFechaHallazgo', eq.fechaHallazgo || '');

      setVal('edAnalisisHumano', eq.analisis || '');
      setVal('edRecomendacionHumano', eq.recomendacion || '');
      setVal('edAnalisisIA', eq.analisisIA || '');
      setVal('edRecomendacionIA', eq.recomendacionIA || '');

      window.CIO.seleccionarPestanaAnalisis('humano');
      window.CIO.auditarDiasMedicionForm();

      var cont = document.getElementById('edComponentesContainer');
      if (cont) {
        cont.innerHTML = '';
        (eq.componentes || []).forEach(function(c) {
          window.CIO.agregarFormComponente(c);
        });
      }
      var modalEd = document.getElementById('modalEdicion');
      if (modalEd) modalEd.showModal();
    },

    agregarFormComponente: function(data) {
      data = data || {};
      var cont = document.getElementById('edComponentesContainer');
      if (!cont) return;
      var div = document.createElement('div');
      div.style.cssText = "background:var(--input-bg); padding:10px; border:1px solid var(--border-card); border-radius:6px; position:relative;";
      div.className = 'comp-item';
      div.innerHTML = [
        '<button type="button" class="btn-base btn-danger" style="position:absolute; top:8px; right:8px; padding:2px 6px; font-size:0.6rem;" onclick="this.parentElement.remove()">Eliminar</button>',
        '<div class="form-grid">',
          '<div><label>Spot</label><input type="text" class="c-nom" value="', (data.nombre || ''), '"></div>',
          '<div><label>RMS</label><input type="text" class="c-rms" value="', (data.rms || ''), '"></div>',
          '<div class="span-2"><label>Severidad</label><select class="c-sev">',
            '<option value="Rojo"', (data.severidad === 'Rojo' ? ' selected' : ''), '>Rojo</option>',
            '<option value="Naranja"', (data.severidad === 'Naranja' ? ' selected' : ''), '>Naranja</option>',
            '<option value="Amarillo"', (data.severidad === 'Amarillo' ? ' selected' : ''), '>Amarillo</option>',
            '<option value="Verde"', (data.severidad === 'Verde' ? ' selected' : ''), '>Verde</option>',
          '</select></div>',
        '</div>'
      ].join('');
      cont.appendChild(div);
    },

    guardarEquipo: function() {
      if (!state.equipoSeleccionado) return;
      var comps = [];
      document.querySelectorAll('.comp-item').forEach(function(el) {
        var nomIn = el.querySelector('.c-nom');
        var rmsIn = el.querySelector('.c-rms');
        var sevIn = el.querySelector('.c-sev');
        comps.push({
          nombre: nomIn ? nomIn.value : '',
          rms: rmsIn ? rmsIn.value : '',
          severidad: sevIn ? sevIn.value : 'Verde'
        });
      });

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
        estatusHallazgo: getVal('edEstatusHallazgo'),
        avisoSap: getVal('edAvisoSap'),
        omSap: getVal('edOmSap'),
        analisis: getVal('edAnalisisHumano'),
        recomendacion: getVal('edRecomendacionHumano'),
        analisisIA: getVal('edAnalisisIA'),
        recomendacionIA: getVal('edRecomendacionIA'),
        componentes: comps
      };

      if (db) db.child(state.equipoSeleccionado.id).update(payload);
      var modalEd = document.getElementById('modalEdicion');
      if (modalEd) modalEd.close();
    },

    eliminarEquipo: function() {
      if (confirm('¿Eliminar activo en DEV?') && db && state.equipoSeleccionado) {
        db.child(state.equipoSeleccionado.id).remove();
        var modalEd = document.getElementById('modalEdicion');
        if (modalEd) modalEd.close();
      }
    },

    editarActivoActualDesdeDetalle: function() {
      if (!state.equipoIdModal) return;
      var idToEdit = state.equipoIdModal;
      window.CIO.cerrarModalDetalle();
      window.CIO.abrirEdicion(idToEdit);
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
                avisoSap: '',
                omSap: '',
                analisis: '',
                recomendacion: '',
                analisisIA: '',
                recomendacionIA: '',
                componentes: [{ nombre: 'Spot Principal', severidad: 'Verde', rms: '2.0', om: '' }]
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
