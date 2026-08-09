# Education Project

Este projeto é uma aplicação full-stack para análise de dados educacionais de municípios de Alagoas.
Ele permite importar arquivos CSV, validar e armazenar os registros no PostgreSQL e visualizar os dados em um dashboard interativo. A interface apresenta indicadores, séries históricas, rankings municipais, comparações por rede ou etapa de ensino e uma tabela detalhada.
Os filtros globais permitem selecionar múltiplos municípios, anos, fontes, redes, etapas e variáveis. O sistema também trata corretamente diferentes tipos de dados, utilizando soma para quantidades e média para taxas.
A aplicação utiliza Node.js, Express, TypeScript, Prisma e PostgreSQL no backend, com React, Vite, Tailwind CSS, TanStack Query e Recharts no frontend.

## Estrutura

- backend: API Express + TypeScript + Prisma + PostgreSQL
- frontend: React + Vite + Tailwind + React Query
- docker-compose: banco PostgreSQL local

## Como começar

1. Instale as dependências:
   ```bash
   npm install
   ```
2. Suba o banco PostgreSQL:
   ```bash
   docker compose up -d
   ```
3. Copie o arquivo de ambiente e ajuste a URL do banco:
   ```bash
   cp .env.example .env
   ```
4. Gere o cliente Prisma:
   ```bash
   npx prisma generate --workspace apps/backend
   ```
5. Inicie o projeto:
   ```bash
   npm run dev
   ```

## Endpoints iniciais

- Backend: http://localhost:3333/health
- Frontend: http://localhost:5173
