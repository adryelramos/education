import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { ChevronDown, DatabaseZap } from 'lucide-react';
import { BarChart, Bar, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';

// Em desenvolvimento, o Vite encaminha /api e /health para o backend.
// Em produção, VITE_API_URL permite hospedar a API em outro domínio.
const api = axios.create({
  baseURL: import.meta.env.DEV ? '' : (import.meta.env.VITE_API_URL ?? 'http://localhost:3333'),
  timeout: 10_000
});

type Municipio = { co_mun: string; no_mun: string };

type FiltrosData = {
  municipios: Municipio[];
  anos: number[];
  redes: string[];
  etapas: string[];
  variaveis: string[];
  fontes: string[];
};

type IndicadoresData = {
  totalRegistros: number;
  totalMunicipios: number;
  ofertasEnsino: number;
  matriculas: number;
  taxaAprovacao: number | null;
  taxaAbandono: number | null;
};

type SerieData = { ano: number; valor: number };

type RankingItem = { co_mun: string; no_mun: string; valor: number };
type BreakdownItem = { nome: string; valor: number };

type UploadError = { line: number; reason: string };
type ErrorGroup = { reason: string; count: number };

type DadosItem = {
  id: string;
  co_mun: string;
  no_mun: string;
  ano: number;
  fonte: string;
  variavel: string;
  ensino_rede: string;
  ensino_tipo: string;
  valor: number;
};

type DadosPage = {
  itens: DadosItem[];
  total: number;
  pagina: number;
  tamanho: number;
};

type FilterState = {
  co_mun: string[];
  ano: string[];
  fonte: string[];
  ensino_rede: string[];
  ensino_tipo: string[];
  variavel: string[];
};

type ChartIndicator = 'valor' | 'matriculas' | 'taxaAprovacao' | 'taxaAbandono';
type CheckboxOption = { value: string; label: string };

function formatInteger(value: number) {
  return value.toLocaleString('pt-BR');
}

function formatPercent(value: number) {
  return `${value.toFixed(2).replace('.', ',')}%`;
}

function formatSeriesValue(value: number, isPercent: boolean) {
  if (isPercent) {
    return `${value.toFixed(2).replace('.', ',')}%`;
  }
  return formatInteger(value);
}

function normalizeText(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function getChartIndicator(variables: string[]): ChartIndicator {
  if (variables.length === 0) return 'matriculas';
  if (variables.length > 1) return 'valor';

  const normalized = normalizeText(variables[0]);
  if (normalized.startsWith('matr')) return 'matriculas';
  if (normalized.includes('taxa de aprovacao')) return 'taxaAprovacao';
  if (normalized.includes('taxa de abandono')) return 'taxaAbandono';
  return 'valor';
}

function formatSource(value: string) {
  return value
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function buildParams(filters: FilterState) {
  return {
    co_mun: filters.co_mun,
    ano: filters.ano,
    fonte: filters.fonte,
    ensino_rede: filters.ensino_rede,
    ensino_tipo: filters.ensino_tipo,
    variavel: filters.variavel
  };
}

type CheckboxFilterProps = {
  label: string;
  emptyLabel: string;
  options: CheckboxOption[];
  selected: string[];
  onChange: (values: string[]) => void;
};

function CheckboxFilter({ label, emptyLabel, options, selected, onChange }: CheckboxFilterProps) {
  const selectedOptions = options.filter((option) => selected.includes(option.value));
  const summary = selectedOptions.length === 0
    ? emptyLabel
    : selectedOptions.length === 1
      ? selectedOptions[0].label
      : `${selectedOptions.length} selecionados`;
  const allSelected = options.length > 0 && selectedOptions.length === options.length;

  const toggleValue = (value: string) => {
    onChange(selected.includes(value)
      ? selected.filter((item) => item !== value)
      : [...selected, value]);
  };

  return (
    <div>
      <span className="block text-sm font-medium text-slate-300">{label}</span>
      <details className="group relative mt-2">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-slate-100 marker:hidden hover:border-slate-600">
          <span className="truncate">{summary}</span>
          <ChevronDown className="h-4 w-4 shrink-0 text-slate-400 transition group-open:rotate-180" />
        </summary>
        <div className="absolute left-0 right-0 z-30 mt-2 rounded-xl border border-slate-700 bg-slate-950 p-2 shadow-2xl">
          <div className="mb-2 flex items-center justify-between border-b border-slate-800 px-2 pb-2 text-xs">
            <button
              type="button"
              onClick={() => onChange(allSelected ? [] : options.map((option) => option.value))}
              className="font-medium text-cyan-300 hover:text-cyan-200"
            >
              {allSelected ? 'Limpar todos' : 'Selecionar todos'}
            </button>
            {selected.length > 0 ? (
              <button type="button" onClick={() => onChange([])} className="text-slate-400 hover:text-slate-200">
                Limpar
              </button>
            ) : null}
          </div>
          <div className="max-h-56 space-y-1 overflow-y-auto pr-1">
            {options.map((option) => (
              <label
                key={option.value}
                className="flex cursor-pointer items-start gap-2 rounded-lg px-2 py-2 text-sm text-slate-200 hover:bg-slate-800"
              >
                <input
                  type="checkbox"
                  checked={selected.includes(option.value)}
                  onChange={() => toggleValue(option.value)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-cyan-400"
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
        </div>
      </details>
    </div>
  );
}

export default function App() {
  // Estado do upload e mensagens exibidas ao usuário.
  const [file, setFile] = useState<File | null>(null);
  const [uploadMessage, setUploadMessage] = useState<string>('');
  const [uploadErrors, setUploadErrors] = useState<UploadError[]>([]);
  const [uploadErrorGroups, setUploadErrorGroups] = useState<ErrorGroup[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [breakdownType, setBreakdownType] = useState<'rede' | 'etapa'>('rede');

  // Estado de filtro usado para carregar dados e atualizar consultas.
  const [filters, setFilters] = useState<FilterState>({
    co_mun: [],
    ano: [],
    fonte: [],
    ensino_rede: [],
    ensino_tipo: [],
    variavel: []
  });
  const [debouncedFilters, setDebouncedFilters] = useState(filters);
  const [page, setPage] = useState(1);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedFilters(filters), 300);
    return () => clearTimeout(timer);
  }, [filters]);

  const queryClient = useQueryClient();

  const healthQuery = useQuery({
    queryKey: ['health'],
    queryFn: async () => {
      const response = await api.get('/health');
      return response.data;
    },
    retry: false,
    refetchInterval: 15_000
  });
  const health = healthQuery.data;

  const filtrosQuery = useQuery<FiltrosData>({
    queryKey: ['filtros'],
    queryFn: async () => {
      const response = await api.get('/api/filtros');
      return response.data;
    }
  });

  const filterOptions = filtrosQuery.data;
  const selectedVariables = debouncedFilters.variavel;
  const chartIndicator = getChartIndicator(selectedVariables);
  const chartLabel = selectedVariables.length === 0
    ? 'Matrículas'
    : selectedVariables.length === 1
      ? selectedVariables[0]
      : `${selectedVariables.length} variáveis selecionadas`;
  const chartIsPercent = selectedVariables.length > 0
    && selectedVariables.every((variable) => normalizeText(variable).startsWith('taxa de '));
  const chartAggregationLabel = chartIsPercent
    ? selectedVariables.length === 1 && chartIndicator !== 'valor' ? 'Média ponderada (%)' : 'Média (%)'
    : 'Soma';

  const indicadoresQuery = useQuery<IndicadoresData>({
    queryKey: ['indicadores', debouncedFilters],
    queryFn: async () => {
      const response = await api.get('/api/indicadores', { params: buildParams(debouncedFilters) });
      return response.data;
    },
  });

  const seriesQuery = useQuery<SerieData[]>({
    queryKey: ['series', debouncedFilters, chartIndicator],
    queryFn: async () => {
      const response = await api.get('/api/series', {
        params: { ...buildParams(debouncedFilters), indicador: chartIndicator }
      });
      return response.data;
    },
  });

  const rankingQuery = useQuery<RankingItem[]>({
    queryKey: ['ranking', debouncedFilters, chartIndicator],
    queryFn: async () => {
      const response = await api.get('/api/ranking', {
        params: { ...buildParams(debouncedFilters), indicador: chartIndicator, limit: 6 }
      });
      return response.data;
    },
  });

  const breakdownQuery = useQuery<BreakdownItem[]>({
    queryKey: ['breakdown', debouncedFilters, breakdownType, chartIndicator],
    queryFn: async () => {
      const response = await api.get('/api/quebra', {
        params: { ...buildParams(debouncedFilters), tipo: breakdownType, indicador: chartIndicator }
      });
      return response.data;
    },
  });

  const dadosQuery = useQuery<DadosPage>({
    queryKey: ['dados', debouncedFilters, page],
    queryFn: async () => {
      const response = await api.get('/api/dados', {
        params: { ...buildParams(debouncedFilters), page, size: 10 }
      });
      return response.data;
    },
  });

  const seriesData = useMemo(() => seriesQuery.data ?? [], [seriesQuery.data]);
  const rankingData = useMemo(() => rankingQuery.data ?? [], [rankingQuery.data]);
  const breakdownData = useMemo(() => breakdownQuery.data ?? [], [breakdownQuery.data]);
  const yearVariation = useMemo(() => {
    if (seriesData.length < 2) return undefined;
    const last = seriesData[seriesData.length - 1].valor;
    const prev = seriesData[seriesData.length - 2].valor;
    if (prev === 0) return undefined;
    return ((last - prev) / prev) * 100;
  }, [seriesData]);

  // Valida o arquivo selecionado no input e rejeita arquivos não CSV.
  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0] ?? null;
    setUploadErrors([]);
    setUploadErrorGroups([]);
    if (selectedFile) {
      const isCsv = selectedFile.name.toLowerCase().endsWith('.csv');
      if (!isCsv) {
        setUploadMessage('Apenas arquivos CSV são aceitos.');
        setFile(null);
        return;
      }
    }
    setFile(selectedFile);
    setUploadMessage('');
  };

  // Envia o arquivo CSV para o backend e atualiza o estado da UI.
  // Mantém o botão em carregamento enquanto a requisição está em progresso.
  const handleUpload = async () => {
    if (!file) {
      setUploadMessage('Selecione um arquivo CSV antes de enviar.');
      setUploadErrors([]);
      setUploadErrorGroups([]);
      return;
    }

    const isCsv = file.name.toLowerCase().endsWith('.csv');
    if (!isCsv) {
      setUploadMessage('Apenas arquivos CSV são aceitos.');
      setUploadErrors([]);
      setUploadErrorGroups([]);
      return;
    }

    const formData = new FormData();
    formData.append('file', file);
    setIsUploading(true);
    setUploadMessage('');
    setUploadErrors([]);
    setUploadErrorGroups([]);

    try {
      const response = await api.post('/api/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      const duplicateCount = response.data.duplicatasIgnoradas ?? 0;
      const duplicateText = duplicateCount > 0 ? ` (${duplicateCount} duplicata(s) ignorada(s))` : '';
      setUploadMessage(
        `Importado: ${response.data.linhasImportadas}, rejeitados: ${response.data.linhasRejeitadas}${duplicateText}`
      );
      setUploadErrors(response.data.erros ?? []);
      setUploadErrorGroups(response.data.errosAgrupados ?? []);
      setPage(1);
      queryClient.invalidateQueries({ queryKey: ['filtros'] });
      queryClient.invalidateQueries({ queryKey: ['indicadores'] });
      queryClient.invalidateQueries({ queryKey: ['series'] });
      queryClient.invalidateQueries({ queryKey: ['ranking'] });
      queryClient.invalidateQueries({ queryKey: ['breakdown'] });
      queryClient.invalidateQueries({ queryKey: ['dados'] });
    } catch (error) {
      const serverData = axios.isAxiosError(error) && error.response?.data && typeof error.response.data === 'object'
        ? (error.response.data as any)
        : null;
      setUploadMessage(
        String(serverData?.error ?? 'Falha ao enviar o arquivo. Verifique o formato CSV.')
      );
      if (Array.isArray(serverData?.erros)) {
        setUploadErrors(serverData.erros);
        const grouped = (serverData.errosAgrupados ?? []) as ErrorGroup[];
        setUploadErrorGroups(grouped);
      } else {
        setUploadErrors([]);
        setUploadErrorGroups([]);
      }
    } finally {
      setIsUploading(false);
    }
  };

  // Limpa todos os dados do banco. O backend responde com a quantidade removida.
  const handleClearData = async () => {
    // Pergunta ao usuário antes de remover todos os dados do banco.
    const confirmed = window.confirm(
      '⚠️ Tem certeza que deseja deletar TODOS os dados do banco?\n\nEsta ação é irreversível!'
    );

    if (!confirmed) {
      return;
    }

    try {
      const response = await api.post('/api/admin/clear-data');
      setUploadMessage(
        `✅ ${response.data.message} (${response.data.registros_deletados} registros deletados)`
      );
      setPage(1);
      setFilters({ co_mun: [], ano: [], fonte: [], ensino_rede: [], ensino_tipo: [], variavel: [] });
      queryClient.invalidateQueries({ queryKey: ['filtros'] });
      queryClient.invalidateQueries({ queryKey: ['indicadores'] });
      queryClient.invalidateQueries({ queryKey: ['series'] });
      queryClient.invalidateQueries({ queryKey: ['ranking'] });
      queryClient.invalidateQueries({ queryKey: ['breakdown'] });
      queryClient.invalidateQueries({ queryKey: ['dados'] });
    } catch (error) {
      const message =
        axios.isAxiosError(error) && error.response?.data && typeof error.response.data === 'object'
          ? (error.response.data as any).error ?? 'Erro ao deletar dados.'
          : 'Erro ao deletar dados.';
      setUploadMessage(`❌ ${String(message)}`);
    }
  };

  const updateFilter = (key: keyof FilterState, values: string[]) => {
    setFilters((current) => ({ ...current, [key]: values }));
    setPage(1);
  };

  const clearFilters = () => {
    setFilters({ co_mun: [], ano: [], fonte: [], ensino_rede: [], ensino_tipo: [], variavel: [] });
    setPage(1);
  };

  const activeFilterCount = Object.values(filters).reduce((total, values) => total + values.length, 0);

  return (
    <div className="min-h-screen bg-slate-950 p-8 text-slate-100">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <header className="rounded-2xl border border-slate-800 bg-slate-900/80 p-6 shadow-2xl">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm uppercase tracking-[0.3em] text-cyan-400">Desafio técnico</p>
              <h1 className="text-3xl font-semibold">Dashboard de Educação</h1>
            </div>
            <div className="space-y-1 text-right text-sm text-slate-400">
              <p className={healthQuery.isError ? 'text-rose-300' : health ? 'text-emerald-300' : ''}>
                Backend: {healthQuery.isError ? 'offline' : health ? 'online' : 'conectando...'}
              </p>
              <p>{health ? `Último check: ${new Date(health.timestamp).toLocaleString('pt-BR')}` : ''}</p>
            </div>
          </div>
        </header>

        <section className="grid gap-4 xl:grid-cols-[1.4fr_0.6fr]">
          <article className="rounded-2xl border border-slate-800 bg-slate-900/80 p-6">
            <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-xl font-semibold">Filtros globais</h2>
                <p className="mt-1 text-sm text-slate-400">
                  Os filtros abaixo atualizam indicadores, gráficos, ranking e tabela.
                </p>
                {filtrosQuery.isError ? (
                  <p className="mt-2 text-sm text-rose-300">Não foi possível carregar as opções de filtro.</p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={clearFilters}
                disabled={activeFilterCount === 0}
                className="rounded-xl border border-slate-700 bg-slate-950 px-4 py-2 text-sm text-slate-300 transition hover:border-cyan-500 hover:text-cyan-300 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Limpar filtros {activeFilterCount > 0 ? `(${activeFilterCount})` : ''}
              </button>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <CheckboxFilter
                label="Fonte"
                emptyLabel="Todas as fontes"
                options={(filterOptions?.fontes ?? []).map((fonte) => ({ value: fonte, label: formatSource(fonte) }))}
                selected={filters.fonte}
                onChange={(values) => updateFilter('fonte', values)}
              />

              <CheckboxFilter
                label="Município"
                emptyLabel="Todos os municípios"
                options={(filterOptions?.municipios ?? []).map((municipio) => ({
                  value: municipio.co_mun,
                  label: municipio.no_mun
                }))}
                selected={filters.co_mun}
                onChange={(values) => updateFilter('co_mun', values)}
              />

              <CheckboxFilter
                label="Ano"
                emptyLabel="Todos os anos"
                options={(filterOptions?.anos ?? []).map((ano) => ({ value: String(ano), label: String(ano) }))}
                selected={filters.ano}
                onChange={(values) => updateFilter('ano', values)}
              />

              <CheckboxFilter
                label="Rede"
                emptyLabel="Todas as redes"
                options={(filterOptions?.redes ?? []).map((rede) => ({ value: rede, label: rede }))}
                selected={filters.ensino_rede}
                onChange={(values) => updateFilter('ensino_rede', values)}
              />

              <CheckboxFilter
                label="Etapa de ensino"
                emptyLabel="Todas as etapas"
                options={(filterOptions?.etapas ?? []).map((etapa) => ({ value: etapa, label: etapa }))}
                selected={filters.ensino_tipo}
                onChange={(values) => updateFilter('ensino_tipo', values)}
              />

              <div>
                <CheckboxFilter
                  label="Variável exibida"
                  emptyLabel="Matrículas (padrão)"
                  options={(filterOptions?.variaveis ?? []).map((variavel) => ({ value: variavel, label: variavel }))}
                  selected={filters.variavel}
                  onChange={(values) => updateFilter('variavel', values)}
                />
                <span className="mt-1 block text-xs font-normal text-slate-500">
                  É possível combinar variáveis; taxas usam média e quantidades usam soma.
                </span>
              </div>
            </div>
          </article>

          <article className="rounded-2xl border border-slate-800 bg-slate-900/80 p-6">
            <h2 className="mb-4 text-xl font-semibold">Upload de CSV</h2>
            <div className="flex flex-col gap-4">
              <label className="block text-sm font-medium text-slate-300">Arquivo CSV</label>
              <input
                type="file"
                accept=".csv"
                onChange={handleFileChange}
                className="rounded-2xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
              />
              <button
                type="button"
                onClick={handleUpload}
                disabled={isUploading}
                className="inline-flex items-center justify-center rounded-2xl bg-cyan-500 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isUploading ? 'Enviando...' : 'Enviar CSV'}
              </button>
              <button
                type="button"
                onClick={handleClearData}
                className="inline-flex items-center justify-center rounded-2xl bg-red-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-red-500"
              >
                <DatabaseZap className="mr-2 h-4 w-4" />
                Limpar Dados
              </button>
              {uploadMessage ? <p className="text-sm text-slate-300">{uploadMessage}</p> : null}
              {uploadErrors.length > 0 ? (
                // Exibe a lista completa de linhas rejeitadas e o resumo agrupado por motivo.
                <div className="rounded-2xl border border-rose-600 bg-rose-950/20 p-4 text-sm text-slate-100">
                  <p className="mb-2 font-semibold text-rose-300">Linhas rejeitadas</p>
                  <div className="space-y-1 max-h-40 overflow-y-auto pr-2 text-slate-200">
                    {uploadErrors.map((error) => (
                      <p key={`${error.line}-${error.reason}`}>
                        Linha {error.line}: {error.reason}
                      </p>
                    ))}
                  </div>
                  {uploadErrorGroups.length > 0 ? (
                    <div className="mt-3 rounded-2xl border border-slate-700 bg-slate-900/80 p-3">
                      <p className="mb-2 font-semibold text-slate-300">Resumo de erros</p>
                      <ul className="space-y-1 text-slate-200">
                        {uploadErrorGroups.map((group) => (
                          <li key={group.reason}>
                            {group.reason}: {group.count}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </article>
        </section>

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          {indicadoresQuery.isLoading ? (
            <p className="rounded-2xl border border-slate-800 bg-slate-900/80 p-6 text-slate-300">Carregando indicadores...</p>
          ) : indicadoresQuery.isError ? (
            <p className="rounded-2xl border border-rose-900 bg-rose-950/20 p-6 text-rose-300 sm:col-span-2 xl:col-span-5">
              Não foi possível carregar os indicadores. Verifique a conexão com a API.
            </p>
          ) : (
            indicadoresQuery.data && [
              { label: 'Municípios', value: formatInteger(indicadoresQuery.data.totalMunicipios) },
              { label: 'Matrículas', value: formatInteger(indicadoresQuery.data.matriculas) },
              { label: 'Aprovação média', value: indicadoresQuery.data.taxaAprovacao == null ? '—' : formatPercent(indicadoresQuery.data.taxaAprovacao) },
              { label: 'Abandono médio', value: indicadoresQuery.data.taxaAbandono == null ? '—' : formatPercent(indicadoresQuery.data.taxaAbandono) },
              { label: 'Variação ano a ano', value: yearVariation != null ? formatPercent(yearVariation) : '—' }
            ].map((item) => (
              <article key={item.label} className="rounded-2xl border border-slate-800 bg-slate-900/80 p-6">
                <p className="text-sm text-slate-400">{item.label}</p>
                <p className="mt-3 text-2xl font-semibold text-slate-100">{item.value}</p>
              </article>
            ))
          )}
        </section>

        <section className="grid gap-4 xl:grid-cols-[1.4fr_0.8fr]">
          <article className="rounded-2xl border border-slate-800 bg-slate-900/80 p-6">
            <div className="mb-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-xl font-semibold">Evolução de {chartLabel}</h2>
                <p className="mt-1 text-sm text-slate-400">Valores consolidados por ano</p>
              </div>
              <span className="w-fit rounded-full bg-cyan-500/10 px-3 py-1 text-xs font-medium text-cyan-300">
                {chartAggregationLabel}
              </span>
            </div>
            <div className="h-72">
              {seriesQuery.isLoading ? (
                <p className="text-slate-300">Carregando série...</p>
              ) : seriesQuery.isError ? (
                <p className="text-rose-300">Não foi possível carregar a série temporal.</p>
              ) : seriesData.length ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={seriesData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis dataKey="ano" stroke="#94a3b8" />
                    <YAxis stroke="#94a3b8" tickFormatter={(value) => formatInteger(Number(value))} />
                    <Tooltip formatter={(value: number) => formatSeriesValue(value, chartIsPercent)} />
                    <Bar dataKey="valor" fill="#22d3ee" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-slate-300">Sem dados para esta combinação de fonte, variável e filtros.</p>
              )}
            </div>
          </article>

          <article className="rounded-2xl border border-slate-800 bg-slate-900/80 p-6">
            <h2 className="mb-1 text-xl font-semibold">Ranking de municípios</h2>
            <p className="mb-4 text-sm text-slate-400">{chartLabel}</p>
            {rankingQuery.isLoading ? (
              <p className="text-slate-300">Carregando ranking...</p>
            ) : rankingQuery.isError ? (
              <p className="text-rose-300">Não foi possível carregar o ranking.</p>
            ) : rankingData.length ? (
              <div className="space-y-3">
                {rankingData.map((item, index) => (
                  <div key={item.co_mun} className="rounded-2xl bg-slate-950 p-4">
                    <p className="text-sm text-slate-400">{index + 1}. {item.no_mun}</p>
                    <p className="mt-2 text-xl font-semibold">{formatSeriesValue(item.valor, chartIsPercent)}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-slate-300">Sem ranking no momento.</p>
            )}
          </article>

          <article className="rounded-2xl border border-slate-800 bg-slate-900/80 p-6 xl:col-span-2">
            <div className="mb-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-xl font-semibold">{chartLabel} por {breakdownType === 'rede' ? 'rede' : 'etapa'}</h2>
                <p className="mt-1 text-sm text-slate-400">Comparação dentro do recorte global</p>
              </div>
              <div className="flex items-center gap-3 text-sm text-slate-300">
                <button
                  type="button"
                  onClick={() => setBreakdownType('rede')}
                  className={`rounded-2xl px-3 py-2 ${breakdownType === 'rede' ? 'bg-cyan-500 text-slate-950' : 'bg-slate-950 text-slate-500 border border-slate-700'}`}
                >
                  Rede
                </button>
                <button
                  type="button"
                  onClick={() => setBreakdownType('etapa')}
                  className={`rounded-2xl px-3 py-2 ${breakdownType === 'etapa' ? 'bg-cyan-500 text-slate-950' : 'bg-slate-950 text-slate-500 border border-slate-700'}`}
                >
                  Etapa
                </button>
              </div>
            </div>
            <div className="h-72">
              {breakdownQuery.isLoading ? (
                <p className="text-slate-300">Carregando quebra...</p>
              ) : breakdownQuery.isError ? (
                <p className="text-rose-300">Não foi possível carregar esta comparação.</p>
              ) : breakdownData.length ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={breakdownData} margin={{ left: 0, right: 0, top: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis dataKey="nome" stroke="#94a3b8" />
                    <YAxis stroke="#94a3b8" tickFormatter={(value) => formatInteger(Number(value))} />
                    <Tooltip formatter={(value: number) => formatSeriesValue(value, chartIsPercent)} />
                    <Bar dataKey="valor" fill="#38bdf8" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-slate-300">Sem dados para esta combinação de fonte, variável e filtros.</p>
              )}
            </div>
          </article>
        </section>

        <section className="rounded-2xl border border-slate-800 bg-slate-900/80 p-6">
          <div className="mb-4 flex items-center justify-between gap-4">
            <h2 className="text-xl font-semibold">Tabela de dados</h2>
            <div className="flex items-center gap-2 text-sm text-slate-400">
              <span>Página {dadosQuery.data?.pagina ?? 1}</span>
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((value) => Math.max(1, value - 1))}
                className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Anterior
              </button>
              <button
                type="button"
                disabled={!dadosQuery.data || page >= Math.ceil(dadosQuery.data.total / dadosQuery.data.tamanho)}
                onClick={() => setPage((value) => value + 1)}
                className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Próxima
              </button>
            </div>
          </div>
          {dadosQuery.isLoading ? (
            <p className="text-slate-300">Carregando dados...</p>
          ) : dadosQuery.isError ? (
            <p className="text-rose-300">Não foi possível carregar a tabela de dados.</p>
          ) : dadosQuery.data?.itens.length ? (
            <div className="overflow-x-auto">
              <table className="min-w-full table-auto border-collapse text-sm text-slate-200">
                <thead>
                  <tr className="border-b border-slate-700 text-left text-xs uppercase tracking-[0.2em] text-slate-400">
                    <th className="px-3 py-3">Município</th>
                    <th className="px-3 py-3">Ano</th>
                    <th className="px-3 py-3">Fonte</th>
                    <th className="px-3 py-3">Variável</th>
                    <th className="px-3 py-3">Rede</th>
                    <th className="px-3 py-3">Etapa</th>
                    <th className="px-3 py-3">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {dadosQuery.data.itens.map((item) => (
                    <tr key={item.id} className="border-b border-slate-800 last:border-b-0">
                      <td className="px-3 py-3">{item.no_mun}</td>
                      <td className="px-3 py-3">{item.ano}</td>
                      <td className="px-3 py-3">{formatSource(item.fonte)}</td>
                      <td className="px-3 py-3">{item.variavel}</td>
                      <td className="px-3 py-3">{item.ensino_rede}</td>
                      <td className="px-3 py-3">{item.ensino_tipo}</td>
                      <td className="px-3 py-3">{formatInteger(item.valor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-slate-300">Sem dados para os filtros selecionados.</p>
          )}
        </section>
      </div>
    </div>
  );
}
