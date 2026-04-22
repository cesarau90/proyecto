/**
 * config.js — Configuración central de Barber Registro.
 *
 * Este archivo centraliza:
 * - La URL de la API (cambiarla según entorno: local, ngrok, producción)
 * - Credenciales de EmailJS para notificaciones por correo
 * - Módulo `auth` para manejo de sesión (token JWT en sessionStorage)
 *
 * DESARROLLO LOCAL:
 *   const API_URL = 'http://localhost:3001/api';
 *
 * CON NGROK (para acceso público temporal):
 *   1. Ejecuta: ngrok http 3001
 *   2. Copia la URL generada y reemplaza abajo:
 *      const API_URL = 'https://TU-SUBDOMINIO.ngrok-free.app/api';
 *
 * NOTA: El frontend (Live Server en puerto 5500) NO necesita ngrok
 * si solo lo abres desde la misma computadora. Para compartir a otros
 * en tu red local usa: http://TU-IP-LOCAL:5500/frontend/barberia.html?codigo=XXXX
 */

const API_URL = 'http://localhost:3001/api';

export const config = {
    apiURL: API_URL,
    emailJS: {
        serviceId: 'service_wn05ymp',
        publicKey: 'qFJurRildjWCafr5d',
        // Template para confirmación de reserva al cliente
        templateReserva: 'template_ltyvhuj',
        // Template para registro exitoso de barbería al dueño
        templateRegistro: 'template_o3nrsar'
    }
};

/**
 * Módulo auth — Manejo de sesión basado en JWT.
 *
 * Usa sessionStorage en vez de localStorage porque la sesión se limpia
 * al cerrar la pestaña, reduciendo el riesgo de que un token robado
 * persista en el navegador indefinidamente.
 *
 * Soporta dos roles: 'dueno' (usuario dueño de barbería) y 'admin' (administrador de la plataforma).
 */
export const auth = {
    /** Guarda token, datos del usuario y rol en sessionStorage */
    guardarSesion(token, data, role) {
        sessionStorage.setItem('token', token);
        sessionStorage.setItem('userData', JSON.stringify(data));
        sessionStorage.setItem('role', role);
    },

    getToken()    { return sessionStorage.getItem('token'); },
    getRole()     { return sessionStorage.getItem('role'); },
    getUserData() { const d = sessionStorage.getItem('userData'); return d ? JSON.parse(d) : null; },
    estaLogueado(){ return !!this.getToken(); },

    /** Cierra sesión y redirige según el rol: admin va a admin.html, dueño va a login */
    logout() {
        const role = this.getRole();
        sessionStorage.clear();
        window.location.href = role === 'admin' ? 'admin.html' : 'login.html';
    },

    /** Headers estándar para peticiones autenticadas a la API */
    headers() {
        return { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.getToken()}` };
    },

    /**
     * Verifica que el token JWT siga válido con el backend.
     * Se hace en cada carga de página protegida para detectar tokens
     * expirados o revocados sin esperar a que falle una petición real.
     */
    async verificar() {
        if (!this.getToken()) return false;
        try {
            const r = await fetch(`${config.apiURL}/auth/verificar`, {
                headers: { 'Authorization': `Bearer ${this.getToken()}` }
            });
            if (!r.ok) { this.logout(); return false; }
            const d = await r.json();
            if (d.barberia)    sessionStorage.setItem('userData', JSON.stringify(d.barberia));
            if (d.admin)       sessionStorage.setItem('userData', JSON.stringify(d.admin));
            return true;
        } catch { return false; }
    }
};
