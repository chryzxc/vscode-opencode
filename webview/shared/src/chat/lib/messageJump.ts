export function jumpToMessage(messageId: string): void {
  if (!messageId) {
    return;
  }

  const target =
    document.getElementById(`msg-${messageId}`) ||
    document.querySelector<HTMLElement>(`[data-message-id="${messageId}"]`);
  if (!target) {
    return;
  }

  target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  target.classList.remove('oc-message-focus');
  // Force restart of the highlight animation.
  void target.offsetWidth;
  target.classList.add('oc-message-focus');
  window.setTimeout(() => {
    target.classList.remove('oc-message-focus');
  }, 1600);
}
