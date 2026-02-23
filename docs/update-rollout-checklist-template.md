# Update Rollout Checklist (Template)

Template marcavel para colar em PR/issue de rollout/update.

Referencias:

- presets de env: `docs/update-rollout-modes.md`
- runbook de execucao: `docs/update-rollout-runbook.md`
- promocao RC -> stable: `docs/release-promotion-playbook.md`

---

## Identificacao

- [ ] Data (UTC) preenchida
- [ ] Responsavel definido
- [ ] Repo alvo confirmado
- [ ] Chave publica do manifesto disponivel

Campos:

- Data (UTC):
- Responsavel:
- Repo (`owner/repo`):
- Chave publica (`*_PUBLIC_KEY_PATH`):
- Cenario: `pilot rc` | `testers stable` | `stable canary`
- Versao alvo:
- Canal esperado (`rc` | `stable`):

## Pre-check local

- [ ] `main` sincronizado / branch de execucao definida
- [ ] Sem alteracoes locais que atrapalhem a operacao
- [ ] `npm run update:rollout:preset -- --help` funcionando

Comandos (opcional):

```bash
git status --short
npm run update:rollout:preset -- --help
```

## Preset aplicado (app)

- [ ] Preset gerado para o cenario correto
- [ ] `DEXTER_UPDATE_PROVIDER=github` (exceto se for checklist de dev interno)
- [ ] `DEXTER_UPDATE_GITHUB_REPO` confere com o repo alvo
- [ ] Chave publica configurada no ambiente (`PATH` ou `PEM`)
- [ ] Estrategia `.deb` confere com o cenario
- [ ] Flags de handshake/rollback conferem com o cenario

Comando executado:

```bash
eval "$(npm run update:rollout:preset -- --mode <pilot|testers|stable> --repo <owner/repo> --key-path <path/public.pem>)"
```

Observacoes de env (se houver override manual):

- 

## Verificacao remota (manifesto + assinatura + checksum)

- [ ] Preset de verificacao gerado (`--include-verify`) ou envs configurados manualmente
- [ ] `npm run update:pilot:verify` executado
- [ ] Assinatura do manifesto validada
- [ ] Checksum do asset validado (`DEXTER_UPDATE_VERIFY_DOWNLOAD=1`)
- [ ] Canal selecionado pelo verificador confere
- [ ] Versao selecionada pelo verificador confere

Comandos:

```bash
eval "$(npm run update:rollout:preset -- --mode <pilot|testers|stable> --repo <owner/repo> --key-path <path/public.pem> --include-verify)"
npm run update:pilot:verify
```

Evidencia (cole resumo/saida):

```txt
selected.version:
selected.channel:
signatureVerificationEnabled:
selected.downloadVerified:
```

## Execucao do app / fluxo UI

- [ ] App iniciado com preset aplicado
- [ ] Painel de updates abriu normalmente
- [ ] `Verificar Update` executado
- [ ] `Baixar Update` executado
- [ ] `Aplicar no Reinicio` / `Abrir Instalador (.deb)` executado
- [ ] App reiniciou / instalador abriu conforme esperado

Checklist de comportamento observado:

- [ ] Sem erro de renderer no boot (`render-process-gone` / `did-fail-load`)
- [ ] Handshake de boot saudavel concluido (se habilitado)
- [ ] Janela de estabilidade concluida (se `STABILITY_MS > 0`)
- [ ] Sem rollback automatico inesperado `.deb`

Observacoes do fluxo:

- 

## Auditoria e evidencias

- [ ] `Auditoria Update` exportada
- [ ] `Erros de Update` (preset) exportada
- [ ] `Logs de Update` exportados
- [ ] Evidencias anexadas (arquivos/caminhos/links)

Eventos esperados (marcar os observados):

- [ ] `update.check.finish`
- [ ] `update.download.finish`
- [ ] `update.apply.restart_requested`
- [ ] `update.apply.validation_waiting_health` (quando handshake ativo)
- [ ] `update.apply.validation_healthy` (quando handshake ativo)
- [ ] `update.apply.validation_waiting_stability` (quando `STABILITY_MS > 0`)
- [ ] `update.apply.validation_stable` (quando `STABILITY_MS > 0`)

Eventos de erro/alerta observados (se houver):

- [ ] `download_failed`
- [ ] `restart_failed`
- [ ] `validation_health_timeout`
- [ ] `update.rollback.deb_scheduled`
- [ ] outro:

Links/caminhos de evidencia:

- `Auditoria Update`:
- `Erros de Update`:
- `Logs de Update`:
- screenshots/logs adicionais:

## Go / No-Go

- [ ] Decisao registrada
- [ ] Criterios revisados com base nas evidencias
- [ ] Proximo passo definido

Decisao: `GO` | `NO-GO`

Motivo (resumo):

- 

Proximo passo:

- [ ] Ampliar rollout
- [ ] Repetir piloto
- [ ] Corrigir regressao
- [ ] Publicar hotfix
- [ ] Abortado

## Aprovacoes / Encerramento

- [ ] Responsavel tecnico revisou
- [ ] Evidencias arquivadas
- [ ] Issue/PR atualizada com resultado final

Links:

- PR/Issue:
- Release URL:
- Workflow run(s):
- Registro de decisao (se aplicavel):

