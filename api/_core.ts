// Lógica del proxy de Supabase para Agendaconmigo (api-agendaconmigo).
//
// Repo 100% autocontenido: no depende de nada del proyecto principal
// Agendaconmigo. Pensado para desplegarse como su propio proyecto Vercel
// (igual que hoy existe proxy-agendaconmigo.vercel.app como proyecto
// separado para Airtable).
//
// Seguridad:
// - Usa SIEMPRE el service_role key, nunca el anon key. Nunca se expone al cliente.
// - Exige el header "x-api-key" (SUPABASE_PROXY_API_KEY).
// - Solo permite operar sobre una lista blanca de tablas (ALLOWED_TABLES).
// - Las tablas en Supabase tienen Row Level Security activado sin policies:
//   sin este proxy (es decir, sin el service_role key), nadie puede leer ni escribir nada.

import { createClient, SupabaseClient } from '@supabase/supabase-js';

export const ALLOWED_TABLES = [
  'usuarios',
  'servicios',
  'profesionales',
  'etiquetas',
  'clientes',
  'citas',
  'inventario',
  'gastos',
  'perfiles',
  'auth_tokens',
  'postulaciones'
] as const;

export type AllowedTable = typeof ALLOWED_TABLES[number];

let cachedClient: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (cachedClient) return cachedClient;

  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error('Faltan SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY en el entorno de supabase-proxy.');
  }

  cachedClient = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  return cachedClient;
}

export function isAuthorized(apiKeyHeader: string | string[] | undefined): boolean {
  const expected = process.env.SUPABASE_PROXY_API_KEY;
  const provided = Array.isArray(apiKeyHeader) ? apiKeyHeader[0] : apiKeyHeader;
  return !!expected && !!provided && provided === expected;
}

export function isAllowedTable(table: string): table is AllowedTable {
  return (ALLOWED_TABLES as readonly string[]).includes(table);
}

export type ProxyRequest = {
  method: string;
  table: string;
  id: string | null;
  query: Record<string, string | string[] | undefined>;
  body: any;
};

export type ProxyResult = { status: number; body: any };

// Convierte parámetros de query estilo PostgREST simplificado en un query builder de Supabase.
// Soporta: ?usuario_id=eq.rec123  |  ?limit=50  |  ?order=created_at.desc
function applyFilters(builder: any, query: Record<string, string | string[] | undefined>) {
  for (const [key, rawVal] of Object.entries(query)) {
    if (rawVal === undefined) continue;
    const val = Array.isArray(rawVal) ? rawVal[0] : rawVal;

    if (key === 'limit') {
      builder = builder.limit(parseInt(val, 10) || 100);
      continue;
    }
    if (key === 'order') {
      const [col, dir] = val.split('.');
      builder = builder.order(col, { ascending: dir !== 'desc' });
      continue;
    }

    // Formato "columna=operador.valor", ej: usuario_id=eq.rec123
    const match = val.match(/^(eq|neq|gt|gte|lt|lte|like|ilike)\.(.*)$/);
    if (match) {
      const [, op, opVal] = match;
      builder = (builder as any)[op](key, opVal);
    } else {
      // Sin operador explícito: igualdad directa
      builder = builder.eq(key, val);
    }
  }
  return builder;
}

export async function handleProxyRequest(req: ProxyRequest): Promise<ProxyResult> {
  if (!isAllowedTable(req.table)) {
    return { status: 404, body: { error: `Tabla no permitida: "${req.table}". Tablas válidas: ${ALLOWED_TABLES.join(', ')}` } };
  }

  const supabase = getClient();
  const table = supabase.from(req.table);

  try {
    switch (req.method) {
      case 'GET': {
        if (req.id) {
          const { data, error } = await table.select('*').eq('id', req.id).maybeSingle();
          if (error) return { status: 500, body: { error: error.message } };
          if (!data) return { status: 404, body: { error: 'Registro no encontrado' } };
          return { status: 200, body: { data } };
        }
        // Si el caller no pidió un "limit" explícito, traemos la tabla completa
        // paginando en bloques: Supabase/PostgREST tiene un tope por defecto
        // de 1000 filas por consulta (max-rows) y lo devuelve en silencio,
        // sin error — sin esto, clientes/citas (miles de filas) quedarían
        // truncadas sin que nadie se entere.
        if (Object.prototype.hasOwnProperty.call(req.query, 'limit')) {
          let builder = table.select('*');
          builder = applyFilters(builder, req.query);
          const { data, error } = await builder;
          if (error) return { status: 500, body: { error: error.message } };
          return { status: 200, body: { data } };
        }

        const PAGE_SIZE = 1000;
        let allRows: any[] = [];
        let from = 0;
        while (true) {
          let builder = table.select('*');
          builder = applyFilters(builder, req.query);
          builder = builder.range(from, from + PAGE_SIZE - 1);
          const { data, error } = await builder;
          if (error) return { status: 500, body: { error: error.message } };
          allRows = allRows.concat(data || []);
          if (!data || data.length < PAGE_SIZE) break;
          from += PAGE_SIZE;
        }
        return { status: 200, body: { data: allRows } };
      }

      case 'POST': {
        const { data, error } = await table.insert(req.body).select();
        if (error) return { status: 400, body: { error: error.message } };
        return { status: 201, body: { data } };
      }

      case 'PATCH': {
        if (!req.id) return { status: 400, body: { error: 'Falta el id en la ruta para actualizar (ej. /api/supabase/clientes/rec123)' } };
        const { data, error } = await table.update(req.body).eq('id', req.id).select();
        if (error) return { status: 400, body: { error: error.message } };
        return { status: 200, body: { data } };
      }

      case 'DELETE': {
        if (!req.id) return { status: 400, body: { error: 'Falta el id en la ruta para eliminar' } };
        const { error } = await table.delete().eq('id', req.id);
        if (error) return { status: 400, body: { error: error.message } };
        return { status: 200, body: { ok: true } };
      }

      default:
        return { status: 405, body: { error: `Método no soportado: ${req.method}` } };
    }
  } catch (err: any) {
    return { status: 500, body: { error: err.message || 'Error interno del proxy de Supabase' } };
  }
}
