/* Páginas de operação. Move os mesmos formulários, preservando eventos e dados. */
(() => {
  'use strict';
  window.PloaSections = { mount({ root, aiRoot, copiesRoot, groups, getState, getSnapshot, navigate, api, notify, hasUnsaved, onTabChange }) {
    const make = (tag, className, text) => {
      const element = document.createElement(tag);
      if (className) element.className = className;
      if (text) element.textContent = text;
      return element;
    };
    const stack = page => {
      const body = make('div', 'ploa-operation-body');
      page.append(body); return body;
    };
    const messages = stack(root), ai = stack(aiRoot), copies = stack(copiesRoot);
    const add = (host, items) => { for (const item of items || []) if (item) host.append(item); };
    const fold = item => {
      if (!item) return;
      const heading = item.querySelector(':scope > h3');
      const panel = make('details', 'ploa-section ploa-operation-fold');
      const title = make('summary', null, heading?.textContent || 'Orientações');
      heading?.remove();
      const body = make('div', 'ploa-operation-fold-body'); body.append(item);
      panel.append(title, body); ai.append(panel);
    };
    const qrHost = make('div', 'ploa-message-qr');
    const [control, feature, progress, settings] = groups.disparos;
    add(messages, [control, qrHost, progress, settings, feature]);
    add(ai, [groups.attendance?.[0], groups.settings?.[0], groups.attendance?.[1]]);
    const tokenUsage=window.PloaTokenUsage.mount({host:ai});
    groups.settings?.[0]?.after(tokenUsage.root);
    for (const item of groups.offers || []) fold(item);
    fold(groups.settings?.[1]);
    add(ai, groups.history);
    add(copies, groups.copies);
    aiRoot.querySelector('#ai-history-anchor')?.remove();
    const oldLayout = root.querySelector('.module-layout');
    if (oldLayout && !oldLayout.querySelector('section')) oldLayout.remove();
    const connectionLink = make('button', 'text-action', 'Conexão e IA');
    connectionLink.type = 'button'; connectionLink.addEventListener('click', () => navigate('ai'));
    root.querySelector('.page-intro').append(connectionLink);
    const status = make('p', 'ploa-operation-status'); status.setAttribute('role', 'status');
    aiRoot.querySelector('.page-intro').after(status);
    const history = groups.history?.[0];
    document.querySelector('[data-ai-history]')?.addEventListener('click', () => {
      if (getState().activeView !== 'ai' || !history) return;
      history.open = true;
      requestAnimationFrame(() => history.scrollIntoView({ block: 'start', behavior: 'smooth' }));
    });
    const tests=window.PloaIaTests.mount({host:aiRoot,configuration:ai,api,notify,getState,hasUnsaved,onTabChange});
    function update() {
      const state = getState(), snapshot = getSnapshot(), worker = state.processes?.whatsapp;
      const connection = worker?.running ? worker.connection === 'ready' ? 'WhatsApp conectado' : worker.connection === 'qr' ? 'Aguardando conexão do WhatsApp' : worker.connection === 'pairing' ? 'Aguardando confirmação do código' : 'WhatsApp conectando' : 'WhatsApp desconectado';
      const enabled = snapshot?.settings.enabled;
      tokenUsage.update(snapshot?.tokenUsage,snapshot?.settings);
      const test=tests.getSnapshot();
      status.textContent = connection + ' · ' + (test?.running?'Teste restrito ativo':snapshot?.runtime?.label || (enabled ? snapshot.hasKey ? 'IA habilitada' : 'IA sem chave disponível' : 'IA desativada'));
      const qr = document.querySelector('#messages-qr-panel');
      const attendance = groups.attendance?.[0];
      const destination = state.activeView === 'messages' ? qrHost : attendance;
      if (qr && destination && qr.parentElement !== destination) {
        const logs = attendance?.querySelector('details');
        if (destination === attendance && logs) logs.before(qr);
        else destination.append(qr);
        requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
      }
    }
    // Mantém compatibilidade com atalhos que antes apontavam para as abas.
    const controller = { update, open(id) {
      navigate(id === 'copies' ? 'copies' : id === 'disparos' ? 'messages' : 'ai');
    } };
    window.PloaMessageSections = controller;
    aiRoot.addEventListener('ploa-test-state',update);
    update(); return controller;
  } };
})();
