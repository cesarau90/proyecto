/**
 * barberia.js — Lógica de la página pública de una barbería.
 *
 * Flujo principal:
 * 1. Lee el código único de la URL (?codigo=XXXX).
 * 2. Carga datos de la barbería desde la API.
 * 3. Renderiza servicios, reseñas, horarios e info.
 * 4. Maneja la reserva y el envío de reseñas.
 *
 * Dependencia: config.js (API URL + auth helpers).
 */

import { config } from './config.js';
import { toast, openModal, closeModal, initGlobalModalEscape } from './utils.js';

initGlobalModalEscape();

// EmailJS se inicializa en usuario.js (el email se envía al confirmar la cita, no al crear la reserva)

// Extraer el código único de la barbería de los query params.
// Cada barbería tiene un código corto que identifica su página pública.
const params = new URLSearchParams(location.search);
const codigo = params.get('codigo');

// Variable global para almacenar los horarios en texto.
// Se usa en validarDia() para verificar si un día seleccionado es laborable.
let horarios = '';

// Nombre de la barbería — se llena en cargarTodo() para usarlo en el email de reserva pendiente.
let _barberaNombre = '';

// Fotos del modal de galería activo — se usa para navegar con flechas en el lightbox.
let _galeriaActivaFotos = [];

// Inicializar EmailJS para enviar confirmación de solicitud al cliente.
if (typeof emailjs !== 'undefined') emailjs.init({ publicKey: config.emailJS.publicKey });

// Mapeo servicioId → array de fotos de galería asignadas a ese servicio.
// Se puebla en cargarServicios() con los datos que ya vienen del endpoint.
const _galeriasPorServicio = {};

/**
 * Convierte un color hex (#rrggbb) a "r,g,b" para usar en rgba().
 * Necesario para generar variaciones del tema_color sin librerías.
 */
function hexToRgb(hex) {
    const clean = hex.replace('#', '');
    const full = clean.length === 3
        ? clean.split('').map(c => c + c).join('')
        : clean;
    const n = parseInt(full, 16);
    return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}

function hexToHsl(hex) {
    const clean = hex.replace('#', '');
    const full = clean.length === 3 ? clean.split('').map(c => c + c).join('') : clean;
    const n = parseInt(full, 16);
    let r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    let h = 0, s = 0, l = (max + min) / 2;
    if (d) {
        s = d / (1 - Math.abs(2 * l - 1));
        switch (max) {
            case r: h = ((g - b) / d % 6) * 60; break;
            case g: h = ((b - r) / d + 2) * 60; break;
            case b: h = ((r - g) / d + 4) * 60; break;
        }
        if (h < 0) h += 360;
    }
    return [h, s, l];
}

function hslToHex(h, s, l) {
    const a = s * (l < 0.5 ? l : 1 - l);
    const f = n => {
        const k = (n + h / 30) % 12;
        const c = a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
        return Math.round(255 * (l + c)).toString(16).padStart(2, '0');
    };
    return `#${f(0)}${f(8)}${f(4)}`;
}


/* ── INTERSECTION OBSERVER PARA REVEAL ANIMATIONS ─────────────
   Observa elementos con clase .will-reveal y les agrega .revealed
   cuando entran al viewport. Se desconecta de cada elemento tras
   revelarlo para no seguir procesándolo.
   ────────────────────────────────────────────────────────────── */
const _revealObs = new IntersectionObserver((entries) => {
    entries.forEach(e => {
        if (e.isIntersecting) {
            e.target.classList.add('revealed');
            _revealObs.unobserve(e.target);
        }
    });
}, { threshold: 0.08, rootMargin: '0px 0px -30px 0px' });

function observeReveal(container) {
    container.querySelectorAll('.will-reveal').forEach(el => _revealObs.observe(el));
}



/* ── VALIDACIÓN INICIAL ───────────────────────────────────────
   Si no hay código en la URL, mostramos error y no cargamos nada.
   ────────────────────────────────────────────────────────────── */
if (!codigo) {
    document.body.innerHTML = '<div style="text-align:center;padding:100px;color:var(--text-2);"><h1 style="font-family:Playfair Display,serif;">Link inválido</h1><p style="margin-top:8px;">Verifica el enlace.</p></div>';
} else {
    cargarTodo();
}


/* ── CARGA PRINCIPAL ──────────────────────────────────────────
   Orquesta la carga inicial. Primero obtiene info general
   (necesaria para configurar el título y hero), luego carga
   servicios y reseñas en paralelo con Promise.all para reducir
   el tiempo total de carga percibido por el cliente.
   El mapa se carga después de mostrar el contenido para que
   la página sea interactiva lo antes posible (progressive loading).
   ────────────────────────────────────────────────────────────── */
async function cargarTodo() {
    try {
        const r = await fetch(`${config.apiURL}/barberias/${codigo}`);
        if (!r.ok) throw new Error();
        const b = await r.json();
        horarios = b.horarios || '';

        // ── TEMA DE COLOR PERSONALIZADO ───────────────────────────
        // Si la barbería tiene un color de identidad configurado,
        // se aplica como variable CSS en el body. Esto reemplaza el
        // dorado por defecto y da personalidad única a cada página.
        if (b.tema_color && /^#[0-9a-fA-F]{3,8}$/.test(b.tema_color)) {
            const rgb = hexToRgb(b.tema_color);
            const [h, s, l] = hexToHsl(b.tema_color);
            // Variante clara para acentos en modo oscuro (textos, precios)
            const goldLight = hslToHex(h, s, Math.min(l + 0.12, 0.88));
            // Variante oscura para modo claro (necesita contraste sobre fondo blanco)
            const goldDim   = hslToHex(h, s, Math.min(Math.max(l - 0.28, 0.18), 0.32));
            document.body.style.setProperty('--gold',       b.tema_color);
            document.body.style.setProperty('--gold-light', goldLight);
            document.body.style.setProperty('--gold-dim',   goldDim);
            document.body.style.setProperty('--gold-rgb',   rgb);
            document.body.style.setProperty('--border',     `rgba(${rgb},0.25)`);
            document.body.style.setProperty('--glow',       `0 0 32px rgba(${rgb},0.4)`);
            document.body.style.setProperty('--card-glow',  `0 0 15px rgba(${rgb},0.4)`);
        }
        // ──────────────────────────────────────────────────────────

        _barberaNombre = b.nombre;

        // Actualizar título de pestaña del navegador
        document.getElementById('pageTitle').textContent = b.nombre + ' — Barber Registro';
        document.getElementById('nombreBarberia').textContent = b.nombre;

        // Actualizar el nombre en el navbar (se muestra en la barra fija superior)
        const navBrand = document.getElementById('navBrandName');
        if (navBrand) navBrand.textContent = b.nombre;

        // Ciudad es opcional: solo la mostramos si existe
        const ciudad = b.ciudad || '';
        document.getElementById('ciudadBarberia').textContent = ciudad;
        if (ciudad) document.getElementById('ciudadWrap').style.display = 'flex';

        document.getElementById('direccionBarberia').textContent = b.direccion;
        document.getElementById('horariosInfo').textContent = b.horarios || 'No especificado';
        document.getElementById('ubicacionInfo').textContent = (b.direccion || '') + (ciudad ? '\n' + ciudad : '');

        const tel = b.dueno_telefono || '';
        document.getElementById('telefonoInfo').textContent = tel || 'No disponible';

        // Cargar servicios y reseñas en paralelo
        await Promise.all([cargarServicios(), cargarResenas()]);

        // Configurar el campo de fecha: mínimo hoy, valor default hoy
        const hoy = new Date().toISOString().split('T')[0];
        document.getElementById('fecha').min = hoy;
        document.getElementById('fecha').value = hoy;
        document.getElementById('fecha').addEventListener('change', validarDia);
        validarDia(); // Validar la fecha actual inmediatamente

        // Ocultar pantalla de carga y mostrar contenido
        document.getElementById('loading').style.display = 'none';
        document.getElementById('content').style.display = 'block';

        // Añadir reveal a elementos estáticos de la página
        ['.booking-card', '.info-strip', '.sec-head'].forEach(sel => {
            document.querySelectorAll(sel).forEach((el, i) => {
                el.classList.add('will-reveal');
                el.style.transitionDelay = `${i * 0.08}s`;
                _revealObs.observe(el);
            });
        });

        // ── MAPA DE UBICACIÓN ────────────────────────────────────
        // Después de que el contenido es visible, intentamos mostrar
        // un mapa con la ubicación de la barbería.
        // Usamos Nominatim (API gratuita de OpenStreetMap) para convertir
        // la dirección en coordenadas (geocodificación).
        // Si la dirección no se encuentra, simplemente no mostramos el mapa.
        // ──────────────────────────────────────────────────────────
        const direccionCompleta = (b.direccion || '') + ', ' + (b.ciudad || '') + ', México';
        cargarMapa(direccionCompleta);

    } catch {
        // Error de red o barbería inexistente
        document.getElementById('loading').innerHTML = '<div class="alert alert-error" style="max-width:400px;margin:0 auto;"><i class="fas fa-exclamation-circle"></i> Barbería no encontrada</div>';
    }
}


/* ── MAPA DE UBICACIÓN ────────────────────────────────────────────
   Convierte la dirección de la barbería a coordenadas usando
   Nominatim (servicio gratuito de OpenStreetMap) y muestra un
   mapa interactivo con Leaflet.js.

   También genera un link directo a Google Maps con la dirección
   para que el cliente pueda abrir la navegación fácilmente.

   Si la geocodificación falla (dirección no encontrada), el mapa
   simplemente no se muestra — no afecta el resto de la página.
   ────────────────────────────────────────────────────────────────── */
async function cargarMapa(direccion) {
    try {
        // Paso 1: Configurar el botón de Google Maps (esto funciona siempre,
        // incluso si el mapa de Leaflet falla)
        const googleUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(direccion)}`;
        const btnGM = document.getElementById('btnGoogleMaps');
        if (btnGM) btnGM.href = googleUrl;

        // Paso 2: Geocodificar la dirección con Nominatim (OpenStreetMap)
        // Nominatim convierte texto ("Av. Principal 123, Tampico") en coordenadas (lat, lng)
        const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(direccion)}&limit=1`;
        const resp = await fetch(url, {
            headers: { 'Accept-Language': 'es' } // Resultados en español
        });
        const resultados = await resp.json();

        // Si no encontró la dirección, mostrar solo el botón de Google Maps sin mapa
        if (!resultados.length) {
            document.getElementById('mapaContainer').style.display = 'block';
            document.getElementById('mapa').style.display = 'none';
            return;
        }

        // Paso 3: Extraer las coordenadas del primer resultado
        const lat = parseFloat(resultados[0].lat);
        const lng = parseFloat(resultados[0].lon);

        // Paso 4: Mostrar el contenedor y crear el mapa con Leaflet
        document.getElementById('mapaContainer').style.display = 'block';

        const mapa = L.map('mapa').setView([lat, lng], 16); // Zoom 16 = nivel de calle

        // Capa de tiles de OpenStreetMap (el fondo del mapa)
        // Usamos CartoDB Voyager (fondo claro) para que las calles
        // y nombres se vean claramente contra el fondo oscuro de la página
        L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
            attribution: '© OpenStreetMap © CartoDB',
            maxZoom: 19
        }).addTo(mapa);

        // Paso 5: Agregar un marcador (pin) en la ubicación
        L.marker([lat, lng]).addTo(mapa)
            .bindPopup(`<strong style="font-size:13px;">${document.getElementById('nombreBarberia').textContent}</strong><br><span style="font-size:12px;">${direccion}</span>`)
            .openPopup();

    } catch (e) {
        // Si algo falla (sin internet, API caída, etc), no pasa nada
        // Simplemente no se muestra el mapa
        console.log('Mapa no disponible:', e);
    }
}


/* ── VALIDAR DÍA SELECCIONADO ─────────────────────────────────
   Muestra feedback inmediato al elegir fecha para que el cliente
   sepa ANTES de enviar si la barbería está cerrada ese día.
   Evita reservas fallidas que generarían frustración y carga
   innecesaria al servidor.
   Se usa T12:00:00 al crear la Date porque sin hora explícita,
   new Date('2024-01-15') puede devolver el día anterior en
   zonas horarias negativas (como México UTC-6).
   ────────────────────────────────────────────────────────────── */
function validarDia() {
    const f = document.getElementById('fecha').value;
    const av = document.getElementById('avisoDia');
    if (!f || !horarios || !av) return;

    // Mapeo de getDay() (0=dom) a nombres en español sin acentos
    const dias = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
    const diasN = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

    // Usamos T12:00:00 para evitar problemas de timezone que pueden cambiar el día
    const idx = new Date(f + 'T12:00:00').getDay();

    // Buscar la línea de horarios que coincida con el día
    const linea = horarios.split('\n').find(l =>
        l.split(':')[0].trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '') === dias[idx]
    );

    if (linea) {
        const c = linea.substring(linea.indexOf(':') + 1).trim().toLowerCase();
        if (c === 'cerrado') {
            av.innerHTML = `<div class="alert alert-error" style="padding:8px 12px;font-size:13px;margin-top:8px;"><i class="fas fa-times-circle"></i> Cerrado los ${diasN[idx]}. Elige otro día.</div>`;
            av.style.display = 'block';
            return;
        }
        // Extraer rango de horas (ej: "09:00 - 18:00")
        const m = c.match(/(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/);
        if (m) {
            av.innerHTML = `<div class="alert-info"><i class="fas fa-clock"></i> Horario: ${m[1]} – ${m[2]}</div>`;
            av.style.display = 'block';
            return;
        }
    }
    av.style.display = 'none';
}


/* ── CARGAR SERVICIOS ─────────────────────────────────────────
   Obtiene los servicios de la API, los renderiza como cards
   interactivas. Al hacer click en una card, se selecciona el
   servicio en el <select> del formulario y se hace scroll al booking.
   ────────────────────────────────────────────────────────────── */
async function cargarServicios() {
    const cont = document.getElementById('serviciosContainer');
    const sel = document.getElementById('servicio');

    // Mostrar skeletons mientras carga para percepción de velocidad
    cont.innerHTML = Array(3).fill(`
        <div class="service-card" style="pointer-events:none;">
            <div class="skeleton" style="width:100%;aspect-ratio:16/10;border-radius:var(--radius-lg) var(--radius-lg) 0 0;"></div>
            <div style="padding:16px 18px;">
                <div class="skeleton" style="height:18px;width:68%;margin-bottom:10px;border-radius:6px;"></div>
                <div class="skeleton" style="height:12px;width:48%;margin-bottom:14px;border-radius:4px;"></div>
                <div class="skeleton" style="height:24px;width:38%;border-radius:6px;"></div>
            </div>
        </div>`).join('');

    try {
        const servicios = await (await fetch(`${config.apiURL}/barberias/${codigo}/servicios`)).json();

        if (!servicios.length) {
            cont.innerHTML = `<div class="empty-state" style="width:100%;max-width:400px;margin:0 auto;"><i class="fas fa-cut"></i><p>Esta barbería aún no tiene servicios registrados.</p></div>`;
            return;
        }

        // Determinar el servicio con más reservas para el badge Popular
        const maxReservas = Math.max(...servicios.map(s => parseInt(s.reservas_count) || 0));

        const base = config.apiURL.replace('/api', '');
        const assetUrl = (url) => /^https?:\/\//i.test(url || '') ? url : `${base}${url}`;

        // Guardar galerías por servicio para abrirlas al hacer click
        servicios.forEach(s => {
            if (s.galeria_fotos && s.galeria_fotos.length) {
                _galeriasPorServicio[s.id] = s.galeria_fotos.map(f => ({
                    url: assetUrl(f.url),
                    desc: f.desc || ''
                }));
            }
        });

        cont.innerHTML = servicios.map((s, i) => {
            // Si el servicio tiene foto asignada, mostrarla; sino mostrar un placeholder
            const _imgSrc = s.imagen_url ? assetUrl(s.imagen_url) : '';
            const imgHTML = s.imagen_url
                ? `<img src="${_imgSrc}" alt="${s.nombre}" loading="lazy" onerror="this.parentElement.innerHTML='<div class=\\'service-img-fallback\\'><i class=\\'fas fa-cut\\'></i><span>Sin foto</span></div>'">`
                : `<div class="service-img-fallback"><i class="fas fa-cut"></i><span>Sin foto</span></div>`;
            const zoomBtnHTML = s.imagen_url
                ? `<button class="srv-zoom-btn" onclick="event.stopPropagation();abrirLightbox('${_imgSrc}','${s.nombre.replace(/'/g,"\\'")}');" aria-label="Ver foto ampliada"><i class="fas fa-expand-alt"></i></button>`
                : '';
            const descHTML = s.descripcion ? `<div class="service-description">${s.descripcion}</div>` : '';
            const isPopular = maxReservas > 0 && (parseInt(s.reservas_count) || 0) === maxReservas;
            const badgeHTML = isPopular ? `<div class="badge-popular">⭐ Popular</div>` : '';
            const hasGaleria = s.galeria_fotos && s.galeria_fotos.length > 0;
            const btnFotosHTML = hasGaleria
                ? `<button class="btn-ver-fotos" onclick="event.stopPropagation();abrirGaleria(${s.id})" style="display:flex;margin-top:14px;width:100%;padding:8px;border-radius:8px;border:1px solid var(--border);background:transparent;color:var(--gold);font-size:12px;font-weight:600;cursor:pointer;gap:6px;align-items:center;justify-content:center;font-family:'DM Sans',sans-serif;transition:all var(--t);">
                        <i class="fas fa-images"></i> Ver más fotos
                    </button>`
                : '';
            return `
            <div class="service-card will-reveal" style="transition-delay:${i * 0.08}s" data-n="${s.nombre}" data-p="${s.precio}" tabindex="0" role="button" aria-label="Seleccionar servicio ${s.nombre} por $${s.precio}">
                <div class="service-img-wrapper">${badgeHTML}${imgHTML}${zoomBtnHTML}</div>
                <div class="service-body">
                    <div class="service-name">${s.nombre}</div>
                    ${descHTML}
                    <div class="service-price">$${s.precio}</div>
                    <div class="service-duration"><i class="fas fa-clock" style="font-size:10px;"></i> ${s.duracion || 30} min</div>
                    ${btnFotosHTML}
                </div>
            </div>`;
        }).join('');

        // Activar reveal animado con IntersectionObserver
        observeReveal(cont);

        // Poblar el <select> del formulario con los servicios
        sel.innerHTML = '<option value="">Selecciona un servicio</option>' +
            servicios.map(s => `<option value="${s.nombre} - $${s.precio}">${s.nombre} — $${s.precio}</option>`).join('');

        // Handler para seleccionar servicio al hacer click/Enter en la card
        cont.querySelectorAll('.service-card').forEach(c => {
            const handleSelect = function () {
                cont.querySelectorAll('.service-card').forEach(x => x.classList.remove('selected'));
                this.classList.add('selected');
                sel.value = `${this.dataset.n} - $${this.dataset.p}`;
                document.getElementById('booking').scrollIntoView({ behavior: 'smooth', block: 'start' });
                toast(`"${this.dataset.n}" seleccionado`, 'info', 2000);
            };
            c.addEventListener('click', handleSelect);
            // Soporte de teclado: activar con Enter o Space (accesibilidad C7)
            c.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleSelect.call(this);
                }
            });
        });
    } catch (e) {
        console.error('Error cargando servicios:', e);
        cont.innerHTML = '';
    }
}


/* ── CARGAR RESEÑAS ───────────────────────────────────────────
   Obtiene las reseñas públicas y las renderiza con animación
   staggered para una entrada visual suave.
   ────────────────────────────────────────────────────────────── */
async function cargarResenas() {
    const cont = document.getElementById('resenasContainer');
    cont.innerHTML = `<div class="skeleton" style="height:80px;margin-bottom:12px;"></div><div class="skeleton" style="height:80px;margin-bottom:12px;"></div>`;

    try {
        const resenas = await (await fetch(`${config.apiURL}/barberias/${codigo}/resenas`)).json();

        if (!resenas.length) {
            cont.innerHTML = `<div class="empty-state"><i class="fas fa-star"></i><p>Aún no hay reseñas. ¡Sé el primero!</p></div>`;
            return;
        }

        cont.innerHTML = resenas.map((r, i) => {
            // Formatear fecha de creación en formato legible en español
            let f = '';
            try { f = new Date(r.created_at).toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' }); } catch { }
            const stars = '★'.repeat(r.calificacion) + '<span style="color:var(--text-3);">' + '★'.repeat(5 - r.calificacion) + '</span>';
            return `<div class="review-card will-reveal" style="transition-delay:${i * 0.07}s">
                <div class="review-header">
                    <span class="review-author">${r.cliente_nombre}</span>
                    <span class="review-rating">${stars}</span>
                </div>
                <p class="review-text">${r.comentario}</p>
                <p class="review-date">${f}</p>
            </div>`;
        }).join('');

        observeReveal(cont);
    } catch (e) {
        console.error('Error cargando reseñas:', e);
        cont.innerHTML = '';
    }
}


/* ── GALERÍA POR SERVICIO ─────────────────────────────────────
   _galeriasPorServicio se declara al inicio del módulo.
   ────────────────────────────────────────────────────────────── */
window.abrirGaleria = (servicioId) => {
    const fotos = _galeriasPorServicio[servicioId] || [];
    const grid = document.getElementById('modalGaleriaGrid');
    if (!fotos.length) return;

    _galeriaActivaFotos = fotos.map(f => ({ src: f.url, alt: f.desc || '' }));
    grid.innerHTML = fotos.map((f, i) => `
        <div class="galeria-modal-item">
            <img src="${f.url}" alt="${f.desc || ''}" loading="lazy" onerror="this.parentElement.style.display='none'">
            <button class="galeria-zoom-btn" onclick="abrirLightboxGaleria(${i})" aria-label="Ver foto ampliada"><i class="fas fa-expand-alt"></i></button>
            ${f.desc ? `<div class="galeria-modal-caption">${f.desc}</div>` : ''}
        </div>`).join('');

    openModal(document.getElementById('modalGaleria'));
    document.body.style.overflow = 'hidden';
};

window.cerrarModalGaleria = (e) => {
    const modal = document.getElementById('modalGaleria');
    if (!e || e.target === modal) {
        closeModal(modal);
        document.body.style.overflow = '';
    }
};


/* ── LIGHTBOX ────────────────────────────────────────────────── */
window.abrirLightboxGaleria = (idx) => {
    abrirLightbox(_galeriaActivaFotos[idx]?.src, _galeriaActivaFotos[idx]?.alt, _galeriaActivaFotos, idx);
};
let _lbFotos = [];   // array de fotos del conjunto actual
let _lbIndex = 0;    // índice de la foto visible

function _lbMostrar(i) {
    _lbIndex = (i + _lbFotos.length) % _lbFotos.length;
    const f = _lbFotos[_lbIndex];
    const img = document.getElementById('lightboxImg');
    const caption = document.getElementById('lightboxCaption');
    img.style.opacity = '0';
    img.src = '';
    if (caption) { caption.style.opacity = '0'; caption.textContent = ''; }
    setTimeout(() => {
        img.alt = f.alt;
        img.onload = img.onerror = () => {
            img.style.opacity = '1';
            if (caption) { caption.textContent = f.alt || ''; caption.style.opacity = f.alt ? '1' : '0'; }
            img.onload = img.onerror = null;
        };
        img.src = f.src;
        if (img.complete && img.naturalWidth > 0) {
            img.style.opacity = '1';
            if (caption) { caption.textContent = f.alt || ''; caption.style.opacity = f.alt ? '1' : '0'; }
            img.onload = img.onerror = null;
        }
    }, 120);
    const nav = document.getElementById('lightboxNav');
    if (nav) nav.style.display = _lbFotos.length > 1 ? 'flex' : 'none';
}

window.abrirLightbox = (src, alt = '', fotos = null, idx = 0) => {
    _lbFotos = fotos || [{ src, alt }];
    const lb = document.getElementById('lightbox');
    lb.classList.add('open');
    document.body.style.overflow = 'hidden';
    _lbMostrar(idx);
};

window.cerrarLightbox = (e) => {
    if (e && e.target.closest && e.target.closest('.lightbox-img')) return;
    document.getElementById('lightbox').classList.remove('open');
    if (!document.querySelector('.modal-overlay.open')) document.body.style.overflow = '';
};

window.lbPrev = (e) => { e.stopPropagation(); _lbMostrar(_lbIndex - 1); };
window.lbNext = (e) => { e.stopPropagation(); _lbMostrar(_lbIndex + 1); };

document.addEventListener('keydown', e => {
    const lb = document.getElementById('lightbox');
    if (!lb.classList.contains('open')) return;
    if (e.key === 'Escape') { e.stopImmediatePropagation(); cerrarLightbox(); }
    if (e.key === 'ArrowLeft')  { e.preventDefault(); _lbMostrar(_lbIndex - 1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); _lbMostrar(_lbIndex + 1); }
}, true);


/* ── FORMULARIO DE RESERVA ────────────────────────────────────
   Envía la reserva a la API y muestra feedback al usuario.
   Pre-llena el nombre en el formulario de reseña para
   facilitar que deje una reseña después de su visita.
   ────────────────────────────────────────────────────────────── */
document.getElementById('reservaForm').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = document.getElementById('btnReservar');
    const msg = document.getElementById('mensaje');

    btn.disabled = true;
    btn.innerHTML = '<span class="loading"></span> Procesando...';
    msg.innerHTML = '';

    const datos = {
        nombre: document.getElementById('nombre').value.trim(),
        email: document.getElementById('email').value.trim(),
        telefono: document.getElementById('telefono').value.trim(),
        fecha: document.getElementById('fecha').value,
        hora: document.getElementById('hora').value,
        servicio: document.getElementById('servicio').value,
        comentarios: document.getElementById('comentarios').value.trim()
    };

    try {
        const r = await fetch(`${config.apiURL}/barberias/${codigo}/reservas`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(datos)
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || 'Error');

        // Formato de fecha legible para el mensaje de confirmación
        const fFmt = new Date(datos.fecha + 'T12:00:00').toLocaleDateString('es-MX', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
        document.getElementById('reservaForm').reset();
        document.querySelectorAll('.service-card').forEach(c => c.classList.remove('selected'));
        document.getElementById('reservaOkDetalle').innerHTML =
            `<div><i class="fas fa-cut" style="color:var(--gold);margin-right:8px;"></i><strong>Servicio:</strong> ${datos.servicio}</div>
             <div><i class="fas fa-calendar" style="color:var(--gold);margin-right:8px;"></i><strong>Fecha:</strong> ${fFmt}</div>
             <div><i class="fas fa-clock" style="color:var(--gold);margin-right:8px;"></i><strong>Hora:</strong> ${datos.hora}</div>
             <div><i class="fas fa-user" style="color:var(--gold);margin-right:8px;"></i><strong>Nombre:</strong> ${datos.nombre}</div>`;
        document.getElementById('modalReservaOk').classList.add('open');
        document.body.style.overflow = 'hidden';

        // Email automático al cliente: solicitud recibida (estado pendiente)
        if (config.emailJS.templatePendiente && typeof emailjs !== 'undefined') {
            emailjs.send(config.emailJS.serviceId, config.emailJS.templatePendiente, {
                to_email:        datos.email,
                to_name:         datos.nombre,
                servicio:        datos.servicio,
                fecha:           fFmt,
                hora:            datos.hora,
                telefono:        datos.telefono,
                comentarios:     datos.comentarios || 'Ninguno',
                barberia_nombre: _barberaNombre,
                reply_to:        datos.email
            }).catch(err => console.warn('EmailJS pendiente:', err));
        }
    } catch (e) {
        toast(e.message, 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-check"></i> Confirmar Reserva';
    }
});


/* ── FORMULARIO DE RESEÑA ─────────────────────────────────────
   Envía una nueva reseña y recarga la lista para mostrarla
   inmediatamente sin necesidad de recargar la página.
   ────────────────────────────────────────────────────────────── */
const rf = document.getElementById('resenaForm');
if (rf) rf.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = document.getElementById('btnResena');
    const msg = document.getElementById('mensajeResena');

    // Validar que haya una calificación seleccionada
    const cal = document.querySelector('input[name="cal"]:checked');
    if (!cal) {
        msg.innerHTML = '<div class="alert alert-error" style="padding:8px;"><i class="fas fa-exclamation-circle"></i> Selecciona una calificación</div>';
        return;
    }

    btn.disabled = true;
    btn.innerHTML = '<span class="loading" style="border-top-color:var(--ink);"></span> Enviando...';

    try {
        const r = await fetch(`${config.apiURL}/barberias/${codigo}/resenas`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                cliente_nombre: document.getElementById('resena_cliente').value.trim(),
                comentario: document.getElementById('resena_comentario').value.trim(),
                calificacion: parseInt(cal.value)
            })
        });
        if (!r.ok) {
            const e = await r.json();
            throw new Error(e.error);
        }
        toast('¡Gracias por tu reseña!', 'success');
        rf.reset();
        await cargarResenas(); // Recargar para mostrar la nueva reseña al instante
    } catch (e) {
        msg.innerHTML = `<div class="alert alert-error" style="padding:8px;"><i class="fas fa-exclamation-circle"></i> ${e.message}</div>`;
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-paper-plane"></i> Enviar Reseña';
    }
});
