# Playbook de Promocao RC -> Stable

## Objetivo

Padronizar a promocao de uma release candidata (`rc`) para release estavel (`vX.Y.Z`) com foco em:

- seguranca operacional
- verificacao de origem/integridade
- evidencias de auditoria
- rollback claro

## Contexto atual (referencia)

- Piloto real executado com sucesso em **23/02/2026**:
  - `v0.1.4-rc.1` (piloto UI real + auditoria)
  - `v0.1.4-rc.2` (validacao do workflow corrigido para `prerelease`)
- Pipeline de release Linux publica:
  - `AppImage`
  - `deb`
  - `SHA256SUMS.txt`
  - `dexter-update-manifest.json`
  - `dexter-update-manifest.json.sig`

## Pre-condicoes (obrigatorias)

1. `main` limpo e sincronizado com `origin/main`.
2. Secret `DEXTER_UPDATE_MANIFEST_PRIVATE_KEY_PEM` configurada no GitHub repo.
3. Chave publica correspondente disponivel para verificacao local (`*_PUBLIC_KEY_PATH` ou `*_PUBLIC_KEY_PEM`).
4. Ultima `rc` candidata aprovada em piloto:
   - workflow de release `Dexter Release Linux` verde
   - `npm run update:pilot:verify` com assinatura obrigatoria e checksum do asset
   - fluxo UI real validado (`check -> download -> apply`) ou evidencias recentes equivalentes

## Go / No-Go (criterios)

### Go

Promover para `stable` somente se todos forem verdadeiros:

1. Release `rc` alvo esta publicada e `isPrerelease=true`.
2. Assinatura do manifesto valida (`dexter-update-manifest.json.sig`).
3. `checksumSha256` do asset confere em verificacao remota (`DEXTER_UPDATE_VERIFY_DOWNLOAD=1`).
4. Nao ha erro estruturado critico em evidencias recentes de update:
   - `download_failed`
   - `restart_failed`
   - `ipc_incompatible`
   - `remote_schema_incompatible`
   - `schema_migration_unavailable`
5. Auditoria de piloto indica fluxo esperado:
   - `update.check.finish`
   - `update.download.finish`
   - `update.apply.restart_requested`
   - `update.apply.restart_scheduled`
   - `update.apply.appimage_spawned` (Linux/AppImage)
6. Sem regressao aberta bloqueante no periodo do RC (manual/team triage).

### No-Go

Nao promover (ou abortar promocao) se qualquer um ocorrer:

1. Workflow de release falhar ou publicar assets incompletos.
2. `update:pilot:verify` falhar em assinatura/checksum.
3. Release stable sair com manifesto inconsistente (canal/version/checksum).
4. Evidencias de auditoria mostrarem erros estruturados criticos.
5. Bloqueios de compatibilidade inesperados em ambiente alvo.

## Passo a passo (promocao `rc` -> `stable`)

Exemplo: promover `0.1.4-rc.2` para `0.1.4`.

### 1. Confirmar RC candidata

Verificar release e workflow:

```bash
gh release view v0.1.4-rc.2 -R N1ghthill/dexter --json tagName,isPrerelease,publishedAt,assets,url
gh run list -R N1ghthill/dexter --workflow "Dexter Release Linux" -L 5
```

Verificar manifesto assinado + checksum remoto:

```bash
DEXTER_UPDATE_GITHUB_REPO=N1ghthill/dexter \
DEXTER_UPDATE_CHANNEL=rc \
DEXTER_UPDATE_MANIFEST_PUBLIC_KEY_PATH=/path/public.pem \
DEXTER_UPDATE_REQUIRE_SIGNED_MANIFEST=1 \
DEXTER_UPDATE_VERIFY_DOWNLOAD=1 \
npm run update:pilot:verify
```

### 2. Preparar promocao no `main`

```bash
git checkout main
git pull --ff-only origin main
git status --short
```

Esperado: sem mudancas (ignorar `artifacts/` local nao versionado, se existir).

### 3. Bump de versao para stable

```bash
npm version --no-git-tag-version 0.1.4
git add package.json package-lock.json
git commit -m "chore: release v0.1.4"
```

### 4. Validacao local minima antes da tag

```bash
npm run check
```

Opcional (recomendado se houve mudanca desde a RC):

```bash
npm run test:e2e
```

### 5. Publicar commit + tag stable

```bash
git push origin main
git tag v0.1.4
git push origin v0.1.4
```

### 6. Acompanhar workflow de release stable

```bash
gh run list -R N1ghthill/dexter --workflow "Dexter Release Linux" -L 3
gh run watch <RUN_ID> -R N1ghthill/dexter --exit-status
```

### 7. Validar release stable publicada

Checar assets e flags:

```bash
gh release view v0.1.4 -R N1ghthill/dexter --json tagName,isPrerelease,publishedAt,assets,url
```

Esperado:

- `isPrerelease=false`
- assets completos (`AppImage`, `deb`, `SHA256SUMS.txt`, manifesto e `.sig`)

Verificar manifesto assinado + checksum remoto no canal stable:

```bash
DEXTER_UPDATE_GITHUB_REPO=N1ghthill/dexter \
DEXTER_UPDATE_CHANNEL=stable \
DEXTER_UPDATE_MANIFEST_PUBLIC_KEY_PATH=/path/public.pem \
DEXTER_UPDATE_REQUIRE_SIGNED_MANIFEST=1 \
DEXTER_UPDATE_VERIFY_DOWNLOAD=1 \
npm run update:pilot:verify
```

## Validacao pos-publicacao (canary controlado)

Recomendado antes de anunciar para todos os usuarios:

1. Executar 1 canary manual em Linux (ambiente de teste):
   - `DEXTER_UPDATE_PROVIDER=github`
   - `DEXTER_UPDATE_GITHUB_REPO=<owner>/<repo>`
   - `DEXTER_UPDATE_MANIFEST_PUBLIC_KEY_PATH=/path/public.pem`
2. Confirmar fluxo no painel:
   - `Verificar Update`
   - `Baixar Update`
   - `Aplicar no Reinicio`
3. Exportar evidencias:
   - `Auditoria Update` (geral)
   - `Erros de Update` (preset)
   - `Logs de Update`

## Evidencias minimas a arquivar

1. URL da release (`rc` e `stable`).
2. ID da run da workflow de release.
3. Saida do `npm run update:pilot:verify` (rc e stable).
4. Export JSON de `Auditoria Update` (piloto/canary).
5. Export JSON de `Logs de Update`.
6. Captura do painel de updates (opcional, mas recomendada).

## Rollback / Contencao

### Antes de usuarios atualizarem (preferencial)

1. Se release stable publicada estiver incorreta (assets/checksum/manifesto):
   - interromper divulgacao
   - corrigir no `main`
   - publicar nova versao (ex.: `v0.1.5`) em vez de reutilizar tag
2. Manter canal `stable` sem anuncio ate verificacao passar.

### Depois de usuarios atualizarem

1. Nao reaproveitar tag.
2. Publicar hotfix incremental (ex.: `v0.1.5`) com mesmo processo assinado.
3. Coletar `Auditoria Update` / `Logs de Update` dos ambientes afetados.
4. Classificar causa:
   - assinatura/manifesto
   - checksum/download
   - compatibilidade (`ipc/schema/migracao`)
   - aplicacao (`restart/applier`)

## Registro de decisao (template)

```txt
Data (UTC):
Versao RC avaliada:
Versao stable promovida:
Responsavel:

Go/No-Go: GO | NO-GO

Checklist:
- workflow rc verde: sim/nao
- verify rc (assinatura+checksum): sim/nao
- piloto UI real/canary: sim/nao
- workflow stable verde: sim/nao
- verify stable (assinatura+checksum): sim/nao
- auditoria sem erros criticos: sim/nao

Evidencias:
- release rc:
- release stable:
- run ids:
- caminho das evidencias locais/artifacts:

Observacoes:
```
