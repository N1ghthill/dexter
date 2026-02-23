# Update Rollout Runbook

Runbook operacional (copy/paste) para execucao dos cenarios mais comuns de rollout do modulo de update usando os presets de `docs/update-rollout-modes.md`.

Para acompanhamento formal em PR/issue, use o template marcavel `docs/update-rollout-checklist-template.md`.

## Pre-requisitos

- release publicada no GitHub (`rc` ou `stable`)
- chave publica do manifesto disponivel localmente (arquivo PEM)
- acesso ao repo (ex.: `N1ghthill/dexter`)

Defina variaveis base no shell (ajuste conforme seu ambiente):

```bash
export DEXTER_ROLLOUT_REPO='N1ghthill/dexter'
export DEXTER_UPDATE_PUBKEY='/path/public.pem'
```

Opcional para checar envs ativos:

```bash
env | rg '^DEXTER_(UPDATE|ROLLOUT)_'
```

## Cenario 1: `pilot rc` (validacao forte)

Objetivo: validar release `rc` em ambiente controlado com criterio forte de boot e rollback `.deb` opt-in.

1. Aplicar preset do app (pilot):

```bash
eval "$(npm run update:rollout:preset -- --mode pilot --repo "$DEXTER_ROLLOUT_REPO" --key-path "$DEXTER_UPDATE_PUBKEY")"
```

2. Verificar release remota (`rc`) com assinatura + checksum:

```bash
eval "$(npm run update:rollout:preset -- --mode pilot --repo "$DEXTER_ROLLOUT_REPO" --key-path "$DEXTER_UPDATE_PUBKEY" --include-verify)"
npm run update:pilot:verify
```

3. Iniciar app de teste com provider GitHub ativo:

```bash
npm run dev
```

4. No painel de updates (UI):

- `Verificar Update`
- `Baixar Update`
- `Aplicar no Reinicio` (ou `Abrir Instalador (.deb)` se aplicavel)

5. Coletar evidencias apos o fluxo:

- exportar `Auditoria Update` (use atalho `Erros de Update` tambem)
- exportar `Logs de Update`
- salvar screenshots/logs se houve fallback/rollback

6. Sinais esperados de sucesso (logs/auditoria):

- `update.check.finish`
- `update.download.finish`
- `update.apply.restart_requested`
- `update.apply.validation_waiting_health` (se handshake opt-in ativo)
- `update.apply.validation_healthy`
- `update.apply.validation_stable` (se estabilidade > `0`)

## Cenario 2: `testers stable` (rollout controlado)

Objetivo: liberar para grupo pequeno de testers com configuracao conservadora.

1. Aplicar preset `testers`:

```bash
eval "$(npm run update:rollout:preset -- --mode testers --repo "$DEXTER_ROLLOUT_REPO" --key-path "$DEXTER_UPDATE_PUBKEY")"
```

2. (Recomendado) Verificar release `stable` remota antes da distribuicao:

```bash
eval "$(npm run update:rollout:preset -- --mode testers --repo "$DEXTER_ROLLOUT_REPO" --key-path "$DEXTER_UPDATE_PUBKEY" --include-verify)"
npm run update:pilot:verify
```

3. Distribuir para testers com checklist curto:

- confirmar canal `stable` no painel de updates
- executar `Verificar -> Baixar -> Aplicar`
- exportar `Auditoria Update` se houver erro/bloqueio

4. Janela de observacao sugerida:

- 24h a 48h

5. Go/No-Go (pratico):

- `Go`: sem erros estruturados recorrentes (`download_failed`, `restart_failed`, `validation_health_timeout`)
- `No-Go`: falhas repetidas por formato/build, regressao de renderer no boot, rollbackes `.deb` inesperados

## Cenario 3: `stable canary` (producao gradual)

Objetivo: liberacao estavel em canary pequeno antes de ampliar.

1. Aplicar preset `stable`:

```bash
eval "$(npm run update:rollout:preset -- --mode stable --repo "$DEXTER_ROLLOUT_REPO" --key-path "$DEXTER_UPDATE_PUBKEY")"
```

2. Verificar release `stable` assinada/checksum:

```bash
eval "$(npm run update:rollout:preset -- --mode stable --repo "$DEXTER_ROLLOUT_REPO" --key-path "$DEXTER_UPDATE_PUBKEY" --include-verify)"
npm run update:pilot:verify
```

3. Rodar canary com grupo pequeno (ex.: equipe interna / testers experientes).

4. Monitorar evidencias:

- `Auditoria Update` por familia `apply` e `rollback`
- `Logs de Update` (scope `updates`)
- eventos de validacao de boot (`validation_*`)

5. Expansao gradual (manual):

- canary inicial -> grupo maior -> rollout geral
- expandir apenas apos janela de observacao sem regressao critica

## Comandos uteis (operacao)

Inspecionar preset sem aplicar:

```bash
npm run update:rollout:preset -- --mode pilot --repo "$DEXTER_ROLLOUT_REPO" --key-path "$DEXTER_UPDATE_PUBKEY"
```

Saida em JSON (integracao/automacao):

```bash
npm run update:rollout:preset -- --mode stable --repo "$DEXTER_ROLLOUT_REPO" --key-path "$DEXTER_UPDATE_PUBKEY" --include-verify --format json
```

Limpar envs de update da sessao atual:

```bash
unset DEXTER_UPDATE_PROVIDER \
  DEXTER_UPDATE_GITHUB_REPO \
  DEXTER_UPDATE_MANIFEST_PUBLIC_KEY_PATH \
  DEXTER_UPDATE_MANIFEST_PUBLIC_KEY_PEM \
  DEXTER_UPDATE_DEB_APPLY_STRATEGY \
  DEXTER_UPDATE_DEB_AUTO_ROLLBACK_ON_BOOT_FAILURE \
  DEXTER_UPDATE_BOOT_HEALTH_REQUIRE_HANDSHAKE \
  DEXTER_UPDATE_BOOT_HEALTH_GRACE_MS \
  DEXTER_UPDATE_BOOT_HEALTH_STABILITY_MS \
  DEXTER_UPDATE_CHANNEL \
  DEXTER_UPDATE_VERIFY_DOWNLOAD \
  DEXTER_UPDATE_REQUIRE_SIGNED_MANIFEST
```

## Limites atuais (importante)

- O rollback automatico `.deb` e opt-in e cobre falha de boot com pacote anterior local elegivel.
- O watchdog de renderer e interno ao app (nao substitui supervisor externo de processo).
- A politica de canal (`stable`/`rc`) continua ajustavel pelo painel de updates (persistida no `UpdatePolicyStore`).
