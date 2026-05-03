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
 * Modal de confirmación personalizado — reemplaza el confirm() nativo del navegador
 * que muestra la URL fea ("127.0.0.1:5500 dice...").
 *
 * @param {string} titulo    Título del modal
 * @param {string} mensaje   Cuerpo del mensaje (acepta HTML básico)
 * @param {string} btnTexto  Texto del botón de confirmación (default 'Confirmar')
 * @param {'danger'|'warning'} tipo  Color del botón principal
 * @returns {Promise<boolean>} true si el usuario confirma, false si cancela
 */
export function confirmar(titulo, mensaje, btnTexto = 'Confirmar', tipo = 'danger') {
    return new Promise(resolve => {
        const previo = document.activeElement;
        const btnBg = tipo === 'danger' ? 'var(--red,#e05252)' : 'var(--gold,#c9a847)';

        const overlay = document.createElement('div');
        overlay.style.cssText = [
            'position:fixed;inset:0;z-index:9999',
            'background:rgba(0,0,0,0.55)',
            'backdrop-filter:blur(3px)',
            'display:flex;align-items:center;justify-content:center;padding:20px',
        ].join(';');

        overlay.innerHTML = `
            <div role="dialog" aria-modal="true" aria-labelledby="_conf-title" style="background:var(--surface,#1a1a24);border:1px solid var(--border-2,rgba(255,255,255,0.09));
                        border-radius:16px;padding:28px 24px;max-width:380px;width:100%;
                        box-shadow:0 24px 60px rgba(0,0,0,0.55);
                        animation:conf-in 0.18s cubic-bezier(0.34,1.56,0.64,1);">
                <p id="_conf-title" style="font-family:'DM Sans',sans-serif;font-size:16px;font-weight:700;
                           color:var(--text,#ece9e0);margin-bottom:8px;">${titulo}</p>
                <p style="font-size:13px;color:var(--text-2,#b5b2ab);line-height:1.65;margin-bottom:24px;">${mensaje}</p>
                <div style="display:flex;gap:10px;justify-content:flex-end;">
                    <button id="_conf-no" style="padding:9px 20px;border-radius:9px;border:1px solid var(--border-2,rgba(255,255,255,0.09));
                            background:transparent;color:var(--text-2,#b5b2ab);font-size:13px;font-weight:600;
                            cursor:pointer;font-family:'DM Sans',sans-serif;">Cancelar</button>
                    <button id="_conf-si" style="padding:9px 20px;border-radius:9px;border:none;
                            background:${btnBg};color:#fff;font-size:13px;font-weight:700;
                            cursor:pointer;font-family:'DM Sans',sans-serif;">${btnTexto}</button>
                </div>
            </div>`;

        // Animación keyframe (se inyecta una sola vez)
        if (!document.getElementById('_conf-style')) {
            const s = document.createElement('style');
            s.id = '_conf-style';
            s.textContent = '@keyframes conf-in{from{opacity:0;transform:scale(0.88)}to{opacity:1;transform:scale(1)}}';
            document.head.appendChild(s);
        }

        document.body.appendChild(overlay);
        overlay.querySelector('#_conf-no').focus();

        const cerrar = val => {
            overlay.remove();
            if (previo && typeof previo.focus === 'function') previo.focus();
            resolve(val);
        };
        overlay.querySelector('#_conf-no').addEventListener('click', () => cerrar(false));
        overlay.querySelector('#_conf-si').addEventListener('click', () => cerrar(true));
        overlay.addEventListener('click', e => { if (e.target === overlay) cerrar(false); });
        overlay.addEventListener('keydown', e => {
            if (e.key === 'Escape') cerrar(false);
            if (e.key === 'Tab') {
                const focusables = Array.from(overlay.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'))
                    .filter(el => !el.disabled && el.offsetParent !== null);
                if (!focusables.length) return;
                const first = focusables[0];
                const last = focusables[focusables.length - 1];
                if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
                else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
            }
        });
    });
}

export function closeModal(modal) {
    if (!modal) return;
    modal.classList.remove('open');
    if (!document.querySelector('.modal-overlay.open')) document.body.style.overflow = '';
    const returnTo = modal.dataset.returnFocus;
    if (returnTo) {
        const el = document.getElementById(returnTo);
        if (el && typeof el.focus === 'function') el.focus();
    }
    delete modal.dataset.returnFocus;
}

export function openModal(modal, trigger = document.activeElement) {
    if (!modal) return;
    if (trigger?.id) modal.dataset.returnFocus = trigger.id;
    modal.classList.add('open');
    const focusable = modal.querySelector('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
    if (focusable) setTimeout(() => focusable.focus(), 0);
}

export function closeOpenModals() {
    document.querySelectorAll('.modal-overlay.open').forEach(modal => closeModal(modal));
}

export function initGlobalModalEscape() {
    document.addEventListener('keydown', e => {
        const modal = document.querySelector('.modal-overlay.open');
        if (!modal) return;
        if (e.key === 'Escape') {
            closeModal(modal);
            return;
        }
        if (e.key !== 'Tab') return;
        const focusables = Array.from(modal.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'))
            .filter(el => el.offsetParent !== null);
        if (!focusables.length) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
        }
    });
}


/**
 * Inicializa el toggle de tema oscuro/claro.
 * Requiere un <button id="btnTema"> y un <i id="iconTema"> en el HTML.
 * Lee la preferencia de localStorage y aplica el tema al cargar.
 */
export function initTema() {
    const btn = document.getElementById('btnTema');
    const icon = document.getElementById('iconTema');

    const root = document.documentElement;

    function aplicar(modo) {
        if (modo === 'claro') {
            root.setAttribute('data-tema', 'claro');
            if (icon) icon.className = 'fas fa-moon';
            if (btn) btn.setAttribute('aria-label', 'Cambiar a modo oscuro');
        } else {
            root.removeAttribute('data-tema');
            if (icon) icon.className = 'fas fa-sun';
            if (btn) btn.setAttribute('aria-label', 'Cambiar a modo claro');
        }
    }

    aplicar(localStorage.getItem('barber-tema') || 'oscuro');

    if (btn) {
        btn.addEventListener('click', () => {
            const nuevo = root.getAttribute('data-tema') === 'claro' ? 'oscuro' : 'claro';
            aplicar(nuevo);
            localStorage.setItem('barber-tema', nuevo);
        });
    }
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
