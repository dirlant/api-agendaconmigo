// Handler serverless (Vercel). Rutas esperadas, una vez desplegado este
// proyecto de forma independiente (ver vercel.json en esta misma carpeta):
//
//   GET    /api/supabase/:table              -> lista (con filtros vía query string)
//   GET    /api/supabase/:table/:id           -> un registro
//   POST   /api/supabase/:table               -> insertar
//   PATCH  /api/supabase/:table/:id           -> actualizar
//   DELETE /api/supabase/:table/:id           -> eliminar
//
// Requiere el header "x-api-key" (SUPABASE_PROXY_API_KEY).

import { handleProxyRequest, isAuthorized } from './_core';

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, x-api-key');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (!isAuthorized(req.headers['x-api-key'])) {
    return res.status(401).json({ error: 'x-api-key inválida o ausente' });
  }

  let subPath = '';
  if (req.query && req.query.path) {
    subPath = Array.isArray(req.query.path) ? req.query.path.join('/') : req.query.path;
  } else {
    const rawUrl = req.url || '';
    subPath = rawUrl.replace(/^\/api\/supabase\/?/, '').split('?')[0];
  }

  const [table, id] = subPath.split('/').filter(Boolean);
  if (!table) {
    return res.status(400).json({ error: 'Falta el nombre de la tabla en la ruta (/api/supabase/<tabla>)' });
  }

  const query: Record<string, any> = {};
  for (const [key, value] of Object.entries(req.query || {})) {
    if (key !== 'path') query[key] = value;
  }

  const result = await handleProxyRequest({
    method: req.method,
    table,
    id: id || null,
    query,
    body: req.body
  });

  return res.status(result.status).json(result.body);
}
