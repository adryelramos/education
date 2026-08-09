# Education Project

Este workspace foi preparado como base inicial para o desafio técnico full-stack.

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
