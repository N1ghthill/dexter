# Guia de Implementacao de Modulos

## Objetivo

Padronizar como novos modulos do Dexter devem ser implementados para reduzir bugs, manter baixo acoplamento e facilitar manutencao.

## Contrato minimo de um modulo

Todo modulo de dominio deve seguir este formato:

1. Interface clara de entrada e saida (tipos em `src/shared/contracts.ts` quando houver IPC/UI).
2. Responsabilidade unica (evitar modulo que faz persistencia + IO externo + formatacao de UI no mesmo arquivo).
3. Tratamento de falha previsivel com retorno seguro (fallback) e log estruturado.
4. Testes cobrindo fluxo principal, erro e dado corrompido/inesperado.

## Estrutura recomendada

- `src/main/services/<dominio>/<Modulo>.ts`: logica principal.
- `src/main/services/<dominio>/...`: helpers internos do dominio.
- `tests/<modulo>.test.ts`: testes unitarios.
- `docs/`: decisao arquitetural quando o modulo altera fluxo importante.

## Template canonico (servico de dominio)

Use este formato base para reduzir variacao entre modulos:

```ts
export class ExampleService {
  constructor(
    private readonly dependencyA: DependencyA,
    private readonly logger: Logger
  ) {}

  execute(input: string): Result {
    const normalized = input.trim();
    if (!normalized) {
      return {
        ok: false,
        message: 'Entrada invalida.'
      };
    }

    try {
      const data = this.dependencyA.run(normalized);
      return {
        ok: true,
        message: 'Operacao concluida.',
        data
      };
    } catch (error) {
      this.logger.error('example.execute.error', {
        message: error instanceof Error ? error.message : String(error)
      });

      return {
        ok: false,
        message: 'Falha ao executar operacao.'
      };
    }
  }
}
```

## Template minimo de testes por modulo

Para cada modulo novo, criar estes blocos no arquivo `tests/<modulo>.test.ts`:

1. `happy-path`: retorna sucesso com dados validos.
2. `validation-path`: rejeita entrada invalida sem chamar dependencia externa.
3. `failure-path`: dependencia externa falha e modulo retorna fallback seguro.
4. `recovery-path`: estado persistido invalido e modulo autocorrige.
5. `anti-mutation-path`: retorno nao expoe referencia mutavel interna.

## Checklist anti-bug

- Entrada normalizada:
  - `trim`, limites de tamanho e validacao de enum/tipo antes da execucao.
- Persistencia resiliente:
  - leitura tolerante a arquivo invalido e fallback automatico para estado seguro.
- Timeout e recursos:
  - todo `setTimeout` deve garantir `clearTimeout` em todos os caminhos de execucao (`finally` ou retorno unico).
- Erro operacional:
  - em falha inesperada, finalizar estado pendente e registrar log de erro com contexto.
- Sem mutacao acidental:
  - retornar copias de arrays/objetos quando a colecao interna nao deve ser alterada externamente.
- Observabilidade:
  - logar inicio/fim de operacoes sensiveis (runtime/modelos/permissoes).

## Checklist de hardening para UI (renderer)

Quando um modulo inclui interface/controles no `renderer`, adicionar este checklist ao DoD:

1. Texto e labels longos:
   - validar labels em PT-BR (botoes, selects, estados, mensagens de erro) sem overflow horizontal.
   - grupos de botoes (`inline-actions`, toolbars, chips) devem aceitar wrap, ellipsis ou stack responsivo.
2. Estados visuais:
   - cobrir `idle`, `busy`, `success`, `error` e `disabled` sem troca de label quebrar layout.
   - operacoes longas devem ter feedback de progresso e detalhe de erro acionavel.
3. Layout responsivo:
   - validar breakpoints principais (desktop, tablet/compacto, mobile).
   - garantir `min-width: 0` em itens flex/grid que recebem texto dinamico.
4. Navegacao e foco:
   - foco visivel em controles clicaveis.
   - acoes guiadas/focus jump nao podem apontar para controle oculto/desabilitado.
5. Conteudo tecnico:
   - `code/pre` e saidas de comando devem usar `overflow-wrap`/quebra segura para nao estourar cards.

## Padrao de operacoes assistidas (sistema)

Para qualquer modulo que execute acao no host (ex.: instalar runtime, baixar tool externa, start/stop de servico):

1. Definir estrategia explicita de execucao:
   - `automatica` (sem privilegio)
   - `privilegiada` (ex.: `pkexec`)
   - `assistida/manual` (usuario executa no terminal)
2. Retornar resultado estruturado para UI:
   - `ok`, `exitCode`, `errorCode`, `strategy`, `manualRequired`
   - `nextSteps` (passos acionaveis)
   - `stdout/stderr` (ou excerpt controlado pela UI)
3. Fazer preflight antes de executar:
   - dependencias (`bash`, `curl`, binario alvo)
   - disponibilidade de prompt de privilegio quando necessario
4. Falhar de forma previsivel:
   - se ambiente nao suporta execucao automatica (sem TTY/prompt de privilegio), retornar modo assistido em vez de tentar comando cego
5. Testes minimos extras:
   - caminho privilegiado disponivel
   - fallback assistido/manual
   - erro de spawn
   - timeout

## Padrao consolidado de hardening modular

Aplicar este padrao em qualquer novo modulo ou refactor estrutural:

1. Contrato forte de entrada:
   - normalizar payload e aplicar defaults deterministas.
   - rejeitar combinacoes invalidas cedo (antes de IO externo).
2. Estado interno protegido:
   - nunca expor referencias mutaveis de colecoes internas.
   - devolver copias defensivas em queries/getters.
3. Persistencia autocorretiva:
   - em arquivo ausente, criar fallback valido.
   - em payload invalido, sanitizar e regravar formato canonicamente.
4. Limites operacionais:
   - impor teto de crescimento (historico, notas, listas em memoria).
   - limitar loops paginados para evitar travamento em dados inconsistentes.
5. Falha previsivel:
   - respostas de erro com mensagem acionavel e sem leak tecnico sensivel.
   - finalizar estados pendentes em erros inesperados.
6. Exportacao segura:
   - CSV com escape para virgula/quebra de linha/aspas.
   - filtro de data tolerante a valor invalido (ignora sem quebrar fluxo).
7. Teste minimo obrigatorio:
   - cobrir sucesso, validacao, falha operacional, recuperacao e anti-mutacao.

## Definition of Done por modulo

Antes de considerar um modulo "pronto":

1. `npm run typecheck`
2. testes unitarios do modulo cobrindo todos os itens do hardening.
3. sem retorno de objeto mutavel interno em API publica do modulo.
4. persistencia testada com arquivo ausente, quebrado e payload invalido.
5. docs atualizadas quando houver novo contrato ou comportamento de fallback.

## Padrao para contexto inteligente do agente

Para manter o Dexter consciente do ambiente sem acoplamento excessivo:

1. Agregue contexto em um builder dedicado (`ConversationContextBuilder`).
2. Inclua no prompt:
   - ambiente local (`/env`)
   - identidade operacional (assistente, usuario local, host e modo/caminho de instalacao)
   - contexto operacional atual (modelo ativo + endpoint local/remoto)
   - memoria de curto/longo prazo
   - sinais situacionais (operacoes recentes de modelo)
   - protocolo textual de seguranca (leitura vs escrita, sem alegar execucoes inexistentes)
3. Em falha de LLM, gere dica contextual usando o estado local (ex.: comando `ollama` ausente ou runtime parado).

## Matriz minima de testes por modulo

- `happy-path`: comportamento principal.
- `validation-path`: entrada invalida.
- `failure-path`: dependencia externa indisponivel.
- `recovery-path`: arquivo/local state corrompido.

## Revisao antes de merge

1. `npm run typecheck`
2. `npm run test`
3. `npm run test:e2e` (quando alterar IPC, renderer ou fluxo de runtime/modelos)
4. Atualizar docs de arquitetura se houver novo modulo transversal.
