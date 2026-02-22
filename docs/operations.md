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
  - publica artefatos (`AppImage`, `deb` e `SHA256SUMS.txt`) e pode criar GitHub Release automaticamente
