/**
 * usuario.js — Panel del dueño de barbería (usuario registrado).
 *
 * Convención de nombres:
 * - Funciones de negocio en español (cargarServicios, cambiarEstado)
 *   porque los conceptos son del dominio en español.
 * - Variables técnicas breves (btn, el, msg) se mantienen cortas
 *   por ser locales y efímeras dentro de su scope.
 *
 * Estructura:
 * - Autenticación y guard de sesión
 * - Toast notifications
 * - Navegación por tabs (servicios, reservas, reseñas, fotos, config)
 * - CRUD de servicios con asignación de fotos
 * - Gestión de reservas y cambio de estado
 * - Listado de reseñas con promedio
 * - Upload y eliminación de fotos
 * - Configuración de datos de la barbería
 *
 * Dependencia: config.js (API URL + auth helpers).
 */

import { config, auth } from './config.js';
import { toast, fmtFecha } from './utils.js';

// IIFE para bloquear la página antes de que el DOM termine de renderizar;
// un guard en DOMContentLoaded llegaría demasiado tarde y el usuario vería contenido protegido.
(async () => {
    if (!auth.estaLogueado() || auth.getRole() !== 'dueno') {
        window.location.href = 'login.html';
        return;
    }
    // Verificar que el token siga válido con el backend
    if (!(await auth.verificar())) {
        window.location.href = 'login.html';
        return;
    }
    init();
})();



/* ── INIT ──────────────────────────────────────────────────────
   Se ejecuta tras validar la sesión. Construye el link público
   dinámicamente a partir de location.origin para que funcione
   tanto en localhost como en ngrok sin cambiar configuración.
   ────────────────────────────────────────────────────────────── */
function init() {
    const barberia = auth.getUserData();
    document.getElementById('nombreBarberia').textContent = barberia.nombre;
    document.getElementById('emailUsuario').textContent = barberia.dueno_email;

    const base = location.origin + location.pathname.replace('usuario.html', '');
    document.getElementById('linkPublico').value = `${base}barberia.html?codigo=${barberia.codigo_unico}`;
    document.getElementById('linkVerPagina').href = `${base}barberia.html?codigo=${barberia.codigo_unico}`;

    cargarServicios();
}


/* ── NAVEGACIÓN POR TABS (WAI-ARIA Tabs pattern) ───────────────
   Solo el tab activo es tabulable (tabindex=0), los demás tienen -1.
   Esto permite al usuario saltar los tabs con una sola pulsación de Tab.
   Flechas izq/der mueven el foco entre tabs; Enter/Space activan.
   Al cambiar de tab se recarga la data para mantenerla fresca.
   ────────────────────────────────────────────────────────────── */
window.cambiarTab = function (tabId, tabEl) {
    // Desactivar todos los tabs y paneles
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.tab').forEach(t => {
        t.classList.remove('active');
        t.setAttribute('aria-selected', 'false');
        t.setAttribute('tabindex', '-1');
    });

    // Activar el tab y panel seleccionados
    const panel = document.getElementById(tabId);
    panel.classList.add('active');
    if (tabEl) {
        tabEl.classList.add('active');
        tabEl.setAttribute('aria-selected', 'true');
        tabEl.setAttribute('tabindex', '0');
    }

    // Recargar datos de la sección para mantenerlos actualizados sin F5
    if (tabId === 'servicios') cargarServicios();
    if (tabId === 'reservas') cargarReservas();
    if (tabId === 'resenas') cargarResenas();
    if (tabId === 'fotos') cargarFotos();
    if (tabId === 'configuracion') cargarConfig();

    // Mover el foco al primer elemento interactivo del panel
    // (solo si la navegación fue por teclado, no por click)
    const viaTeclado = tabEl && document.activeElement === tabEl;
    if (viaTeclado) {
        setTimeout(() => {
            const focusable = panel.querySelector(
                'button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
            );
            if (focusable) focusable.focus();
        }, 80);
    }
};

/* Inicializar listeners de teclado y click en los tabs.
   Se usa event delegation en el tablist para no repetir listeners
   en cada tab individualmente. */
(function inicializarTabs() {
    const tablist = document.querySelector('[role="tablist"]');
    if (!tablist) return;
    const tabs = Array.from(tablist.querySelectorAll('[role="tab"]'));

    tablist.addEventListener('keydown', (e) => {
        const currentTab = document.activeElement;
        if (!currentTab || currentTab.getAttribute('role') !== 'tab') return;
        const idx = tabs.indexOf(currentTab);

        let nextIdx = -1;
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
            nextIdx = (idx + 1) % tabs.length;
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
            nextIdx = (idx - 1 + tabs.length) % tabs.length;
        } else if (e.key === 'Home') {
            nextIdx = 0;
        } else if (e.key === 'End') {
            nextIdx = tabs.length - 1;
        } else if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            const panelId = currentTab.getAttribute('aria-controls');
            cambiarTab(panelId, currentTab);
            return;
        }

        if (nextIdx >= 0) {
            e.preventDefault();
            tabs[nextIdx].focus();
            const panelId = tabs[nextIdx].getAttribute('aria-controls');
            cambiarTab(panelId, tabs[nextIdx]);
        }
    });

    // Click también activa el tab
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const panelId = tab.getAttribute('aria-controls');
            cambiarTab(panelId, tab);
        });
    });
})();



// Base URL del backend (sin /api) para construir URLs de imágenes
const base = config.apiURL.replace('/api', '');

// Cache de reservas para el exportador CSV (se llena al cargarReservas())
let reservasCache = [];


/* ═══════════════════════════════════════════════════════════════
   SERVICIOS — CRUD + asignación de fotos
   ═══════════════════════════════════════════════════════════════ */

/**
 * Carga la lista de servicios del backend y renderiza como cards.
 * Usa skeleton loading en vez de spinner porque las cards ya definen
 * la altura final del layout, evitando un "salto" visual cuando
 * los datos reales llegan (mejora Cumulative Layout Shift).
 */
async function cargarServicios() {
    const c = document.getElementById('listaServicios');

    // Skeleton loading: 3 cards placeholder
    c.innerHTML = Array(3).fill(`<div class="srv-card">
        <div class="skeleton" style="width:100%;aspect-ratio:16/10;"></div>
        <div class="srv-card-body"><div class="skeleton" style="height:14px;width:60%;margin-bottom:8px;"></div><div class="skeleton" style="height:11px;width:80%;margin-bottom:8px;"></div><div class="skeleton" style="height:20px;width:35%;"></div></div>
        <div class="srv-card-footer"><div class="skeleton" style="height:34px;width:100%;border-radius:8px;"></div></div>
    </div>`).join('');

    try {
        const s = await (await fetch(`${config.apiURL}/mi-barberia/servicios`, { headers: auth.headers() })).json();

        if (!s.length) {
            c.innerHTML = `<div class="empty-state" style="grid-column:1/-1;">
                <i class="fas fa-cut"></i>
                <p>Aún no tienes servicios.<br>Agrega el primero usando el formulario de arriba.</p>
            </div>`;
            return;
        }

        c.innerHTML = s.map(x => {
            const imgHTML = x.imagen_url
                ? `<img src="${base}${x.imagen_url}" alt="${x.nombre}">`
                : `<div class="srv-card-img-placeholder"><i class="fas fa-cut"></i><span>Sin foto</span></div>`;
            return `<div class="srv-card">
                <div class="srv-card-img" onclick="abrirModalFoto(${x.id},${x.foto_id || 'null'})" role="button" tabindex="0" aria-label="Cambiar foto de ${x.nombre}">
                    ${imgHTML}
                    <div class="srv-card-img-overlay"><i class="fas fa-camera"></i> Cambiar foto</div>
                </div>
                <div class="srv-card-body">
                    <div class="srv-card-name">${x.nombre}</div>
                    <div class="srv-card-desc">${x.descripcion || '<span style="opacity:.4;">Sin descripción</span>'}</div>
                    <div class="srv-card-meta">
                        <span class="srv-card-price">$${x.precio}</span>
                        <span class="srv-card-dur"><i class="fas fa-clock"></i> ${x.duracion || 30} min</span>
                    </div>
                </div>
                <div class="srv-card-footer">
                    <button onclick="eliminarServicio(${x.id})" class="btn btn-danger" style="flex:1;justify-content:center;padding:8px;font-size:12px;"><i class="fas fa-trash"></i> Eliminar</button>
                </div>
            </div>`;
        }).join('');

        // C7: Permitir activar "Cambiar foto" con Enter/Space desde teclado
        c.querySelectorAll('.srv-card-img[role="button"]').forEach(el => {
            el.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    el.click();
                }
            });
        });
    } catch (e) { console.error('Error cargando servicios:', e); }
}

// Formulario para agregar un nuevo servicio
document.getElementById('servicioForm').addEventListener('submit', async e => {
    e.preventDefault();
    const d = {
        nombre: document.getElementById('nombreServicio').value.trim(),
        precio: parseInt(document.getElementById('precioServicio').value),
        descripcion: document.getElementById('descripcionServicio').value.trim(),
        duracion: parseInt(document.getElementById('duracionServicio').value) || 30
    };

    if (!d.nombre || !d.precio) { toast('Nombre y precio son requeridos', 'error'); return; }

    const btn = e.target.querySelector('[type=submit]');
    btn.disabled = true;
    btn.innerHTML = '<span class="loading" style="border-top-color:var(--ink);"></span> Guardando...';

    try {
        const r = await fetch(`${config.apiURL}/mi-barberia/servicios`, {
            method: 'POST', headers: auth.headers(), body: JSON.stringify(d)
        });
        const res = await r.json();
        if (!r.ok) { toast(res.error, 'error'); return; }

        // Limpiar formulario y restaurar duración al default
        document.getElementById('servicioForm').reset();
        document.getElementById('duracionServicio').value = '30';
        toast(`"${d.nombre}" agregado`, 'success');
        cargarServicios();
    } catch { toast('Error al guardar', 'error'); }
    finally { btn.disabled = false; btn.innerHTML = '<i class="fas fa-plus"></i> Agregar Servicio'; }
});

/** Elimina un servicio con soft-delete (activo=false en BD).
 *  Se usa soft-delete en vez de DELETE real para preservar el historial
 *  de reservas anteriores que referencian este servicio por nombre. */
window.eliminarServicio = async id => {
    if (!confirm('¿Eliminar este servicio?')) return;
    try {
        await fetch(`${config.apiURL}/mi-barberia/servicios/${id}`, { method: 'DELETE', headers: auth.headers() });
        toast('Servicio eliminado', 'info');
        cargarServicios();
    } catch { toast('Error al eliminar', 'error'); }
};


/* ── MODAL DE ASIGNACIÓN DE FOTO ──────────────────────────────
   Flujo de 2 pasos (subir foto → asignar a servicio) en vez de
   upload directo por servicio, porque permite reusar la misma foto
   en múltiples servicios sin duplicar archivos en disco.
   ────────────────────────────────────────────────────────────── */

/* Estado del modal separado del DOM para evitar parsear el HTML
   cada vez que necesitamos saber qué servicio/foto está seleccionado */
let _modalServicioId = null;
let _modalFotoSeleccionada = null;

window.abrirModalFoto = async (servicioId, fotoActualId) => {
    _modalServicioId = servicioId;
    _modalFotoSeleccionada = fotoActualId;
    const grid = document.getElementById('modalFotoGrid');
    grid.innerHTML = '<p style="color:var(--text-3);grid-column:1/-1;"><span class="loading"></span> Cargando...</p>';
    document.getElementById('modalFoto').classList.add('open');

    try {
        const fotos = await (await fetch(`${config.apiURL}/mi-barberia/fotos`, { headers: auth.headers() })).json();
        if (!fotos.length) {
            grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:24px;color:var(--text-3);">
                <i class="fas fa-images" style="font-size:32px;opacity:.3;display:block;margin-bottom:10px;"></i>
                No tienes fotos subidas.<br><small>Ve a la pestaña <strong style="color:var(--gold);">Fotos</strong> y sube algunas primero.</small></div>`;
            return;
        }
        // Opción "Sin foto" + todas las fotos de la galería
        grid.innerHTML = `
            <div class="foto-none ${!fotoActualId ? 'selected' : ''}" onclick="seleccionarFoto(null,this)" tabindex="0" role="button" aria-label="Sin foto">
                <i class="fas fa-times"></i>Sin foto
            </div>
            ${fotos.map(f => `
            <div class="foto-option ${f.id == fotoActualId ? 'selected' : ''}" onclick="seleccionarFoto(${f.id},this)" tabindex="0" role="button" aria-label="Seleccionar foto ${f.descripcion || f.id}">
                <img src="${base}${f.url || '/uploads/' + f.filename}" alt="${f.descripcion || 'Foto'}">
            </div>`).join('')}`;

        // C7: Activar fotos con Enter/Space para usuarios de teclado
        grid.querySelectorAll('[role="button"]').forEach(el => {
            el.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    el.click();
                }
            });
        });
    } catch { grid.innerHTML = '<p style="color:var(--red);">Error cargando fotos</p>'; }
};

/** Marca visualmente la foto seleccionada en el modal */
window.seleccionarFoto = (fotoId, el) => {
    document.querySelectorAll('.foto-option,.foto-none').forEach(x => x.classList.remove('selected'));
    el.classList.add('selected');
    _modalFotoSeleccionada = fotoId;
};

/** Cierra el modal si se hace click en el overlay (fuera del modal) */
window.cerrarModal = (e) => {
    if (e.target === document.getElementById('modalFoto'))
        document.getElementById('modalFoto').classList.remove('open');
};

/** Confirma la asignación de foto al servicio vía PATCH */
window.confirmarFoto = async () => {
    if (_modalServicioId === null) return;
    try {
        const r = await fetch(`${config.apiURL}/mi-barberia/servicios/${_modalServicioId}/foto`, {
            method: 'PATCH',
            headers: auth.headers(),
            body: JSON.stringify({ foto_id: _modalFotoSeleccionada })
        });
        if (!r.ok) throw 0;
        document.getElementById('modalFoto').classList.remove('open');
        toast('Foto asignada al servicio', 'success');
        cargarServicios();
    } catch { toast('Error al asignar foto', 'error'); }
};


/* ═══════════════════════════════════════════════════════════════
   RESERVAS — Listado, cambio de estado, eliminación
   ═══════════════════════════════════════════════════════════════ */

async function cargarReservas() {
    const c = document.getElementById('listaReservas');
    c.innerHTML = '<div style="padding:20px;"><span class="loading"></span></div>';

    try {
        const rs = await (await fetch(`${config.apiURL}/mi-barberia/reservas`, { headers: auth.headers() })).json();
        reservasCache = rs; // Se mantiene en memoria para el filtro de fechas y exportación CSV sin nueva petición

        if (!rs.length) {
            c.innerHTML = `<div class="empty-state"><i class="fas fa-calendar"></i><p>Sin reservas por ahora.<br>Cuando lleguen aparecerán aquí.</p></div>`;
            return;
        }

        // Tabla con todas las reservas, ordenadas por fecha descendente (backend)
        c.innerHTML = `<div class="table-wrap"><table><thead><tr><th>Cliente</th><th>Contacto</th><th>Servicio</th><th>Fecha</th><th>Hora</th><th>Estado</th><th></th></tr></thead><tbody>
            ${rs.map(r => `<tr>
                <td><strong style="color:var(--text);">${r.nombre}</strong></td>
                <td style="font-size:12px;line-height:1.5;">${r.email}<br>${r.telefono}</td>
                <td>${r.servicio}</td><td>${fmtFecha(r.fecha)}</td><td>${(r.hora || '').substring(0, 5)}</td>
                <td><select onchange="cambiarEstado(${r.id},this.value)" class="estado-sel" aria-label="Cambiar estado de reserva">
                    <option value="pendiente"  ${r.estado === 'pendiente' ? 'selected' : ''}>⏳ Pendiente</option>
                    <option value="confirmada" ${r.estado === 'confirmada' ? 'selected' : ''}>✅ Confirmada</option>
                    <option value="completada" ${r.estado === 'completada' ? 'selected' : ''}>🎉 Completada</option>
                    <option value="cancelada"  ${r.estado === 'cancelada' ? 'selected' : ''}>❌ Cancelada</option>
                </select></td>
                <td><button onclick="eliminarReserva(${r.id})" class="btn btn-danger" style="padding:5px 9px;font-size:12px;width:auto;" aria-label="Eliminar reserva de ${r.nombre}"><i class="fas fa-trash"></i></button></td>
            </tr>${r.comentarios ? `<tr><td colspan="7" style="background:var(--ink-3);font-size:12px;color:var(--text-3);padding:6px 14px;font-style:italic;">"${r.comentarios}"</td></tr>` : ''}`).join('')}
        </tbody></table></div>
        <p style="text-align:right;color:var(--text-3);font-size:12px;margin-top:10px;">${rs.length} reserva${rs.length !== 1 ? 's' : ''}</p>`;
    } catch (e) { console.error('Error cargando reservas:', e); }
}

/**
 * Exporta todas las reservas cargadas como archivo .csv.
 * Usa los datos en memoria (reservasCache) para no hacer otra petición.
 * El BOM (\uFEFF) garantiza que Excel abra el archivo con UTF-8 correctamente.
 */
window.exportarCSV = function () {
    if (!reservasCache.length) {
        toast('No hay reservas para exportar', 'info');
        return;
    }
    const encabezado = ['Nombre', 'Email', 'Teléfono', 'Servicio', 'Fecha', 'Hora', 'Estado'];
    const filas = reservasCache.map(r => [
        r.nombre || '',
        r.email || '',
        r.telefono || '',
        r.servicio || '',
        r.fecha ? r.fecha.substring(0, 10) : '',
        r.hora ? r.hora.substring(0, 5) : '',
        r.estado || ''
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));

    const csv = [encabezado.join(','), ...filas].join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const enlace = document.createElement('a');
    enlace.href = url;
    enlace.download = `reservas-${new Date().toISOString().slice(0, 10)}.csv`;
    enlace.click();
    URL.revokeObjectURL(url);
    toast(`${reservasCache.length} reserva${reservasCache.length !== 1 ? 's' : ''} exportada${reservasCache.length !== 1 ? 's' : ''}`, 'success');
};

/** Cambia el estado de una reserva (pendiente → confirmada → completada → cancelada) */
window.cambiarEstado = async (id, e) => {
    try {
        await fetch(`${config.apiURL}/mi-barberia/reservas/${id}/estado`, {
            method: 'PATCH', headers: auth.headers(), body: JSON.stringify({ estado: e })
        });
        toast('Estado actualizado', 'success');
    } catch {
        toast('Error', 'error');
        cargarReservas(); // Recargar para revertir el select al estado real
    }
};

window.eliminarReserva = async id => {
    if (!confirm('¿Eliminar esta reserva?')) return;
    try {
        await fetch(`${config.apiURL}/mi-barberia/reservas/${id}`, { method: 'DELETE', headers: auth.headers() });
        toast('Reserva eliminada', 'info');
        cargarReservas();
    } catch { }
};


/* ═══════════════════════════════════════════════════════════════
   RESEÑAS — Listado con calificación promedio
   ═══════════════════════════════════════════════════════════════ */

async function cargarResenas() {
    const c = document.getElementById('listaResenas');
    c.innerHTML = '<div style="padding:20px;"><span class="loading"></span></div>';

    try {
        const rs = await (await fetch(`${config.apiURL}/mi-barberia/resenas`, { headers: auth.headers() })).json();

        if (!rs.length) {
            c.innerHTML = `<div class="empty-state"><i class="fas fa-star"></i><p>Todavía no tienes reseñas de clientes.</p></div>`;
            return;
        }

        // Calcular promedio de calificaciones para mostrar resumen arriba
        const avg = (rs.reduce((a, r) => a + r.calificacion, 0) / rs.length).toFixed(1);
        c.innerHTML = `<div style="display:flex;align-items:center;gap:10px;margin-bottom:20px;padding:14px 16px;background:var(--ink-3);border-radius:10px;border:1px solid var(--border);">
            <span style="font-size:28px;font-family:'Playfair Display',serif;color:var(--gold);font-weight:700;">${avg}</span>
            <div><div style="color:var(--gold);font-size:18px;">${'★'.repeat(Math.round(avg))}${'☆'.repeat(5 - Math.round(avg))}</div>
            <div style="font-size:12px;color:var(--text-3);">${rs.length} reseña${rs.length !== 1 ? 's' : ''}</div></div></div>
        ${rs.map(r => {
            let f = '';
            try { f = new Date(r.created_at).toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' }); } catch { }
            return `<div class="review-card"><div class="review-header"><span class="review-author">${r.cliente_nombre}</span><span style="color:var(--gold);">${'★'.repeat(r.calificacion)}<span style="color:var(--text-3);">${'★'.repeat(5 - r.calificacion)}</span></span></div><p class="review-text">${r.comentario}</p><p class="review-date">${f}</p></div>`;
        }).join('')}`;
    } catch (e) { console.error('Error cargando reseñas:', e); }
}


/* ═══════════════════════════════════════════════════════════════
   FOTOS — Upload, listado y eliminación
   ═══════════════════════════════════════════════════════════════ */

async function cargarFotos() {
    const c = document.getElementById('galeriaAdmin');

    // Skeleton loading
    c.innerHTML = Array(3).fill(`<div class="card" style="padding:0;overflow:hidden;"><div class="skeleton" style="width:100%;aspect-ratio:4/3;"></div><div style="padding:10px;"><div class="skeleton" style="height:12px;margin-bottom:8px;"></div><div class="skeleton" style="height:34px;border-radius:8px;"></div></div></div>`).join('');

    try {
        const fs = await (await fetch(`${config.apiURL}/mi-barberia/fotos`, { headers: auth.headers() })).json();

        if (!fs.length) {
            c.innerHTML = `<div class="empty-state" style="grid-column:1/-1;"><i class="fas fa-images"></i><p>Sin fotos aún. ¡Sube la primera!</p></div>`;
            return;
        }

        c.innerHTML = fs.map(f => `<div class="card" style="padding:0;overflow:hidden;margin-bottom:0;">
            <img src="${base}${f.url || '/uploads/' + f.filename}" style="width:100%;aspect-ratio:4/3;object-fit:cover;display:block;" loading="lazy" alt="${f.descripcion || 'Foto de la barbería'}">
            <div style="padding:10px 12px;">
                ${f.descripcion ? `<p style="font-size:12px;color:var(--text-3);margin-bottom:8px;">${f.descripcion}</p>` : ''}
                <button onclick="eliminarFoto(${f.id})" class="btn btn-danger" style="width:100%;padding:7px;font-size:12px;justify-content:center;"><i class="fas fa-trash"></i> Eliminar</button>
            </div></div>`).join('');
    } catch (e) { console.error('Error cargando fotos:', e); }
}

/** Sube una foto al backend via FormData (multipart) */
window.subirFoto = async () => {
    const fi = document.getElementById('fotoInput');
    const btn = document.getElementById('btnFoto');
    const msg = document.getElementById('msgFoto');

    if (!fi.files[0]) { toast('Selecciona una imagen', 'error'); return; }
    if (fi.files[0].size > 5 * 1024 * 1024) { toast('Máximo 5MB', 'error'); return; }

    btn.disabled = true;
    btn.innerHTML = '<span class="loading" style="border-top-color:var(--ink);"></span>';
    msg.innerHTML = '';

    const fd = new FormData();
    fd.append('foto', fi.files[0]);
    fd.append('descripcion', document.getElementById('fotoDesc').value.trim());

    try {
        const r = await fetch(`${config.apiURL}/mi-barberia/fotos`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${auth.getToken()}` }, // Sin Content-Type: browser lo pone automáticamente para FormData
            body: fd
        });
        if (!r.ok) { const e = await r.json(); throw new Error(e.error); }
        fi.value = '';
        document.getElementById('fotoDesc').value = '';
        toast('¡Foto subida exitosamente!', 'success');
        cargarFotos();
    } catch (e) { toast(e.message, 'error'); }
    finally { btn.disabled = false; btn.innerHTML = '<i class="fas fa-upload"></i> Subir'; }
};

window.eliminarFoto = async id => {
    if (!confirm('¿Eliminar esta foto?')) return;
    try {
        await fetch(`${config.apiURL}/mi-barberia/fotos/${id}`, { method: 'DELETE', headers: auth.headers() });
        toast('Foto eliminada', 'info');
        cargarFotos();
    } catch { }
};


/* ═══════════════════════════════════════════════════════════════
   CONFIGURACIÓN — Datos de la barbería + editor de horarios
   ═══════════════════════════════════════════════════════════════ */

// Definición de días y opciones de hora (reutilizable)
const cfgDias = [
    { id: 'lunes', nombre: 'Lunes' }, { id: 'martes', nombre: 'Martes' },
    { id: 'miercoles', nombre: 'Miércoles' }, { id: 'jueves', nombre: 'Jueves' },
    { id: 'viernes', nombre: 'Viernes' }, { id: 'sabado', nombre: 'Sábado' },
    { id: 'domingo', nombre: 'Domingo' }
];
const cfgHorasAp = ['06:00','07:00','08:00','09:00','10:00','11:00'];
const cfgHorasCi = ['14:00','15:00','16:00','17:00','18:00','19:00','20:00','21:00','22:00'];

/**
 * Construye el grid interactivo de horarios en la pestaña Config.
 * Se llama una sola vez; luego cargarConfig() rellena los valores.
 */
function buildHorariosGrid() {
    const grid = document.getElementById('cfgHorariosGrid');
    if (!grid || grid.children.length > 0) return; // Ya construido

    cfgDias.forEach(d => {
        const row = document.createElement('div');
        row.className = 'cfg-dia';
        row.id = `cfg-row-${d.id}`;
        row.innerHTML = `
            <label class="cfg-dia-check">
                <input type="checkbox" id="cfg-ck-${d.id}"> ${d.nombre}
            </label>
            <select class="cfg-time" id="cfg-ap-${d.id}" disabled>
                ${cfgHorasAp.map(h => `<option value="${h}">${h}</option>`).join('')}
            </select>
            <select class="cfg-time" id="cfg-ci-${d.id}" disabled>
                ${cfgHorasCi.map(h => `<option value="${h}">${h}</option>`).join('')}
            </select>
            <span class="cfg-cerrado" id="cfg-bg-${d.id}">Cerrado</span>`;
        grid.appendChild(row);

        // Toggle: activar/desactivar selectores al marcar checkbox
        row.querySelector(`#cfg-ck-${d.id}`).addEventListener('change', function () {
            row.classList.toggle('activo', this.checked);
            row.querySelector(`#cfg-ap-${d.id}`).disabled = !this.checked;
            row.querySelector(`#cfg-ci-${d.id}`).disabled = !this.checked;
            row.querySelector(`#cfg-bg-${d.id}`).style.display = this.checked ? 'none' : 'block';
        });
    });
}

/**
 * Parsea el string de horarios guardado en la BD y rellena el grid interactivo.
 * Formato esperado: "Lunes: 09:00 - 18:00\nMartes: Cerrado\n..."
 */
function rellenarHorariosGrid(horariosStr) {
    if (!horariosStr) return;
    const lineas = horariosStr.split('\n');

    cfgDias.forEach(d => {
        // Buscar la línea que corresponde a este día (sin acentos)
        const linea = lineas.find(l =>
            l.split(':')[0].trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '') ===
            d.id
        );
        const ck = document.getElementById(`cfg-ck-${d.id}`);
        const ap = document.getElementById(`cfg-ap-${d.id}`);
        const ci = document.getElementById(`cfg-ci-${d.id}`);
        const bg = document.getElementById(`cfg-bg-${d.id}`);
        const row = document.getElementById(`cfg-row-${d.id}`);

        if (linea) {
            const contenido = linea.substring(linea.indexOf(':') + 1).trim().toLowerCase();
            if (contenido === 'cerrado') {
                ck.checked = false;
                ap.disabled = true;
                ci.disabled = true;
                bg.style.display = 'block';
                row.classList.remove('activo');
            } else {
                // Extraer horas (ej: "09:00 - 18:00")
                const m = contenido.match(/(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/);
                ck.checked = true;
                ap.disabled = false;
                ci.disabled = false;
                bg.style.display = 'none';
                row.classList.add('activo');
                if (m) {
                    ap.value = m[1];
                    ci.value = m[2];
                }
            }
        }
    });
}

/**
 * Serializa el grid interactivo a texto plano ("Lunes: 09:00 - 18:00\n...").
 * Se usa texto en vez de JSON porque el mismo string se muestra directamente
 * en la página pública sin necesidad de parseo adicional en barberia.js.
 */
function generarHorariosDesdeGrid() {
    return cfgDias.map(d => {
        const ck = document.getElementById(`cfg-ck-${d.id}`);
        if (ck.checked) {
            const ap = document.getElementById(`cfg-ap-${d.id}`).value;
            const ci = document.getElementById(`cfg-ci-${d.id}`).value;
            return `${d.nombre}: ${ap} - ${ci}`;
        }
        return `${d.nombre}: Cerrado`;
    }).join('\n');
}

/** Inicializa los botones de la paleta de temas */
function initTemaPaleta() {
    const paleta = document.getElementById('temaPaleta');
    const inputText = document.getElementById('cfgTemaColor');
    const inputCustom = document.getElementById('cfgTemaCustom');
    if (!paleta) return;

    // Click en un botón de la paleta
    paleta.addEventListener('click', e => {
        const btn = e.target.closest('.tema-color-btn');
        if (!btn) return;
        const color = btn.dataset.color;
        setTemaColor(color);
    });

    // Input de color nativo sincroniza con el campo de texto
    if (inputCustom) {
        inputCustom.addEventListener('input', () => {
            setTemaColor(inputCustom.value);
        });
    }

    // Campo de texto sincroniza con el color nativo
    if (inputText) {
        inputText.addEventListener('input', () => {
            const val = inputText.value.trim();
            if (/^#[0-9a-fA-F]{6}$/.test(val)) {
                if (inputCustom) inputCustom.value = val;
                resaltarPaletaActiva(val);
            }
        });
    }
}

/** Actualiza el tema seleccionado en la UI */
function setTemaColor(color) {
    const inputText = document.getElementById('cfgTemaColor');
    const inputCustom = document.getElementById('cfgTemaCustom');
    if (inputText) inputText.value = color;
    if (inputCustom && /^#[0-9a-fA-F]{6}$/.test(color)) inputCustom.value = color;
    resaltarPaletaActiva(color);
}

/** Marca el botón activo en la paleta según el color actual */
function resaltarPaletaActiva(color) {
    document.querySelectorAll('.tema-color-btn').forEach(btn => {
        btn.classList.toggle('activo', btn.dataset.color === color);
    });
}

/** Carga los datos actuales desde la API para pre-llenar el formulario de config */
async function cargarConfig() {
    buildHorariosGrid();
    initTemaPaleta();
    try {
        const barberia = await (await fetch(`${config.apiURL}/mi-barberia`, { headers: auth.headers() })).json();
        document.getElementById('cfgNombre').value = barberia.nombre || '';
        document.getElementById('cfgTelefono').value = barberia.dueno_telefono || '';
        document.getElementById('cfgDireccion').value = barberia.direccion || '';
        document.getElementById('cfgCiudad').value = barberia.ciudad || '';
        rellenarHorariosGrid(barberia.horarios || '');
        // Cargar tema de color guardado
        const colorGuardado = barberia.tema_color || '#c9a847';
        setTemaColor(colorGuardado);
    } catch { }
}

/* Al guardar config, también actualizamos sessionStorage para que el nombre
   de la barbería en el topbar se refleje inmediatamente sin recargar página.
   Sin esto, el usuario vería el nombre viejo hasta hacer F5. */
document.getElementById('configForm').addEventListener('submit', async e => {
    e.preventDefault();
    const submitBtn = e.target.querySelector('[type=submit]');

    const horariosStr = generarHorariosDesdeGrid();
    document.getElementById('cfgHorarios').value = horariosStr;

    const temaColor = (document.getElementById('cfgTemaColor')?.value || '').trim();
    const d = {
        nombre: document.getElementById('cfgNombre').value.trim(),
        dueno_telefono: document.getElementById('cfgTelefono').value.trim(),
        direccion: document.getElementById('cfgDireccion').value.trim(),
        ciudad: document.getElementById('cfgCiudad').value.trim(),
        horarios: horariosStr,
        tema_color: /^#[0-9a-fA-F]{3,8}$/.test(temaColor) ? temaColor : undefined
    };

    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span class="loading" style="border-top-color:var(--ink);"></span> Guardando...';

    try {
        const respuesta = await fetch(`${config.apiURL}/mi-barberia`, { method: 'PUT', headers: auth.headers(), body: JSON.stringify(d) });
        if (!respuesta.ok) throw 0;
        const datosActualizados = await respuesta.json();

        const sesion = auth.getUserData();
        sesion.nombre = datosActualizados.nombre;
        sessionStorage.setItem('userData', JSON.stringify(sesion));
        document.getElementById('nombreBarberia').textContent = d.nombre;

        toast('¡Cambios guardados!', 'success');
    } catch { toast('Error al guardar', 'error'); }
    finally { submitBtn.disabled = false; submitBtn.innerHTML = '<i class="fas fa-save"></i> Guardar Cambios'; }
});


/* ── UTILIDADES GLOBALES ──────────────────────────────────────
   Se exponen a window porque se invocan desde atributos onclick
   inline en el HTML. Idealmente se migrarían a event listeners,
   pero onclick inline es más fácil de auditar en el HTML estático.
   ────────────────────────────────────────────────────────────── */
window.copiarLink = id => {
    navigator.clipboard.writeText(document.getElementById(id).value)
        .then(() => toast('¡Link copiado!', 'success'));
};

window.cerrarSesion = () => {
    if (confirm('¿Cerrar sesión?')) auth.logout();
};
