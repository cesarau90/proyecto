import pg from 'pg';
import bcrypt from 'bcrypt';
import dotenv from 'dotenv';
dotenv.config();

const pool = new pg.Pool({
  user: process.env.DB_USER, host: process.env.DB_HOST,
  database: process.env.DB_DATABASE, password: process.env.DB_PASSWORD, port: process.env.DB_PORT
});

async function seed() {
  try {
    console.log('Insertando datos de ejemplo...\n');
    console.log('═══════════════════════════════════════');
    console.log('  CREDENCIALES DE PRUEBA');
    console.log('═══════════════════════════════════════\n');

    // ── 2 ADMINS DE PLATAFORMA ──────────────────────────
    const admins = [
      { email: 'admin@barberregistro.com', password: 'admin123', nombre: 'Administrador Principal' },
      { email: 'admin2@barberregistro.com', password: 'admin456', nombre: 'Administrador Secundario' }
    ];

    for (const a of admins) {
      const existe = await pool.query("SELECT id FROM admins WHERE email = $1", [a.email]);
      if (existe.rows.length === 0) {
        const hash = await bcrypt.hash(a.password, 10);
        await pool.query("INSERT INTO admins (email, password_hash, nombre) VALUES ($1, $2, $3)", [a.email, hash, a.nombre]);
      }
      console.log(`  ROL: Admin`);
      console.log(`  Email:    ${a.email}`);
      console.log(`  Password: ${a.password}\n`);
    }

    // ── 2 USUARIOS (dueños de barbería) ─────────────────
    const barberias = [
      {
        codigo: 'DEMO2024', nombre: 'Barbería El Clásico', dueno: 'Juan Pérez',
        email: 'juan@barberia.com', tel: '+52 833 123 4567', password: 'demo123',
        direccion: 'Av. Hidalgo 123, Col. Centro', ciudad: 'Tampico',
        horarios: 'Lunes: 09:00 - 18:00\nMartes: 09:00 - 18:00\nMiércoles: 09:00 - 18:00\nJueves: 09:00 - 18:00\nViernes: 09:00 - 18:00\nSábado: 09:00 - 14:00\nDomingo: Cerrado'
      },
      {
        codigo: 'DEMO2025', nombre: 'BarberShop Premium', dueno: 'Carlos López',
        email: 'carlos@barberia.com', tel: '+52 833 987 6543', password: 'demo456',
        direccion: 'Blvd. López Mateos 456', ciudad: 'Altamira',
        horarios: 'Lunes: 10:00 - 20:00\nMartes: 10:00 - 20:00\nMiércoles: 10:00 - 20:00\nJueves: 10:00 - 20:00\nViernes: 10:00 - 21:00\nSábado: 09:00 - 17:00\nDomingo: Cerrado'
      }
    ];

    for (const b of barberias) {
      const existe = await pool.query("SELECT id FROM barberias WHERE codigo_unico = $1", [b.codigo]);
      if (existe.rows.length > 0) {
        console.log(`  ROL: Usuario (dueño)`);
        console.log(`  Barbería: ${b.nombre} — ya existe\n`);
        continue;
      }

      const hash = await bcrypt.hash(b.password, 10);
      const result = await pool.query(
        `INSERT INTO barberias (codigo_unico, nombre, dueno_nombre, dueno_email, dueno_telefono, password_hash, direccion, ciudad, horarios)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [b.codigo, b.nombre, b.dueno, b.email, b.tel, hash, b.direccion, b.ciudad, b.horarios]
      );
      const id = result.rows[0].id;

      console.log(`  ROL: Usuario (dueño)`);
      console.log(`  Barbería: ${b.nombre}`);
      console.log(`  Email:    ${b.email}`);
      console.log(`  Password: ${b.password}\n`);

      // Servicios de ejemplo
      if (b.codigo === 'DEMO2024') {
        await pool.query(`INSERT INTO servicios (barberia_id, nombre, descripcion, precio, duracion, icono) VALUES
          ($1, 'Corte Clásico', 'Corte tradicional con tijera y máquina', 150, 30, 'corte'),
          ($1, 'Corte + Barba', 'Corte completo más arreglo de barba', 250, 45, 'barba'),
          ($1, 'Afeitado Premium', 'Afeitado con navaja y toalla caliente', 200, 30, 'afeitado')`, [id]);

        // Reservas de ejemplo para tener historial
        await pool.query(`INSERT INTO reservas (barberia_id, nombre, email, telefono, fecha, hora, servicio, estado, comentarios) VALUES
          ($1, 'Miguel Torres', 'miguel@mail.com', '+52 833 111 2222', '2025-03-10', '10:00', 'Corte Clásico - $150', 'completada', 'Primera visita'),
          ($1, 'Roberto García', 'roberto@mail.com', '+52 833 333 4444', '2025-03-12', '11:30', 'Corte + Barba - $250', 'completada', ''),
          ($1, 'Luis Hernández', 'luis@mail.com', '+52 833 555 6666', '2025-03-15', '09:00', 'Afeitado Premium - $200', 'confirmada', 'Quiero toalla extra caliente'),
          ($1, 'Pedro Martínez', 'pedro@mail.com', '+52 833 777 8888', '2025-03-20', '16:00', 'Corte Clásico - $150', 'pendiente', ''),
          ($1, 'Ana Ruiz', 'ana@mail.com', '+52 833 999 0000', '2025-03-08', '14:00', 'Corte + Barba - $250', 'cancelada', 'No pude asistir')`, [id]);

        await pool.query(`INSERT INTO resenas (barberia_id, reserva_id, cliente_nombre, comentario, calificacion) VALUES
          ($1, NULL, 'Carlos M.', 'Excelente servicio, muy profesional. Recomendado!', 5),
          ($1, NULL, 'Luis G.', 'Me gustó mucho el corte, el barbero es muy atento.', 5),
          ($1, NULL, 'Roberto S.', 'Buen servicio y precio justo. Regresaré.', 4)`, [id]);
      }

      if (b.codigo === 'DEMO2025') {
        await pool.query(`INSERT INTO servicios (barberia_id, nombre, descripcion, precio, duracion, icono) VALUES
          ($1, 'Fade Moderno', 'Degradado con diseño personalizado', 180, 40, 'corte'),
          ($1, 'Barba Completa', 'Perfilado y arreglo de barba con aceites', 120, 25, 'barba'),
          ($1, 'Paquete VIP', 'Corte + barba + mascarilla facial + masaje', 400, 60, 'corte')`, [id]);

        await pool.query(`INSERT INTO reservas (barberia_id, nombre, email, telefono, fecha, hora, servicio, estado, comentarios) VALUES
          ($1, 'Diego Sánchez', 'diego@mail.com', '+52 833 222 3333', '2025-03-11', '12:00', 'Fade Moderno - $180', 'completada', ''),
          ($1, 'Fernando Ríos', 'fernando@mail.com', '+52 833 444 5555', '2025-03-14', '15:00', 'Paquete VIP - $400', 'confirmada', 'Es mi cumpleaños'),
          ($1, 'Javier Mora', 'javier@mail.com', '+52 833 666 7777', '2025-03-18', '10:30', 'Barba Completa - $120', 'pendiente', '')`, [id]);

        await pool.query(`INSERT INTO resenas (barberia_id, reserva_id, cliente_nombre, comentario, calificacion) VALUES
          ($1, NULL, 'Diego S.', 'El mejor fade que me han hecho, 100% recomendado.', 5),
          ($1, NULL, 'Fernando R.', 'Paquete VIP increíble, muy relajante.', 5)`, [id]);
      }
    }

    console.log('═══════════════════════════════════════');
    console.log('  Seed completado!');
    console.log('═══════════════════════════════════════\n');
  } catch (e) { console.error('Error:', e.message); }
  finally { await pool.end(); }
}
seed();
