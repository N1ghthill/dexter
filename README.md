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
- No Linux, a instalacao de runtime tenta fluxo privilegiado com `pkexec`; sem prompt grafico/polkit disponivel, o app retorna fluxo assistido com orientacao manual no terminal (incluindo exemplo com `sudo`).
- Em builds Linux empacotados, o Dexter inclui um helper privilegiado whitelistado (via `pkexec`) para setup do runtime quando o ambiente suporta PolicyKit; em desenvolvimento o app permanece nos fallbacks para evitar elevar scripts editaveis do workspace.
- Catalogo curado de modelos locais gratuitos com download/remocao pela interface.
- Contexto de ambiente local (SO, shell e comandos principais) para respostas mais conscientes no Linux.
- Contexto de identidade operacional (usuario local, host e modo/caminho de instalacao) para respostas mais conscientes e rastreaveis.
- Resolucao de usuario em foco por sessao (com contexto recente), sem sobrescrever identidade persistente automaticamente.
- Contexto situacional de operacoes recentes de modelo para respostas mais inteligentes sobre estado local.
- Captura de preferencias conversacionais explicitas (idioma/tom/nivel de detalhe) para memoria de longo prazo.
- Protocolo de seguranca no prompt do agente (leitura por padrao; escrita/sobrescrita so com pedido explicito e respeito a permissao).
- Persona v1 do Dexter no system prompt (prioridades obrigatorias, contrato de resposta e estilo tecnico-didatico).
- Persistencia de politicas de permissao para a evolucao segura de tools sensiveis.
- Exportacao de auditoria pela interface (`json`/`csv`) para historico de modelos e logs, com filtro por periodo.

## Notas de operacao (Linux/.deb)

- A permissao interna do Dexter (`allow/ask/deny`) controla o que o app pode tentar fazer, mas nao substitui privilegio do sistema.
- Instalacao do Ollama em Linux normalmente exige privilegio administrativo. Quando nao for possivel abrir prompt grafico (`pkexec`), execute o comando assistido no terminal do host com `sudo` e depois volte ao app para iniciar o runtime/validar (`/health`).
- Em build empacotada, o helper privilegiado Linux e resolvido em `process.resourcesPath/helpers/linux/dexter-runtime-helper.sh` (extraResources), evitando execucao de script dentro de `app.asar`.
- Problemas de rolagem/layout da UI nao sao especificos do formato `.deb`; o renderer e o mesmo entre execucao local e build empacotado.

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
Inclui smoke de `.deb` em container Ubuntu limpo (`DEB Smoke (Container)`), com instalacao real e validacao de bootstrap por log.
Workflow release Linux: `.github/workflows/release-linux.yml` (tag semver `vX.Y.Z`/`vX.Y.Z-rc.1` ou manual com `tag`).
O workflow de release publica tambem `dexter-update-manifest.json` para o provider de updates.

## Comandos in-app (curtos e claros)

- `/help` lista comandos disponiveis.
- `/whoami` mostra identidade operacional (Dexter + usuario local detectado + usuario lembrado).
- `/now` mostra contexto situacional em tempo real (hora/data/fuso/sistema/host/diretorio atual).
- `/name <apelido>` define nome persistente para o Dexter usar como padrao entre sessoes.
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
- `assets/novos_assets/` referencias visuais brutas para adaptacao de UI/branding (nao usadas direto no build).
- `assets/illustrations/mascot/` mascotes derivados (fundo limpo + canvas padronizado) para UI.

## Assets de UI (mascote/icones)

- Para regenerar os assets derivados a partir de `assets/novos_assets/` (limpeza de fundo, recorte, variantes leves para UI em `webp` e icones Linux em `assets/icons/linux/`), execute:
  - `npm run assets:prepare-ui`
- Requisito local: `ImageMagick` (`magick`).
- Uso atual: o renderer usa mascotes derivados no hero/onboarding do chat e o conjunto `assets/icons/linux/` para branding da janela/build Linux.

## Roadmap resumido

1. Base conversacional local com memoria em camadas e logs.
2. Sistema de permissao explicita para tools sensiveis.
3. Integracao controlada ao sistema de arquivos.
4. Ferramentas modulares plugaveis por capacidade.
5. Diagnostico e auto-ajuda assistida no proprio Dexter.

Consulte `docs/scope.md`, `docs/architecture.md`, `docs/vision.md`, `docs/security-model.md`, `docs/linux-setup-onboarding.md`, `docs/runtime-model-management.md`, `docs/update-system-plan.md`, `docs/update-rollout-modes.md`, `docs/update-rollout-runbook.md`, `docs/update-rollout-checklist-template.md`, `docs/release-promotion-playbook.md` e `docs/module-implementation-guide.md` para detalhes.
