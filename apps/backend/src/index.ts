import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prisma } from './lib/prisma.js';
import { healthRouter } from './routes/health.js';
import { uploadRouter } from './routes/upload.js';
import { analyticsRouter } from './routes/analytics.js';
import { adminRouter } from './routes/admin.js';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(currentDirectory, '../../../.env') });

const app = express();
const port = Number(process.env.PORT ?? 3333);

// O Prisma representa colunas BigInt como bigint do JavaScript, que não é
// serializável pelo JSON.stringify padrão e poderia encerrar o processo.
app.set('json replacer', (_key: string, value: unknown) =>
  typeof value === 'bigint' ? value.toString() : value
);
app.use(cors());
app.use(express.json());

app.get('/', (_req, res) => {
  res.json({
    message: 'API inicial do desafio técnico pronta para expansão.'
  });
});

app.use('/health', healthRouter);
app.use('/api', uploadRouter);
app.use('/api', analyticsRouter);
app.use('/api', adminRouter);

async function startServer() {
  await prisma.$connect();

  const server = app.listen(port, '0.0.0.0', () => {
    console.log(`Backend running at http://localhost:${port}`);
  });

  const shutdown = (signal: string) => {
    console.log(`${signal} received. Closing backend...`);
    server.close(() => {
      void prisma.$disconnect().finally(() => process.exit(0));
    });
  };

  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
}

startServer().catch((error) => {
  console.error('Backend could not connect to PostgreSQL:', error);
  void prisma.$disconnect().finally(() => process.exit(1));
});
