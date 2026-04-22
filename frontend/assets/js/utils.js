/**
 * utils.js — Utilidades compartidas entre barberia.js y usuario.js.
 *
 * Se extrae aquí para no duplicar código entre la página pública (barberia.js)
 * y el panel del dueño (usuario.js). Ambas páginas necesitan las mismas
 * notificaciones y el mismo formateador de fechas, así que un módulo compartido
 * evita que un bugfix en toast() tenga que aplicarse en dos sitios distintos.
 */


/**
 * Muestra una notificación toast temporal en #toastContainer.
 * Se auto-destruye después de `duration` ms para evitar acumulación de nodos
 * en el DOM durante sesiones largas donde el usuario hace muchas acciones.
 *
 * @param {string} msg      Texto del mensaje
 * @param {'info'|'success'|'error'} type  Tipo de notificación
 * @param {number} duration Milisegundos antes de ocultar (default 3000)
 */
export function toast(msg, type = 'info', duration = 3000) {
    const icons = { success: 'fa-check-circle', error: 'fa-exclamation-circle', info: 'fa-info-circle' };
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.setAttribute('role', 'alert');
    el.innerHTML = `<i class="fas ${icons[type] ?? icons.info}"></i><span>${msg}</span>`;
    document.getElementById('toastContainer').appendChild(el);
    setTimeout(() => {
        el.classList.add('out');
        // Espera el tiempo de la animación CSS de salida antes de remover del DOM
        setTimeout(() => el.remove(), 300);
    }, duration);
}


/**
 * Formatea una fecha ISO (YYYY-MM-DD o ISO completo) a texto legible en español.
 *
 * Construye la fecha con componentes separados (año, mes, día) en vez de
 * pasar el string directo a new Date(), porque new Date('2024-01-15') interpreta
 * la fecha como UTC medianoche, lo que puede mostrar el día anterior en zonas
 * horarias negativas como México (UTC-6).
 *
 * @param {string} f        Fecha ISO (acepta 'YYYY-MM-DD' o 'YYYY-MM-DDTHH:mm...')
 * @param {object} options  Opciones de toLocaleDateString (opcional)
 */
export function fmtFecha(f, options = { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) {
    if (!f) return '-';
    try {
        const [y, m, d] = f.substring(0, 10).split('-').map(Number);
        return new Date(y, m - 1, d).toLocaleDateString('es-MX', options);
    } catch { return f; }
}
