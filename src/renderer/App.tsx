import type { JSX, KeyboardEvent } from 'react';
import ActivityBar from '@renderer/components/layout/ActivityBar';
import Workspace from '@renderer/components/layout/Workspace';
import SidePanel from '@renderer/components/layout/SidePanel';
import { UiViewProvider } from '@renderer/context/UiViewContext';
import { dispatchUiIntent } from '@renderer/state/ui-intents';

export default function App(): JSX.Element {
  const handleGlobalKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.defaultPrevented || event.altKey || event.shiftKey) {
      return;
    }

    if (!(event.ctrlKey || event.metaKey)) {
      return;
    }

    const isNewSessionShortcut = event.key.toLowerCase() === 'n';
    const isModelEditorShortcut = event.key === ',' || event.code === 'Comma';
    if (!isNewSessionShortcut && !isModelEditorShortcut) {
      return;
    }

    event.preventDefault();
    dispatchUiIntent({
      type: 'global-keydown',
      key: event.key,
      code: event.code,
      shiftKey: event.shiftKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      altKey: event.altKey,
      defaultPrevented: event.defaultPrevented
    });
  };

  return (
    <UiViewProvider>
      <div className="app-shell app-shell-vscode" onKeyDown={handleGlobalKeyDown}>
        <ActivityBar />
        <Workspace />
        <SidePanel />
      </div>
    </UiViewProvider>
  );
}
