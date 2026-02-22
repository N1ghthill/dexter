# Arquitetura Base

## Camadas

1. `renderer` (UI)
2. `preload` (ponte segura)
3. `main` (orquestracao)
4. `services` (dominios: llm, memoria, logs, comandos, health)
5. `shared` (contratos)

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

## Padrao de implementacao de modulos

Use `docs/module-implementation-guide.md` como referencia obrigatoria para novos modulos e refactors estruturais.
