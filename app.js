(() => {
  'use strict';

  // Configuración de Firebase DEV
  const firebaseConfig = {
    apiKey: "AIzaSyBd5MEZdMmgzBs1xCyeGYeKtQx5gJIeY3w",
    authDomain: "dashboard-vulnerabilidades-mlc.firebaseapp.com",
    databaseURL: "https://dashboard-vulnerabilidades-mlc-default-rtdb.firebaseio.com",
    projectId: "dashboard-vulnerabilidades-mlc"
  };

  let db = null;
  let dbUsers = null;
  let dbAlertasTerreno = null;

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

  const FAENAS = Object.freeze([
    'Planta, Mina los Colorados',
    'Mina, Mina los Colorados',
    'Planta de Pellets',
    'Planta, Mina el Romeral',
    'Mina, Mina el Romeral'
  ]);

  const SEV_PESO = Object.freeze({ Rojo: 5, Naranja: 4, Amarillo: 3, Verde: 2, Plomo: 1 });
  const SEV_COLOR = Object.freeze({ Rojo: '#ef4444', Naranja: '#f97316', Amarillo: '#eab308', Verde: '#22c55e', Plomo: '#6b7280' });

  const state = {
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

  function sanitize(str) {
    return (str || '').replace(/[<>&"']/g, (m) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[m]));
  }

  function normalizarFaena(f) {
    return FAENAS.includes(f) ? f : FAENAS[0];
  }

  function matchTags(t1, t2) {
    if (!t1 || !t2) return false;
    const clean = (s) => String(s).trim().toUpperCase().replace(/[\s\-_]/g, '');
    return clean(t1) === clean(t2);
  }

  function calcularDiasDesdeMedicion(fechaStr) {
    if (!fechaStr) return { dias: null, vencido: true, texto: 'Sin fecha registrada' };
    const partes = String(fechaStr).split('-');
    if (partes.length !== 3) return { dias: null, vencido: true, texto: 'Fecha no válida' };
    
    const fechaMed = new Date(parseInt(partes[0], 10), parseInt(partes[1], 10) - 1, parseInt(partes[2], 10));
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    fechaMed.setHours(0, 0, 0, 0);

    const diffMs = hoy.getTime() - fechaMed.getTime();
    const dias = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const vencido = dias > 30;

    return {
      dias: dias,
      vencido: vencido,
      texto: dias >= 0 ? `Hace ${dias} día(s)` : `En ${Math.abs(dias)} día(s)`
    };
  }

  function calcMaxSev(comps) {
    if (!comps || !comps.length) return 'Plomo';
    let max = 1;
    let maxSev = 'Plomo';
    comps.forEach((c) => {
      if (c && SEV_PESO[c.severidad] > max) {
        max = SEV_PESO[c.severidad];
        maxSev = c.severidad;
      }
    });
    return maxSev;
  }

  // Objeto Global CIO registrado de inmediato para evitar errores de undefined
  window.CIO = {
    goScreen: (num) => {
      state.currentScreen = num;
      document.querySelectorAll('.screen-view').forEach((el) => el.classList.remove('active'));
      const sc = document.getElementById(`screen-${num}`);
      if (sc) sc.classList.add('active');
      const titles = { 1: 'Vista Pública (Global - DEV)', 2: `Faena: ${state.faenaSeleccionada || 'Operativa (DEV)'}`, 3: 'Consola SuperAdmin (DEV)' };
      const headerTitle = document.getElementById('headerScreenTitle');
      if (headerTitle) headerTitle.innerText = titles[num] || 'CIO';
      if (num !== 2) state.siteMapVisible = false;
      refresh();
    },

    seleccionarFaena: (f) => {
      state.faenaSeleccionada = f;
      state.areaSeleccionada = null;
      state.siteMapVisible = false;
      const b = document.getElementById('badgeFaenaAsignada');
      if (b) b.innerText = f;
      window.CIO.goScreen(2);
    },

    seleccionarArea: (a) => {
      state.areaSeleccionada = a;
      renderScreen2();
    },

    volverAreas: () => {
      state.areaSeleccionada = null;
      renderScreen2();
    },

    stepBackScreen2: () => {
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

    toggleSiteMapTab: () => {
      state.siteMapVisible = !state.siteMapVisible;
      const mapBox = document.getElementById('view-site-map');
      const container = document.getElementById('viewScreen2Container');
      const lbl = document.getElementById('labelToggleSiteMap');
      const target = state.faenaSeleccionada || FAENAS[0];

      if (state.siteMapVisible) {
        if (mapBox) mapBox.style.display = 'block';
        if (container) container.style.display = 'none';
        if (lbl) lbl.innerText = 'Ver Tarjetas';
        setTimeout(() => actualizarMapaSite(state.equipos.filter((e) => normalizarFaena(e.siteId) === target)), 150);
      } else {
        if (mapBox) mapBox.style.display = 'none';
        if (container) container.style.display = '';
        if (lbl) lbl.innerText = 'Ver Mapa de Faena';
      }
    },

    toggleTheme: () => {
      document.body.classList.toggle('light-mode');
    },

    handleUserBtnClick: () => {
      if (!state.usuarioActivo) {
        window.CIO.setAuthMode('login');
        const m = document.getElementById('modalAuth');
        if (m) m.showModal();
      } else {
        const uMenu = document.getElementById('userDropdownMenu');
        if (uMenu) uMenu.classList.toggle('is-active');
      }
    },

    setAuthMode: (mode) => {
      state.authMode = mode;
      const isReg = (mode === 'register');
      
      const boxName = document.getElementById('boxFullName');
      const boxSite = document.getElementById('boxFaenaSite');
      const tabLogin = document.getElementById('tabBtnLogin');
      const tabRegister = document.getElementById('tabBtnRegister');
      const title = document.getElementById('authModalHeaderTitle');
      const desc = document.getElementById('authModalHeaderDesc');
      const btn = document.getElementById('authSubmitActionBtn');

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

    handleAuthSubmission: () => {
      const uEl = document.getElementById('authUsername');
      const pEl = document.getElementById('authPassword');
      const fnEl = document.getElementById('authFullname');
      const stEl = document.getElementById('authSelectedSite');

      const u = uEl ? uEl.value.trim() : '';
      const p = pEl ? pEl.value.trim() : '';
      const fullname = fnEl ? fnEl.value.trim() : '';
      const selectedSite = stEl ? stEl.value : 'Planta, Mina los Colorados';

      if (!u || !p) {
        alert("⚠️ Completa usuario y contraseña.");
        return;
      }

      const lookupId = u.replace(/[^a-zA-Z0-9]/g, '_');

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
          }).then(() => {
            alert(`✅ Cuenta DEV registrada: ${selectedSite}`);
            loginLocal(fullname, selectedSite);
          }).catch(err => alert("Error: " + err.message));
        } else {
          loginLocal(fullname, selectedSite);
        }
      } else {
        if (dbUsers) {
          dbUsers.child(lookupId).once('value', (snap) => {
            const uData = snap.val();
            if (uData && uData.password === p) {
              const nombreFinal = uData.nombreCompleto || uData.usuario || u.split('@')[0];
              const faenaLigada = uData.faenaAsignada || 'Planta, Mina los Colorados';
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
        const lbl = document.getElementById('labelUsuarioBtn');
        if (lbl) lbl.innerText = nombre.split(' ')[0];
        const dropInfo = document.getElementById('dropUserInfo');
        if (dropInfo) dropInfo.innerText = `Activo (DEV): ${nombre} | Faena: ${faena}`;
        const modal = document.getElementById('modalAuth');
        if (modal) modal.close();
        alert(`✅ Bienvenido ${nombre} al Entorno DEV.`);
      }
    },

    cerrarSesionUsuario: () => {
      state.usuarioActivo = null;
      state.faenaAsignada = null;
      document.body.classList.remove('user-authenticated');
      const lbl = document.getElementById('labelUsuarioBtn');
      if (lbl) lbl.innerText = 'Entrar';
      const dropInfo = document.getElementById('dropUserInfo');
      if (dropInfo) dropInfo.innerText = 'Invitado (Solo Lectura)';
      const uMenu = document.getElementById('userDropdownMenu');
      if (uMenu) uMenu.classList.remove('is-active');
      window.CIO.goScreen(1);
    },

    solicitarPermisoSuperAdmin: () => {
      const p = prompt("🔑 Clave SuperAdmin (DEV):");
      if (p === "Moncon2026") {
        state.isSuperAdmin = true;
        window.CIO.goScreen(3);
      } else if (p !== null) {
        alert("❌ Clave incorrecta.");
      }
    },

    renderScreen3Global: () => {
      renderScreen3();
    },

    exportarReporteGerenciaAlta: () => {
      const txt = `REPORTE ALTA GERENCIA CIO - CMP [DEV]\nTotal: ${state.equipos.length}\nFecha: ${new Date().toISOString()}`;
      const blob = new Blob([txt], { type: 'text/plain' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `Reporte_DEV_${Date.now()}.txt`;
      a.click();
    },

    exportarReporteGerenciaPorFaena: () => {
      const filterEl = document.getElementById('superAdminFilterSite');
      const target = filterEl ? filterEl.value : FAENAS[0];
      const count = state.equipos.filter((e) => normalizarFaena(e.siteId) === target).length;
      const txt = `REPORTE FAENA [${target}] [DEV]\nTotal Activos: ${count}\nFecha: ${new Date().toISOString()}`;
      const blob = new Blob([txt], { type: 'text/plain' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `Reporte_${target.replace(/[^a-zA-Z0-9]/g, '_')}_DEV.txt`;
      a.click();
    },

    seleccionarPestanaAnalisis: (tab) => {
      const pnlHumano = document.getElementById('panelAnalisisHumano');
      const pnlIA = document.getElementById('panelAnalisisIA');
      const tabHumano = document.getElementById('tabAnalistaHumano');
      const tabIA = document.getElementById('tabAnalisisIA');

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

    ejecutarGeneracionIA: () => {
      const tagEl = document.getElementById('edTag');
      const tag = tagEl ? tagEl.value : 'Activo';
      const spots = [];
      document.querySelectorAll('.comp-item').forEach((el) => {
        const nomIn = el.querySelector('.c-nom');
        const rmsIn = el.querySelector('.c-rms');
        const sevIn = el.querySelector('.c-sev');
        spots.push({
          nom: nomIn ? nomIn.value : 'Punto',
          rms: rmsIn ? (parseFloat(rmsIn.value) || 0) : 0,
          sev: sevIn ? sevIn.value : 'Verde'
        });
      });

      const maxComp = spots.reduce((prev, curr) => (SEV_PESO[curr.sev] > SEV_PESO[prev.sev] ? curr : prev), { sev: 'Plomo', rms: 0, nom: '' });
      const sevMax = maxComp.sev;

      let diagnosticoGenerado = "";
      let recomendacionGenerada = "";

      if (sevMax === 'Rojo') {
        diagnosticoGenerado = `[IA Predictiva - Criticidad Alta en ${tag}]: Energía vibratoria crítica en ${maxComp.nom} (RMS: ${maxComp.rms || 'Elevado'}). Patrón armónico a 1X y 2X consistente con desalineación severa y holgura mecánica.`;
        recomendacionGenerada = "1) Inspección termográfica en descansos. 2) Alineamiento láser de precisión. 3) Muestra de lubricante para ferrografía.";
      } else if (sevMax === 'Naranja') {
        diagnosticoGenerado = `[IA Predictiva - Alerta en ${tag}]: Incremento vibratorio en ${maxComp.nom}. Sugiere desbalanceo dinámico o fatiga en elementos rodantes.`;
        recomendacionGenerada = "1) Frecuencia de inspección cada 7 días. 2) Relubricación según carta de mantención.";
      } else {
        diagnosticoGenerado = `[IA Predictiva - Normal]: Parámetros dinámicos en ${tag} admisibles según norma ISO.`;
        recomendacionGenerada = "Mantener monitoreo mensual estándar.";
      }

      const anIA = document.getElementById('edAnalisisIA');
      const recIA = document.getElementById('edRecomendacionIA');
      if (anIA) anIA.value = diagnosticoGenerado;
      if (recIA) recIA.value = recomendacionGenerada;
      window.CIO.seleccionarPestanaAnalisis('ia');
    },

    adoptarDiagnosticoIA: (tipo) => {
      const anIA = document.getElementById('edAnalisisIA');
      const recIA = document.getElementById('edRecomendacionIA');
      const iaAnalisis = anIA ? anIA.value : '';
      const iaRecom = recIA ? recIA.value : '';

      if (!iaAnalisis && !iaRecom) {
        alert("Primero presiona 'Generar Diagnóstico IA'.");
        return;
      }

      if (tipo === 'analisis' || tipo === 'todo') {
        const hum = document.getElementById('edAnalisisHumano');
        if (hum) hum.value = iaAnalisis;
      }
      if (tipo === 'recomendacion' || tipo === 'todo') {
        const rec = document.getElementById('edRecomendacionHumano');
        if (rec) rec.value = iaRecom;
      }

      window.CIO.seleccionarPestanaAnalisis('humano');
      alert("✅ Diagnóstico de la IA adoptado.");
    },

    auditarDiasMedicionForm: () => {
      const medEl = document.getElementById('edFechaMedicion');
      const val = medEl ? medEl.value : '';
      const box = document.getElementById('edFeedbackContadorDias');
      if (!box) return;

      const aud = calcularDiasDesdeMedicion(val);
      if (!val) {
        box.innerHTML = '';
        return;
      }

      box.innerHTML = aud.vencido
        ? `<span class="banner-contador-alerta vencido" style="font-size:0.7rem; padding:4px 8px;">⚠️ RUTA VENCIDA: ${aud.dias} días sin medir</span>`
        : `<span class="banner-contador-alerta al-dia" style="font-size:0.7rem; padding:4px 8px;">✅ Medición vigente: ${aud.texto}</span>`;
    },

    abrirEdicionEquipoNuevoAuth: () => {
      const targetSite = state.faenaSeleccionada || state.faenaAsignada || FAENAS[0];
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

    abrirEdicionGlobalNuevo: () => {
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

    abrirEdicion: (id) => {
      state.equipoSeleccionado = state.equipos.find((e) => e.id === id);
      if (state.equipoSeleccionado) window.CIO.abrirEdicionModalObj();
    },

    abrirEdicionModalObj: () => {
      const eq = state.equipoSeleccionado;
      const setVal = (id, val) => {
        const el = document.getElementById(id);
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

      const cont = document.getElementById('edComponentesContainer');
      if (cont) {
        cont.innerHTML = '';
        (eq.componentes || []).forEach((c) => window.CIO.agregarFormComponente(c));
      }
      const modalEd = document.getElementById('modalEdicion');
      if (modalEd) modalEd.showModal();
    },

    agregarFormComponente: (data = {}) => {
      const cont = document.getElementById('edComponentesContainer');
      if (!cont) return;
      const div = document.createElement('div');
      div.style.cssText = "background:var(--input-bg); padding:10px; border:1px solid var(--border-card); border-radius:6px; position:relative;";
      div.className = 'comp-item';
      
      div.innerHTML = `
        <button type="button" class="btn-base btn-danger" style="position:absolute; top:8px; right:8px; padding:2px 6px; font-size:0.6rem;" onclick="this.parentElement.remove()">Eliminar</button>
        <div class="form-grid">
          <div><label>Spot</label><input type="text" class="c-nom" value="${sanitize(data.nombre || '')}"></div>
          <div><label>RMS</label><input type="text" class="c-rms" value="${sanitize(data.rms || '')}"></div>
          <div class="span-2"><label>Severidad</label><select class="c-sev">
            <option value="Rojo" ${data.severidad === 'Rojo' ? 'selected' : ''}>Rojo</option>
            <option value="Naranja" ${data.severidad === 'Naranja' ? 'selected' : ''}>Naranja</option>
            <option value="Amarillo" ${data.severidad === 'Amarillo' ? 'selected' : ''}>Amarillo</option>
            <option value="Verde" ${data.severidad === 'Verde' ? 'selected' : ''}>Verde</option>
          </select></div>
        </div>
      `;
      cont.appendChild(div);
    },

    guardarEquipo: () => {
      if (!state.equipoSeleccionado) return;
      const comps = [];
      document.querySelectorAll('.comp-item').forEach((el) => {
        const nomIn = el.querySelector('.c-nom');
        const rmsIn = el.querySelector('.c-rms');
        const sevIn = el.querySelector('.c-sev');
        comps.push({
          nombre: nomIn ? nomIn.value : '',
          rms: rmsIn ? rmsIn.value : '',
          severidad: sevIn ? sevIn.value : 'Verde'
        });
      });

      const getVal = (id) => { const el = document.getElementById(id); return el ? el.value : ''; };

      const payload = {
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
      const modalEd = document.getElementById('modalEdicion');
      if (modalEd) modalEd.close();
    },

    eliminarEquipo: () => {
      if (confirm('¿Eliminar activo en DEV?') && db && state.equipoSeleccionado) {
        db.child(state.equipoSeleccionado.id).remove();
        const modalEd = document.getElementById('modalEdicion');
        if (modalEd) modalEd.close();
      }
    },

    editarActivoActualDesdeDetalle: () => {
      if (!state.equipoIdModal) return;
      const idToEdit = state.equipoIdModal;
      window.CIO.cerrarModalDetalle();
      window.CIO.abrirEdicion(idToEdit);
    },

    procesarCargaExcelFaena: (e) => {
      const file = e.target.files[0];
      if (!file || !db) return;

      const targetSite = state.faenaSeleccionada || state.faenaAsignada || FAENAS[0];
      const reader = new FileReader();

      reader.onload = (evt) => {
        try {
          const data = new Uint8Array(evt.target.result);
          const wb = XLSX.read(data, { type: 'array', cellDates: true });
          const firstSheetName = wb.SheetNames[0];
          const worksheet = wb.Sheets[firstSheetName];
          const rawRows = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

          if (!rawRows || rawRows.length === 0) {
            alert("⚠️ La planilla seleccionada está vacía.");
            return;
          }

          let cargados = 0;
          const actualizaciones = {};

          rawRows.forEach((row) => {
            const normalizedRow = {};
            Object.keys(row).forEach((k) => {
              normalizedRow[k.trim().toUpperCase()] = row[k];
            });

            const rawTag = normalizedRow['EQUIPO'] || normalizedRow['TAG'] || normalizedRow['ACTIVO'] || normalizedRow['NOMBRE'];
            const rawArea = normalizedRow['AREA'] || normalizedRow['ÁREA'] || 'Área General';
            const rawTipo = normalizedRow['TIPO EQUIPO'] || normalizedRow['TIPO'] || normalizedRow['CLASE'] || 'Activo';
            const rawFecha = normalizedRow['ULTIMA FECHA'] || normalizedRow['FECHA MEDICION'] || normalizedRow['FECHA'];

            if (rawTag && String(rawTag).trim() !== '') {
              const tagStr = String(rawTag).trim();
              const areaStr = String(rawArea).trim() || 'General';
              const tipoStr = String(rawTipo).trim() || 'Activo';

              let fechaMedicionFinal = '';
              if (rawFecha instanceof Date && !isNaN(rawFecha.getTime())) {
                fechaMedicionFinal = rawFecha.toISOString().split('T')[0];
              } else if (typeof rawFecha === 'string' && rawFecha.trim() !== '') {
                const dateParsed = new Date(rawFecha);
                if (!isNaN(dateParsed.getTime())) {
                  fechaMedicionFinal = dateParsed.toISOString().split('T')[0];
                }
              }

              const safeTagId = tagStr.replace(/[\/\.\#\$\[\]]/g, '_');
              const recordId = 'EQ_' + safeTagId;

              actualizaciones[recordId] = {
                siteId: targetSite,
                domain: areaStr.toUpperCase().includes('MINA') ? 'mina' : 'planta',
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
            .then(() => {
              alert(`✅ Carga masiva exitosa: ${cargados} equipos importados en ${targetSite}.`);
            })
            .catch((err) => {
              alert(`❌ Error al guardar en Firebase: ${err.message}`);
            });

        } catch (err) {
          console.error("Error al procesar Excel:", err);
          alert(`❌ Error al leer el archivo Excel: ${err.message}`);
        }
      };

      reader.readAsArrayBuffer(file);
      e.target.value = '';
    }
  };

  // Renderizado Seguro de Pantalla 1 usando nodos DOM sin concatenaciones de riesgo
  function renderScreen1() {
    const container = document.getElementById('viewScreen1Content');
    if (!container) return;

    const stats = {};
    FAENAS.forEach((f) => { stats[f] = { count: 0, critical: 0, maxSev: 'Plomo', maxPeso: 1 }; });

    state.equipos.forEach((eq) => {
      const f = normalizarFaena(eq.siteId);
      stats[f].count++;
      const s = calcMaxSev(eq.componentes);
      if (s === 'Rojo' || s === 'Naranja') stats[f].critical++;
      if (SEV_PESO[s] > stats[f].maxPeso) {
        stats[f].maxPeso = SEV_PESO[s];
        stats[f].maxSev = s;
      }
    });

    const sortedFaenas = FAENAS.map((f) => ({ name: f, ...stats[f] }))
      .sort((a, b) => b.maxPeso - a.maxPeso || b.critical - a.critical);

    container.innerHTML = '';
    sortedFaenas.forEach((d) => {
      const card = document.createElement('article');
      card.className = `card-area ${d.maxSev === 'Rojo' || d.maxSev === 'Naranja' ? 'anim-' + d.maxSev.toLowerCase() : ''}`;
      card.onclick = () => window.CIO.seleccionarFaena(d.name);

      card.innerHTML = `
        <header>
          <span class="label-muted">Faena Operativa CMP</span>
          <h3 class="value-strong" style="margin:4px 0 8px 0;">${sanitize(d.name)}</h3>
        </header>
        <div style="display:flex; justify-content:space-between; border-top:1px solid var(--border-card); padding-top:8px;">
          <div><span class="label-muted">Activos</span><div class="value-strong">${d.count}</div></div>
          <div><span class="label-muted">Condición</span><div class="value-strong" style="color:${SEV_COLOR[d.maxSev]}">${d.critical > 0 ? d.critical + ' Alertas' : 'Normal'}</div></div>
        </div>
      `;
      container.appendChild(card);
    });
  }

  // Renderizado Seguro de Pantalla 2
  function renderScreen2() {
    const target = state.faenaSeleccionada || state.faenaAsignada || FAENAS[0];
    const titleEl = document.getElementById('screen2SiteTitle');
    if (titleEl) titleEl.innerText = target;

    const container = document.getElementById('viewScreen2Container');
    if (!container) return;
    container.style.display = state.siteMapVisible ? 'none' : '';

    const eqsFaena = state.equipos.filter((e) => normalizarFaena(e.siteId) === target);

    if (!state.areaSeleccionada) {
      const areas = {};
      eqsFaena.forEach((eq) => {
        const a = eq.area || 'Sin Área';
        if (!areas[a]) areas[a] = { count: 0, critical: 0, maxSev: 'Plomo', maxPeso: 1 };
        areas[a].count++;
        const s = calcMaxSev(eq.componentes);
        if (s === 'Rojo' || s === 'Naranja') areas[a].critical++;
        if (SEV_PESO[s] > areas[a].maxPeso) {
          areas[a].maxPeso = SEV_PESO[s];
          areas[a].maxSev = s;
        }
      });

      const sortedAreas = Object.keys(areas).map((a) => ({ name: a, ...areas[a] }))
        .sort((a, b) => b.maxPeso - a.maxPeso || b.critical - a.critical);

      container.className = 'grid-container';
      container.innerHTML = '';

      if (sortedAreas.length === 0) {
        container.innerHTML = '<div class="label-muted" style="padding:20px;">Sin áreas registradas. Realiza una Carga Masiva.</div>';
        return;
      }

      sortedAreas.forEach((a) => {
        const card = document.createElement('article');
        card.className = `card-area ${a.maxSev === 'Rojo' || a.maxSev === 'Naranja' ? 'anim-' + a.maxSev.toLowerCase() : ''}`;
        card.onclick = () => window.CIO.seleccionarArea(a.name);

        card.innerHTML = `
          <span class="label-muted">Área Operacional</span>
          <h3 class="value-strong" style="margin:4px 0 8px 0;">${sanitize(a.name)}</h3>
          <div style="display:flex; justify-content:space-between; border-top:1px solid var(--border-card); padding-top:8px;">
            <div><span class="label-muted">Activos</span><div class="value-strong">${a.count}</div></div>
            <div><span class="label-muted">Condición</span><div class="value-strong" style="color:${SEV_COLOR[a.maxSev]}">${a.critical > 0 ? a.critical + ' Alertas' : 'Normal'}</div></div>
          </div>
        `;
        container.appendChild(card);
      });
    } else {
      container.className = 'grid-equipos';
      container.innerHTML = '';

      const eqsArea = eqsFaena.filter((e) => (e.area || 'Sin Área') === state.areaSeleccionada);
      eqsArea.sort((a, b) => SEV_PESO[calcMaxSev(b.componentes)] - SEV_PESO[calcMaxSev(a.componentes)]);

      const navHeader = document.createElement('div');
      navHeader.style.cssText = "grid-column: 1/-1; display:flex; align-items:center; gap:10px; margin-bottom:4px; background:var(--glass-card); backdrop-filter:blur(8px); padding:8px 12px; border-radius:8px; border:1px solid var(--glass-border);";
      navHeader.innerHTML = `
        <button class="btn-base" type="button" onclick="window.CIO.volverAreas()">⬅️ Volver a Áreas</button>
        <span style="font-weight:700; color:var(--accent-color); font-size:0.85rem;">Área: ${sanitize(state.areaSeleccionada)}</span>
      `;
      container.appendChild(navHeader);

      eqsArea.forEach((eq) => {
        const s = calcMaxSev(eq.componentes);
        const tagValue = eq.tag || eq.Tag || eq.TAG || eq.equipo || eq.id || 'S/T';
        const fieldCount = state.alertasTerreno.filter((a) => matchTags(a.tag, tagValue)).length;
        const aud = calcularDiasDesdeMedicion(eq.fechaMedicion);

        const card = document.createElement('article');
        card.className = `card-equipo sev-${s.toLowerCase()} ${s === 'Rojo' || s === 'Naranja' ? 'anim-' + s.toLowerCase() : ''}`;
        card.onclick = () => window.CIO.abrirDetalle(eq.id);

        card.innerHTML = `
          ${fieldCount > 0 ? `<span class="badge-field-floating">💬 Terreno (${fieldCount})</span>` : ''}
          ${aud.vencido ? `<span class="badge-vencido-floating" title="Medición vencida: ${aud.texto}">⏱️ >30d</span>` : ''}
          <span class="eq-type">${sanitize(eq.tipo || eq.area)}</span>
          <div class="eq-tag code-font">${sanitize(tagValue)}</div>
          <span class="eq-type" style="color:${SEV_COLOR[s]}">${s.toUpperCase()}</span>
        `;
        container.appendChild(card);
      });
    }
  }

  // Renderizado Seguro de Pantalla 3
  function renderScreen3() {
    const filterEl = document.getElementById('superAdminFilterSite');
    const filter = filterEl ? filterEl.value : 'TODAS';
    const eqs = filter === 'TODAS' ? state.equipos : state.equipos.filter((e) => normalizarFaena(e.siteId) === filter);
    eqs.sort((a, b) => SEV_PESO[calcMaxSev(b.componentes)] - SEV_PESO[calcMaxSev(a.componentes)]);

    const container = document.getElementById('viewScreen3Global');
    if (!container) return;

    container.innerHTML = '';
    eqs.forEach((eq) => {
      const s = calcMaxSev(eq.componentes);
      const tagValue = eq.tag || eq.Tag || eq.TAG || eq.id || 'S/T';

      const card = document.createElement('article');
      card.className = `card-equipo sev-${s.toLowerCase()} ${s === 'Rojo' || s === 'Naranja' ? 'anim-' + s.toLowerCase() : ''}`;
      card.innerHTML = `
        <span class="label-muted">${sanitize(eq.siteId)}</span>
        <div class="eq-tag code-font">${sanitize(tagValue)}</div>
        <div style="margin-top:6px;">
          <button class="btn-base btn-primary" type="button" style="padding:2px 8px; font-size:0.65rem;" onclick="window.CIO.abrirEdicion('${eq.id}')">✏️ Editar</button>
        </div>
      `;
      container.appendChild(card);
    });
  }

  function actualizarMapaSite(eqs) {
    if (typeof L === 'undefined') return;
    const mapBox = document.getElementById('view-site-map');
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
      const bounds = [];

      eqs.forEach((eq) => {
        const lat = parseFloat(eq.lat);
        const lng = parseFloat(eq.lng);
        if (!isNaN(lat) && !isNaN(lng) && lat !== 0) {
          const s = calcMaxSev(eq.componentes);
          const col = SEV_COLOR[s] || '#6b7280';
          const pulse = s === 'Rojo' ? 'map-pin-pulse' : '';
          const tagValue = eq.tag || eq.Tag || eq.id || 'S/T';
          const icon = L.divIcon({
            className: 'custom-pin',
            html: `<div class="${pulse}" style="background:${col}; width:20px; height:20px; border-radius:50%; border:2px solid #fff; box-shadow:0 0 10px ${col};"></div>`,
            iconSize: [20, 20],
            iconAnchor: [10, 10]
          });
          L.marker([lat, lng], { icon }).bindPopup(`<strong>${sanitize(tagValue)}</strong><br>${sanitize(eq.area)}<br><span style="color:${col};font-weight:bold;">${s}</span>`).addTo(state.capaSite);
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
    db.on('value', (snap) => {
      const raw = snap.val();
      if (raw && Object.keys(raw).length > 0) {
        state.equipos = Object.keys(raw).map((k) => {
          const item = raw[k] || {};
          const detectedTag = item.tag || item.Tag || item.TAG || item.equipo || item.Equipo || item.nombre || k;
          const detectedArea = item.area || item.Area || item.AREA || 'Sin Área';
          const detectedSite = item.siteId || item.site || item.faena || item.Faena || 'Planta, Mina los Colorados';

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
      dbAlertasTerreno.on('value', (snap) => {
        const raw = snap.val();
        state.alertasTerreno = raw ? Object.keys(raw).map((k) => ({ id: k, ...(raw[k] || {}) })) : [];
        refresh();

        if (state.equipoIdModal) {
          const currentEq = state.equipos.find((e) => e.id === state.equipoIdModal);
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

  // Inicialización limpia
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', refresh);
  } else {
    refresh();
  }
})();
