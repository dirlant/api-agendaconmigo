// Servidor mínimo para probar este proxy en local, sin depender de "vercel dev".
// Uso: npm run dev, escucha en PORT (default 3001).
import express from 'express';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

import supabaseHandler from './api/supabase';
import healthHandler from './api/health';

const app = express();
app.use(express.json({ limit: '5mb' }));

app.get('/api/health', (req, res) => healthHandler(req, res));

app.all('/api/supabase/*', (req, res) => {
  const subPath = (req.params as any)[0] || '';
  (req as any).query = { ...req.query, path: subPath };
  return supabaseHandler(req, res);
});

const PORT = Number(process.env.PORT) || 3001;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`api-agendaconmigo (dev) escuchando en http://0.0.0.0:${PORT}`);
});
