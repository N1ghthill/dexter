# Runtime e Modelos

## Objetivo

Dar autonomia ao usuario para diagnosticar runtime local e gerenciar modelos gratuitos pela interface grafica.

## Runtime local

- `RuntimeService` detecta binario no PATH e endpoint configurado.
- `runtime:start` tenta iniciar `ollama serve` localmente.
- Se o endpoint configurado apontar para host remoto, o Dexter nao tenta iniciar runtime local automaticamente (evita comportamento ambiguo e bind incorreto).
- `runtime:install` executa instalacao assistida por comando sugerido.
- `DexterBrain` recebe contexto situacional de runtime/modelos via `ConversationContextBuilder`.

## Modelos

- `ModelService` lista modelos instalados via `GET /api/tags`.
- Catalogo curado local destaca modelos recomendados.
- A UI permite baixar (`ollama pull`) e remover (`ollama rm`) sem sair do app.
- Download exibe progresso em tempo real no painel lateral, com barra visual e ETA estimado.
- Historico de operacoes mostra status, horario, duracao e mensagem de cada execucao.
- Historico possui exportacao de auditoria em `json` ou `csv` com filtros aplicados, incluindo periodo.
- Validacao de periodo na UI rejeita datas invalidas (ex.: overflow de calendario como `2026-02-31`) antes da exportacao.
- Logs do Dexter podem ser exportados em `json` ou `csv` direto pela interface, incluindo filtro por periodo.

## Permissoes

- `PermissionService` persiste politicas em disco (`allow|ask|deny`).
- Escopos atuais: `runtime.install`, `tools.filesystem.read`, `tools.filesystem.write`, `tools.system.exec`.
- Acoes sensiveis usam verificacao contextual (`checkPermission`) antes da execucao.

## Limitacoes atuais

- Instalacao automatica de runtime depende de permissao do sistema operacional.
- Nomes de modelos no catalogo curado podem evoluir conforme ecossistema Ollama.
- Sistema de update real (GitHub Releases) e opt-in por ambiente; sem configuracao, o Dexter permanece em fallback seguro (`NoopUpdateProvider`).
