-- RLS: permitir INSERT/UPDATE a usuarios autenticados
-- Las tablas ya tienen SELECT anónimo desde migration 00001

-- Bitácora: usuarios autenticados pueden insertar
CREATE POLICY "auth_insert_bitacora" ON bitacora FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- Umbrales: usuarios autenticados pueden actualizar
CREATE POLICY "auth_update_umbrales" ON umbrales FOR UPDATE USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

-- Configuración: usuarios autenticados pueden actualizar
CREATE POLICY "auth_update_configuracion" ON configuracion FOR UPDATE USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

-- Suscriptores: usuarios autenticados pueden insertar/actualizar
CREATE POLICY "auth_insert_suscriptores" ON suscriptores FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "auth_update_suscriptores" ON suscriptores FOR UPDATE USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

-- Equivalencia escalones: usuarios autenticados pueden actualizar
CREATE POLICY "auth_update_equivalencia" ON equivalencia_escalones FOR UPDATE USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
