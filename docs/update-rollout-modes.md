# Rollout Modes (Update)

Presets operacionais para reduzir erro manual na configuracao de variaveis de ambiente do modulo de update.

Para execucao operacional (copy/paste) por cenario, use tambem `docs/update-rollout-runbook.md`.

## Script de preset

- comando: `npm run update:rollout:preset -- ...`
- saida padrao: `export ...` (shell)
- uso recomendado:

```bash
eval "$(npm run update:rollout:preset -- --mode pilot --repo N1ghthill/dexter --key-path /path/public.pem)"
```

- para inspecionar sem aplicar:

```bash
npm run update:rollout:preset -- --mode stable --repo N1ghthill/dexter --key-path /path/public.pem
```

- para obter tambem envs do verificador de piloto (`update:pilot:verify`):

```bash
npm run update:rollout:preset -- --mode pilot --repo N1ghthill/dexter --key-path /path/public.pem --include-verify
```

## Modos

### `dev`

- objetivo: desenvolvimento local sem update remoto
- preset principal:
  - `DEXTER_UPDATE_PROVIDER=none`
  - `DEXTER_UPDATE_DEB_APPLY_STRATEGY=assist`
  - rollback/handshake desativados

### `pilot`

- objetivo: piloto controlado / validacao forte
- preset principal:
  - `DEXTER_UPDATE_PROVIDER=github`
  - `DEXTER_UPDATE_DEB_APPLY_STRATEGY=pkexec-apt` (default do preset; pode override)
  - `DEXTER_UPDATE_DEB_AUTO_ROLLBACK_ON_BOOT_FAILURE=1`
  - `DEXTER_UPDATE_BOOT_HEALTH_REQUIRE_HANDSHAKE=1`
  - `DEXTER_UPDATE_BOOT_HEALTH_GRACE_MS=15000`
  - `DEXTER_UPDATE_BOOT_HEALTH_STABILITY_MS=5000`
- ao usar `--include-verify`, o script tambem imprime:
  - `DEXTER_UPDATE_CHANNEL=rc`
  - `DEXTER_UPDATE_VERIFY_DOWNLOAD=1`
  - `DEXTER_UPDATE_REQUIRE_SIGNED_MANIFEST=1` (se `--key-path` foi informado)

### `testers`

- objetivo: rollout controlado para testers (mais conservador)
- preset principal:
  - `DEXTER_UPDATE_PROVIDER=github`
  - `DEXTER_UPDATE_DEB_APPLY_STRATEGY=assist`
  - `DEXTER_UPDATE_DEB_AUTO_ROLLBACK_ON_BOOT_FAILURE=0`
  - `DEXTER_UPDATE_BOOT_HEALTH_REQUIRE_HANDSHAKE=1`
  - `DEXTER_UPDATE_BOOT_HEALTH_GRACE_MS=20000`
  - `DEXTER_UPDATE_BOOT_HEALTH_STABILITY_MS=8000`

### `stable`

- objetivo: operacao estavel com criterio forte de boot
- preset principal:
  - `DEXTER_UPDATE_PROVIDER=github`
  - `DEXTER_UPDATE_DEB_APPLY_STRATEGY=assist`
  - `DEXTER_UPDATE_DEB_AUTO_ROLLBACK_ON_BOOT_FAILURE=0`
  - `DEXTER_UPDATE_BOOT_HEALTH_REQUIRE_HANDSHAKE=1`
  - `DEXTER_UPDATE_BOOT_HEALTH_GRACE_MS=15000`
  - `DEXTER_UPDATE_BOOT_HEALTH_STABILITY_MS=5000`
- ao usar `--include-verify`, o canal default do verificador e `stable`

## Overrides suportados pelo script

- `--deb-strategy assist|pkexec-apt`
- `--verify-channel stable|rc`
- `--format shell|json`

## Observacoes

- Modos nao-`dev` exigem `--repo <owner>/<repo>`.
- `--key-path` e fortemente recomendado para ativar verificacao de assinatura do manifesto no app.
- O script gera presets de runtime/operacao. Politica de canal (`stable`/`rc`) no app continua sendo configuravel pelo painel (persistida no `UpdatePolicyStore`).
