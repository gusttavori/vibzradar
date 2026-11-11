/**
 * Radar Vibz - Full-Stack Express Server & Vite Dev Middleware
 * Porta: 3000
 */
import 'dotenv/config';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { apiRouter } from './src/server/api';
import { schedulerService } from './src/server/services/schedulerService';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const port = Number(process.env.PORT) || 3000;

  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));

  // Healthcheck endpoint
  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      app: 'Radar Vibz',
      timestamp: new Date().toISOString()
    });
  });

  // Rotas da API
  app.use('/api', apiRouter);

  const isProduction = process.env.NODE_ENV === 'production';

  if (!isProduction) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  const server = app.listen(port, '0.0.0.0', () => {
    console.log(`[Radar Vibz] Servidor rodando em http://0.0.0.0:${port}`);
    // Inicializa o serviço de agendamento automático junto com o servidor Express
    schedulerService.init();
  });

  const shutdown = () => {
    console.log('[Radar Vibz] Encerrando o scheduler e o servidor HTTP...');
    schedulerService.stop();
    server.close(() => {
      process.exit(0);
    });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

startServer().catch(err => {
  console.error('[Radar Vibz] Falha ao iniciar o servidor:', err);
  process.exit(1);
});