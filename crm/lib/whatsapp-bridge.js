'use strict';

const fs = require('node:fs');
const path = require('node:path');

// Exclusivo do painel local. Não abre outra sessão do WhatsApp.
function createWhatsAppBridge(root, { independent = false } = {}) {
  const token = process.env.PLOA_AGENT_TOKEN;
  const port = Number(process.env.PLOA_PANEL_PORT);
  const enabled = Boolean(token) && Number.isInteger(port) && port > 0 && port < 65536;
  const ownIds = new Set();
  const sendingTexts = new Map();
  const recentSends = [];
  let busy = false;
  let timer = null;
  let deliveryActor = null;
  let lastWarning = 0;
  let sessionStartedAt = 0;
  const idOf = (message) => typeof message?.id === 'string' ? message.id : message?.id?._serialized || message?.id?.id || '';
  const contactOf = (contact) => String(contact).replace(/@c\.us$/, '');
  const sendKey = (contact,text) => JSON.stringify([contactOf(contact),text]);
  function pruneSends() {
    const cutoff=Date.now()-60000;
    while(recentSends.length&&(recentSends[0].finishedAt<cutoff||recentSends.length>3000))recentSends.shift();
  }
  function isOwnEcho(message,contact,text) {
    const id=idOf(message);
    if(id&&ownIds.has(id))return true;
    if(sendingTexts.has(sendKey(contact,text)))return true;
    pruneSends();
    const at=Number(message.timestamp)*1000;
    if(!text||!Number.isFinite(at)||at<=0)return false;
    const receipt=recentSends.find(item=>!item.observed&&item.contact===contactOf(contact)&&item.text===text
      && !(id&&item.messageId&&id!==item.messageId)
      && (item.messageAt ? Math.floor(at/1000)===Math.floor(item.messageAt/1000)
        : at>=Math.floor(item.startedAt/1000)*1000&&at<=item.finishedAt));
    if(!receipt)return false;
    receipt.observed=true;return true;
  }

  function control() {
    if (!enabled) return 'resume';
    try { return JSON.parse(fs.readFileSync(path.join(root, 'ploa_controle.json'), 'utf8')).messages?.action || 'resume'; }
    catch { return 'resume'; }
  }
  async function request(route, body) {
    if (!enabled) return null;
    const response = await fetch('http://127.0.0.1:' + port + '/api/internal/' + route, {
      method: 'POST', signal: AbortSignal.timeout(8000),
      headers: { 'Content-Type': 'application/json', 'X-Ploa-Agent': token },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error('Painel indisponível (' + response.status + ').');
    return response.json();
  }
  function warn(error) {
    if (Date.now() - lastWarning > 30000) {
      lastWarning = Date.now();
      console.error('Ploa: não foi possível sincronizar com o painel:', error.message);
    }
  }
  async function event(data) {
    try { await request('events', data); } catch (error) { warn(error); }
  }
  async function trackSend(contact, text, send) {
    const key=sendKey(contact,text),startedAt=Date.now(),actor=deliveryActor;
    sendingTexts.set(key, (sendingTexts.get(key) || 0) + 1);
    let message;
    try { message = await send(); }
    finally { const count = (sendingTexts.get(key) || 1) - 1; if(count) sendingTexts.set(key,count); else sendingTexts.delete(key); }
    const messageId = idOf(message);
    if (messageId) {
      ownIds.add(messageId);
      if (ownIds.size > 3000) ownIds.delete(ownIds.values().next().value);
    }
    if(enabled){
      recentSends.push({contact:contactOf(contact),text,messageId,startedAt,finishedAt:Date.now(),messageAt:Number(message?.timestamp)*1000||0,observed:false});
      pruneSends();
    }
    if (enabled && !actor) void event({
      contact: String(contact).replace(/@c\.us$/, ''), direction: 'out', text,
      actor: 'script', messageId, at: new Date().toISOString(),
    });
    return message;
  }
  function start(client, isReady, send) {
    if (!enabled) return;
    sessionStartedAt=Math.floor(Date.now()/1000);
    if(timer)return;
    client.on('message_create', (message) => {
      if (!message.fromMe || !isReady() || !/(@c\.us|@lid)$/.test(message.to || '')) return;
      if(Number(message.timestamp)<sessionStartedAt)return;
      // Aguarda o retorno do envio para reconhecer IDs produzidos pelo próprio script.
      setTimeout(async () => {
        if(!isReady())return;
        if (idOf(message) && ownIds.has(idOf(message))) return;
        try {
          let contact = message.to;
          if (contact.endsWith('@lid')) {
            const [mapping] = await client.getContactLidAndPhone([contact]);
            contact = mapping?.pn || mapping?.phone || contact;
          }
          if(isOwnEcho(message,contact,message.body||''))return;
          let contactName='';
          try { const info=await client.getContactById(contact);contactName=info?.name||info?.pushname||info?.shortName||''; } catch {}
          await event({ contact: contact.replace(/@c\.us$/, ''), direction: 'out',contactName,origin:'whatsapp_external',
            text: message.body || (message.hasMedia ? '[Mídia enviada]' : ''),
            actor: 'human', messageId: idOf(message), at: new Date(message.timestamp * 1000).toISOString() });
        } catch (error) { warn(error); }
      }, 1500);
    });
    timer = setInterval(async () => {
      if (busy || !isReady() || (!independent && control() !== 'resume')) return;
      busy = true;
      try {
        const result = await request('next', {});
        const job = result?.job;
        if (!job) return;
        let message;
        try {
          deliveryActor = job.kind;
          message = await send(job.contact + '@c.us', job.text);
        } catch (error) {
          await request('ack', { id: job.id, ok: false, error: error.message });
          return;
        } finally { deliveryActor = null; }
        // Falha nesta confirmação nunca provoca repetição automática do envio.
        await request('ack', { id: job.id, ok: true, messageId: idOf(message) });
      } catch (error) { warn(error); }
      finally { busy = false; }
    }, 2500);
  }
  return { enabled, control, event, trackSend, start, close: () => clearInterval(timer), isBusy: () => busy || sendingTexts.size > 0 };
}
module.exports = { createWhatsAppBridge };
