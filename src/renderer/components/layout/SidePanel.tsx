import type { JSX, MouseEvent } from 'react';
import { ACTIVE_VIEW_META } from '@renderer/state/active-view';
import { useUiView } from '@renderer/context/UiViewContext';
import ModuleManager from '@renderer/components/modules/ModuleManager';
import SettingsPanel from '@renderer/components/settings/SettingsPanel';
import GovernancePanel from '@renderer/components/governance/GovernancePanel';
import { dispatchUiIntent, type LegacyUiCommand } from '@renderer/state/ui-intents';

function viewProps(active: boolean): { className: string; hidden?: true; 'aria-hidden'?: 'true' } {
  return active
    ? { className: 'sidepanel-view is-active' }
    : { className: 'sidepanel-view', hidden: true, 'aria-hidden': 'true' };
}

export default function SidePanel(): JSX.Element {
  const { activeView } = useUiView();
  const viewMeta = ACTIVE_VIEW_META[activeView];
  const runLegacyCommand = (command: LegacyUiCommand): void => {
    dispatchUiIntent({
      type: 'run-legacy-command',
      command
    });
  };

  const handleQuickActionClick = (event: MouseEvent<HTMLDivElement>): void => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const button = target.closest<HTMLButtonElement>('button[data-command]');
    const command = button?.dataset.command?.trim();
    if (!button || !command) {
      return;
    }

    dispatchUiIntent({
      type: 'insert-command',
      command
    });
  };

  return (
    <aside className="inspector sidepanel">
      <span id="panelActionLive" className="sr-only" aria-live="polite" aria-atomic="true"></span>

      <header className="inspector-head sidepanel-head">
        <div className="inspector-head-copy">
          <p id="sidePanelKicker" className="inspector-kicker">
            {viewMeta.kicker}
          </p>
          <h2 id="sidePanelTitle" className="inspector-title">
            {viewMeta.title}
          </h2>
        </div>
      </header>

      <section data-sidepanel-view="chat" {...viewProps(activeView === 'chat')}>
        <section className="inspector-group" aria-labelledby="chatContextTitle">
          <h3 id="chatContextTitle" className="inspector-group-title">
            Contexto imediato
          </h3>
          <section className="card">
            <h2>Acoes rapidas de contexto</h2>
            <p>Use os atalhos para preencher comandos no chat com um clique.</p>
            <div id="chatSideQuickActions" className="inline-actions" onClick={handleQuickActionClick}>
              <button className="btn ghost" type="button" data-command="/now" data-tooltip="Contexto temporal atual">
                /now
              </button>
              <button className="btn ghost" type="button" data-command="/whoami" data-tooltip="Identidade local">
                /whoami
              </button>
              <button className="btn ghost" type="button" data-command="/mem" data-tooltip="Memoria local">
                /mem
              </button>
              <button className="btn ghost" type="button" data-command="/health" data-tooltip="Saude local">
                /health
              </button>
            </div>
          </section>
        </section>

        <section className="inspector-group" aria-labelledby="stateGroupTitle">
          <h3 id="stateGroupTitle" className="inspector-group-title">
            Estado e memoria
          </h3>
          <section className="card" id="healthCard">
            <h2>Saude</h2>
            <p id="healthSummary">Verificando...</p>
            <div className="inline-actions health-actions">
              <button
                id="healthRepairSetupBtn"
                className="btn ghost"
                type="button"
                hidden
                onClick={() => runLegacyCommand('repair-setup-health')}
              >
                Reparar Setup
              </button>
            </div>
          </section>

          <section className="card" id="memoryCard">
            <h2>Memoria</h2>
            <ul id="memoryStats" className="stats"></ul>
            <details id="memoryLivePanel" className="memory-live-panel">
              <summary>Memoria viva (sessao + persistente)</summary>
              <p className="small-label">Sessao atual</p>
              <ul id="memorySessionFacts" className="stats"></ul>
              <p className="small-label">Preferencias persistentes</p>
              <ul id="memoryPreferenceFacts" className="stats"></ul>
              <p className="small-label">Perfil persistente</p>
              <ul id="memoryProfileFacts" className="stats"></ul>
              <p className="small-label">Notas persistentes</p>
              <ul id="memoryNotes" className="stats"></ul>
              <div className="inline-actions memory-actions">
                <button
                  id="memoryClearSessionBtn"
                  className="btn ghost"
                  type="button"
                  onClick={() => runLegacyCommand('memory-clear-session')}
                >
                  Limpar Sessao
                </button>
                <button
                  id="memoryClearPreferencesBtn"
                  className="btn ghost"
                  type="button"
                  onClick={() => runLegacyCommand('memory-clear-preferences')}
                >
                  Limpar Preferencias
                </button>
                <button
                  id="memoryClearProfileBtn"
                  className="btn ghost"
                  type="button"
                  onClick={() => runLegacyCommand('memory-clear-profile')}
                >
                  Limpar Perfil
                </button>
                <button
                  id="memoryClearNotesBtn"
                  className="btn ghost"
                  type="button"
                  onClick={() => runLegacyCommand('memory-clear-notes')}
                >
                  Limpar Notas
                </button>
              </div>
            </details>
          </section>
        </section>
      </section>

      <section data-sidepanel-view="modules" {...viewProps(activeView === 'modules')}>
        <ModuleManager />
      </section>

      <section data-sidepanel-view="settings" {...viewProps(activeView === 'settings')}>
        <SettingsPanel />
      </section>

      <section data-sidepanel-view="governance" {...viewProps(activeView === 'governance')}>
        <GovernancePanel />
      </section>
    </aside>
  );
}
