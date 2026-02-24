const DEFAULT_GROUP_WINDOW_MS = 2 * 60 * 1000;
const TYPING_INDICATOR_CLASS = 'message-typing-indicator';
const UNREAD_SEPARATOR_CLASS = 'message-unread-separator';

export function ensureMessageDaySeparator(container: HTMLElement, date: Date): void {
  const dayKey = formatMessageDayKey(date);
  const lastSeparator = findLastTimelineSeparator(container, 'message-day-separator');
  if (lastSeparator?.dataset.dayKey === dayKey) {
    return;
  }

  const separator = document.createElement('div');
  separator.className = 'message-day-separator';
  separator.dataset.dayKey = dayKey;

  const label = document.createElement('span');
  label.textContent = formatMessageDayLabel(date);
  separator.appendChild(label);

  container.appendChild(separator);
}

export function appendMessageSessionSeparator(container: HTMLElement, labelText: string): void {
  const separator = document.createElement('div');
  separator.className = 'message-session-separator';

  const label = document.createElement('span');
  label.textContent = labelText;
  separator.appendChild(label);

  container.appendChild(separator);
}

export function ensureUnreadMessageSeparator(container: HTMLElement, labelText = 'Novas mensagens'): void {
  const existing = container.querySelector<HTMLElement>(`.${UNREAD_SEPARATOR_CLASS}`);
  if (existing) {
    const label = existing.querySelector<HTMLElement>('span');
    if (label) {
      label.textContent = labelText;
    }
    return;
  }

  const separator = document.createElement('div');
  separator.className = UNREAD_SEPARATOR_CLASS;

  const label = document.createElement('span');
  label.textContent = labelText;
  separator.appendChild(label);

  container.appendChild(separator);
}

export function clearUnreadMessageSeparator(container: HTMLElement): void {
  container.querySelector<HTMLElement>(`.${UNREAD_SEPARATOR_CLASS}`)?.remove();
}

export function syncAssistantTypingIndicator(
  container: HTMLElement,
  options: { visible: boolean; avatarSrc: string; label?: string }
): void {
  const existing = container.querySelector<HTMLElement>(`.${TYPING_INDICATOR_CLASS}`);

  if (!options.visible) {
    existing?.remove();
    return;
  }

  const indicator = existing ?? buildAssistantTypingIndicator(options.avatarSrc, options.label);
  const labelNode = indicator.querySelector<HTMLElement>('.message-typing-label');
  if (labelNode) {
    labelNode.textContent = options.label ?? 'Dexter digitando...';
  }

  container.appendChild(indicator);
}

export function applyMessageGrouping(
  container: HTMLElement,
  nextArticle: HTMLElement,
  options?: { groupWindowMs?: number }
): void {
  const prev = findLastMessageArticleBeforeBoundary(container);
  if (!prev) {
    return;
  }

  const sameRole = prev.dataset.role === nextArticle.dataset.role;
  const sameDay = prev.dataset.dayKey === nextArticle.dataset.dayKey;
  const sameSource = prev.dataset.role === 'assistant' ? prev.dataset.source === nextArticle.dataset.source : true;
  const prevTs = Number.parseInt(prev.dataset.ts || '', 10);
  const nextTs = Number.parseInt(nextArticle.dataset.ts || '', 10);
  const groupWindowMs = options?.groupWindowMs ?? DEFAULT_GROUP_WINDOW_MS;
  const closeInTime =
    Number.isFinite(prevTs) && Number.isFinite(nextTs) ? Math.abs(nextTs - prevTs) <= groupWindowMs : false;

  if (sameRole && sameDay && sameSource && closeInTime) {
    nextArticle.classList.add('compact');
  }
}

export function formatMessageDayKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function findLastTimelineSeparator(container: HTMLElement, className: string): HTMLElement | null {
  const children = Array.from(container.children);
  for (let index = children.length - 1; index >= 0; index -= 1) {
    const child = children[index];
    if (!(child instanceof HTMLElement)) {
      continue;
    }
    if (child.classList.contains(className)) {
      return child;
    }
  }
  return null;
}

function findLastMessageArticleBeforeBoundary(container: HTMLElement): HTMLElement | null {
  const children = Array.from(container.children);
  for (let index = children.length - 1; index >= 0; index -= 1) {
    const child = children[index];
    if (!(child instanceof HTMLElement)) {
      continue;
    }
    if (child.classList.contains(TYPING_INDICATOR_CLASS)) {
      continue;
    }
    if (child.classList.contains('message-session-separator') || child.classList.contains(UNREAD_SEPARATOR_CLASS)) {
      return null;
    }
    if (child.classList.contains('message')) {
      return child;
    }
  }
  return null;
}

function buildAssistantTypingIndicator(avatarSrc: string, label?: string): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = TYPING_INDICATOR_CLASS;
  wrapper.setAttribute('aria-hidden', 'true');

  const head = document.createElement('div');
  head.className = 'message-head';

  const avatar = document.createElement('img');
  avatar.className = 'message-avatar';
  avatar.src = avatarSrc;
  avatar.alt = '';
  avatar.decoding = 'async';
  head.appendChild(avatar);

  const headLabel = document.createElement('span');
  headLabel.className = 'message-typing-label';
  headLabel.textContent = label ?? 'Dexter digitando...';
  head.appendChild(headLabel);

  const bubble = document.createElement('div');
  bubble.className = 'message-typing-bubble';

  for (let index = 0; index < 3; index += 1) {
    const dot = document.createElement('span');
    dot.className = 'message-typing-dot';
    dot.style.setProperty('--typing-delay', `${index * 120}ms`);
    bubble.appendChild(dot);
  }

  wrapper.append(head, bubble);
  return wrapper;
}

// Exported constant is not required by callers; style class is internal here.

function formatMessageDayLabel(date: Date): string {
  const today = new Date();
  const todayKey = formatMessageDayKey(today);
  const dateKey = formatMessageDayKey(date);
  if (dateKey === todayKey) {
    return 'Hoje';
  }

  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (dateKey === formatMessageDayKey(yesterday)) {
    return 'Ontem';
  }

  return date.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  });
}
