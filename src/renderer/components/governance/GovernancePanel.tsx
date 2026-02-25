import type { JSX } from 'react';
import { dispatchUiIntent, type LegacyUiCommand } from '@renderer/state/ui-intents';

export default function GovernancePanel(): JSX.Element {
  const runLegacyCommand = (command: LegacyUiCommand): void => {
    dispatchUiIntent({
      type: 'run-legacy-command',
      command
    });
  };

  return (
    <section className="inspector-group" aria-labelledby="govGroupTitle">
      <h3 id="govGroupTitle" className="inspector-group-title">
        Governanca
      </h3>

      <section className="card" id="permissionsCard">
        <h2>Permissoes</h2>
        <div className="permission-grid">
          <label>
            <span>Instalar runtime</span>
            <select
              id="permRuntimeInstall"
              data-scope="runtime.install"
              onChange={() => runLegacyCommand('permission-runtime-install-change')}
            >
              <option value="allow">allow</option>
              <option value="ask">ask</option>
              <option value="deny">deny</option>
            </select>
          </label>
          <label>
            <span>Filesystem read</span>
            <select
              id="permFsRead"
              data-scope="tools.filesystem.read"
              onChange={() => runLegacyCommand('permission-fs-read-change')}
            >
              <option value="allow">allow</option>
              <option value="ask">ask</option>
              <option value="deny">deny</option>
            </select>
          </label>
          <label>
            <span>Filesystem write</span>
            <select
              id="permFsWrite"
              data-scope="tools.filesystem.write"
              onChange={() => runLegacyCommand('permission-fs-write-change')}
            >
              <option value="allow">allow</option>
              <option value="ask">ask</option>
              <option value="deny">deny</option>
            </select>
          </label>
          <label>
            <span>System exec</span>
            <select
              id="permSystemExec"
              data-scope="tools.system.exec"
              onChange={() => runLegacyCommand('permission-system-exec-change')}
            >
              <option value="allow">allow</option>
              <option value="ask">ask</option>
              <option value="deny">deny</option>
            </select>
          </label>
        </div>
      </section>

      <section className="card" id="updatesCard">
        <h2>Updates</h2>
        <p id="updateSummary" className="update-summary" data-phase="idle">
          Sem verificacao recente.
        </p>
        <p className="small-label">Politica</p>
        <div className="update-policy-row">
          <select
            id="updateChannelSelect"
            aria-label="Canal de updates"
            onChange={() => runLegacyCommand('update-channel-change')}
          >
            <option value="stable">stable</option>
            <option value="rc">rc</option>
          </select>
          <label className="toggle-inline" htmlFor="updateAutoCheckInput">
            <input id="updateAutoCheckInput" type="checkbox" onChange={() => runLegacyCommand('update-auto-check-change')} />
            <span>Auto-check</span>
          </label>
        </div>
        <div className="inline-actions">
          <button id="updateCheckBtn" className="btn ghost" onClick={() => runLegacyCommand('update-check')}>
            Verificar Update
          </button>
          <button id="updateDownloadBtn" className="btn ghost" onClick={() => runLegacyCommand('update-download')}>
            Baixar Update
          </button>
          <button id="updateRestartBtn" className="btn ghost" onClick={() => runLegacyCommand('update-restart')}>
            Aplicar no Reinicio
          </button>
        </div>
        <p className="small-label">Versao disponivel</p>
        <code id="updateAvailableVersion">-</code>
        <p className="small-label">Compatibilidade</p>
        <p id="updateCompatibility">-</p>
        <p className="small-label">Notas</p>
        <p id="updateNotes">Sem dados de update.</p>
      </section>

      <section className="card" id="auditExportsCard">
        <h2>Auditoria e Exportacao</h2>

        <div className="history-filters">
          <select
            id="historyOperationFilter"
            aria-label="Filtrar por operacao"
            onChange={() => runLegacyCommand('history-operation-filter-change')}
          >
            <option value="all">Operacao: todas</option>
            <option value="pull">Operacao: pull</option>
            <option value="remove">Operacao: remove</option>
          </select>
          <select
            id="historyStatusFilter"
            aria-label="Filtrar por status"
            onChange={() => runLegacyCommand('history-status-filter-change')}
          >
            <option value="all">Status: todos</option>
            <option value="running">Status: running</option>
            <option value="done">Status: done</option>
            <option value="error">Status: error</option>
            <option value="blocked">Status: blocked</option>
          </select>
        </div>
        <ul id="modelHistory" className="stats history-list"></ul>
        <div id="historyDetail" className="history-detail">
          <p id="historyDetailTitle" className="small-label">
            Detalhes da operacao
          </p>
          <p id="historyDetailMessage">Selecione uma operacao para ver os detalhes.</p>
          <code id="historyDetailMeta">-</code>
        </div>
        <div className="history-pagination">
          <button id="historyPrevBtn" className="btn ghost" onClick={() => runLegacyCommand('history-prev')}>
            Anterior
          </button>
          <p id="historyPageInfo" className="small-label">
            Pagina 1/1
          </p>
          <button id="historyNextBtn" className="btn ghost" onClick={() => runLegacyCommand('history-next')}>
            Proxima
          </button>
        </div>

        <p className="small-label">Exportacao de auditoria</p>
        <div className="export-presets">
          <button id="exportPresetTodayBtn" className="btn ghost" onClick={() => runLegacyCommand('export-preset-today')}>
            Hoje
          </button>
          <button id="exportPreset7dBtn" className="btn ghost" onClick={() => runLegacyCommand('export-preset-7d')}>
            7 dias
          </button>
          <button id="exportPreset30dBtn" className="btn ghost" onClick={() => runLegacyCommand('export-preset-30d')}>
            30 dias
          </button>
          <button id="exportPresetClearBtn" className="btn ghost" onClick={() => runLegacyCommand('export-preset-clear')}>
            Limpar
          </button>
        </div>
        <div className="export-controls">
          <input
            id="exportDateFrom"
            type="date"
            aria-label="Data inicial da exportacao"
            onChange={() => runLegacyCommand('export-date-from-change')}
          />
          <input
            id="exportDateTo"
            type="date"
            aria-label="Data final da exportacao"
            onChange={() => runLegacyCommand('export-date-to-change')}
          />
          <select id="exportFormatSelect" aria-label="Formato de exportacao" onChange={() => runLegacyCommand('export-format-change')}>
            <option value="json">json</option>
            <option value="csv">csv</option>
          </select>
          <select
            id="exportLogScopeSelect"
            aria-label="Escopo dos logs"
            title="Filtra escopo de logs exportados (all, updates ou ui)."
            onChange={() => runLegacyCommand('export-log-scope-change')}
          >
            <option value="all">logs: all</option>
            <option value="updates">logs: updates</option>
            <option value="ui">logs: ui</option>
          </select>
          <select
            id="exportUpdateAuditFamilySelect"
            aria-label="Familia da auditoria de update"
            onChange={() => runLegacyCommand('export-update-audit-family-change')}
          >
            <option value="all">audit: all</option>
            <option value="check">audit: check</option>
            <option value="download">audit: download</option>
            <option value="apply">audit: apply</option>
            <option value="migration">audit: migration</option>
            <option value="rollback">audit: rollback</option>
            <option value="other">audit: other</option>
          </select>
          <select
            id="exportUpdateAuditSeveritySelect"
            aria-label="Severidade da auditoria de update"
            onChange={() => runLegacyCommand('export-update-audit-severity-change')}
          >
            <option value="all">sev: all</option>
            <option value="warn-error">sev: warn/error</option>
          </select>
          <select
            id="exportUpdateAuditWindowSelect"
            aria-label="Janela temporal da auditoria de update"
            title="Define janela temporal para trilhas de auditoria de update."
            onChange={() => runLegacyCommand('export-update-audit-window-change')}
          >
            <option value="custom">audit range: custom</option>
            <option value="24h">audit range: 24h</option>
            <option value="7d">audit range: 7d</option>
            <option value="30d">audit range: 30d</option>
          </select>
          <label className="checkbox-inline" htmlFor="exportUpdateAuditCodeOnly">
            <input id="exportUpdateAuditCodeOnly" type="checkbox" onChange={() => runLegacyCommand('export-update-audit-code-only-change')} />
            <span>audit: code only</span>
          </label>
          <button id="exportHistoryBtn" className="btn ghost" onClick={() => runLegacyCommand('export-history')}>
            Exportar Historico
          </button>
          <button id="exportLogsBtn" className="btn ghost" onClick={() => runLegacyCommand('export-logs')}>
            Exportar Logs
          </button>
          <button id="exportUpdateLogsBtn" className="btn ghost" onClick={() => runLegacyCommand('export-update-logs')}>
            Logs de Update
          </button>
          <button
            id="exportUiAuditLogsBtn"
            className="btn ghost"
            title="Exporta logs de auditoria de UI usando o periodo selecionado atual"
            onClick={() => runLegacyCommand('export-ui-audit-logs')}
          >
            Logs de UI
          </button>
          <button id="exportUpdateAuditTrailBtn" className="btn ghost" onClick={() => runLegacyCommand('export-update-audit-trail')}>
            Auditoria Update
          </button>
          <button id="exportUpdateAuditErrorsBtn" className="btn ghost" onClick={() => runLegacyCommand('export-update-audit-errors')}>
            Erros de Update
          </button>
        </div>
        <p id="exportLogsPreview" className="small-label">
          Logs no escopo selecionado: --
        </p>
        <p id="exportUpdateAuditPreview" className="small-label">
          Auditoria Update (familia selecionada): --
        </p>
      </section>
    </section>
  );
}
