# Arquitetura Base

## Camadas

1. `renderer` (UI)
2. `preload` (ponte segura)
3. `main` (orquestracao)
4. `services` (dominios: llm, memoria, logs, comandos, health)
5. `shared` (contratos)

Observacao: o modulo de update (Fase 1 incremental) ja segue o mesmo padrao (`services/update` + contratos `shared` + IPC/preload), com UI dedicada, provider GitHub opcional e `UpdateApplier` modular para aplicacao em reinicio (AppImage Linux + fallback).

No `renderer`, o shell principal esta organizado em tres areas (`left-rail`, `workspace`, `inspector`). A area de conversa do `workspace` segue a hierarquia `chat-hero -> messages -> composer`, com `messages` alimentado por eventos locais e respostas via IPC (`window.dexter.chat(...)`). O `chat-hero` pode operar em modo onboarding (expandido) e auto-compactar apos a primeira mensagem do usuario, enquanto um mini-header sticky local assume o resumo de contexto durante leitura longa do historico.
O `composer` pode oferecer autocomplete local de comandos (`/help`, `/health`, etc.) com preview de efeito (incluindo avisos para comandos destrutivos locais como `/clear`) e priorizacao contextual baseada apenas em estado local do renderer (saude/runtime/update/conversa); essa mesma priorizacao pode ser reutilizada para chips rapidos dinamicos do toolbar e um chip de acao contextual primaria (ex.: focar `Iniciar Runtime` ou `Aplicar Update`), com feedback visual temporario apos o foco guiado e anuncio `aria-live` discreto para acessibilidade. Feedbacks transitórios de interacao (ex.: autocomplete aplicado, copiar mensagem, reuso de resposta no composer e acoes do painel lateral como update/exportacao) tambem podem anunciar status em live regions locais, com deduplicacao curta por regiao para reduzir ruido de anuncios repetidos, sem poluir o layout; as janelas de dedupe/clear podem ser parametrizadas em constantes locais do renderer para tuning de UX. O composer tambem pode completar prefixos via `Tab`/`Enter` e expor atalhos globais de UX (ex.: nova sessao local e foco rapido no topo/config) sem alterar contratos IPC.
Preferencias puramente locais de interface (ex.: tema `dark/light/system`) podem ser persistidas no `localStorage` do renderer e refletidas via `data-*` no `body`, mantendo o `main`/IPC fora desse fluxo; o topbar pode expor esse seletor e, no modo `system`, reagir a `prefers-color-scheme` sem alterar contratos.

A UI pode aplicar enriquecimento visual no renderer para respostas de comandos canonicos (ex.: `/health`, `/env`, `/mem`, `/history`) sem alterar contratos IPC, mantendo fallback para texto bruto quando o formato nao corresponder.

O renderer tambem pode aplicar aprimoramentos puramente visuais na timeline (ex.: separadores por dia, marcadores de sessao locais numerados apos `/clear`, agrupamento de mensagens consecutivas, destaque de comandos, indicador transitorio de "Dexter analisando" sincronizado ao estado local `busy` do composer, separador local de `Novas mensagens` + affordance de "voltar ao fim" quando o usuario sobe no historico com contador local de novas respostas e mini-header sticky de contexto compacto baseado no estado atual de modelo/runtime/update, alem de acoes por mensagem como copiar/reusar no composer) sem alterar o payload persistido.

Para reduzir acoplamento no `renderer`, helpers de UI podem ser extraidos para modulos locais em `src/renderer/ui/` (ex.: composer/chat DOM, renderizacao de command cards, timeline e infraestrutura de live regions/acessibilidade), mantendo `src/renderer/main.ts` como orquestrador de eventos/IPC.

No dominio `agent`, o `DexterBrain` orquestra resposta e o `ConversationContextBuilder` agrega contexto de memoria, ambiente, configuracao operacional (modelo/endpoint) e sinais situacionais.

## Fluxo de mensagem

1. Usuario envia texto pela UI.
2. Renderer chama `window.dexter.chat(...)` via preload.
3. Main repassa ao `DexterBrain`.
4. `DexterBrain` decide: comando interno ou LLM provider.
5. Resposta retorna para renderer e vira item no historico.

## Memoria inteligente

- Curto prazo: contexto recente da sessao em RAM.
- Medio prazo: historico condensado por sessao em disco.
- Longo prazo: preferencias e fatos persistentes do usuario.

## Observabilidade

- Logs estruturados em arquivo local.
- Health checks (Ollama + memoria + logs).
- Trilha de eventos relevantes para auditoria.

## Seguranca por padrao

- `contextIsolation: true`
- `nodeIntegration: false`
- IPC restrito a canais definidos.
- Sem acesso direto ao sistema a partir do renderer.

## Expansao planejada

- Interface de providers LLM desacoplada.
- Registro modular de tools com policy engine.
- Permissoes explicitas por capacidade e escopo.
- Sistema de update modular (provider + estado + politica + applier), com rollout inicial atomico e compatibilidade futura entre `core` e `ui` planejada em `docs/update-system-plan.md`.

## Padrao de implementacao de modulos

Use `docs/module-implementation-guide.md` como referencia obrigatoria para novos modulos e refactors estruturais.
