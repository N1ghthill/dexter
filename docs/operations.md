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
- Espelho opcional para debug de build empacotada:
  - `DEXTER_LOG_MIRROR_TMP=1` (somente build empacotada): espelha logs em `/tmp/dexter.log`
  - `DEXTER_DEBUG_LOG_PATH=/caminho/absoluto/dexter.log`: espelha logs no caminho informado (dev ou prod)

## Health checks

- Endpoint Ollama configurado: `http://127.0.0.1:11434`
- Comando in-app: `/health`
- Painel Runtime: status, tentativa de start, reparo/reinicio local guiado e instalacao assistida.

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

## Empacotamento .deb (inspecao)

- Gerar apenas `.deb` localmente:
  - `npm run build`
  - `npx electron-builder --linux deb --publish never`
- Inspecionar metadados e conteudo:
  - `dpkg-deb -I release/*.deb`
  - `dpkg-deb -c release/*.deb | rg "helpers/linux|dist/main|dist/renderer|assets"`
- Inspecionar `asar` no build unpacked:
  - `npm run pack`
  - `npx asar list release/linux-unpacked/resources/app.asar | rg "assets|dist/main|dist/renderer"`
- Paths de referencia em producao:
  - helper Linux privilegiado: `process.resourcesPath/helpers/linux/dexter-runtime-helper.sh` (extraResources)
  - assets app: `app.getAppPath()/assets/...` (ou `process.resourcesPath/assets/...` quando presente fora do asar)
  - dados/logs de usuario: `app.getPath('userData')`
- Dependencias declaradas no `.deb` incluem runtime de audio ALSA com versao minima (`libasound2t64 (>= 1.0.0) | libasound2 (>= 1.0.0)`) para evitar provider virtual `liboss4` (causa conhecida de erro `undefined symbol ... ALSA_0.9` em bootstrap).

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
  - `DEB Smoke (Container)` gera `.deb`, instala em `ubuntu:24.04` limpo (Docker), valida helper em `resources/helpers/linux`, checa resolucao ALSA (evita `liboss4`) e confirma bootstrap via `/tmp/dexter.log` executando Electron como usuario nao-root.
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
  - usa o conjunto de icones PNG Linux em `assets/icons/linux/` (electron-builder `build.linux.icon`)
  - gera checksum `release/SHA256SUMS.txt` para verificacao dos binarios
  - gera manifesto de update `release/dexter-update-manifest.json` (legado + `artifacts[]` com `AppImage` e `deb`, checksums e compatibilidade base)
  - assina o manifesto (`release/dexter-update-manifest.json.sig`, assinatura detached Ed25519 em base64) quando `secrets.DEXTER_UPDATE_MANIFEST_PRIVATE_KEY_PEM` estiver configurado
  - para publicacao de GitHub Release (`should_publish=true`), a secret de assinatura do manifesto e obrigatoria
  - publica artefatos (`AppImage`, `deb`, `SHA256SUMS.txt`, `dexter-update-manifest.json` e opcionalmente `.sig`) e pode criar GitHub Release automaticamente

## Preparacao de assets de UI/branding (mascote)

- Assets brutos de referencia ficam em `assets/novos_assets/` e nao entram diretamente no fluxo de build.
- Assets derivados (fundo limpo + recorte + canvas padronizado + variantes leves `webp` para UI + icones Linux) podem ser regenerados com:
  - `npm run assets:prepare-ui`
- Requisito local: `ImageMagick` (`magick`).

## Proximo modulo transversal (planejado)

- Sistema de update: ver `docs/update-system-plan.md` para estrategia incremental (rollout atomico primeiro, com compatibilidade futura entre `core` e `ui`).
- Estado atual: painel inicial de update + scaffold backend/IPC/preload ja existem (check/download/politica/restart via mock/noop); provider real ainda nao foi ativado por padrao.
- Provider GitHub Releases existe e pode ser ativado opcionalmente por ambiente:
  - presets operacionais por modo (`dev`, `pilot`, `testers`, `stable`): `docs/update-rollout-modes.md` (script `npm run update:rollout:preset`)
  - runbook copy/paste por cenario (`pilot rc`, `testers stable`, `stable canary`): `docs/update-rollout-runbook.md`
  - template marcavel para PR/issue de rollout: `docs/update-rollout-checklist-template.md`
  - `DEXTER_UPDATE_PROVIDER=github`
  - `DEXTER_UPDATE_GITHUB_REPO=<owner>/<repo>` (ex.: `N1ghthill/dexter`)
  - verificacao de assinatura do manifesto (recomendado para producao):
    - `DEXTER_UPDATE_MANIFEST_PUBLIC_KEY_PEM` (PEM em string, aceita `\n`)
    - ou `DEXTER_UPDATE_MANIFEST_PUBLIC_KEY_PATH` (arquivo PEM local)
  - quando a chave publica esta configurada, o provider exige `dexter-update-manifest.json.sig` valido; releases sem assinatura valida sao ignoradas
  - estrategia de aplicacao para `.deb` (opcional, Linux):
    - `DEXTER_UPDATE_DEB_APPLY_STRATEGY=assist` (padrao; abre instalador via `xdg-open`)
    - `DEXTER_UPDATE_DEB_APPLY_STRATEGY=pkexec-apt` (agenda instalacao privilegiada via `pkexec + apt`, com fallback para `xdg-open` se falhar)
  - rollback automatico `.deb` em falha de boot (opcional, Linux):
    - `DEXTER_UPDATE_DEB_AUTO_ROLLBACK_ON_BOOT_FAILURE=1`
    - escopo atual: tenta rollback privilegiado (`pkexec + apt`) quando existe marcador de tentativa de apply `.deb/pkexec` e o boot falha apos subir na versao alvo (ex.: falha de migracao no bootstrap)
  - validacao de boot saudavel por handshake renderer (opcional, recomendado para pilotos):
    - `DEXTER_UPDATE_BOOT_HEALTH_REQUIRE_HANDSHAKE=1`
    - `DEXTER_UPDATE_BOOT_HEALTH_GRACE_MS=15000` (opcional; minimo efetivo 1000ms)
    - `DEXTER_UPDATE_BOOT_HEALTH_STABILITY_MS=0` (opcional; se > 0, mantem tentativa pendente por uma janela de estabilidade apos o handshake)
    - fluxo: apos boot na versao alvo, o `main` aguarda `reportBootHealthy()` enviado pelo renderer; sem handshake no prazo, registra timeout e trata como falha de boot para fins de rollback opt-in
    - durante a janela de boot/estabilidade, falhas de renderer (ex.: `render-process-gone`, `did-fail-load`) tambem sao tratadas como falha de boot
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
- Promocao de RC para stable:
  - use o playbook `docs/release-promotion-playbook.md` (criterios de `go/no-go`, comandos de promocao, evidencias e rollback)
- Fluxo atual de "Aplicar no Reinicio":
  - `UpdateState` persiste `stagedArtifactPath` para o artefato baixado
  - o provider seleciona artefato compativel por runtime quando o manifesto traz `artifacts[]` (ex.: `AppImage`/`deb`), preservando os campos legados para compatibilidade
  - o provider tambem faz cleanup best-effort de artefatos staged antigos (retencao local) apos staging bem-sucedido, evitando acumulo excessivo em `updates/downloads`
  - em Linux, quando o artefato staged e `.AppImage`, o app tenta handoff (spawn do AppImage staged) e encerra a instancia atual
  - em Linux, quando o artefato staged e `.deb`, o app usa modo assistido: abre o instalador (`xdg-open`) e registra auditoria; a conclusao/privilegios ficam com o sistema/usuario
  - opcionalmente, em Linux/`.deb`, pode usar modo privilegiado controlado (`pkexec + apt`) via `DEXTER_UPDATE_DEB_APPLY_STRATEGY=pkexec-apt`; se a abertura privilegiada falhar (inclusive erro de spawn/comando ausente), o app tenta fallback para `xdg-open`
  - se nao houver applier por formato compativel, usa fallback de `relaunch` controlado
  - rollback/substituicao totalmente automatizados para formatos de pacote do sistema seguem como etapa de hardening do applier
  - no startup, o app reconcilia estado `staged` persistido:
    - se `app.getVersion() >= stagedVersion`, limpa o estado `staged` e tenta remover o artefato/diretorio staged (somente dentro de `updates/downloads`)
    - se a versao atual ainda for menor que `stagedVersion`, mantem o estado `staged` (update pendente)
  - o app tambem registra uma tentativa de apply (`updates/apply-attempt.json`) para validar o resultado no proximo boot:
    - se iniciar na versao alvo, registra `update.apply.validation_passed`
    - se `DEXTER_UPDATE_BOOT_HEALTH_REQUIRE_HANDSHAKE=1`, primeiro entra em `update.apply.validation_waiting_health` e so conclui apos `update.apply.validation_healthy` (renderer)
    - se o grace period expirar sem handshake, registra `update.apply.validation_health_timeout`
    - se `DEXTER_UPDATE_BOOT_HEALTH_STABILITY_MS>0`, apos `validation_healthy` entra em `update.apply.validation_waiting_stability` e so limpa a tentativa em `update.apply.validation_stable`
    - se iniciar na versao anterior, registra `update.apply.validation_not_applied`
    - se o boot falhar na versao alvo e `DEXTER_UPDATE_DEB_AUTO_ROLLBACK_ON_BOOT_FAILURE=1`, tenta agendar rollback `.deb` (quando houver pacote anterior local elegivel)
- Diagnostico de bloqueio de update (UI):
  - quando existe update remoto mas o `check` bloqueia localmente (ex.: schema/migracao), o painel exibe motivo especifico em `Notas` e marca `bloqueio local`.
  - `UpdateState.lastErrorCode` foi adicionado para UI/telemetria (sem depender de parsing do texto em `lastError`).
  - o card de updates diferencia visualmente erros de compatibilidade (bloqueio local) de erros operacionais/rede (`data-error-kind`).
- Exportacao de auditoria (logs):
  - `exportLogs` agora aceita filtro `scope` (`all` | `updates`) no contrato IPC/preload.
  - UI possui atalho `Logs de Update` para exportar somente eventos de update (`update.*` + `app.relaunch` com motivo de update).
  - UI possui atalho `Logs de UI` para exportar somente eventos `ui.audit.event` (ex.: `setup.repair.finish`) usando o periodo selecionado atual.
  - eventos de UI relevantes tambem podem ser registrados em `ui.audit.event` (ex.: `setup.repair.finish`) e entram na exportacao de logs.
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
