import { parseActiveView, type ActiveView } from '@renderer/state/active-view';

export type ActiveViewChangeOptions = {
  announce?: boolean;
  focus?: boolean;
  smooth?: boolean;
  source?: 'ui' | 'legacy' | 'system';
};

type ActiveViewListener = (nextView: ActiveView, options: ActiveViewChangeOptions) => void;

let activeView: ActiveView = 'chat';
const listeners = new Set<ActiveViewListener>();

export function getActiveView(): ActiveView {
  return activeView;
}

export function setActiveView(view: ActiveView | string | null | undefined, options: ActiveViewChangeOptions = {}): void {
  const nextView = parseActiveView(view);
  activeView = nextView;

  for (const listener of listeners) {
    listener(nextView, options);
  }
}

export function subscribeActiveView(listener: ActiveViewListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
