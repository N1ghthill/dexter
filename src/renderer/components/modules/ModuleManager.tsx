import type { ChangeEvent, JSX, MouseEvent } from 'react';
import ModuleItem, { type ModuleItemModel } from '@renderer/components/modules/ModuleItem';
import { dispatchUiIntent, type LegacyUiCommand } from '@renderer/state/ui-intents';

export type ModuleManagerAction = {
  moduleId: string;
  actionId: string;
  enabled: boolean | null;
};

const INSTALLED_MODULES: ReadonlyArray<ModuleItemModel> = [
  {
    id: 'memory.layered',
    name: 'Memoria em Camadas',
    description: 'Contexto de sessao e persistencia local para preferencias/notas.',
    status: 'ativo',
    isCore: false,
    actions: [
      {
        id: 'toggle-memory-layered',
        label: 'Ativo',
        kind: 'toggle',
        checked: true,
        tooltip: 'Liga/desliga apenas na camada de UI.'
      },
      {
        id: 'config-memory-layered',
        label: 'Configurar',
        kind: 'config'
      }
    ]
  },
  {
    id: 'update.guard',
    name: 'Update Guard',
    description: 'Politica de atualizacao, compatibilidade e aplicacao assistida.',
    status: 'ativo',
    isCore: false,
    actions: [
      {
        id: 'toggle-update-guard',
        label: 'Ativo',
        kind: 'toggle',
        checked: true,
        tooltip: 'Liga/desliga apenas na camada de UI.'
      },
      {
        id: 'config-update-guard',
        label: 'Configurar',
        kind: 'config'
      }
    ]
  },
  {
    id: 'audit.logs',
    name: 'Audit Trails',
    description: 'Exportacao de trilhas de auditoria em JSON/CSV com filtros.',
    status: 'ativo',
    isCore: false,
    actions: [
      {
        id: 'toggle-audit-logs',
        label: 'Ativo',
        kind: 'toggle',
        checked: true,
        tooltip: 'Liga/desliga apenas na camada de UI.'
      },
      {
        id: 'config-audit-logs',
        label: 'Configurar',
        kind: 'config'
      }
    ]
  }
] as const;

const DISCOVER_MODULES: ReadonlyArray<ModuleItemModel> = [
  {
    id: 'docs.indexer',
    name: 'Indexer de Docs',
    description: 'Indexa documentacao local para respostas com contexto de repositorio.',
    status: 'disponivel',
    isCore: false,
    actions: [
      {
        id: 'install-docs-indexer',
        label: 'Instalar',
        kind: 'install'
      }
    ]
  },
  {
    id: 'shell.runner',
    name: 'Shell Runner Seguro',
    description: 'Executa comandos com politicas de permissao e auditoria refinadas.',
    status: 'disponivel',
    isCore: false,
    actions: [
      {
        id: 'install-shell-runner',
        label: 'Instalar',
        kind: 'install'
      }
    ]
  }
] as const;

function emitModuleAction(action: ModuleManagerAction): void {
  dispatchUiIntent({
    type: 'module-action',
    action
  });
}

export default function ModuleManager(): JSX.Element {
  const runLegacyCommand = (command: LegacyUiCommand): void => {
    dispatchUiIntent({
      type: 'run-legacy-command',
      command
    });
  };

  const handleCatalogClick = (event: MouseEvent<HTMLUListElement>): void => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const button = target.closest<HTMLButtonElement>('button[data-module-action][data-module-id]');
    if (!button) {
      return;
    }

    const actionId = button.dataset.moduleAction?.trim();
    const moduleId = button.dataset.moduleId?.trim();
    if (!actionId || !moduleId) {
      return;
    }

    emitModuleAction({
      moduleId,
      actionId,
      enabled: null
    });
  };

  const handleCatalogChange = (event: ChangeEvent<HTMLUListElement>): void => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || target.type !== 'checkbox') {
      return;
    }

    const actionId = target.dataset.moduleAction?.trim();
    const moduleId = target.dataset.moduleId?.trim();
    if (!actionId || !moduleId) {
      return;
    }

    emitModuleAction({
      moduleId,
      actionId,
      enabled: target.checked
    });
  };

  return (
    <>
      <section className="inspector-group" aria-labelledby="coreGroupTitle">
        <h3 id="coreGroupTitle" className="inspector-group-title">
          Core System
        </h3>
        <p className="sidepanel-group-lead">Estes modulos sao obrigatorios para o Dexter funcionar localmente.</p>

        <section className="card module-item module-item-core" id="runtimeCard" data-module-id="runtime.local" data-module-core="true">
          <div className="module-item-head">
            <h2>Ollama Runtime</h2>
            <span className="module-core-tag">core</span>
          </div>
          <p id="runtimeSummary">Detectando runtime...</p>
          <p className="small-label">Helper privilegiado</p>
          <p id="runtimeHelperSummary">Detectando helper...</p>
          <details
            id="runtimeHelperDetailsPanel"
            className="runtime-helper-details-panel"
            onToggle={() => runLegacyCommand('runtime-helper-details-toggle')}
          >
            <summary>Detalhes do helper/ambiente</summary>
            <p id="runtimeHelperDetails" className="runtime-helper-details">
              Aguardando diagnostico de helper.
            </p>
          </details>
          <p className="small-label">Comando sugerido</p>
          <code id="runtimeCommand">-</code>
          <div className="inline-actions runtime-actions">
            <button id="startRuntimeBtn" className="btn ghost" onClick={() => runLegacyCommand('runtime-start')}>
              Iniciar Runtime
            </button>
            <button id="installRuntimeBtn" className="btn ghost" onClick={() => runLegacyCommand('runtime-install')}>
              Instalar Runtime
            </button>
            <button id="repairRuntimeBtn" className="btn ghost" onClick={() => runLegacyCommand('runtime-repair')}>
              Reparar Runtime
            </button>
          </div>
          <p className="small-label">Instalacao do runtime</p>
          <div id="runtimeInstallProgressTrack" className="progress-track" aria-label="Progresso da instalacao do runtime">
            <div id="runtimeInstallProgressFill" className="progress-fill"></div>
          </div>
          <p id="runtimeInstallProgressText" className="small-label">
            Sem instalacao em andamento.
          </p>
        </section>

        <section className="card module-item module-item-core" id="modelsCard" data-module-id="model.base" data-module-core="true">
          <div className="module-item-head">
            <h2>Modelo Base</h2>
            <span className="module-core-tag">core</span>
          </div>
          <details className="models-block" open>
            <summary>Gerenciamento de modelos</summary>
            <label className="small-label" htmlFor="curatedModelSelect">
              Catalogo gratuito (curado)
            </label>
            <select id="curatedModelSelect"></select>
            <div className="inline-actions">
              <button id="pullModelBtn" className="btn ghost" onClick={() => runLegacyCommand('model-pull')}>
                Baixar Modelo
              </button>
              <button
                id="removeModelBtn"
                className="btn ghost"
                title="Modulo core nao pode ser removido."
                onClick={() => runLegacyCommand('model-remove')}
              >
                Remover Modelo
              </button>
            </div>
            <p className="small-label">Instalados</p>
            <ul id="installedModels" className="stats"></ul>
            <p className="small-label">Progresso</p>
            <div id="modelProgressTrack" className="progress-track" aria-label="Progresso do modelo">
              <div id="modelProgressFill" className="progress-fill"></div>
            </div>
            <p id="modelProgressText">Sem operacao em andamento.</p>
            <p id="modelProgressEta" className="small-label">
              ETA: --
            </p>
          </details>
        </section>
      </section>

      <section className="inspector-group" aria-labelledby="installedGroupTitle">
        <h3 id="installedGroupTitle" className="inspector-group-title">
          Modulos Instalados
        </h3>
        <section className="card">
          <ul
            id="installedModulesCatalog"
            className="module-catalog-list"
            onClick={handleCatalogClick}
            onChange={handleCatalogChange}
          >
            {INSTALLED_MODULES.map((item) => (
              <ModuleItem key={item.id} item={item} />
            ))}
          </ul>
        </section>
      </section>

      <section className="inspector-group" aria-labelledby="discoverGroupTitle">
        <h3 id="discoverGroupTitle" className="inspector-group-title">
          Descobrir Modulos
        </h3>
        <section className="card">
          <p className="small-label">Placeholder para loja/local feed de modulos.</p>
          <ul
            id="discoverModulesCatalog"
            className="module-catalog-list"
            onClick={handleCatalogClick}
            onChange={handleCatalogChange}
          >
            {DISCOVER_MODULES.map((item) => (
              <ModuleItem key={item.id} item={item} />
            ))}
          </ul>
        </section>
      </section>
    </>
  );
}
