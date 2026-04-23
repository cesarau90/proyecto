/**
 * server.js — Backend API de Barber Registro.
 *
 * Stack: Express + PostgreSQL + JWT + bcrypt + multer.
 *
 * Estructura de rutas:
 * - /api/auth/*           → Registro, login, verificación de sesión
 * - /api/barberias/:code  → Rutas públicas (cualquiera puede ver)
 * - /api/mi-barberia/*    → Rutas autenticadas del dueño (requiere JWT)
 * - /api/admin/*          → Rutas del admin de plataforma (requiere JWT + role)
 *
 * Decisiones de seguridad:
 * - Passwords con bcrypt salt=10 (balance entre seguridad y velocidad;
 *   más alto haría el registro demasiado lento en hardware básico)
 * - JWT con expiración de 7 días porque los dueños de barberías
 *   acceden esporádicamente y re-login frecuente genera abandono
 * - Upload limitado a 5MB y solo JPEG/PNG/WEBP para prevenir
 *   almacenamiento excesivo y archivos ejecutables disfrazados
 */

import express from 'express';
import cors from 'cors';
import pg from 'pg';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import { existsSync, mkdirSync, unlinkSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadsDir = path.join(__dirname, 'uploads');
if (!existsSync(uploadsDir)) mkdirSync(uploadsDir, { recursive: true });

const { Pool } = pg;
const app = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'cambiar';

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(uploadsDir));

const pool = new Pool({
  user: process.env.DB_USER, host: process.env.DB_HOST,
  database: process.env.DB_DATABASE, password: process.env.DB_PASSWORD, port: process.env.DB_PORT
});

pool.connect(async (err, client, release) => {
  if (err) { console.error('Error DB:', err.message); return; }
  console.log('DB conectada');
  // Migración segura: agrega tema_color si no existe aún
  try {
    await client.query(`
      ALTER TABLE barberias ADD COLUMN IF NOT EXISTS tema_color VARCHAR(20) DEFAULT '#c9a847'
    `);
  } catch (e) { /* columna ya existe o no es postgres 9.6+, ignorar */ }
  release();
});

// === HELPERS ===
function validarCampos(campos, body) {
  const f = campos.filter(c => !body[c] || String(body[c]).trim() === '');
  return f.length > 0 ? `Faltan: ${f.join(', ')}` : null;
}

function generarToken(payload, expiresIn = '7d') {
  return jwt.sign(payload, JWT_SECRET, { expiresIn });
}

function authMiddleware(req, res, next) {
  const h = req.headers.authorization;
  if (!h || !h.startsWith('Bearer ')) return res.status(401).json({ error: 'No autorizado' });
  try { req.user = jwt.verify(h.split(' ')[1], JWT_SECRET); next(); }
  catch { return res.status(401).json({ error: 'Sesion expirada' }); }
}

function adminMiddleware(req, res, next) {
  if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'Acceso denegado' });
  next();
}

// === AUTH DUENOS (usuarios dueños de barbería) ===
app.post('/api/auth/registro', async (req, res) => {
  const { nombre, dueno_nombre, dueno_email, dueno_telefono, password, direccion, ciudad, horarios } = req.body;
  const err = validarCampos(['nombre','dueno_nombre','dueno_email','password','direccion','horarios'], req.body);
  if (err) return res.status(400).json({ error: err });
  if (password.length < 6) return res.status(400).json({ error: 'Contrasena minimo 6 caracteres' });

  try {
    const existe = await pool.query('SELECT id FROM barberias WHERE dueno_email = $1', [dueno_email.trim().toLowerCase()]);
    if (existe.rows.length > 0) return res.status(400).json({ error: 'Ya existe una cuenta con ese email' });
    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO barberias (nombre, dueno_nombre, dueno_email, dueno_telefono, password_hash, direccion, ciudad, horarios)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, codigo_unico, nombre, dueno_nombre, dueno_email`,
      [nombre.trim(), dueno_nombre.trim(), dueno_email.trim().toLowerCase(), dueno_telefono||'', hash, direccion.trim(), ciudad||'', horarios]
    );
    const b = result.rows[0];
    res.status(201).json({ token: generarToken({ id: b.id, codigo: b.codigo_unico, email: b.dueno_email, role: 'dueno' }),
      barberia: { id: b.id, codigo_unico: b.codigo_unico, nombre: b.nombre, dueno_nombre: b.dueno_nombre, dueno_email: b.dueno_email }
    });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Error al registrar' }); }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email y contrasena requeridos' });
  try {
    const r = await pool.query('SELECT * FROM barberias WHERE dueno_email = $1 AND activa = true', [email.trim().toLowerCase()]);
    if (r.rows.length === 0) return res.status(401).json({ error: 'Credenciales incorrectas' });
    const b = r.rows[0];
    if (!(await bcrypt.compare(password, b.password_hash))) return res.status(401).json({ error: 'Credenciales incorrectas' });
    res.json({ token: generarToken({ id: b.id, codigo: b.codigo_unico, email: b.dueno_email, role: 'dueno' }),
      barberia: { id: b.id, codigo_unico: b.codigo_unico, nombre: b.nombre, dueno_nombre: b.dueno_nombre, dueno_email: b.dueno_email }
    });
  } catch (e) { res.status(500).json({ error: 'Error al iniciar sesion' }); }
});

app.get('/api/auth/verificar', authMiddleware, async (req, res) => {
  try {
    if (req.user.role === 'admin') {
      const r = await pool.query('SELECT id, email, nombre FROM admins WHERE id = $1', [req.user.id]);
      return r.rows.length ? res.json({ admin: r.rows[0], role: 'admin' }) : res.status(401).json({ error: 'No encontrado' });
    }
    const r = await pool.query('SELECT id, codigo_unico, nombre, dueno_nombre, dueno_email FROM barberias WHERE id = $1 AND activa = true', [req.user.id]);
    r.rows.length ? res.json({ barberia: r.rows[0], role: 'dueno' }) : res.status(401).json({ error: 'No encontrada' });
  } catch { res.status(500).json({ error: 'Error' }); }
});

// === AUTH ADMIN (administrador de la plataforma) ===
app.post('/api/auth/admin/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email y contrasena requeridos' });
  try {
    const r = await pool.query('SELECT * FROM admins WHERE email = $1', [email.trim().toLowerCase()]);
    if (r.rows.length === 0) return res.status(401).json({ error: 'Credenciales incorrectas' });
    const admin = r.rows[0];
    if (!(await bcrypt.compare(password, admin.password_hash))) return res.status(401).json({ error: 'Credenciales incorrectas' });
    res.json({ token: generarToken({ id: admin.id, email: admin.email, role: 'admin' }), admin: { id: admin.id, email: admin.email, nombre: admin.nombre } });
  } catch { res.status(500).json({ error: 'Error' }); }
});

// === RUTAS PUBLICAS ===

// Directorio público: lista todas las barberías activas (para buscador en index.html)
app.get('/api/barberias', async (req, res) => {
  try {
    const r = await pool.query(
      'SELECT codigo_unico, nombre, ciudad, direccion FROM barberias WHERE activa = true ORDER BY nombre'
    );
    res.json(r.rows);
  } catch { res.status(500).json({ error: 'Error' }); }
});

app.get('/api/barberias/:codigo', async (req, res) => {
  try {
    let r;
    try {
      r = await pool.query('SELECT id, codigo_unico, nombre, dueno_telefono, direccion, ciudad, horarios, tema_color FROM barberias WHERE codigo_unico = $1 AND activa = true', [req.params.codigo]);
    } catch {
      // Fallback: la columna tema_color aún no existe (migración pendiente)
      r = await pool.query('SELECT id, codigo_unico, nombre, dueno_telefono, direccion, ciudad, horarios FROM barberias WHERE codigo_unico = $1 AND activa = true', [req.params.codigo]);
    }
    r.rows.length ? res.json(r.rows[0]) : res.status(404).json({ error: 'No encontrada' });
  } catch { res.status(500).json({ error: 'Error' }); }
});

app.get('/api/barberias/:codigo/servicios', async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT s.*, f.filename as foto_filename,
             COALESCE(
               (SELECT COUNT(*) FROM reservas r
                WHERE r.barberia_id = s.barberia_id
                  AND SPLIT_PART(r.servicio, ' - $', 1) = s.nombre),
               0
             ) AS reservas_count
      FROM servicios s
      JOIN barberias b ON s.barberia_id=b.id
      LEFT JOIN fotos f ON s.foto_id = f.id
      WHERE b.codigo_unico=$1 AND s.activo=true ORDER BY s.id`, [req.params.codigo]);
    const rows = r.rows.map(s => ({ ...s, imagen_url: s.foto_filename ? `/uploads/${s.barberia_id}/${s.foto_filename}` : null }));
    res.json(rows);
  } catch { res.status(500).json({ error: 'Error' }); }
});

app.get('/api/barberias/:codigo/resenas', async (req, res) => {
  try {
    const r = await pool.query('SELECT r.* FROM resenas r JOIN barberias b ON r.barberia_id=b.id WHERE b.codigo_unico=$1 AND r.visible=true ORDER BY r.created_at DESC LIMIT 10', [req.params.codigo]);
    res.json(r.rows);
  } catch { res.status(500).json({ error: 'Error' }); }
});

app.get('/api/barberias/:codigo/fotos', async (req, res) => {
  try {
    const br = await pool.query('SELECT id FROM barberias WHERE codigo_unico=$1', [req.params.codigo]);
    if (!br.rows.length) return res.status(404).json({ error: 'No encontrada' });
    const r = await pool.query('SELECT * FROM fotos WHERE barberia_id=$1 ORDER BY created_at DESC', [br.rows[0].id]);
    res.json(r.rows.map(f => ({ ...f, url: `/uploads/${br.rows[0].id}/${f.filename}` })));
  } catch { res.status(500).json({ error: 'Error' }); }
});

// Crear reserva con validacion de horario
app.post('/api/barberias/:codigo/reservas', async (req, res) => {
  const { nombre, email, telefono, fecha, hora, servicio, comentarios, es_cliente_recurrente } = req.body;
  const err = validarCampos(['nombre','email','telefono','fecha','hora','servicio'], req.body);
  if (err) return res.status(400).json({ error: err });

  try {
    const br = await pool.query('SELECT * FROM barberias WHERE codigo_unico=$1', [req.params.codigo]);
    if (!br.rows.length) return res.status(404).json({ error: 'No encontrada' });
    const barberia = br.rows[0];

    // ISO string comparison works for YYYY-MM-DD: lexicographic order matches chronological order
    if (fecha < new Date().toISOString().split('T')[0]) return res.status(400).json({ error: 'No puedes reservar en fecha pasada' });

    // Hora fijada a mediodía (T12:00:00) para que getDay() devuelva el día correcto en cualquier zona horaria
    if (barberia.horarios) {
      const dias = ['domingo','lunes','martes','miercoles','jueves','viernes','sabado'];
      const diasN = ['Domingo','Lunes','Martes','Miercoles','Jueves','Viernes','Sabado'];
      const fObj = new Date(fecha + 'T12:00:00');
      const dIdx = fObj.getDay();
      const lineas = barberia.horarios.split('\n');
      const linea = lineas.find(l => l.split(':')[0].trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'') === dias[dIdx]);
      if (linea) {
        const cont = linea.substring(linea.indexOf(':') + 1).trim().toLowerCase();
        if (cont === 'cerrado') return res.status(400).json({ error: `Cerrado los ${diasN[dIdx]}. Elige otro dia.` });
        const m = cont.match(/(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/);
        if (m && hora) {
          const hr = hora.replace(':',''), ha = m[1].replace(':',''), hc = m[2].replace(':','');
          if (hr < ha || hr >= hc) return res.status(400).json({ error: `Horario: ${m[1]} a ${m[2]}. Elige hora dentro del horario.` });
        }
      }
    }

    // Excluir canceladas: un slot liberado por cancelación debe poder reservarse de nuevo
    const dup = await pool.query("SELECT id FROM reservas WHERE barberia_id=$1 AND fecha=$2 AND hora=$3 AND estado!='cancelada'", [barberia.id, fecha, hora]);
    if (dup.rows.length) return res.status(400).json({ error: 'Ya hay reserva en esa fecha y hora' });

    // Máximo 5 citas en la misma hora (ej: todas las de las 09:xx cuentan juntas)
    const porHora = await pool.query(
      "SELECT COUNT(*) FROM reservas WHERE barberia_id=$1 AND fecha=$2 AND EXTRACT(HOUR FROM hora)=EXTRACT(HOUR FROM $3::time) AND estado!='cancelada'",
      [barberia.id, fecha, hora]
    );
    if (parseInt(porHora.rows[0].count) >= 5) return res.status(400).json({ error: 'Ya hay 5 citas agendadas en esa hora. Elige otra hora.' });

    const r = await pool.query(
      'INSERT INTO reservas (barberia_id,nombre,email,telefono,fecha,hora,servicio,comentarios,es_cliente_recurrente) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',
      [barberia.id, nombre.trim(), email.trim(), telefono.trim(), fecha, hora, servicio, comentarios||'', es_cliente_recurrente||false]
    );
    res.status(201).json({ ...r.rows[0], barberia_nombre: barberia.nombre, barberia_direccion: barberia.direccion,
      barberia_ciudad: barberia.ciudad, barberia_telefono: barberia.dueno_telefono, barberia_email: barberia.dueno_email, barberia_dueno: barberia.dueno_nombre });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Error al crear reserva' }); }
});

app.post('/api/barberias/:codigo/resenas', async (req, res) => {
  const { cliente_nombre, comentario, calificacion } = req.body;
  const err = validarCampos(['cliente_nombre','comentario','calificacion'], req.body);
  if (err) return res.status(400).json({ error: err });
  if (calificacion < 1 || calificacion > 5) return res.status(400).json({ error: 'Calificacion 1-5' });
  try {
    const br = await pool.query('SELECT id FROM barberias WHERE codigo_unico=$1', [req.params.codigo]);
    if (!br.rows.length) return res.status(404).json({ error: 'No encontrada' });
    const r = await pool.query('INSERT INTO resenas (barberia_id,cliente_nombre,comentario,calificacion) VALUES($1,$2,$3,$4) RETURNING *',
      [br.rows[0].id, cliente_nombre.trim(), comentario.trim(), parseInt(calificacion)]);
    res.status(201).json(r.rows[0]);
  } catch { res.status(500).json({ error: 'Error' }); }
});

// === RUTAS DUENO (protegidas) ===
app.get('/api/mi-barberia', authMiddleware, async (req, res) => {
  try {
    let r;
    try {
      r = await pool.query('SELECT id,codigo_unico,nombre,dueno_nombre,dueno_email,dueno_telefono,direccion,ciudad,horarios,tema_color,created_at FROM barberias WHERE id=$1', [req.user.id]);
    } catch {
      r = await pool.query('SELECT id,codigo_unico,nombre,dueno_nombre,dueno_email,dueno_telefono,direccion,ciudad,horarios,created_at FROM barberias WHERE id=$1', [req.user.id]);
    }
    r.rows.length ? res.json(r.rows[0]) : res.status(404).json({ error: 'No encontrada' });
  } catch { res.status(500).json({ error: 'Error' }); }
});

app.put('/api/mi-barberia', authMiddleware, async (req, res) => {
  const { nombre, dueno_telefono, direccion, ciudad, horarios, tema_color } = req.body;
  try {
    const r = await pool.query(`UPDATE barberias SET nombre=COALESCE($1,nombre), dueno_telefono=COALESCE($2,dueno_telefono),
      direccion=COALESCE($3,direccion), ciudad=COALESCE($4,ciudad), horarios=COALESCE($5,horarios),
      tema_color=COALESCE($6,tema_color), updated_at=CURRENT_TIMESTAMP
      WHERE id=$7 RETURNING id,codigo_unico,nombre,dueno_nombre,dueno_email,dueno_telefono,direccion,ciudad,horarios,tema_color`,
      [nombre, dueno_telefono, direccion, ciudad, horarios, tema_color, req.user.id]);
    res.json(r.rows[0]);
  } catch { res.status(500).json({ error: 'Error' }); }
});

app.get('/api/mi-barberia/servicios', authMiddleware, async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT s.*, f.filename as foto_filename
      FROM servicios s
      LEFT JOIN fotos f ON s.foto_id = f.id
      WHERE s.barberia_id=$1 AND s.activo=true ORDER BY s.id`, [req.user.id]);
    const rows = r.rows.map(s => ({ ...s, imagen_url: s.foto_filename ? `/uploads/${s.barberia_id}/${s.foto_filename}` : null }));
    res.json(rows);
  } catch { res.status(500).json({ error: 'Error' }); }
});

app.post('/api/mi-barberia/servicios', authMiddleware, async (req, res) => {
  const { nombre, descripcion, precio, duracion, icono } = req.body;
  if (!nombre || !precio) return res.status(400).json({ error: 'Nombre y precio requeridos' });
  try {
    const r = await pool.query('INSERT INTO servicios (barberia_id,nombre,descripcion,precio,duracion,icono) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',
      [req.user.id, nombre.trim(), descripcion||'', parseInt(precio), parseInt(duracion)||30, icono||'corte']);
    res.status(201).json(r.rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'Ya existe ese servicio' });
    res.status(500).json({ error: 'Error' });
  }
});

/* Soft-delete (activo=false) en vez de DELETE real porque las reservas
   existentes referencian el nombre del servicio como texto. Borrar el
   servicio rompería el historial de reservas completadas. */
app.delete('/api/mi-barberia/servicios/:id', authMiddleware, async (req, res) => {
  try {
    const s = await pool.query('SELECT barberia_id FROM servicios WHERE id=$1', [req.params.id]);
    if (!s.rows.length || s.rows[0].barberia_id !== req.user.id) return res.status(403).json({ error: 'Sin permiso' });
    await pool.query('UPDATE servicios SET activo=false WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Error' }); }
});

// Vincular foto a servicio
app.patch('/api/mi-barberia/servicios/:id/foto', authMiddleware, async (req, res) => {
  try {
    const { foto_id } = req.body;
    const s = await pool.query('SELECT barberia_id FROM servicios WHERE id=$1', [req.params.id]);
    if (!s.rows.length || s.rows[0].barberia_id !== req.user.id) return res.status(403).json({ error: 'Sin permiso' });
    // Asegurar que la columna existe (migration en caliente)
    await pool.query(`ALTER TABLE servicios ADD COLUMN IF NOT EXISTS foto_id INTEGER REFERENCES fotos(id) ON DELETE SET NULL`);
    const r = await pool.query('UPDATE servicios SET foto_id=$1 WHERE id=$2 RETURNING *', [foto_id || null, req.params.id]);
    res.json(r.rows[0]);
  } catch { res.status(500).json({ error: 'Error' }); }
});

app.get('/api/mi-barberia/reservas', authMiddleware, async (req, res) => {
  try { res.json((await pool.query('SELECT * FROM reservas WHERE barberia_id=$1 ORDER BY fecha DESC, hora DESC', [req.user.id])).rows); }
  catch { res.status(500).json({ error: 'Error' }); }
});

app.patch('/api/mi-barberia/reservas/:id/estado', authMiddleware, async (req, res) => {
  const validos = ['pendiente','confirmada','cancelada','completada'];
  if (!validos.includes(req.body.estado)) return res.status(400).json({ error: 'Estado invalido' });
  try {
    const rv = await pool.query('SELECT barberia_id FROM reservas WHERE id=$1', [req.params.id]);
    if (!rv.rows.length || rv.rows[0].barberia_id !== req.user.id) return res.status(403).json({ error: 'Sin permiso' });
    const r = await pool.query('UPDATE reservas SET estado=$1 WHERE id=$2 RETURNING *', [req.body.estado, req.params.id]);
    res.json(r.rows[0]);
  } catch { res.status(500).json({ error: 'Error' }); }
});

app.delete('/api/mi-barberia/reservas/:id', authMiddleware, async (req, res) => {
  try {
    const rv = await pool.query('SELECT barberia_id FROM reservas WHERE id=$1', [req.params.id]);
    if (!rv.rows.length || rv.rows[0].barberia_id !== req.user.id) return res.status(403).json({ error: 'Sin permiso' });
    await pool.query('DELETE FROM reservas WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Error' }); }
});

app.get('/api/mi-barberia/resenas', authMiddleware, async (req, res) => {
  try { res.json((await pool.query('SELECT * FROM resenas WHERE barberia_id=$1 ORDER BY created_at DESC', [req.user.id])).rows); }
  catch { res.status(500).json({ error: 'Error' }); }
});

// Fotos dueno
app.post('/api/mi-barberia/fotos', authMiddleware, async (req, res) => {
  const multer = (await import('multer')).default;
  const storage = multer.diskStorage({
    destination: (r, f, cb) => { const d = path.join(uploadsDir, String(req.user.id)); if (!existsSync(d)) mkdirSync(d, { recursive: true }); cb(null, d); },
    filename: (r, f, cb) => cb(null, `foto_${Date.now()}${path.extname(f.originalname)}`)
  });
  multer({ storage, limits: { fileSize: 5*1024*1024 },
    fileFilter: (r, f, cb) => ['image/jpeg','image/png','image/webp'].includes(f.mimetype) ? cb(null, true) : cb(new Error('Solo JPG, PNG o WEBP'))
  }).single('foto')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'Sin imagen' });
    try {
      const r = await pool.query('INSERT INTO fotos (barberia_id,filename,descripcion) VALUES($1,$2,$3) RETURNING *',
        [req.user.id, req.file.filename, (req.body.descripcion||'').trim()]);
      res.status(201).json({ ...r.rows[0], url: `/uploads/${req.user.id}/${req.file.filename}` });
    } catch { res.status(500).json({ error: 'Error' }); }
  });
});

app.get('/api/mi-barberia/fotos', authMiddleware, async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM fotos WHERE barberia_id=$1 ORDER BY created_at DESC', [req.user.id]);
    res.json(r.rows.map(f => ({ ...f, url: `/uploads/${req.user.id}/${f.filename}` })));
  } catch { res.status(500).json({ error: 'Error' }); }
});

app.delete('/api/mi-barberia/fotos/:id', authMiddleware, async (req, res) => {
  try {
    const f = await pool.query('SELECT * FROM fotos WHERE id=$1 AND barberia_id=$2', [req.params.id, req.user.id]);
    if (!f.rows.length) return res.status(403).json({ error: 'Sin permiso' });
    const fp = path.join(uploadsDir, String(req.user.id), f.rows[0].filename);
    if (existsSync(fp)) unlinkSync(fp);
    await pool.query('DELETE FROM fotos WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'Error' }); }
});

// === RUTAS ADMIN (administrador de la plataforma) ===
app.get('/api/admin/barberias', authMiddleware, adminMiddleware, async (req, res) => {
  try { res.json((await pool.query('SELECT * FROM estadisticas_barberias ORDER BY created_at DESC')).rows); }
  catch { res.status(500).json({ error: 'Error' }); }
});

app.get('/api/admin/barberias/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM barberias WHERE id=$1', [req.params.id]);
    r.rows.length ? res.json(r.rows[0]) : res.status(404).json({ error: 'No encontrada' });
  } catch { res.status(500).json({ error: 'Error' }); }
});

app.put('/api/admin/barberias/:id', authMiddleware, adminMiddleware, async (req, res) => {
  const { nombre, direccion, ciudad, horarios, activa, dueno_telefono } = req.body;
  try {
    const r = await pool.query(`UPDATE barberias SET nombre=COALESCE($1,nombre), direccion=COALESCE($2,direccion),
      ciudad=COALESCE($3,ciudad), horarios=COALESCE($4,horarios), activa=COALESCE($5,activa),
      dueno_telefono=COALESCE($6,dueno_telefono), updated_at=CURRENT_TIMESTAMP
      WHERE id=$7 RETURNING *`, [nombre, direccion, ciudad, horarios, activa, dueno_telefono, req.params.id]);
    r.rows.length ? res.json(r.rows[0]) : res.status(404).json({ error: 'No encontrada' });
  } catch { res.status(500).json({ error: 'Error' }); }
});

app.get('/api/admin/barberias/:id/reservas', authMiddleware, adminMiddleware, async (req, res) => {
  try { res.json((await pool.query('SELECT * FROM reservas WHERE barberia_id=$1 ORDER BY fecha DESC', [req.params.id])).rows); }
  catch { res.status(500).json({ error: 'Error' }); }
});

/* Admin puede cambiar el estado de cualquier reserva */
app.patch('/api/admin/reservas/:id/estado', authMiddleware, adminMiddleware, async (req, res) => {
  const validos = ['pendiente','confirmada','cancelada','completada'];
  if (!validos.includes(req.body.estado)) return res.status(400).json({ error: 'Estado invalido' });
  try {
    const r = await pool.query('UPDATE reservas SET estado=$1 WHERE id=$2 RETURNING *', [req.body.estado, req.params.id]);
    r.rows.length ? res.json(r.rows[0]) : res.status(404).json({ error: 'Reserva no encontrada' });
  } catch { res.status(500).json({ error: 'Error' }); }
});

/* Admin puede eliminar cualquier reserva */
app.delete('/api/admin/reservas/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const r = await pool.query('DELETE FROM reservas WHERE id=$1 RETURNING id', [req.params.id]);
    r.rows.length ? res.json({ ok: true }) : res.status(404).json({ error: 'Reserva no encontrada' });
  } catch { res.status(500).json({ error: 'Error' }); }
});

app.get('/api/admin/barberias/:id/servicios', authMiddleware, adminMiddleware, async (req, res) => {
  try { res.json((await pool.query('SELECT * FROM servicios WHERE barberia_id=$1 AND activo=true ORDER BY id', [req.params.id])).rows); }
  catch { res.status(500).json({ error: 'Error' }); }
});

app.get('/api/admin/stats', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const barberias = (await pool.query('SELECT COUNT(*) FROM barberias')).rows[0].count;
    const reservas = (await pool.query('SELECT COUNT(*) FROM reservas')).rows[0].count;
    const activas = (await pool.query('SELECT COUNT(*) FROM barberias WHERE activa=true')).rows[0].count;
    res.json({ barberias: parseInt(barberias), reservas: parseInt(reservas), activas: parseInt(activas) });
  } catch { res.status(500).json({ error: 'Error' }); }
});

app.get('/', (req, res) => res.json({ message: 'Barber Registro API v4.0' }));

app.listen(PORT, () => console.log(`\nBarber Registro API en http://localhost:${PORT}\n`));