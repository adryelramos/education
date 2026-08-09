import { Router, Request } from 'express';
import multer from 'multer';
import { parse } from 'csv-parse';
import { Readable } from 'stream';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024
  }
});

const expectedHeaders = [
  'co_mun',
  'no_mun',
  'ano',
  'fonte',
  'variavel',
  'ensino_rede',
  'ensino_tipo',
  'valor'
];

const csvRowSchema = z.object({
  co_mun: z.string().min(1),
  no_mun: z.string().min(1),
  ano: z.preprocess((value) => {
    if (typeof value === 'string') {
      return Number(value.trim());
    }
    return value;
  }, z.number().int().gte(1900).lte(2100)),
  fonte: z.string().min(1),
  variavel: z.string().min(1),
  ensino_rede: z.string().min(1),
  ensino_tipo: z.string().min(1),
  valor: z.preprocess((value) => {
    if (typeof value === 'string') {
      const normalized = value.trim().replace(',', '.');
      return Number(normalized);
    }
    return value;
  }, z.number())
});

type CsvRow = z.infer<typeof csvRowSchema>;

function validateHeaders(headers: string[]) {
  const normalized = headers.map((header) => header.trim().toLowerCase());
  const missing = expectedHeaders.filter((expected) => !normalized.includes(expected));
  if (missing.length > 0) {
    throw new Error(`Cabeçalho inválido. Faltam colunas: ${missing.join(', ')}`);
  }
}

export const uploadRouter = Router();

uploadRouter.post('/upload', upload.single('file'), async (req: Request & { file?: Express.Multer.File }, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Arquivo não fornecido. Use multipart/form-data com campo file.' });
  }

  const fileBuffer = req.file.buffer;
  const parser = parse({
    bom: true,
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true
  });

  const stream = Readable.from(fileBuffer).pipe(parser);
  let lineIndex = 0;
  let imported = 0;
  let rejected = 0;
  const errors: Array<{ line: number; reason: string }> = [];
  const batch: CsvRow[] = [];
  const batchSize = 2000;
  let headersValidated = false;

  try {
    await prisma.dadosEducacao.deleteMany({});

    for await (const record of stream) {
      lineIndex += 1;

      if (!headersValidated) {
        validateHeaders(Object.keys(record));
        headersValidated = true;
      }

      const parseResult = csvRowSchema.safeParse(record);
      if (!parseResult.success) {
        rejected += 1;
        errors.push({
          line: lineIndex + 1,
          reason: parseResult.error.errors.map((error) => `${error.path.join('.')} ${error.message}`).join('; ')
        });
        continue;
      }

      batch.push(parseResult.data);

      if (batch.length >= batchSize) {
        await prisma.dadosEducacao.createMany({
          data: batch.map((item) => ({
            co_mun: item.co_mun,
            no_mun: item.no_mun,
            ano: item.ano,
            fonte: item.fonte,
            variavel: item.variavel,
            ensino_rede: item.ensino_rede,
            ensino_tipo: item.ensino_tipo,
            valor: item.valor
          })),
          skipDuplicates: true
        });
        imported += batch.length;
        batch.length = 0;
      }
    }

    if (batch.length > 0) {
      await prisma.dadosEducacao.createMany({
        data: batch.map((item) => ({
          co_mun: item.co_mun,
          no_mun: item.no_mun,
          ano: item.ano,
          fonte: item.fonte,
          variavel: item.variavel,
          ensino_rede: item.ensino_rede,
          ensino_tipo: item.ensino_tipo,
          valor: item.valor
        })),
        skipDuplicates: true
      });
      imported += batch.length;
    }

    return res.json({
      linhasLidas: lineIndex,
      linhasImportadas: imported,
      linhasRejeitadas: rejected,
      erros: errors
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro interno durante o upload.';
    return res.status(500).json({ error: message, detalhes: error });
  }
});
