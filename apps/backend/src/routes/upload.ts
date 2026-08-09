import { Router, Request } from 'express';
import multer from 'multer';
import { parse } from 'csv-parse';
import path from 'path';
import { Readable } from 'stream';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';

// Configura o multer para manter o arquivo em memória e limitar o tamanho.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024
  }
});

// Lista de colunas esperadas no CSV. A ordem não precisa ser exatamente a mesma,
// mas todas as colunas devem estar presentes para o arquivo ser válido.
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

// Validação de cada linha do CSV. O Zod transforma campos numéricos a partir de strings
// e garante que todos os campos obrigatórios estejam presentes e com formato correto.
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

// Normaliza valores para gerar uma chave única que identifica uma linha
// sem considerar diferenças de maiúsculas/minúsculas ou espaços.
function normalizeValue(value: string | number) {
  return String(value).trim().toLowerCase();
}

// Gera uma chave composta usada para detectar duplicatas dentro do arquivo e no banco.
function buildRowKey(row: CsvRow) {
  return [
    normalizeValue(row.co_mun),
    normalizeValue(row.no_mun),
    normalizeValue(row.ano),
    normalizeValue(row.fonte),
    normalizeValue(row.variavel),
    normalizeValue(row.ensino_rede),
    normalizeValue(row.ensino_tipo)
  ].join('|');
}

// Verifica se o CSV contém todas as colunas esperadas. Se faltar alguma,
// interrompe o processamento imediatamente.
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

  const extension = path.extname(req.file.originalname).toLowerCase();
  if (extension !== '.csv') {
    return res.status(400).json({ error: 'Apenas arquivos com extensão .csv são aceitos.' });
  }

  // Cria um parser CSV que lê todas as linhas com cabeçalho e remove espaços em branco.
  const fileBuffer = req.file.buffer;
  const parser = parse({
    bom: true,
    delimiter: ',',
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: false
  });

  const stream = Readable.from(fileBuffer).pipe(parser);
  let lineIndex = 0;
  let imported = 0;
  let rejected = 0;
  let duplicateIgnored = 0;
  const errors: Array<{ line: number; reason: string }> = [];
  const uniqueRows: Array<{ row: CsvRow; line: number; key: string }> = [];
  const seenKeys = new Set<string>();
  let headersValidated = false;

  try {
    for await (const record of stream) {
      lineIndex += 1;

      if (!headersValidated) {
        validateHeaders(Object.keys(record));
        headersValidated = true;
      }

      // Valida cada linha do CSV contra o schema.
      const parseResult = csvRowSchema.safeParse(record);
      if (!parseResult.success) {
        rejected += 1;
        errors.push({
          line: lineIndex + 1,
          reason: parseResult.error.errors.map((error) => `${error.path.join('.')} ${error.message}`).join('; ')
        });
        continue;
      }

      const csvRow = parseResult.data;
      const rowKey = buildRowKey(csvRow);

      // Detecta duplicatas dentro do próprio arquivo antes de tentar inserir.
      if (seenKeys.has(rowKey)) {
        rejected += 1;
        duplicateIgnored += 1;
        errors.push({ line: lineIndex + 1, reason: 'Linha duplicada dentro do arquivo.' });
        continue;
      }

      seenKeys.add(rowKey);
      uniqueRows.push({ row: csvRow, line: lineIndex + 1, key: rowKey });
    }

    if (!headersValidated) {
      return res.status(400).json({ error: 'Arquivo CSV inválido ou vazio.' });
    }

    // Verifica duplicatas existentes no banco em blocos para não gerar consultas muito grandes.
    const existingKeys = new Set<string>();
    const chunks: Array<Array<{ co_mun: string; no_mun: string; ano: number; fonte: string; variavel: string; ensino_rede: string; ensino_tipo: string }>> = [];
    for (let i = 0; i < uniqueRows.length; i += 500) {
      chunks.push(
        uniqueRows.slice(i, i + 500).map(({ row }) => ({
          co_mun: row.co_mun,
          no_mun: row.no_mun,
          ano: row.ano,
          fonte: row.fonte,
          variavel: row.variavel,
          ensino_rede: row.ensino_rede,
          ensino_tipo: row.ensino_tipo
        }))
      );
    }

    for (const chunk of chunks) {
      const existing = await prisma.dadosEducacao.findMany({
        where: {
          OR: chunk
        },
        select: {
          co_mun: true,
          no_mun: true,
          ano: true,
          fonte: true,
          variavel: true,
          ensino_rede: true,
          ensino_tipo: true
        }
      });

      for (const record of existing) {
        existingKeys.add(buildRowKey(record as CsvRow));
      }
    }

    // Remove do conjunto de inserção as linhas que já existem no banco de dados.
    const rowsToInsert = uniqueRows.filter(({ row, line, key }) => {
      if (existingKeys.has(key)) {
        rejected += 1;
        duplicateIgnored += 1;
        errors.push({ line, reason: 'Linha já existente no banco de dados.' });
        return false;
      }
      return true;
    });

    if (rowsToInsert.length > 0) {
      const dataToInsert = rowsToInsert.map(({ row }) => ({
        co_mun: row.co_mun,
        no_mun: row.no_mun,
        ano: row.ano,
        fonte: row.fonte,
        variavel: row.variavel,
        ensino_rede: row.ensino_rede,
        ensino_tipo: row.ensino_tipo,
        valor: row.valor
      }));

      for (let i = 0; i < dataToInsert.length; i += 2000) {
        const batch = dataToInsert.slice(i, i + 2000);
        const result = await prisma.dadosEducacao.createMany({
          data: batch,
          skipDuplicates: true
        });
        imported += result.count;
      }
    }

    // Agrupa os erros por motivo para exibir um resumo compacto ao frontend.
    const groupedErrors = Object.entries(
      errors.reduce<Record<string, number>>((acc, error) => {
        acc[error.reason] = (acc[error.reason] ?? 0) + 1;
        return acc;
      }, {})
    ).map(([reason, count]) => ({ reason, count }));

    // Retorna o resultado do upload com detalhes de inserções, rejeições e duplicatas.
    return res.status(200).json({
      linhasLidas: lineIndex,
      linhasImportadas: imported,
      linhasRejeitadas: rejected,
      duplicatasIgnoradas: duplicateIgnored,
      erros: errors,
      errosAgrupados: groupedErrors
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro interno durante o upload.';
    return res.status(400).json({ error: message, detalhes: error });
  }
});
