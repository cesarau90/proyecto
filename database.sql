-- BARBER REGISTRO - Sistema Multi-Barberia con Admin
-- psql -U postgres -c "CREATE DATABASE barber_registro;"
-- psql -U postgres -d barber_registro -f database.sql

CREATE TABLE IF NOT EXISTS admins (
    id SERIAL PRIMARY KEY,
    email VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    nombre VARCHAR(100) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS barberias (
    id SERIAL PRIMARY KEY,
    codigo_unico VARCHAR(20) UNIQUE NOT NULL,
    nombre VARCHAR(100) NOT NULL,
    dueno_nombre VARCHAR(100) NOT NULL,
    dueno_email VARCHAR(100) UNIQUE NOT NULL,
    dueno_telefono VARCHAR(20),
    password_hash VARCHAR(255) NOT NULL,
    direccion TEXT NOT NULL,
    ciudad VARCHAR(100),
    horarios TEXT NOT NULL,
    activa BOOLEAN DEFAULT true,
    tema_color VARCHAR(20) DEFAULT '#d4aa42',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Agregar tema_color si la tabla ya existe (migracion segura)
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='barberias' AND column_name='tema_color') THEN
        ALTER TABLE barberias ADD COLUMN tema_color VARCHAR(20) DEFAULT '#d4aa42';
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_barberias_codigo ON barberias(codigo_unico);
CREATE INDEX IF NOT EXISTS idx_barberias_email ON barberias(dueno_email);

CREATE TABLE IF NOT EXISTS servicios (
    id SERIAL PRIMARY KEY,
    barberia_id INTEGER REFERENCES barberias(id) ON DELETE CASCADE,
    nombre VARCHAR(100) NOT NULL,
    descripcion TEXT DEFAULT '',
    precio INTEGER NOT NULL,
    duracion INTEGER DEFAULT 30,
    icono VARCHAR(10) DEFAULT 'corte',
    activo BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(barberia_id, nombre)
);

CREATE TABLE IF NOT EXISTS reservas (
    id SERIAL PRIMARY KEY,
    barberia_id INTEGER REFERENCES barberias(id) ON DELETE CASCADE,
    nombre VARCHAR(100) NOT NULL,
    email VARCHAR(100) NOT NULL,
    telefono VARCHAR(20) NOT NULL,
    fecha DATE NOT NULL,
    hora TIME NOT NULL,
    servicio VARCHAR(200) NOT NULL,
    comentarios TEXT DEFAULT '',
    es_cliente_recurrente BOOLEAN DEFAULT false,
    estado VARCHAR(20) DEFAULT 'pendiente',
    notificacion_enviada BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_reservas_barberia ON reservas(barberia_id);
CREATE INDEX IF NOT EXISTS idx_reservas_fecha ON reservas(fecha);

CREATE TABLE IF NOT EXISTS resenas (
    id SERIAL PRIMARY KEY,
    barberia_id INTEGER REFERENCES barberias(id) ON DELETE CASCADE,
    reserva_id INTEGER REFERENCES reservas(id) ON DELETE SET NULL,
    cliente_nombre VARCHAR(100) NOT NULL,
    comentario TEXT NOT NULL,
    calificacion INTEGER CHECK (calificacion >= 1 AND calificacion <= 5),
    visible BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS fotos (
    id SERIAL PRIMARY KEY,
    barberia_id INTEGER REFERENCES barberias(id) ON DELETE CASCADE,
    filename VARCHAR(255) NOT NULL,
    descripcion TEXT DEFAULT '',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Funcion codigo unico
CREATE OR REPLACE FUNCTION generar_codigo_unico() RETURNS TEXT AS $$
DECLARE
    codigo TEXT;
    existe BOOLEAN;
BEGIN
    LOOP
        codigo := upper(substring(md5(random()::text) from 1 for 8));
        SELECT EXISTS(SELECT 1 FROM barberias WHERE codigo_unico = codigo) INTO existe;
        IF NOT existe THEN RETURN codigo; END IF;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION set_codigo_unico() RETURNS TRIGGER AS $$
BEGIN
    IF NEW.codigo_unico IS NULL OR NEW.codigo_unico = '' THEN
        NEW.codigo_unico := generar_codigo_unico();
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_set_codigo_unico ON barberias;
CREATE TRIGGER trigger_set_codigo_unico
    BEFORE INSERT ON barberias FOR EACH ROW EXECUTE FUNCTION set_codigo_unico();

CREATE OR REPLACE VIEW estadisticas_barberias AS
SELECT b.id, b.nombre, b.codigo_unico, b.dueno_nombre, b.dueno_email,
    b.dueno_telefono, b.direccion, b.ciudad, b.activa, b.created_at, b.horarios,
    COUNT(DISTINCT r.id) as total_reservas,
    COUNT(DISTINCT CASE WHEN r.estado = 'completada' THEN r.id END) as reservas_completadas,
    COUNT(DISTINCT s.id) as total_servicios,
    COALESCE(ROUND(AVG(re.calificacion)::numeric, 1), 0) as calificacion_promedio,
    COUNT(DISTINCT re.id) as total_resenas
FROM barberias b
LEFT JOIN reservas r ON b.id = r.barberia_id
LEFT JOIN servicios s ON b.id = s.barberia_id AND s.activo = true
LEFT JOIN resenas re ON b.id = re.barberia_id AND re.visible = true
GROUP BY b.id;
