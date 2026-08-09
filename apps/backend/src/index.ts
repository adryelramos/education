import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import { healthRouter } from './routes/health.js';
import { uploadRouter } from './routes/upload.js';
import { analyticsRouter } from './routes/analytics.js';
import { adminRouter } from './routes/admin.js';

dotenv.config({ path: '../../.env' });

const app = express();
const port = Number(process.env.PORT ?? 3333);

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

app.listen(port, () => {
  console.log(`Backend running at http://localhost:${port}`);
});
