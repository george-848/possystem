import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { apiRateLimiter, attachRequestContext } from './server/middleware/auth.ts';
import { apiRouter } from './server/routes/api.ts';

async function startServer() {
  const app = express();
  const port = Number(process.env.PORT) || 3000;
  const isProd = process.env.NODE_ENV === 'production';

  app.set('trust proxy', 1);
  app.use(express.json({ limit: '1mb' }));
  app.use(attachRequestContext);
  app.use('/api', apiRateLimiter, apiRouter);

  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    if (fs.existsSync(distDir)) {
      app.use(express.static(distDir));
      app.get('*', (_req, res) => {
        res.sendFile(path.join(distDir, 'index.html'));
      });
    }
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(
      JSON.stringify({
        severity: 'INFO',
        message: `Multi-Branch POS System server listening on port ${port}`,
        mode: isProd ? 'production' : 'development',
      })
    );
  });
}

startServer().catch((err) => {
  console.error(
    JSON.stringify({
      severity: 'ERROR',
      message: 'Failed to start server',
      error: err instanceof Error ? err.message : String(err),
    })
  );
  process.exit(1);
});
