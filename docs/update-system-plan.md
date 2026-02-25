# Plano de Sistema de Updates

## Objetivo

Adicionar updates no Dexter sem quebrar a filosofia do projeto:

- modularidade com baixo acoplamento
- evolucao segura
- transparencia para o usuario
- hardening com testes e fallback previsivel

## Status atual (implementado nesta fase)

- Scaffold inicial entregue no backend:
  - `UpdatePolicyStore`
  - `UpdateStateStore`
  - `UpdateService`
  - `NoopUpdateProvider` (sem provider real ainda)
- IPC/preload com contratos de update expostos para evolucao incremental.
- Mock API de preload cobre fluxo basico `check -> download -> staged` para testes.
- UI inicial de update (painel no renderer) conectada ao scaffold de `state/policy/check/download/restart`.
- Provider GitHub Releases implementado de forma **opcional** (ativacao por variaveis de ambiente), com validacao de manifesto, verificacao opcional de assinatura detached (`.sig`) e checksum no download.
- Manifesto de update evoluido para suportar `artifacts[]` (multi-artefato, ex.: `AppImage` + `deb`) com selecao por runtime no provider, mantendo campos legados para compatibilidade.
- Verificador de rollout piloto (`npm run update:pilot:verify`) adicionado para validar release remota real (manifesto, assinatura e checksum do asset) antes da ativacao no app de teste.
- Playbook de promocao `RC -> stable` documentado em `docs/release-promotion-playbook.md` (go/no-go, evidencias, rollback).
- Presets operacionais de rollout (`dev`, `pilot`, `testers`, `stable`) documentados em `docs/update-rollout-modes.md`, com script `npm run update:rollout:preset`.
- Runbook operacional por cenario (`pilot rc`, `testers stable`, `stable canary`) documentado em `docs/update-rollout-runbook.md`.
- Template marcavel de execucao para PR/issue documentado em `docs/update-rollout-checklist-template.md`.
- `main` continua seguro por padrao com `NoopUpdateProvider` quando nao configurado.
- Reinicio controlado para aplicar update staged foi adicionado (acao explicita via UI/IPC/service, com `app.relaunch` no `main`).
- `UpdateApplier` modular introduzido no `main`:
  - `LinuxAppImageUpdateApplier` (handoff para AppImage staged quando aplicavel)
  - `LinuxDebUpdateApplier` (aplicacao assistida via `xdg-open` e opcionalmente fluxo privilegiado controlado `pkexec + apt`, com fallback seguro inclusive para falhas de spawn)
  - fallback `ElectronRelaunchUpdateApplier`
- `UpdateState` agora persiste `stagedArtifactPath` para evitar inferencia fraca do provider no momento da aplicacao.
- Provider GitHub faz cleanup local best-effort de diretorios staged antigos (retencao de downloads) apos staging bem-sucedido.
- `UpdateStartupReconciler` limpa estado `staged` ja aplicado/obsoleto no bootstrap e faz cleanup seguro (escopo restrito a `updates/downloads`).
- `UpdateApplyAttemptStore` + `UpdatePostApplyCoordinator` adicionados para validacao pos-aplicacao no boot e rollback automatico `.deb` em falha de boot (opt-in, escopo atual limitado).
- Handshake de boot saudavel renderer -> main (`reportBootHealthy`) adicionado de forma opcional, com grace period configuravel e janela de estabilidade opcional, para endurecer criterio de sucesso pos-update antes de limpar a tentativa de apply.
- `UpdateState.lastErrorCode` adicionando diagnostico estruturado para UI/telemetria (ex.: `ipc_incompatible`, `schema_migration_unavailable`).
- exportacao de logs suporta filtro `scope: updates` para facilitar auditoria dos eventos de update, com preview de contagem/estimativa no painel.
- exportacao dedicada de trilha de updates (`Auditoria Update`) adicionada em `json/csv` com schema JSON `dexter.update-audit.v1`, filtros por familia/severidade/code (`check/download/apply/migration/...`, `warn-error`, `codeOnly`), janela temporal relativa dedicada (`24h/7d/30d/custom`), preview dedicado de contagem/estimativa e hashes de integridade.
- `UpdateMigrationPlanner` e `UserDataMigrationRunner` adicionados:
  - bootstrap do app inicializa/adota `userDataSchemaVersion` local
  - updates com `schemaVersion` nao migravel localmente sao bloqueados no `check`
  - runner agora faz backup/rollback de arquivos rastreados em migracoes
  - primeira migracao real registrada: `1 -> 2` (normalizacao conservadora de `permissions/policies.json`)
  - `USER_DATA_SCHEMA_VERSION` atual do app ainda permanece `1` (migracao pronta para bump futuro)

## Decisao arquitetural (cirurgica)

Implementar em fases, com foco em seguranca e compatibilidade:

1. **Fase 1 (recomendada): update atomico do app**
   - Atualiza o pacote completo (core + preload + renderer + shared) como uma unidade.
   - Reduz risco de incompatibilidade entre `main`, `preload`, `renderer` e contratos IPC.
   - Mantem rollback e suporte operacional mais simples.

2. **Fase 2 (opcional, depois): estrategia "core x UI"**
   - Separar **versionamento logico** de `core` e `ui`.
   - Permitir avaliacao de update parcial de UI **somente** se compatibilidade de contrato for garantida.
   - Nao fazer hot-update de `preload`/IPC/servicos sensiveis sem reinicio e verificacao forte.

Resumo: a sua intuicao (core e UI) faz sentido como modelo arquitetural, mas a primeira entrega deve ser **atomica**, com separacao por componentes no metadado e nas regras de compatibilidade.

## Modelo de componentes (versionamento interno)

Mesmo na Fase 1, registrar versoes internas para preparar evolucao:

- `appVersion`: versao semver do pacote distribuido
- `coreVersion`: `main` + `services` + regras de negocio
- `uiVersion`: renderer (layout/fluxos)
- `ipcContractVersion`: compatibilidade `preload`/`shared/contracts`/IPC
- `userDataSchemaVersion`: versao das persistencias locais (`config`, `memory`, `history`, `permissions`, `logs`)

Isso permite:

- detectar incompatibilidades antes de aplicar update
- criar migracoes de dados com controle
- suportar UI parcial no futuro sem "adivinhar" compatibilidade

## Modulos propostos (Fase 1)

Seguindo `docs/module-implementation-guide.md`, adicionar modulo transversal de update:

- `src/main/services/update/UpdateService.ts`
  - orquestra check, download, validacao, agendamento de instalacao
- `src/main/services/update/UpdateProvider.ts`
  - interface para provider de release (GitHub Releases inicialmente)
- `src/main/services/update/UpdatePolicyStore.ts`
  - canal (`stable|rc`), auto-check, janela de reminder
- `src/main/services/update/UpdateStateStore.ts`
  - estado persistido do ultimo check/download/erro
- `src/main/services/update/UpdateManifestValidator.ts`
  - valida payload remoto (versao, checksums, compatibilidade)
- `src/main/services/update/UpdateMigrationPlanner.ts`
  - decide se requer migracao de `userData` e bloqueios de compatibilidade
- `src/main/services/update/UserDataSchemaStateStore.ts`
  - persistencia do `userDataSchemaVersion` local (marcador de schema)
- `src/main/services/update/UserDataMigrationRunner.ts`
  - executa migracoes versionadas (atualmente bootstrap/adocao idempotente + framework para steps)
- `src/main/services/update/UpdateApplier.ts`
  - interface de aplicacao/restart por formato
- `src/main/services/update/LinuxAppImageUpdateApplier.ts`
  - preflight + handoff seguro do AppImage staged (Linux)
- `src/main/services/update/ElectronRelaunchUpdateApplier.ts`
  - fallback conservador de relaunch do app atual

Camadas auxiliares:

- `src/shared/contracts.ts`
  - contratos de status/progresso/erro de update
- `src/shared/ipc.ts`
  - canais `update:*`
- `src/main/ipc/registerIpc.ts`
  - handlers de check/download/apply
- `src/main/preload.ts`
  - API segura `window.dexter.*` para updates
- `src/renderer/components/governance/GovernancePanel.tsx`
  - painel/status/acoes de update (camada React)
- `src/renderer/legacy-main.ts`
  - orquestracao de eventos/IPC e integracao com estado/DOM legado

## Fluxo seguro (Fase 1)

1. UI solicita `checkForUpdates`.
2. `UpdateService` consulta provider remoto.
3. Manifesto remoto e payload sao validados (estrutura + checksum + compatibilidade).
4. Se houver update compativel:
   - UI mostra versao, notas e impacto (reinicio necessario).
   - usuario aprova download (ou politica automatica).
5. Download concluido e validado.
6. Update fica **staged** para aplicar em reinicio.
7. App reinicia para aplicacao do update staged.
   - Linux/AppImage possui handoff dedicado (spawn do AppImage staged + encerramento do app atual, com tratamento de falha assincrona de spawn)
   - Linux/`.deb` possui aplicacao assistida (abertura do instalador do sistema) e opcao de fluxo privilegiado controlado (`pkexec + apt`) com fallback para instalador padrao
   - bootstrap reconcilia `staged` persistido apos restart/manual upgrade para evitar estado travado e limpar staged local obsoleto
   - boot valida tentativa de apply registrada (`apply-attempt.json`) e registra resultado (`validation_passed` / `validation_not_applied`); opcionalmente exige handshake de boot saudavel do renderer e pode manter janela de estabilidade antes de concluir sucesso
   - falhas de renderer (`render-process-gone` / `did-fail-load`) durante a janela de validacao sao tratadas como falha de boot para rollback opt-in
   - rollback `.deb` em falha de boot e opt-in quando houver pacote anterior local
   - formatos restantes continuam em fallback de relaunch ate o hardening completo do applier por formato.
8. Ao abrir novamente:
   - roda migracoes de `userData` (se houver)
   - registra sucesso/falha de migracao/update em log

## Compatibilidade e politica "core x UI"

Para separar `core` e `ui` sem fragilizar o sistema:

- `ui` so pode atualizar sem pacote completo se:
  - `ipcContractVersion` for identico
  - `coreVersion` estiver dentro de faixa compativel declarada
  - payload estiver assinado/verificado
  - existir rollback local para UI anterior
- `preload`, `shared/contracts` e `main/services` devem continuar no fluxo atomico por padrao

Regra conservadora:

- se houver duvida de compatibilidade, **forcar update atomico**

## Persistencia e migracoes

Arquivos que exigem cuidado:

- `config/dexter.config.json`
- `memory/medium-memory.json`
- `memory/long-memory.json`
- `history/model-operations.json`
- `permissions/policies.json`
- `logs/dexter.log` (rotacao pode continuar simples)

Padrao recomendado:

- migracoes versionadas e idempotentes
- backup local antes de migracao estrutural
- backup/rollback automatico dos arquivos rastreados por migracao (estado atual do runner)
- fallback seguro com autocorrecao (ja alinhado ao hardening atual)
- log estruturado de inicio/fim/erro de migracao

## Testes obrigatorios (antes de habilitar update em producao)

### Unitarios

- parse/validacao de manifesto remoto
- comparacao semver/canais (`stable`, `rc`)
- matriz de compatibilidade (`core`, `ui`, `ipcContractVersion`, schema)
- state machine de update (`idle`, `checking`, `available`, `downloading`, `staged`, `error`)
- falha de checksum/manifesto invalido/timeout

### IPC / preload

- contratos `update:*` (shape de payload e erros)
- bloqueio de acoes invalidas por estado (ex.: aplicar sem download)

### Renderer / E2E

- fluxo check -> download -> staged -> reiniciar (mockado)
- mensagens de erro acionaveis
- regressao visual do painel de update

### Migracoes

- dados antigos validos
- dados corrompidos/parciais
- rollback quando migracao falha

## Observabilidade e auditoria

Adicionar eventos de log (sem dados sensiveis):

- `update.check.start|finish`
- `update.download.start|progress|finish`
- `update.apply.scheduled`
- `update.migration.start|finish|error`
- `update.rollback.triggered` (quando existir)

Exportacao de eventos de update ja esta integrada ao pipeline de auditoria em duas formas:

- logs gerais com filtro `scope: updates`
- exportacao dedicada de trilha de updates (`json/csv`) com schema proprio para consulta/forense, incluindo filtros combinados (familia/severidade/code), janela temporal relativa e metadados de integridade (`sha256`, `itemsSha256`)

## Integracao com release/CI

Mudancas previstas no pipeline:

- publicar metadados de update junto aos artefatos de release
- checksums obrigatorios (ja existe base com `SHA256SUMS.txt`)
- canal de release (`stable`/`rc`) consistente com tag semver
- smoke test de fluxo de update com provider mockado no CI

Observacao:

- a implementacao final deve confirmar a estrategia exata de distribuicao Linux suportada pelo pacote escolhido (sem assumir comportamento automatico igual em todos os formatos).

## Plano de execucao sugerido (incremental)

1. **Contrato e estado**
   - criar contratos `shared` + state store + policy store
   - status: concluido (scaffold)
2. **Provider mock + UI**
   - fechar UX, estados e IPC com testes/E2E
   - status: concluido (UI inicial + IPC/mock + E2E)
3. **Provider real**
   - integrar release metadata, assinatura de manifesto e checksum
   - status: implementado de forma opcional (GitHub Releases + manifesto + assinatura opcional + checksum)
4. **Aplicacao em reinicio**
   - staged update e fluxo de confirmacao
   - status: parcialmente concluido (UI/IPC/service + relaunch controlado + handoff AppImage em Linux + aplicacao assistida `.deb`)
5. **Migracoes**
   - schema version + runner idempotente
   - status: parcialmente concluido (planner + marker + runner com backup/rollback + migracao 1->2 registrada)
6. **Hardening**
   - falhas de rede, corrupcao de manifesto, rollback
   - status: em andamento (checksum + assinatura de manifesto + verificador de piloto + bloqueios de compatibilidade + migracao/rollback de dados + retencao/cleanup local de staged downloads + reconciliacao de staged no startup + validacao pos-apply no boot + handshake de boot saudavel com grace period + janela de estabilidade opcional + watchdog interno de falha de renderer + fluxo `.deb` privilegiado opcional + rollback `.deb` opt-in em falha de boot)
7. **(Opcional) UI-only update**
   - somente apos matriz de compatibilidade madura e rollback provado

## Definition of Done (modulo update)

Antes de ativar para usuarios:

1. `npm run typecheck`
2. `npm run test`
3. `npm run test:e2e` com fluxo mockado de update
4. docs de arquitetura + operacao atualizadas
5. cenarios de falha (rede/checksum/manifesto/migracao) cobertos
6. fallback claro para "continuar na versao atual"
