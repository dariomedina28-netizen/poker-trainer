import { createClient } from "@supabase/supabase-js";

// Cliente Supabase (solo lectura/escritura anónima, sin auth en esta fase).
// Las credenciales vienen de .env.local (prefijo REACT_APP_ obligatorio en CRA).
const url = process.env.REACT_APP_SUPABASE_URL;
const anonKey = process.env.REACT_APP_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  // No rompemos la app: la persistencia es una capa adicional (Fase C).
  console.warn(
    "[supabase] Faltan REACT_APP_SUPABASE_URL o REACT_APP_SUPABASE_ANON_KEY en .env.local — la persistencia queda desactivada."
  );
}

export const supabase = url && anonKey ? createClient(url, anonKey) : null;
