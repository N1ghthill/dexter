# Modelo de Seguranca (Renderer, Main e Privilegios)

## Objetivo

Permitir "integracao total" no Dexter sem misturar UX rica com execucao privilegiada arbitraria.

## Principios

- `renderer` nunca executa comandos de sistema diretamente.
- `preload` expoe apenas contratos IPC explicitos e tipados.
- `main` orquestra e valida acoes; nao repassa shell arbitrario vindo da UI.
- Permissao interna do Dexter (`allow|ask|deny`) nao substitui privilegio do SO (`pkexec`/`sudo`).
- Toda acao sensivel deve retornar diagnostico acionavel (`errorCode`, `nextSteps`, contexto).

## Fronteiras de responsabilidade

### Renderer (UI)

- Coleta intencao do usuario.
- Mostra onboarding, checklist, estados e erros.
- Faz confirmacao de acoes via `checkPermission`.
- Nao coleta senha de `sudo` e nao embute terminal root.

### Preload (ponte)

- Traduz chamadas da UI para IPC.
- Mantem superficie minima (`window.dexter.*`).

### Main + Services

- Valida permissao interna.
- Executa fluxo seguro por dominio (`runtime`, `models`, `updates`).
- Registra logs e historico de operacoes.
- Degrada com fluxo assistido quando o ambiente nao suporta automacao segura (ex.: sem `pkexec`).

## Duas camadas de autorizacao

1. Autorizacao do Dexter
- Controlada por `PermissionService`.
- Escopos atuais: `runtime.install`, `tools.system.exec`, `tools.filesystem.read`, `tools.filesystem.write`.
- Decide se o app pode tentar a acao.

2. Privilegio do sistema operacional
- Exigido por instalacao/operacoes administrativas no host.
- Linux: preferencia por `pkexec` quando houver prompt grafico/polkit.
- Fallback: fluxo assistido com instrucoes para terminal (`sudo`) e retorno ao Dexter para validacao.

## Estado atual (implementado)

- Instalacao de runtime no Linux:
  - prefere helper privilegiado whitelistado (`assets/helpers/linux/dexter-runtime-helper.sh`) via `pkexec` quando configurado e disponivel (uso automatico em build empacotada);
  - tenta `pkexec` quando disponivel;
  - sem `pkexec`, retorna fluxo assistido com `nextSteps` e exemplo com `sudo` quando disponivel.
- Inicio de runtime no Linux:
  - tenta helper privilegiado (`start-ollama-service`) via `pkexec` para acionar service manager;
  - preserva fallback para `ollama serve` local.
- Reparo de runtime no Linux:
  - tenta helper privilegiado (`restart-ollama-service`) via `pkexec` para reinicio guiado;
  - preserva fallback para fluxo de `startRuntime()` quando o helper falha/nao existe.
- Diagnostico do helper no Linux:
  - sonda `status` do helper sem `pkexec` para expor capabilities (sem elevar privilegio desnecessariamente).
- UI possui onboarding de setup com checklist e CTA contextual baseado no estado real de runtime/modelos/health/permissoes.
- O onboarding pode executar `Reparar Setup` (orquestracao guiada no renderer): tenta reparo/reinicio do runtime quando aplicavel e consolida diagnostico final com runtime + helper + health + proximo passo.
- O card `Saude` pode acionar o mesmo `Reparar Setup`, reaproveitando o fluxo/contratos existentes (sem criar novo caminho privilegiado).
- A UI pode registrar eventos de auditoria local (`ui.audit.event`, ex.: `setup.repair.finish`) no processo principal para trilha exportavel sem criar novo canal privilegiado.

## Proximo passo recomendado (evoluir o helper privilegiado)

Quando o produto entrar em fase de "integracao total" mais profunda no Linux:

- expandir o helper privilegiado opcional com interface estrita (whitelist),
- acoplado a polkit,
- sem shell livre,
- auditavel e versionado junto com o Dexter.

Exemplos de acoes candidatas:

- instalar runtime Ollama,
- iniciar/parar runtime (ou integrar com service manager),
- checar status do runtime,
- reparos guiados limitados (sem execucao arbitraria).

## O que evitar

- Prompt de senha root dentro do renderer.
- Shell root generico controlado pela UI.
- Scripts `postinst` do `.deb` que baixam/instalam runtime automaticamente via internet sem confirmacao contextual.
- Mensagens genericas que escondem a causa real da falha.

## Protocolo no cerebro do agente (LLM)

- O prompt de sistema do Dexter inclui protocolo operacional explicito:
  - nao afirmar execucao de comandos/alteracoes que nao ocorreram;
  - tratar leitura/diagnostico como padrao;
  - exigir pedido explicito para escrita/sobrescrita/exclusao;
  - quando faltar contexto/permissao, responder com limite claro + proximo passo seguro.
- Esse protocolo complementa (nao substitui) as camadas de autorizacao do app e do sistema operacional.
