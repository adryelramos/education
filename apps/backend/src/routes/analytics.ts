import { Router } from 'express';
import { prisma } from '../lib/prisma.js';

const analyticsRouter = Router();

function parseStringArray(value: string | string[] | import('qs').ParsedQs | import('qs').ParsedQs[] | undefined) {
  if (!value) return undefined;
  if (Array.isArray(value)) {
    return value.flatMap((item) => String(item).split(',').map((part) => part.trim()).filter(Boolean));
  }
  return String(value).split(',').map((item) => item.trim()).filter(Boolean);
}

function parseNumberArray(value: string | string[] | import('qs').ParsedQs | import('qs').ParsedQs[] | undefined) {
  const strings = parseStringArray(value);
  if (!strings) return undefined;
  return strings.map((item) => Number(item)).filter((value) => Number.isFinite(value));
}

function buildFilters(query: Record<string, any>, includeVariavel = true) {
  const coMuns = parseStringArray(query.co_mun);
  const anos = parseNumberArray(query.ano ?? query.anos);
  let redes = parseStringArray(query.ensino_rede);
  const etapas = parseStringArray(query.ensino_tipo);
  const variaveis = includeVariavel ? parseStringArray(query.variavel ?? query.variaveis) : undefined;

  const where: any = {};

  if (coMuns?.length) where.co_mun = { in: coMuns };
  if (anos?.length) where.ano = { in: anos };
  if (redes?.length) {
    where.ensino_rede = { in: redes };
  } else {
    where.ensino_rede = { equals: 'Total' };
  }
  if (etapas?.length) where.ensino_tipo = { in: etapas };
  if (variaveis?.length) where.variavel = { in: variaveis };

  return where;
}

async function weightedAverage(query: Record<string, any>, metricPattern: string) {
  const baseFilter = buildFilters(query, false);
  const metricWhere = { ...baseFilter, variavel: variableContains(metricPattern) };
  const matriculaWhere = { ...baseFilter, variavel: variableContains('matricul') };

  const [metricRows, matriculaRows] = await Promise.all([
    prisma.dadosEducacao.findMany({
      where: metricWhere,
      select: { valor: true, co_mun: true, ano: true, ensino_rede: true, ensino_tipo: true, fonte: true, no_mun: true }
    }),
    prisma.dadosEducacao.findMany({
      where: matriculaWhere,
      select: { valor: true, co_mun: true, ano: true, ensino_rede: true, ensino_tipo: true, fonte: true, no_mun: true }
    })
  ]);

  const matriculaMap = new Map<string, number>();
  for (const row of matriculaRows) {
    const key = `${row.co_mun}|${row.ano}|${row.ensino_rede}|${row.ensino_tipo}|${row.fonte}|${row.no_mun}`;
    matriculaMap.set(key, (matriculaMap.get(key) ?? 0) + Number(row.valor));
  }

  let weightedSum = 0;
  let totalWeight = 0;

  for (const row of metricRows) {
    const key = `${row.co_mun}|${row.ano}|${row.ensino_rede}|${row.ensino_tipo}|${row.fonte}|${row.no_mun}`;
    const matriculas = matriculaMap.get(key) ?? 0;
    if (matriculas > 0) {
      weightedSum += Number(row.valor) * matriculas;
      totalWeight += matriculas;
    }
  }

  return totalWeight > 0 ? weightedSum / totalWeight : 0;
}

function variableContains(value: string) {
  return {
    contains: value,
    mode: 'insensitive' as const
  };
}

analyticsRouter.get('/filtros', async (_req, res) => {
  const [municipios, anos, redes, etapas, variaveis] = await Promise.all([
    prisma.dadosEducacao.groupBy({ by: ['co_mun', 'no_mun'], orderBy: { no_mun: 'asc' } }),
    prisma.dadosEducacao.groupBy({ by: ['ano'], orderBy: { ano: 'asc' } }),
    prisma.dadosEducacao.groupBy({ by: ['ensino_rede'], orderBy: { ensino_rede: 'asc' } }),
    prisma.dadosEducacao.groupBy({ by: ['ensino_tipo'], orderBy: { ensino_tipo: 'asc' } }),
    prisma.dadosEducacao.groupBy({ by: ['variavel'], orderBy: { variavel: 'asc' } })
  ]);

  return res.json({
    municipios: municipios.map((item) => ({ co_mun: item.co_mun, no_mun: item.no_mun })),
    anos: anos.map((item) => item.ano),
    redes: redes.map((item) => item.ensino_rede),
    etapas: etapas.map((item) => item.ensino_tipo),
    variaveis: variaveis.map((item) => item.variavel)
  });
});

analyticsRouter.get('/indicadores', async (req, res) => {
  const where = buildFilters(req.query);

  const [totalRegistros, municipios, ofertas, matriculasSum] = await Promise.all([
    prisma.dadosEducacao.count({ where }),
    prisma.dadosEducacao.groupBy({ by: ['co_mun'], where }),
    prisma.dadosEducacao.groupBy({ by: ['co_mun', 'ensino_tipo'], where }),
    prisma.dadosEducacao.aggregate({
      _sum: { valor: true },
      where: { ...where, variavel: variableContains('matricul') }
    })
  ]);

  const taxaAprovacao = await weightedAverage(req.query, 'aprov');
  const taxaAbandono = await weightedAverage(req.query, 'aband');

  return res.json({
    totalRegistros,
    totalMunicipios: municipios.length,
    ofertasEnsino: ofertas.length,
    matriculas: Number(matriculasSum._sum.valor ?? 0),
    taxaAprovacao,
    taxaAbandono
  });
});

analyticsRouter.get('/series', async (req, res) => {
  const where = buildFilters(req.query);
  const rawVariavel = req.query.variavel ?? req.query.variaveis;
  const variavel = parseStringArray(rawVariavel as any)?.[0];

  const seriesWhere = variavel
    ? { ...where, variavel: variableContains(variavel) }
    : where;

  const series = await prisma.dadosEducacao.groupBy({
    by: ['ano'],
    where: seriesWhere,
    orderBy: { ano: 'asc' },
    _sum: { valor: true }
  });

  return res.json(series.map((item) => ({ ano: item.ano, valor: Number(item._sum.valor ?? 0) })));
});

analyticsRouter.get('/ranking', async (req, res) => {
  const where = buildFilters(req.query);
  const limit = Number(req.query.limit ?? 10);

  const ranking = await prisma.dadosEducacao.groupBy({
    by: ['co_mun', 'no_mun'],
    where,
    orderBy: { _sum: { valor: 'desc' } },
    _sum: { valor: true },
    take: limit
  });

  return res.json(
    ranking.map((item) => ({
      co_mun: item.co_mun,
      no_mun: item.no_mun,
      valor: Number(item._sum.valor ?? 0)
    }))
  );
});

analyticsRouter.get('/dados', async (req, res) => {
  const where = buildFilters(req.query);
  const page = Math.max(1, Number(req.query.page ?? 1));
  const size = Math.min(100, Math.max(1, Number(req.query.size ?? 15)));

  const [total, items] = await Promise.all([
    prisma.dadosEducacao.count({ where }),
    prisma.dadosEducacao.findMany({
      where,
      skip: (page - 1) * size,
      take: size,
      orderBy: [{ ano: 'desc' }, { no_mun: 'asc' }],
      select: {
        co_mun: true,
        no_mun: true,
        ano: true,
        fonte: true,
        variavel: true,
        ensino_rede: true,
        ensino_tipo: true,
        valor: true
      }
    })
  ]);

  return res.json({
    itens: items.map((item) => ({
      ...item,
      valor: Number(item.valor)
    })),
    total,
    pagina: page,
    tamanho: size
  });
});

export { analyticsRouter };
