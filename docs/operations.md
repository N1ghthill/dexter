# Operacao e Debug

## Fluxo de desenvolvimento

1. `npm install`
2. `npm run dev`
3. `npm run check` antes de commit
4. para novos modulos/refactors, seguir `docs/module-implementation-guide.md` (template canonico + matriz minima de testes)
5. para mudancas de persistencia/IPC/export, executar o checklist "Padrao consolidado de hardening modular"

## Logs

- Local: pasta de `userData` do Electron em `logs/dexter.log`
- Rotacao simples ao atingir 2MB (`dexter.log.1`)

## Health checks

- Endpoint Ollama configurado: `http://127.0.0.1:11434`
- Comando in-app: `/health`
- Painel Runtime: status, tentativa de start e instalacao assistida.

## Diagnostico rapido

- Sem resposta do modelo: execute `/health`.
- Ver ultimas operacoes de modelo: use `/history`.
- Exportar auditoria: use os botoes `Exportar Historico` e `Exportar Logs` no painel de modelos e defina periodo opcional.
- Presets rapidos de periodo: `Hoje`, `7 dias`, `30 dias` e `Limpar`.
- Datas invalidas de periodo (ex.: `2026-02-31`) sao rejeitadas pela UI antes da exportacao.
- Modelo nao encontrado: ajuste com `/model <nome>`.
- Confirmar contexto do host Linux: use `/env`.
- Contexto confuso: execute `/clear` para limpar sessao curta.
- Salvar algo importante: use `/remember <nota>`.
- Baixar modelo por UI: selecione no catalogo curado e clique em `Baixar Modelo`.

## Scripts curtos

- `dev`: ambiente completo de desenvolvimento.
- `build`: build de producao.
- `test`: testes unitarios.
- `test:coverage`: testes + cobertura com threshold por modulo.
- `test:e2e`: testes end-to-end com Playwright (modo mock).
- `check`: typecheck + testes.
- `quality:ci`: typecheck + gate de cobertura do CI.
- `ci`: fluxo completo local (typecheck + unit + e2e/visual).
- `dist`: empacotamento final Linux (`AppImage` e `deb`).
- Gate de cobertura por arquivo (Vitest): `lines/stmts >= 60`, `functions >= 90`, `branches >= 55`.

## Pipeline de hardening recomendado

Use este fluxo sempre que tocar modulo de dominio:

1. alterar codigo com foco em contratos, fallback e limites operacionais.
2. adicionar testes de:
   - sucesso
   - entrada invalida
   - dependencia indisponivel
   - recuperacao de estado/persistencia
   - protecao contra mutacao externa
3. executar:
   - `npm run test -- <testes_do_modulo>`
   - `npm run quality:ci`
   - `npm run test:e2e` quando houver impacto em IPC/preload/renderer

## CI automatizado

- Workflow: `.github/workflows/ci.yml`
- Gatilhos: `push` (`main`/`master`), `pull_request` e `workflow_dispatch`.
- Jobs:
  - `Typecheck + coverage gate` executa `npm run quality:ci`.
  - `E2E + Visual` executa `npm run test:e2e` em `xvfb` para validar Electron + snapshots.
- Em falha de E2E, `test-results/` e publicado como artefato para diagnostico.

## Release Linux automatizado

- Workflow: `.github/workflows/release-linux.yml`
- Gatilhos:
  - `push` em tags `v*` (exemplo: `v0.1.0`)
  - `workflow_dispatch` manual
- Observacao:
  - no modo manual, para publicar GitHub Release e obrigatorio informar `tag`.
  - a tag de publicacao deve seguir semver com prefixo `v` (`vX.Y.Z` ou `vX.Y.Z-rc.1`) e bater com `package.json`.
- Fluxo:
  - roda gate de qualidade (`npm run ci`) em `xvfb`
  - gera build Linux (`npm run dist`)
  - gera checksum `release/SHA256SUMS.txt` para verificacao dos binarios
  - gera manifesto de update `release/dexter-update-manifest.json` (AppImage + checksum + compatibilidade base)
  - assina o manifesto (`release/dexter-update-manifest.json.sig`, assinatura detached Ed25519 em base64) quando `secrets.DEXTER_UPDATE_MANIFEST_PRIVATE_KEY_PEM` estiver configurado
  - para publicacao de GitHub Release (`should_publish=true`), a secret de assinatura do manifesto e obrigatoria
  - publica artefatos (`AppImage`, `deb`, `SHA256SUMS.txt`, `dexter-update-manifest.json` e opcionalmente `.sig`) e pode criar GitHub Release automaticamente

## Proximo modulo transversal (planejado)

- Sistema de update: ver `docs/update-system-plan.md` para estrategia incremental (rollout atomico primeiro, com compatibilidade futura entre `core` e `ui`).
- Estado atual: painel inicial de update + scaffold backend/IPC/preload ja existem (check/download/politica/restart via mock/noop); provider real ainda nao foi ativado por padrao.
- Provider GitHub Releases existe e pode ser ativado opcionalmente por ambiente:
  - `DEXTER_UPDATE_PROVIDER=github`
  - `DEXTER_UPDATE_GITHUB_REPO=<owner>/<repo>` (ex.: `N1ghthill/dexter`)
  - verificacao de assinatura do manifesto (recomendado para producao):
    - `DEXTER_UPDATE_MANIFEST_PUBLIC_KEY_PEM` (PEM em string, aceita `\n`)
    - ou `DEXTER_UPDATE_MANIFEST_PUBLIC_KEY_PATH` (arquivo PEM local)
  - quando a chave publica esta configurada, o provider exige `dexter-update-manifest.json.sig` valido; releases sem assinatura valida sao ignoradas
- Verificador de rollout piloto (smoke real de release remota):
  - comando: `npm run update:pilot:verify`
  - uso minimo:
    - `DEXTER_UPDATE_GITHUB_REPO=N1ghthill/dexter npm run update:pilot:verify`
  - uso recomendado (com assinatura + checksum do asset):
    - `DEXTER_UPDATE_GITHUB_REPO=N1ghthill/dexter DEXTER_UPDATE_MANIFEST_PUBLIC_KEY_PATH=/path/public.pem DEXTER_UPDATE_REQUIRE_SIGNED_MANIFEST=1 DEXTER_UPDATE_VERIFY_DOWNLOAD=1 npm run update:pilot:verify`
  - comportamento:
    - consulta releases do GitHub
    - seleciona candidato por canal (`stable`/`rc`)
    - valida manifesto remoto
    - verifica assinatura `.sig` quando chave publica estiver configurada
    - opcionalmente baixa o asset e valida `checksumSha256`
  - se nao encontrar release valida, retorna `exit code 1` com motivos das releases ignoradas
- Piloto de rollout real (recomendado, antes de ativar para usuarios):
  1. publicar uma release assinada (workflow Linux com `DEXTER_UPDATE_MANIFEST_PRIVATE_KEY_PEM`)
  2. rodar `npm run update:pilot:verify` com chave publica e `DEXTER_UPDATE_VERIFY_DOWNLOAD=1`
  3. iniciar um ambiente de teste com:
     - `DEXTER_UPDATE_PROVIDER=github`
     - `DEXTER_UPDATE_GITHUB_REPO=<owner>/<repo>`
     - `DEXTER_UPDATE_MANIFEST_PUBLIC_KEY_PATH` (ou `_PEM`)
  4. no painel de updates, executar manualmente `Verificar -> Baixar Update -> Aplicar no Reinicio`
  5. exportar `Auditoria Update` (preferencialmente preset `Erros de Update`) para evidenciar o piloto
- Fluxo atual de "Aplicar no Reinicio":
  - `UpdateState` persiste `stagedArtifactPath` para o artefato baixado
  - em Linux, quando o artefato staged e `.AppImage`, o app tenta handoff (spawn do AppImage staged) e encerra a instancia atual
  - se nao houver applier por formato compativel, usa fallback de `relaunch` controlado
  - a substituicao/rollback por todos os formatos (deb etc.) segue como etapa de hardening do provider/applier
- Diagnostico de bloqueio de update (UI):
  - quando existe update remoto mas o `check` bloqueia localmente (ex.: schema/migracao), o painel exibe motivo especifico em `Notas` e marca `bloqueio local`.
  - `UpdateState.lastErrorCode` foi adicionado para UI/telemetria (sem depender de parsing do texto em `lastError`).
  - o card de updates diferencia visualmente erros de compatibilidade (bloqueio local) de erros operacionais/rede (`data-error-kind`).
- Exportacao de auditoria (logs):
  - `exportLogs` agora aceita filtro `scope` (`all` | `updates`) no contrato IPC/preload.
  - UI possui atalho `Logs de Update` para exportar somente eventos de update (`update.*` + `app.relaunch` com motivo de update).
  - UI tambem possui seletor persistente (via `localStorage`) para escopo de logs na exportacao padrao (`Exportar Logs`).
  - preview de exportacao mostra contagem de eventos no escopo selecionado, estimativa de tamanho por formato (`json`/`csv`) e resume `formato`/`periodo` aplicados antes do download.
  - UI tambem possui `Auditoria Update`, uma exportacao dedicada (`json/csv`) da trilha de eventos de update em schema proprio (`dexter.update-audit.v1` no JSON).
  - `Auditoria Update` aceita filtros estruturados por familia (`all`, `check`, `download`, `apply`, `migration`, `rollback`, `other`), severidade (`all` / `warn-error`) e presenca de `code` (`codeOnly`).
  - `Auditoria Update` possui janela temporal relativa dedicada (`custom`, `24h`, `7d`, `30d`) para preview/export sem depender dos campos de data manuais quando um preset relativo esta selecionado.
  - UI mostra preview dedicado da `Auditoria Update` com contagem/estimativa considerando os filtros selecionados.
  - UI persiste localmente (`localStorage`) os filtros da `Auditoria Update` (`family`, `severity`, `codeOnly`) entre recargas.
  - UI tambem persiste a janela temporal relativa da `Auditoria Update` (`custom`, `24h`, `7d`, `30d`).
  - UI possui atalho rapido `Erros de Update` (configura `severity=warn-error`, `codeOnly=on`, `logs: updates` e executa a exportacao dedicada de auditoria).
  - exportacoes de auditoria retornam metadados de integridade no payload IPC/preload (`sha256`, `contentBytes`); a exportacao JSON de `Auditoria Update` tambem inclui `integrity.itemsSha256`, e a CSV inclui rodape com hash/contagem.
- Migracao de `userData` (estado atual):
  - bootstrap registra/adota `userDataSchemaVersion` em `updates/user-data-schema-state.json`
  - upgrades de schema sem migracao registrada sao bloqueados no `check` de updates
  - runner cria backup em `updates/migration-backups/` e faz rollback dos arquivos rastreados se a migracao falhar
  - primeira migracao real registrada: `1 -> 2` (normalizacao de `permissions/policies.json`)
  - schema atual do app continua `1`; a migracao `1 -> 2` ainda nao e executada em producao ate bump de versao de schema
