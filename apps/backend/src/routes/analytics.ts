import { Router } from 'express';
import { prisma } from '../lib/prisma.js';

const analyticsRouter = Router();

type Query = Record<string, any>;
type GroupField = 'ano' | 'ensino_rede' | 'ensino_tipo' | 'municipio' | 'all';
type Indicator = 'matriculas' | 'taxaAprovacao' | 'taxaAbandono' | 'valor';

function parseStringArray(value: unknown) {
  if (value == null || value === '') return undefined;
  const values = Array.isArray(value) ? value : [value];
  const parsed = values.flatMap((item) => String(item).split(',').map((part) => part.trim()).filter(Boolean));
  return parsed.length ? parsed : undefined;
}

function parseNumberArray(value: unknown) {
  return parseStringArray(value)?.map(Number).filter(Number.isFinite);
}

function normalizeText(value: string | undefined) {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function isRateVariable(value: string) {
  return normalizeText(value).startsWith('taxa de ');
}

function variableContains(value: string) {
  return { contains: value, mode: 'insensitive' as const };
}

function matriculaVariableFilter() {
  // "Matr" funciona tanto para Matricula quanto para Matrícula no PostgreSQL.
  return { startsWith: 'Matr', mode: 'insensitive' as const };
}

function defaultNetworkForVariable(variable: string) {
  const normalized = normalizeText(variable);
  const isDemographic = normalized.includes('alfabetiza')
    || normalized.includes('analfabetismo')
    || normalized.startsWith('pessoas ');
  return isDemographic ? 'Não se aplica' : 'Total';
}

function buildFilters(query: Query, includeVariavel = true) {
  const coMuns = parseStringArray(query.co_mun);
  const anos = parseNumberArray(query.ano ?? query.anos);
  const redes = parseStringArray(query.ensino_rede);
  const etapas = parseStringArray(query.ensino_tipo);
  const fontes = parseStringArray(query.fonte);
  const variaveis = includeVariavel ? parseStringArray(query.variavel ?? query.variaveis) : undefined;
  const where: any = {};

  if (coMuns?.length) where.co_mun = { in: coMuns };
  if (anos?.length) where.ano = { in: anos };
  if (redes?.length) where.ensino_rede = { in: redes };
  if (etapas?.length) where.ensino_tipo = { in: etapas };
  if (fontes?.length) where.fonte = { in: fontes };
  if (variaveis?.length) where.variavel = { in: variaveis };

  return where;
}

function requestedIndicator(query: Query): Indicator {
  const explicit = String(query.indicador ?? 'valor') as Indicator;
  if (explicit !== 'valor') return explicit;

  const variables = parseStringArray(query.variavel ?? query.variaveis);
  // Atalhos semânticos só se aplicam quando existe uma única variável.
  // Com várias, o endpoint respeita o conjunto completo usando a agregação genérica.
  if (variables?.length !== 1) return 'valor';

  const variable = variables[0];
  const normalized = normalizeText(variable);
  if (normalized.startsWith('matr')) return 'matriculas';
  if (normalized.includes('taxa de aprovacao')) return 'taxaAprovacao';
  if (normalized.includes('taxa de abandono')) return 'taxaAbandono';
  return 'valor';
}

function applyMeasureNetworkFilter(where: any, query: Query, isNetworkBreakdown = false) {
  if (parseStringArray(query.ensino_rede)?.length) return;

  // A base possui linhas agregadas (Pública e Total). Usar "Total" evita
  // contar matrículas/taxas mais de uma vez nas séries e nos indicadores.
  where.ensino_rede = isNetworkBreakdown
    ? { notIn: ['Pública', 'Total', 'Não se aplica'] }
    : 'Total';
}

function rateGroup(row: any, field: GroupField) {
  if (field === 'ano') return { key: String(row.ano), nome: row.ano };
  if (field === 'ensino_rede') return { key: row.ensino_rede, nome: row.ensino_rede };
  if (field === 'ensino_tipo') return { key: row.ensino_tipo, nome: row.ensino_tipo };
  if (field === 'municipio') return { key: row.co_mun, nome: row.no_mun, co_mun: row.co_mun };
  return { key: 'all', nome: 'all' };
}

async function weightedRateGroups(query: Query, metricPattern: string, groupField: GroupField) {
  const isNetworkBreakdown = groupField === 'ensino_rede';
  const metricWhere = buildFilters(query, false);
  applyMeasureNetworkFilter(metricWhere, query, isNetworkBreakdown);
  metricWhere.variavel = variableContains(metricPattern);

  const weightWhere = buildFilters(query, false);
  // As taxas vêm de indicadores_rendimento e as matrículas do censo_escolar.
  // A fonte não faz parte da chave de correspondência entre as duas medidas.
  delete weightWhere.fonte;
  applyMeasureNetworkFilter(weightWhere, query, isNetworkBreakdown);
  weightWhere.fonte = 'censo_escolar';
  weightWhere.variavel = matriculaVariableFilter();

  const select = {
    valor: true,
    co_mun: true,
    no_mun: true,
    ano: true,
    ensino_rede: true,
    ensino_tipo: true
  };

  const [metricRows, weightRows] = await Promise.all([
    prisma.dadosEducacao.findMany({ where: metricWhere, select }),
    prisma.dadosEducacao.findMany({ where: weightWhere, select })
  ]);

  const weightMap = new Map<string, number>();
  for (const row of weightRows) {
    const key = `${row.co_mun}|${row.ano}|${row.ensino_rede}|${row.ensino_tipo}`;
    weightMap.set(key, (weightMap.get(key) ?? 0) + Number(row.valor));
  }

  const groups = new Map<string, {
    nome: string | number;
    co_mun?: string;
    weightedSum: number;
    totalWeight: number;
    simpleSum: number;
    count: number;
  }>();

  for (const row of metricRows) {
    const group = rateGroup(row, groupField);
    const current = groups.get(group.key) ?? {
      nome: group.nome,
      co_mun: group.co_mun,
      weightedSum: 0,
      totalWeight: 0,
      simpleSum: 0,
      count: 0
    };
    const weightKey = `${row.co_mun}|${row.ano}|${row.ensino_rede}|${row.ensino_tipo}`;
    const weight = weightMap.get(weightKey) ?? 0;
    const value = Number(row.valor);

    if (weight > 0) {
      current.weightedSum += value * weight;
      current.totalWeight += weight;
    }
    current.simpleSum += value;
    current.count += 1;
    groups.set(group.key, current);
  }

  return Array.from(groups.values())
    .map((group) => ({
      nome: group.nome,
      co_mun: group.co_mun,
      valor: group.totalWeight > 0
        ? group.weightedSum / group.totalWeight
        : group.simpleSum / group.count
    }))
    .sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'pt-BR', { numeric: true }));
}

async function groupedValues(query: Query, groupField: Exclude<GroupField, 'municipio' | 'all'>) {
  const variables = parseStringArray(query.variavel ?? query.variaveis);
  if (!variables?.length) return [];

  const useAverage = variables.every(isRateVariable);
  const hasNetworkFilter = Boolean(parseStringArray(query.ensino_rede)?.length);
  const valuesByVariable = await Promise.all(variables.map(async (variable) => {
    const where = buildFilters(query, false);
    where.variavel = variable;
    if (!hasNetworkFilter) where.ensino_rede = defaultNetworkForVariable(variable);

    const variableUsesAverage = isRateVariable(variable);
    const args: any = { by: [groupField], where, orderBy: { [groupField]: 'asc' } };
    if (variableUsesAverage) args._avg = { valor: true };
    else args._sum = { valor: true };

    const values = await prisma.dadosEducacao.groupBy(args);
    return values.map((item: any) => ({
      nome: item[groupField] as string | number,
      valor: Number(variableUsesAverage ? item._avg?.valor ?? 0 : item._sum?.valor ?? 0)
    }));
  }));

  const merged = new Map<string, { nome: string | number; total: number; count: number }>();
  for (const values of valuesByVariable) {
    for (const item of values) {
      const key = String(item.nome);
      const current = merged.get(key) ?? { nome: item.nome, total: 0, count: 0 };
      current.total += item.valor;
      current.count += 1;
      merged.set(key, current);
    }
  }

  return Array.from(merged.values())
    .map((item) => ({
      nome: item.nome,
      valor: useAverage ? item.total / item.count : item.total
    }))
    .sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'pt-BR', { numeric: true }));
}

async function rankedValues(query: Query, limit: number) {
  const variables = parseStringArray(query.variavel ?? query.variaveis);
  if (!variables?.length) return [];

  const useAverage = variables.every(isRateVariable);
  const hasNetworkFilter = Boolean(parseStringArray(query.ensino_rede)?.length);
  const valuesByVariable = await Promise.all(variables.map(async (variable) => {
    const where = buildFilters(query, false);
    where.variavel = variable;
    if (!hasNetworkFilter) where.ensino_rede = defaultNetworkForVariable(variable);

    const variableUsesAverage = isRateVariable(variable);
    const args: any = { by: ['co_mun', 'no_mun'], where };
    if (variableUsesAverage) args._avg = { valor: true };
    else args._sum = { valor: true };
    const values = await prisma.dadosEducacao.groupBy(args);
    return values.map((item: any) => ({
      co_mun: item.co_mun as string,
      no_mun: item.no_mun as string,
      valor: Number(variableUsesAverage ? item._avg?.valor ?? 0 : item._sum?.valor ?? 0)
    }));
  }));

  const merged = new Map<string, { co_mun: string; no_mun: string; total: number; count: number }>();
  for (const values of valuesByVariable) {
    for (const item of values) {
      const current = merged.get(item.co_mun) ?? { ...item, total: 0, count: 0 };
      current.total += item.valor;
      current.count += 1;
      merged.set(item.co_mun, current);
    }
  }

  return Array.from(merged.values())
    .map((item) => ({
      co_mun: item.co_mun,
      no_mun: item.no_mun,
      valor: useAverage ? item.total / item.count : item.total
    }))
    .sort((a, b) => b.valor - a.valor)
    .slice(0, limit);
}

analyticsRouter.get('/filtros', async (_req, res) => {
  const [municipios, anos, redes, etapas, variaveis, fontes] = await Promise.all([
    prisma.dadosEducacao.groupBy({ by: ['co_mun', 'no_mun'], orderBy: { no_mun: 'asc' } }),
    prisma.dadosEducacao.groupBy({ by: ['ano'], orderBy: { ano: 'asc' } }),
    prisma.dadosEducacao.groupBy({ by: ['ensino_rede'], orderBy: { ensino_rede: 'asc' } }),
    prisma.dadosEducacao.groupBy({ by: ['ensino_tipo'], orderBy: { ensino_tipo: 'asc' } }),
    prisma.dadosEducacao.groupBy({ by: ['variavel'], orderBy: { variavel: 'asc' } }),
    prisma.dadosEducacao.groupBy({ by: ['fonte'], orderBy: { fonte: 'asc' } })
  ]);

  return res.json({
    municipios: municipios.map((item) => ({ co_mun: item.co_mun, no_mun: item.no_mun })),
    anos: anos.map((item) => item.ano),
    redes: redes.map((item) => item.ensino_rede),
    etapas: etapas.map((item) => item.ensino_tipo),
    variaveis: variaveis.map((item) => item.variavel),
    fontes: fontes.map((item) => item.fonte)
  });
});

analyticsRouter.get('/indicadores', async (req, res) => {
  const where = buildFilters(req.query);
  const matriculasWhere = buildFilters(req.query, false);
  applyMeasureNetworkFilter(matriculasWhere, req.query);
  matriculasWhere.variavel = matriculaVariableFilter();

  const [totalRegistros, municipios, ofertas, matriculasSum, aprovacao, abandono] = await Promise.all([
    prisma.dadosEducacao.count({ where }),
    prisma.dadosEducacao.groupBy({ by: ['co_mun'], where }),
    prisma.dadosEducacao.groupBy({ by: ['co_mun', 'ensino_tipo'], where }),
    prisma.dadosEducacao.aggregate({ _sum: { valor: true }, where: matriculasWhere }),
    weightedRateGroups(req.query, 'Aprova', 'all'),
    weightedRateGroups(req.query, 'Abandon', 'all')
  ]);

  return res.json({
    totalRegistros,
    totalMunicipios: municipios.length,
    ofertasEnsino: ofertas.length,
    matriculas: Number(matriculasSum._sum.valor ?? 0),
    taxaAprovacao: aprovacao[0]?.valor ?? null,
    taxaAbandono: abandono[0]?.valor ?? null
  });
});

analyticsRouter.get('/series', async (req, res) => {
  const indicator = requestedIndicator(req.query);

  if (indicator === 'taxaAprovacao' || indicator === 'taxaAbandono') {
    const values = await weightedRateGroups(
      req.query,
      indicator === 'taxaAprovacao' ? 'Aprova' : 'Abandon',
      'ano'
    );
    return res.json(values.map((item) => ({ ano: Number(item.nome), valor: item.valor })));
  }

  if (indicator === 'matriculas') {
    const where = buildFilters(req.query, false);
    applyMeasureNetworkFilter(where, req.query);
    where.variavel = matriculaVariableFilter();
    const series = await prisma.dadosEducacao.groupBy({
      by: ['ano'], where, orderBy: { ano: 'asc' }, _sum: { valor: true }
    });
    return res.json(series.map((item) => ({ ano: item.ano, valor: Number(item._sum.valor ?? 0) })));
  }

  const values = await groupedValues(req.query, 'ano');
  return res.json(values.map((item) => ({ ano: Number(item.nome), valor: item.valor })));
});

analyticsRouter.get('/quebra', async (req, res) => {
  const indicator = requestedIndicator(req.query);
  const field = String(req.query.tipo ?? 'rede') === 'etapa' ? 'ensino_tipo' : 'ensino_rede';

  if (indicator === 'taxaAprovacao' || indicator === 'taxaAbandono') {
    const values = await weightedRateGroups(
      req.query,
      indicator === 'taxaAprovacao' ? 'Aprova' : 'Abandon',
      field
    );
    return res.json(values.map((item) => ({ nome: String(item.nome), valor: item.valor })));
  }

  if (indicator === 'matriculas') {
    const where = buildFilters(req.query, false);
    applyMeasureNetworkFilter(where, req.query, field === 'ensino_rede');
    where.variavel = matriculaVariableFilter();
    const args: any = {
      by: [field], where, orderBy: { [field]: 'asc' }, _sum: { valor: true }
    };
    const values = await prisma.dadosEducacao.groupBy(args);
    return res.json(values.map((item: any) => ({
      nome: item[field], valor: Number(item._sum.valor ?? 0)
    })));
  }

  const values = await groupedValues(req.query, field);
  return res.json(values.map((item) => ({ nome: String(item.nome), valor: item.valor })));
});

analyticsRouter.get('/ranking', async (req, res) => {
  const indicator = requestedIndicator(req.query);
  const limit = Math.min(50, Math.max(1, Number(req.query.limit ?? 10) || 10));

  if (indicator === 'taxaAprovacao' || indicator === 'taxaAbandono') {
    const values = await weightedRateGroups(
      req.query,
      indicator === 'taxaAprovacao' ? 'Aprova' : 'Abandon',
      'municipio'
    );
    return res.json(
      values
        .sort((a, b) => b.valor - a.valor)
        .slice(0, limit)
        .map((item) => ({ co_mun: item.co_mun, no_mun: item.nome, valor: item.valor }))
    );
  }

  if (indicator === 'valor') {
    return res.json(await rankedValues(req.query, limit));
  }

  const where = buildFilters(req.query, false);
  applyMeasureNetworkFilter(where, req.query);
  where.variavel = matriculaVariableFilter();
  const args: any = {
    by: ['co_mun', 'no_mun'],
    where,
    take: limit,
    _sum: { valor: true },
    orderBy: { _sum: { valor: 'desc' } }
  };
  const ranking = await prisma.dadosEducacao.groupBy(args);
  return res.json(ranking.map((item: any) => ({
    co_mun: item.co_mun,
    no_mun: item.no_mun,
    valor: Number(item._sum?.valor ?? 0)
  })));
});

analyticsRouter.get('/dados', async (req, res) => {
  const where = buildFilters(req.query);
  const page = Math.max(1, Number(req.query.page ?? 1) || 1);
  const size = Math.min(100, Math.max(1, Number(req.query.size ?? 15) || 15));
  const [total, items] = await Promise.all([
    prisma.dadosEducacao.count({ where }),
    prisma.dadosEducacao.findMany({
      where,
      skip: (page - 1) * size,
      take: size,
      orderBy: [{ ano: 'desc' }, { no_mun: 'asc' }],
      select: {
        id: true,
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
      id: item.id.toString(),
      valor: Number(item.valor)
    })),
    total,
    pagina: page,
    tamanho: size
  });
});

export { analyticsRouter };
