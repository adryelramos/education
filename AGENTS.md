# AGENTS.md

## Visão geral

Este repositório é um projeto full-stack para o desafio técnico, com backend em Node.js/TypeScript, frontend em React/Vite e banco PostgreSQL.

## Stack principal

- Backend: Express, TypeScript, Prisma, PostgreSQL, Zod
- Frontend: React, Vite, Tailwind CSS, TanStack Query, Recharts
- Gerenciamento de dependências: npm workspaces

## Regras de trabalho

- Faça mudanças pequenas e consistentes com a estrutura existente.
- Preserve a organização em pastas: apps/backend para o servidor e apps/frontend para a interface.
- Prefira soluções simples e legíveis.
- Sempre valide com build ou execução local antes de concluir alterações.

## Comandos úteis

- Instalar dependências: npm install
- Subir o banco: docker compose up -d
- Iniciar o projeto: npm run dev
- Validar o projeto: npm run build
- Verificar a API: http://localhost:3333/health
- Verificar o frontend: http://localhost:5173

## Convenções

- Use TypeScript em todo o backend e no frontend.
- Mantenha endpoints REST claros e bem nomeados.
- Para importação de CSV, priorize validação por linha e processamento eficiente.
- Para o frontend, mantenha componentes simples e reutilizáveis.

## Observações importantes

- O arquivo .env já está preparado com a URL do banco local.
- O backend deve continuar funcionando com o Prisma e o PostgreSQL.
- O frontend deve consumir a API através de endpoints bem definidos.
