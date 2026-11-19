'use strict';

const automated = (event) => ['script','ai','bot'].includes(event.actor);
const transportId = (event) => typeof event.messageId === 'string' ? event.messageId : '';
const contactOf = (event) => String(event.contact || event.numero || '').replace(/@c\.us$/, '');

function isOutgoingEcho(a, b) {
  if (a.direction !== 'out' || b.direction !== 'out' || !a.text || a.text !== b.text || a.text === '[Mídia enviada]') return false;
  if (!contactOf(a) || contactOf(a) !== contactOf(b)) return false;
  if (!((a.actor === 'human' && automated(b)) || (b.actor === 'human' && automated(a)))) return false;
  const aId=transportId(a),bId=transportId(b);
  // Different WhatsApp IDs prove separate sends, even with identical text.
  if (aId && bId) return aId === bId;
  const aTime=Date.parse(a.at),bTime=Date.parse(b.at);
  return Number.isFinite(aTime) && Number.isFinite(bTime) && Math.floor(aTime/1000) === Math.floor(bTime/1000);
}

function mergeEvents(a,b) {
  const preferred=automated(b)&&!automated(a)?b:a;
  const other=preferred===a?b:a;
  return {...other,...preferred,messageId:transportId(preferred)||transportId(other)};
}

function uniqueConversationEvents(events) {
  const result=[],ids=new Map(),echoes=new Map(),paired=new Set();
  const idKey=(event)=>transportId(event)&&JSON.stringify([contactOf(event),event.direction,transportId(event)]);
  for (const event of events) {
    if (!['in','out'].includes(event.direction)) { result.push(event); continue; }
    const id=idKey(event);
    if (id && ids.has(id)) { const index=ids.get(id);result[index]=mergeEvents(result[index],event);continue; }
    const time=Date.parse(event.at);
    const key=event.direction==='out' && event.text && Number.isFinite(time)
      ? JSON.stringify([contactOf(event),event.text,Math.floor(time/1000)]) : null;
    const candidates=key?echoes.get(key)||[]:[];
    const index=candidates.find(index=>!paired.has(index)&&isOutgoingEcho(result[index],event));
    if (index !== undefined) {
      result[index]=mergeEvents(result[index],event);paired.add(index);
      const mergedId=idKey(result[index]);if(mergedId)ids.set(mergedId,index);
    } else {
      const index=result.push(event)-1;
      if(id)ids.set(id,index);
      if(key){candidates.push(index);echoes.set(key,candidates);}
    }
  }
  return result;
}

module.exports={uniqueConversationEvents,isOutgoingEcho};
