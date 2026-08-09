import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import { Activity, BarChart3, DatabaseZap, Upload } from 'lucide-react';
import { BarChart, Bar, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';

const api = axios.create({ baseURL: 'http://localhost:3333' });

type Municipio = { co_mun: string; no_mun: string };

type FiltrosData = {
  municipios: Municipio[];
  anos: number[];
  redes: string[];
  etapas: string[];
  variaveis: string[];
};

type IndicadoresData = {
  totalRegistros: number;
  totalMunicipios: number;
  ofertasEnsino: number;
  matriculas: number;
  taxaAprovacao: number;
  taxaAbandono: number;
};

type SerieData = { ano: number; valor: number };

type RankingItem = { co_mun: string; no_mun: string; valor: number };

type DadosItem = {
  id: number;
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
  ensino_rede: string[];
  ensino_tipo: string[];
  variavel: string[];
};

function formatInteger(value: number) {
  return value.toLocaleString('pt-BR');
}

function formatPercent(value: number) {
  return `${value.toFixed(2).replace('.', ',')}%`;
}

function buildParams(filters: FilterState) {
  return {
    co_mun: filters.co_mun,
    ano: filters.ano,
    ensino_rede: filters.ensino_rede,
    ensino_tipo: filters.ensino_tipo,
    variavel: filters.variavel
  };
}

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [uploadMessage, setUploadMessage] = useState<string>('');
  const [filters, setFilters] = useState<FilterState>({
    co_mun: [],
    ano: [],
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

  const { data: health } = useQuery({
    queryKey: ['health'],
    queryFn: async () => {
      const response = await api.get('/health');
      return response.data;
    }
  });

  const filtrosQuery = useQuery<FiltrosData>({
    queryKey: ['filtros'],
    queryFn: async () => {
      const response = await api.get('/api/filtros');
      return response.data;
    }
  });

  const indicadoresQuery = useQuery<IndicadoresData>({
    queryKey: ['indicadores', debouncedFilters],
    queryFn: async () => {
      const response = await api.get('/api/indicadores', { params: buildParams(debouncedFilters) });
      return response.data;
    },
    enabled: filtrosQuery.isSuccess
  });

  const seriesQuery = useQuery<SerieData[]>({
    queryKey: ['series', debouncedFilters],
    queryFn: async () => {
      const response = await api.get('/api/series', { params: buildParams(debouncedFilters) });
      return response.data;
    },
    enabled: filtrosQuery.isSuccess
  });

  const rankingQuery = useQuery<RankingItem[]>({
    queryKey: ['ranking', debouncedFilters],
    queryFn: async () => {
      const response = await api.get('/api/ranking', { params: { ...buildParams(debouncedFilters), limit: 6 } });
      return response.data;
    },
    enabled: filtrosQuery.isSuccess
  });

  const dadosQuery = useQuery<DadosPage>({
    queryKey: ['dados', debouncedFilters, page],
    queryFn: async () => {
      const response = await api.get('/api/dados', {
        params: { ...buildParams(debouncedFilters), page, size: 10 }
      });
      return response.data;
    },
    enabled: filtrosQuery.isSuccess
  });

  const seriesData = useMemo(() => seriesQuery.data ?? [], [seriesQuery.data]);
  const rankingData = useMemo(() => rankingQuery.data ?? [], [rankingQuery.data]);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0] ?? null;
    setFile(selectedFile);
    setUploadMessage('');
  };

  const handleUpload = async () => {
    if (!file) {
      setUploadMessage('Selecione um arquivo CSV antes de enviar.');
      return;
    }

    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await api.post('/api/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      setUploadMessage(`Importado: ${response.data.linhasImportadas}, rejeitados: ${response.data.linhasRejeitadas}`);
      setPage(1);
    } catch (error) {
      const message =
        axios.isAxiosError(error) && error.response?.data && typeof error.response.data === 'object'
          ? (error.response.data as any).error ?? 'Falha ao enviar o arquivo. Verifique o formato CSV.'
          : 'Falha ao enviar o arquivo. Verifique o formato CSV.';
      setUploadMessage(String(message));
    }
  };

  const handleClearData = async () => {
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
    } catch (error) {
      const message =
        axios.isAxiosError(error) && error.response?.data && typeof error.response.data === 'object'
          ? (error.response.data as any).error ?? 'Erro ao deletar dados.'
          : 'Erro ao deletar dados.';
      setUploadMessage(`❌ ${String(message)}`);
    }
  };

  const filterOptions = filtrosQuery.data;

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
              <p>Backend: {health ? 'online' : 'conectando...'}</p>
              <p>{health ? `Último check: ${new Date(health.timestamp).toLocaleString('pt-BR')}` : ''}</p>
            </div>
          </div>
        </header>

        <section className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
          <article className="rounded-2xl border border-slate-800 bg-slate-900/80 p-6">
            <h2 className="mb-4 text-xl font-semibold">Filtros</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-300">Municípios</label>
                <select
                  multiple
                  value={filters.co_mun}
                  onChange={(event) =>
                    setFilters((current) => ({
                      ...current,
                      co_mun: Array.from(event.target.selectedOptions).map((option) => option.value)
                    }))
                  }
                  className="h-40 w-full rounded-2xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
                >
                  {filterOptions?.municipios.map((municipio) => (
                    <option key={municipio.co_mun} value={municipio.co_mun}>
                      {municipio.no_mun}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-300">Anos</label>
                <select
                  multiple
                  value={filters.ano}
                  onChange={(event) =>
                    setFilters((current) => ({
                      ...current,
                      ano: Array.from(event.target.selectedOptions).map((option) => option.value)
                    }))
                  }
                  className="h-40 w-full rounded-2xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
                >
                  {filterOptions?.anos.map((ano) => (
                    <option key={ano} value={ano}>
                      {ano}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-300">Redes</label>
                <select
                  multiple
                  value={filters.ensino_rede}
                  onChange={(event) =>
                    setFilters((current) => ({
                      ...current,
                      ensino_rede: Array.from(event.target.selectedOptions).map((option) => option.value)
                    }))
                  }
                  className="h-40 w-full rounded-2xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
                >
                  {filterOptions?.redes.map((rede) => (
                    <option key={rede} value={rede}>
                      {rede}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-300">Etapas</label>
                <select
                  multiple
                  value={filters.ensino_tipo}
                  onChange={(event) =>
                    setFilters((current) => ({
                      ...current,
                      ensino_tipo: Array.from(event.target.selectedOptions).map((option) => option.value)
                    }))
                  }
                  className="h-40 w-full rounded-2xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
                >
                  {filterOptions?.etapas.map((etapa) => (
                    <option key={etapa} value={etapa}>
                      {etapa}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="mt-4">
              <label className="mb-2 block text-sm font-medium text-slate-300">Variáveis</label>
              <select
                multiple
                value={filters.variavel}
                onChange={(event) =>
                  setFilters((current) => ({
                    ...current,
                    variavel: Array.from(event.target.selectedOptions).map((option) => option.value)
                  }))
                }
                className="h-40 w-full rounded-2xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
              >
                {filterOptions?.variaveis.map((variavel) => (
                  <option key={variavel} value={variavel}>
                    {variavel}
                  </option>
                ))}
              </select>
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
                className="inline-flex items-center justify-center rounded-2xl bg-cyan-500 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400"
              >
                Enviar CSV
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
            </div>
          </article>
        </section>

        <section className="grid gap-4 lg:grid-cols-3">
          {indicadoresQuery.isLoading ? (
            <p className="rounded-2xl border border-slate-800 bg-slate-900/80 p-6 text-slate-300">Carregando indicadores...</p>
          ) : (
            indicadoresQuery.data && [
              { label: 'Registros', value: formatInteger(indicadoresQuery.data.totalRegistros) },
              { label: 'Municípios', value: formatInteger(indicadoresQuery.data.totalMunicipios) },
              { label: 'Ofertas', value: formatInteger(indicadoresQuery.data.ofertasEnsino) },
              { label: 'Matrículas', value: formatInteger(indicadoresQuery.data.matriculas) },
              { label: 'Aprovação média', value: formatPercent(indicadoresQuery.data.taxaAprovacao) },
              { label: 'Abandono médio', value: formatPercent(indicadoresQuery.data.taxaAbandono) }
            ].map((item) => (
              <article key={item.label} className="rounded-2xl border border-slate-800 bg-slate-900/80 p-6">
                <p className="text-sm text-slate-400">{item.label}</p>
                <p className="mt-3 text-2xl font-semibold text-slate-100">{item.value}</p>
              </article>
            ))
          )}
        </section>

        <section className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
          <article className="rounded-2xl border border-slate-800 bg-slate-900/80 p-6">
            <h2 className="mb-4 text-xl font-semibold">Série temporal</h2>
            <div className="h-72">
              {seriesQuery.isLoading ? (
                <p className="text-slate-300">Carregando série...</p>
              ) : seriesData.length ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={seriesData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis dataKey="ano" stroke="#94a3b8" />
                    <YAxis stroke="#94a3b8" />
                    <Tooltip formatter={(value: number) => formatInteger(value)} />
                    <Bar dataKey="valor" fill="#22d3ee" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-slate-300">Sem dados para os filtros selecionados.</p>
              )}
            </div>
          </article>

          <article className="rounded-2xl border border-slate-800 bg-slate-900/80 p-6">
            <h2 className="mb-4 text-xl font-semibold">Ranking</h2>
            {rankingQuery.isLoading ? (
              <p className="text-slate-300">Carregando ranking...</p>
            ) : rankingData.length ? (
              <div className="space-y-3">
                {rankingData.map((item, index) => (
                  <div key={item.co_mun} className="rounded-2xl bg-slate-950 p-4">
                    <p className="text-sm text-slate-400">{index + 1}. {item.no_mun}</p>
                    <p className="mt-2 text-xl font-semibold">{formatInteger(item.valor)}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-slate-300">Sem ranking no momento.</p>
            )}
          </article>
        </section>

        <section className="rounded-2xl border border-slate-800 bg-slate-900/80 p-6">
          <div className="mb-4 flex items-center justify-between gap-4">
            <h2 className="text-xl font-semibold">Tabela de dados</h2>
            <div className="flex items-center gap-2 text-sm text-slate-400">
              <span>Pagina {dadosQuery.data?.pagina ?? 1}</span>
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
          ) : dadosQuery.data?.itens.length ? (
            <div className="overflow-x-auto">
              <table className="min-w-full table-auto border-collapse text-sm text-slate-200">
                <thead>
                  <tr className="border-b border-slate-700 text-left text-xs uppercase tracking-[0.2em] text-slate-400">
                    <th className="px-3 py-3">Município</th>
                    <th className="px-3 py-3">Ano</th>
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
