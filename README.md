# Dexter

Dexter e um assistente local com interface premium em Electron, projetado para evoluir de chat inteligente para agente pessoal modular com integracao profunda ao sistema operacional.

Foco de distribuicao nesta fase: **Linux apenas**.

## Objetivos desta base

- Arquitetura modular e profissional, pronta para crescimento por plugins e tools.
- Integracao com LLM local via Ollama (modo inicial) com onboarding amigavel.
- UX moderna, confortavel e eficiente, com comandos curtos e claros.
- Memoria inteligente em camadas (curto, medio e longo prazo).
- Observabilidade: logs, health checks, debug e trilha de auditoria.
- Qualidade: testes automatizados e estrutura previsivel para CI.

## Decisao de dependencia do Ollama

Dexter **nao embute Ollama por padrao nesta fase**. Em vez disso, usa uma estrategia robusta:

- Detecta automaticamente se o Ollama esta disponivel.
- Mostra orientacoes de setup dentro do app quando necessario.
- Mantem o provedor LLM desacoplado para futuras opcoes (LM Studio, llama.cpp, backend proprio, etc).

Essa abordagem reduz risco operacional no inicio e evita acoplamento prematuro do empacotamento do app a um runtime externo.

## Runtime e modelos (UI)

- Painel de runtime com diagnostico, comando sugerido de instalacao e tentativa de inicializacao.
- Catalogo curado de modelos locais gratuitos com download/remocao pela interface.
- Contexto de ambiente local (SO, shell e comandos principais) para respostas mais conscientes no Linux.
- Contexto situacional de operacoes recentes de modelo para respostas mais inteligentes sobre estado local.
- Persistencia de politicas de permissao para a evolucao segura de tools sensiveis.
- Exportacao de auditoria pela interface (`json`/`csv`) para historico de modelos e logs, com filtro por periodo.

## Scripts principais

- `npm run dev` inicia renderer + main + Electron em modo desenvolvimento.
- `npm run build` gera build de producao (`dist`).
- `npm run test` executa testes unitarios.
- `npm run test:coverage` executa testes com cobertura e threshold por modulo.
- `npm run test:e2e` executa testes E2E com Playwright.
- `npm run check` roda typecheck + testes.
- `npm run quality:ci` roda typecheck + gate de cobertura.
- `npm run ci` roda validacao completa (check + e2e/visual).
- `npm run pack` gera pacote local Linux sem instalador final.
- `npm run dist` gera artefatos Linux via electron-builder (`AppImage` e `deb`).

Workflow CI: `.github/workflows/ci.yml` (push/PR + `workflow_dispatch`).
Workflow release Linux: `.github/workflows/release-linux.yml` (tag semver `vX.Y.Z`/`vX.Y.Z-rc.1` ou manual com `tag`).

## Comandos in-app (curtos e claros)

- `/help` lista comandos disponiveis.
- `/health` mostra saude do runtime local.
- `/env` resume ambiente local (Linux/shell/comandos).
- `/history [n] [pull|remove] [running|done|error|blocked]` mostra historico recente de operacoes.
- `/clear` limpa memoria curta da sessao atual.
- `/model <nome>` altera modelo ativo.
- `/mem` mostra resumo da memoria atual.
- `/remember <nota>` salva nota no longo prazo.

## Estrutura

- `docs/` escopo, arquitetura, roadmap e decisoes.
- `src/main/` processo principal Electron e nucleo Dexter.
- `src/renderer/` interface da aplicacao.
- `src/shared/` contratos e tipos compartilhados.
- `tests/` testes unitarios de modulos criticos.
- `assets/icons/` icones do app, bandeja e status.

## Roadmap resumido

1. Base conversacional local com memoria em camadas e logs.
2. Sistema de permissao explicita para tools sensiveis.
3. Integracao controlada ao sistema de arquivos.
4. Ferramentas modulares plugaveis por capacidade.
5. Diagnostico e auto-ajuda assistida no proprio Dexter.

Consulte `docs/scope.md`, `docs/architecture.md`, `docs/vision.md`, `docs/runtime-model-management.md` e `docs/module-implementation-guide.md` para detalhes.
