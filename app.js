/**
 * Dashboard-MLC-Dev - app.js
 * Centro Integrado de Operaciones (CIO) - Predictivo & Confiabilidad MLC (CMP)
 */

// ==========================================
// 1. CONFIGURACIÓN Y CONSTANTES GLOBALES
// ==========================================
const CONFIG = {
    GOOGLE_SHEETS_WEBHOOK_URL: "https://script.google.com/macros/s/AKfycbx_TU_WEBHOOK_DEV/exec",
    GEMINI_API_KEY: "TU_API_KEY_GEMINI",
    DEFAULT_FAENA: "Mina Los Colorados",
    COLECCIONES: {
        ACTIVOS: "activos_criticos_dev",
        ALERTAS: "alertas_terreno_dev"
    }
};

// Estado Global en Memoria
window.activosCache = {};
window.alertasCache = {};
let currentTag = null;
let currentNivel = 1;
let historialNavegacion = [];

// ==========================================
// 2. INICIALIZACIÓN DE LA APLICACIÓN
// ==========================================
document.addEventListener("DOMContentLoaded", () => {
    initFirebaseListeners();
    initUIEventListeners();
});

function initUIEventListeners() {
    // Botón abrir/cerrar modal bitácora
    const btnAbrirBitacora = document.getElementById("btn-abrir-bitacora");
    const btnCerrarBitacora = document.getElementById("btn-cerrar-bitacora");
    const modalBitacora = document.getElementById("modal-bitacora-alertas");

    if (btnAbrirBitacora && modalBitacora) {
        btnAbrirBitacora.addEventListener("click", () => {
            modalBitacora.classList.remove("hidden");
            modalBitacora.style.display = "flex";
        });
    }

    if (btnCerrarBitacora && modalBitacora) {
        btnCerrarBitacora.addEventListener("click", () => {
            modalBitacora.classList.add("hidden");
            modalBitacora.style.display = "none";
        });
    }

    // Botón Volver desde Nivel 4
    const btnVolverN4 = document.getElementById("btn-volver-n4");
    if (btnVolverN4) {
        btnVolverN4.addEventListener("click", volverDesdeNivel4);
    }
}

// ==========================================
// 3. LISTENERS REACTIVOS DE FIREBASE
// ==========================================
function initFirebaseListeners() {
    if (typeof firebase === "undefined" || !firebase.database) {
        console.error("Firebase SDK no cargado en index.html");
        return;
    }

    const db = firebase.database();

    // Listener de Activos Críticos
    db.ref(CONFIG.COLECCIONES.ACTIVOS).on("value", (snapshot) => {
        const data = snapshot.val() || {};
        window.activosCache = data;
        actualizarVistasDashboard(data);
    });

    // Listener de Alertas en Terreno (En vivo)
    db.ref(CONFIG.COLECCIONES.ALERTAS).on("child_added", (snapshot) => {
        const alertaId = snapshot.key;
        const alerta = snapshot.val();
        if (!alerta) return;

        window.alertasCache[alertaId] = alerta;

        // Inyectar en modal de bitácora
        renderTarjetaBitacora(alertaId, alerta);

        // Notificar en toast flotante solo si la alerta es reciente (< 5 minutos)
        const ahora = Date.now();
        if (alerta.timestamp && (ahora - alerta.timestamp) < 300000) {
            mostrarToastAlerta(alertaId, alerta);
        }
    });
}

// ==========================================
// 4. NAVEGACIÓN Y TRANSICIÓN DE NIVELES (DEEP LINKING)
// ==========================================
function navegarAEvidencia(tag, idAlerta) {
    // 1. Ocultar modal de bitácora
    const modalBitacora = document.getElementById("modal-bitacora-alertas");
    if (modalBitacora) {
        modalBitacora.classList.add("hidden");
        modalBitacora.style.display = "none";
    }

    // 2. Establecer TAG activo
    currentTag = tag;
    const activoData = window.activosCache ? window.activosCache[tag] : null;

    // 3. Guardar historial previo y ocultar niveles inferiores
    historialNavegacion.push(currentNivel);
    currentNivel = 4;

    const vistas = ["vista-nivel-1", "vista-nivel-2", "vista-nivel-3"];
    vistas.forEach((id) => {
        const el = document.getElementById(id);
        if (el) {
            el.classList.add("hidden");
            el.style.display = "none";
        }
    });

    // 4. Mostrar Nivel 4 (Consola Multimodal)
    const consolaN4 = document.getElementById("vista-nivel-4");
    if (consolaN4) {
        consolaN4.classList.remove("hidden");
        consolaN4.style.display = "flex";
    }

    // 5. Cargar UI del Nivel 4 con foco en la alerta seleccionada
    cargarConsolaNivel4(tag, activoData, idAlerta);
}

function volverDesdeNivel4() {
    const consolaN4 = document.getElementById("vista-nivel-4");
    if (consolaN4) {
        consolaN4.classList.add("hidden");
        consolaN4.style.display = "none";
    }

    // Restaurar a Nivel 3 o Nivel 2 según historial
    const nivelDestino = historialNavegacion.pop() || 3;
    currentNivel = nivelDestino;

    const vistaDestino = document.getElementById(`vista-nivel-${nivelDestino}`);
    if (vistaDestino) {
        vistaDestino.classList.remove("hidden");
        vistaDestino.style.display = "block";
    }
}

// ==========================================
// 5. CARGA Y RENDERIZADO EN NIVEL 4 (CONSOLA)
// ==========================================
function cargarConsolaNivel4(tag, activoData, idAlertaFoco = null) {
    const headerTag = document.getElementById("n4-tag-title");
    const headerArea = document.getElementById("n4-tag-area");
    const headerEstado = document.getElementById("n4-tag-estado");

    if (headerTag) headerTag.innerText = tag;
    if (headerArea && activoData) {
        headerArea.innerText = `${activoData.faena || CONFIG.DEFAULT_FAENA} > ${activoData.area || "Área General"} > ${activoData.componente || "Tren Motriz"}`;
    }

    // Contenedor de Evidencias de Terreno
    const contenedorEvidencias = document.getElementById("n4-evidencias-galeria");
    if (contenedorEvidencias) {
        contenedorEvidencias.innerHTML = '<p class="text-xs text-slate-400 p-2">Cargando evidencias multimedia de terreno...</p>';

        firebase.database().ref(CONFIG.COLECCIONES.ALERTAS)
            .orderByChild("tag")
            .equalTo(tag)
            .once("value", (snapshot) => {
                contenedorEvidencias.innerHTML = "";
                const registros = snapshot.val();

                if (!registros) {
                    contenedorEvidencias.innerHTML = '<p class="text-xs text-slate-500 italic p-2">Sin hallazgos multimedia registrados para este TAG.</p>';
                    return;
                }

                Object.keys(registros).reverse().forEach((key) => {
                    const item = registros[key];
                    const esFoco = key === idAlertaFoco;

                    if (item.evidencias && Array.isArray(item.evidencias)) {
                        item.evidencias.forEach((url) => {
                            const esVideo = url.includes(".webm") || url.includes(".mp4");
                            const cardMedia = document.createElement("div");
                            cardMedia.className = `relative rounded overflow-hidden border transition-all ${
                                esFoco ? "ring-2 ring-cyan-400 border-cyan-400 scale-[1.02]" : "border-slate-700 bg-slate-900"
                            }`;

                            if (esVideo) {
                                cardMedia.innerHTML = `
                                    <video src="${url}" controls class="w-full h-36 object-cover bg-black"></video>
                                    <div class="absolute bottom-0 inset-x-0 bg-black/75 p-1 flex justify-between items-center text-[10px] text-slate-200">
                                        <span>🎬 Clip 10s</span>
                                        <span>${item.severidad}</span>
                                    </div>
                                `;
                            } else {
                                cardMedia.innerHTML = `
                                    <img src="${url}" alt="Evidencia ${tag}" class="w-full h-36 object-cover cursor-pointer hover:opacity-85 transition" onclick="abrirLightbox('${url}')" />
                                    <div class="absolute bottom-0 inset-x-0 bg-black/75 p-1 flex justify-between items-center text-[10px] text-slate-200">
                                        <span>📷 Foto</span>
                                        <span>${new Date(item.timestamp).toLocaleDateString()}</span>
                                    </div>
                                `;
                            }
                            contenedorEvidencias.appendChild(cardMedia);
                        });
                    }
                });
            });
    }

    // Análisis diagnóstico con Gemini 2.5 Flash
    if (activoData) {
        solicitarEvaluacionGemini(tag, activoData);
    }
}

// ==========================================
// 6. RENDERIZADO DE BITÁCORA Y TOAST FLOTANTE
// ==========================================
function renderTarjetaBitacora(alertaId, alerta) {
    const contenedor = document.getElementById("lista-bitacora-alertas");
    if (!contenedor) return;

    // Evitar duplicados
    const existente = document.getElementById(`item-alerta-${alertaId}`);
    if (existente) existente.remove();

    const esCritica = alerta.severidad === "Critica";
    const tieneEvidencias = alerta.evidencias && alerta.evidencias.length > 0;

    const card = document.createElement("div");
    card.className = `bitacora-item border-l-4 p-3 mb-2 bg-slate-900 text-slate-100 rounded shadow-md border ${
        esCritica ? "border-l-red-500 border-slate-800" : "border-l-amber-500 border-slate-800"
    }`;
    card.id = `item-alerta-${alertaId}`;

    const fechaFormateada = alerta.timestamp ? new Date(alerta.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";

    card.innerHTML = `
        <div class="flex justify-between items-start gap-2">
            <div class="flex-1">
                <div class="flex items-center gap-2">
                    <span class="font-bold text-sm tracking-wide text-cyan-400">${alerta.tag || "S/TAG"}</span>
                    <span class="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded ${esCritica ? "bg-red-500/20 text-red-400 border border-red-500/40" : "bg-amber-500/20 text-amber-400 border border-amber-500/40"}">${alerta.severidad || "Alerta"}</span>
                </div>
                <p class="text-xs text-slate-300 mt-1">${alerta.area || ""} - ${alerta.componente || ""}</p>
                <p class="text-xs text-slate-400 italic mt-0.5">${alerta.hallazgo || alerta.comentario || "Sin observación adjunta"}</p>
            </div>
            <div class="text-right flex flex-col items-end gap-2">
                <span class="text-[10px] text-slate-500">${fechaFormateada}</span>
                <button 
                    onclick="navegarAEvidencia('${alerta.tag}', '${alertaId}')"
                    class="px-2.5 py-1 text-xs font-semibold rounded bg-cyan-600 hover:bg-cyan-500 text-white transition-all flex items-center gap-1 shadow">
                    ${tieneEvidencias ? "📷 Ver Evidencias" : "🔍 Ver Activo"}
                </button>
            </div>
        </div>
    `;

    contenedor.prepend(card);
}

function mostrarToastAlerta(alertaId, alerta) {
    const contenedorToasts = document.getElementById("contenedor-toasts");
    if (!contenedorToasts) return;

    const esCritica = alerta.severidad === "Critica";
    const toast = document.createElement("div");
    toast.className = `pointer-events-auto p-4 rounded shadow-xl border flex items-center justify-between gap-4 transition-all duration-300 transform translate-y-2 opacity-0 bg-slate-950 ${
        esCritica ? "border-red-500 text-red-100" : "border-amber-500 text-amber-100"
    }`;

    toast.innerHTML = `
        <div class="flex items-start gap-3">
            <span class="text-xl">${esCritica ? "🚨" : "⚠️"}</span>
            <div>
                <p class="text-xs font-bold uppercase tracking-wider text-slate-400">Nueva Alerta Terreno</p>
                <p class="text-sm font-semibold">${alerta.tag || "Activo"} - ${alerta.componente || "General"}</p>
                <p class="text-xs text-slate-300">${alerta.hallazgo || "Revisión requerida"}</p>
            </div>
        </div>
        <button 
            onclick="navegarAEvidencia('${alerta.tag}', '${alertaId}'); this.parentElement.remove();"
            class="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold rounded shadow transition">
            Atender
        </button>
    `;

    contenedorToasts.appendChild(toast);

    // Animación entrada
    setTimeout(() => {
        toast.classList.remove("translate-y-2", "opacity-0");
    }, 10);

    // Auto-remover a los 8 segundos
    setTimeout(() => {
        toast.classList.add("opacity-0", "translate-x-full");
        setTimeout(() => toast.remove(), 300);
    }, 8000);
}

// ==========================================
// 7. LIGHTBOX PARA FOTOGRAFÍAS
// ==========================================
function abrirLightbox(url) {
    let modal = document.getElementById("modal-lightbox");
    if (!modal) {
        modal = document.createElement("div");
        modal.id = "modal-lightbox";
        modal.className = "fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4 cursor-pointer";
        modal.onclick = () => modal.classList.add("hidden");
        document.body.appendChild(modal);
    }
    modal.innerHTML = `<img src="${url}" class="max-w-full max-h-full rounded shadow-2xl object-contain" />`;
    modal.classList.remove("hidden");
}

// ==========================================
// 8. EVALUACIÓN DIAGNÓSTICA (GEMINI 2.5 FLASH)
// ==========================================
async function solicitarEvaluacionGemini(tag, data) {
    const contenedorIA = document.getElementById("n4-diagnostico-ia");
    if (!contenedorIA) return;

    contenedorIA.innerHTML = '<p class="text-xs text-cyan-400 animate-pulse">Analizando parámetros mecánicos bajo norma ISO 20816-3...</p>';

    const prompt = `
        Actúa como especialista de diagnóstico y monitoreo de condiciones mecánicas en minería (ISO 20816-3).
        Analiza el siguiente activo:
        - TAG: ${tag}
        - Datos de Operación/Vibración: ${JSON.stringify(data)}
        Entrega en máximo 3 viñetas concisas:
        1. Zona de severidad y criticidad según norma ISO 20816-3 Grupo 1/2.
        2. Causa probable (desbalance, desalineamiento, holgura, falla de rodamiento).
        3. Acción táctica inmediata para terreno.
    `;

    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${CONFIG.GEMINI_API_KEY}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }]
            })
        });

        const result = await response.json();
        const textoDiagnostico = result?.candidates?.[0]?.content?.parts?.[0]?.text;

        if (textoDiagnostico) {
            contenedorIA.innerHTML = `
                <div class="p-3 bg-slate-900 border border-cyan-800/60 rounded text-xs text-slate-200 space-y-1">
                    <p class="font-bold text-cyan-300 text-[11px] mb-1">Diagnóstico Automático Predictivo</p>
                    ${textoDiagnostico.replace(/\n/g, "<br>")}
                </div>
            `;
            // Sincronizar diagnóstico a Google Sheets
            sincronizarGoogleSheets(tag, data, textoDiagnostico);
        } else {
            contenedorIA.innerHTML = '<p class="text-xs text-slate-500 italic">No se obtuvo respuesta diagnóstica.</p>';
        }
    } catch (err) {
        console.error("Error al evaluar con Gemini:", err);
        contenedorIA.innerHTML = '<p class="text-xs text-red-400">Error al conectar con el motor de diagnóstico.</p>';
    }
}

// ==========================================
// 9. SINCRONIZACIÓN CON GOOGLE SHEETS
// ==========================================
function sincronizarGoogleSheets(tag, data, diagnostico) {
    if (!CONFIG.GOOGLE_SHEETS_WEBHOOK_URL || CONFIG.GOOGLE_SHEETS_WEBHOOK_URL.includes("TU_WEBHOOK")) return;

    const payload = {
        timestamp: new Date().toISOString(),
        tag: tag,
        faena: data.faena || CONFIG.DEFAULT_FAENA,
        area: data.area || "",
        severidad: data.severidad || "Normal",
        vibracion_rms: data.vibracion_rms || 0,
        diagnostico_resumen: diagnostico
    };

    fetch(CONFIG.GOOGLE_SHEETS_WEBHOOK_URL, {
        method: "POST",
        mode: "no-cors",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    }).catch((err) => console.error("Error en sincronización a Google Sheets:", err));
}

// ==========================================
// 10. ACTUALIZACIÓN DE INTERFAZ GENERAL (NIVELES 1 Y 2)
// ==========================================
function actualizarVistasDashboard(activos) {
    const contadorCriticos = document.getElementById("kpi-criticos");
    const contadorAlerta = document.getElementById("kpi-alerta");

    let criticos = 0;
    let alertas = 0;

    Object.values(activos).forEach((item) => {
        if (item.severidad === "Critica") criticos++;
        if (item.severidad === "Alerta") alertas++;
    });

    if (contadorCriticos) contadorCriticos.innerText = criticos;
    if (contadorAlerta) contadorAlerta.innerText = alertas;
}
