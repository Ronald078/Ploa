let lastButton = null, lastClickAt = 0;

export function rememberAction(button) {
  lastButton = button;
  lastClickAt = Date.now();
}

export function actionOrigin() {
  const active = document.activeElement;
  if (active?.matches('button')) return active;
  const submit = active?.closest('form')?.querySelector('button[type="submit"],button:not([type])');
  if (submit) return submit;
  return lastButton?.isConnected && Date.now() - lastClickAt < 1000 ? lastButton : null;
}
