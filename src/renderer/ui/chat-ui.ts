export function resizeTextareaToContent(
  textarea: HTMLTextAreaElement,
  options?: { minHeight?: number; maxHeight?: number }
): void {
  const minHeight = options?.minHeight ?? 56;
  const maxHeight = options?.maxHeight ?? 176;
  textarea.style.height = 'auto';
  const next = Math.min(maxHeight, Math.max(minHeight, textarea.scrollHeight));
  textarea.style.height = `${next}px`;
}

export function insertPromptShortcutIntoTextarea(textarea: HTMLTextAreaElement, command: string): boolean {
  if (textarea.disabled) {
    return false;
  }

  const current = textarea.value.trim();
  textarea.value = current ? `${textarea.value}\n${command}` : command;
  resizeTextareaToContent(textarea);
  textarea.focus();
  const end = textarea.value.length;
  textarea.setSelectionRange(end, end);
  return true;
}

export function syncChatEmptyStateUi(
  messagesContainer: HTMLElement,
  emptyState: HTMLElement,
  heroCard: HTMLElement
): void {
  const hasUserMessage = messagesContainer.querySelector('.message.user') !== null;
  emptyState.hidden = hasUserMessage;
  heroCard.dataset.stage = hasUserMessage ? 'active' : 'onboarding';
}
