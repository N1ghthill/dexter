import type { JSX, SyntheticEvent } from 'react';
import { useEffect, useState } from 'react';
import { useUiView } from '@renderer/context/UiViewContext';
import { dispatchUiIntent, type LegacyUiCommand } from '@renderer/state/ui-intents';

const SETTINGS_ACCORDION_STORAGE_KEY = 'dexter.ui.settingsAccordion.open';

type AccordionKey = 'setup' | 'runtime' | 'models';

type AccordionState = {
  setup: boolean;
  runtime: boolean;
  models: boolean;
};

const DEFAULT_ACCORDION_STATE: AccordionState = {
  setup: true,
  runtime: false,
  models: false
};

function readStoredAccordionState(): AccordionState {
  try {
    const raw = localStorage.getItem(SETTINGS_ACCORDION_STORAGE_KEY);
    if (!raw) {
      return DEFAULT_ACCORDION_STATE;
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return DEFAULT_ACCORDION_STATE;
    }

    const values = new Set(parsed.filter((item): item is string => typeof item === 'string'));
    return {
      setup: values.has('setup'),
      runtime: values.has('runtime'),
      models: values.has('models')
    };
  } catch {
    return DEFAULT_ACCORDION_STATE;
  }
}

function persistAccordionState(state: AccordionState): void {
  const openKeys: AccordionKey[] = [];
  if (state.setup) {
    openKeys.push('setup');
  }
  if (state.runtime) {
    openKeys.push('runtime');
  }
  if (state.models) {
    openKeys.push('models');
  }

  try {
    localStorage.setItem(SETTINGS_ACCORDION_STORAGE_KEY, JSON.stringify(openKeys));
  } catch {
    // Persistencia best-effort.
  }
}

export default function SettingsPanel(): JSX.Element {
  const { setActiveView } = useUiView();
  const [accordionState, setAccordionState] = useState<AccordionState>(readStoredAccordionState);
  const runLegacyCommand = (command: LegacyUiCommand): void => {
    dispatchUiIntent({
      type: 'run-legacy-command',
      command
    });
  };

  useEffect(() => {
    persistAccordionState(accordionState);
  }, [accordionState]);

  const handleToggle =
    (key: AccordionKey) =>
    (event: SyntheticEvent<HTMLDetailsElement>): void => {
      const target = event.currentTarget;
      setAccordionState((current) => ({
        ...current,
        [key]: target.open
      }));
    };

  const jumpToModules = (): void => {
    setActiveView('modules', { announce: true, focus: true, smooth: true, source: 'ui' });
  };

  return (
    <section className="inspector-group" aria-labelledby="settingsGroupTitle">
      <h3 id="settingsGroupTitle" className="inspector-group-title">
        Configuracoes
      </h3>

      <details className="settings-accordion" open={accordionState.setup} onToggle={handleToggle('setup')}>
        <summary>Setup</summary>
        <div className="settings-accordion-body">
          <section className="card setup-card" id="setupCard" aria-labelledby="setupTitle">
            <div className="setup-head">
              <h2 id="setupTitle">Primeiros Passos</h2>
              <span id="setupBadge" className="setup-badge" data-tone="busy">
                Detectando
              </span>
            </div>
            <p id="setupSummary" className="setup-summary">
              Detectando runtime, modelos e saude do ambiente...
            </p>
            <ul id="setupChecklist" className="setup-checklist" aria-label="Checklist de setup inicial"></ul>
            <p id="setupPrivilegeNote" className="setup-note">
              Permissao do Dexter nao substitui privilegio do sistema. No Linux, a instalacao do runtime pode exigir
              <code>pkexec</code> ou <code>sudo</code>.
            </p>
            <div className="inline-actions setup-actions">
              <button
                id="setupPrimaryActionBtn"
                className="btn"
                type="button"
                disabled
                onClick={() => runLegacyCommand('setup-primary')}
              >
                Detectando...
              </button>
              <button
                id="setupSecondaryActionBtn"
                className="btn ghost"
                type="button"
                hidden
                onClick={() => runLegacyCommand('setup-secondary')}
              ></button>
            </div>
          </section>
        </div>
      </details>

      <details className="settings-accordion" open={accordionState.runtime} onToggle={handleToggle('runtime')}>
        <summary>Runtime</summary>
        <div className="settings-accordion-body">
          <section className="card">
            <h2>Atalhos de runtime</h2>
            <p>Abra o modulo "Core System" para iniciar, instalar ou reparar o runtime local.</p>
            <div className="inline-actions">
              <button className="btn ghost" type="button" data-module-nav="modules" data-settings-jump="runtime" onClick={jumpToModules}>
                Ir para Core System
              </button>
            </div>
          </section>
        </div>
      </details>

      <details className="settings-accordion" open={accordionState.models} onToggle={handleToggle('models')}>
        <summary>Modelos</summary>
        <div className="settings-accordion-body">
          <section className="card">
            <h2>Gestao de modelos</h2>
            <p>Gerencie download/remocao e progresso no painel de modulos core.</p>
            <div className="inline-actions">
              <button className="btn ghost" type="button" data-module-nav="modules" data-settings-jump="models" onClick={jumpToModules}>
                Abrir modulo de modelos
              </button>
            </div>
          </section>
        </div>
      </details>
    </section>
  );
}
