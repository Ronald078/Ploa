import { useRef, useSyncExternalStore } from 'react';
import {scopedStorageKey} from './browser-scope.js';

const key = 'ploa-next-drafts-v1';
let cache,cacheKey;
const revisions = new Map(), listeners = new Map();
function changed(id) { revisions.set(id, (revisions.get(id) || 0) + 1); for (const notify of listeners.get(id) || []) notify(); }
function read() {
  const currentKey=scopedStorageKey(key);
  if (!cache||cacheKey!==currentKey) { cacheKey=currentKey;try { cache = JSON.parse(sessionStorage.getItem(currentKey)) || {}; } catch { cache = {}; } }
  return cache;
}
function write() { try { sessionStorage.setItem(scopedStorageKey(key), JSON.stringify(read())); } catch { /* Memory fallback preserves drafts during navigation. */ } }
export function useDraft(contact, section, defaults) {
  const id = contact + ':' + section;
  useSyncExternalStore(notify => { const set = listeners.get(id) || new Set(); listeners.set(id,set); set.add(notify); return () => { set.delete(notify); if (!set.size) listeners.delete(id); }; }, () => revisions.get(id) || 0);
  const latest = useRef(defaults); latest.current = defaults;
  const current = () => read()[id]?.value ?? latest.current;
  function set(value) { read()[id] = { ...read()[id], value: typeof value === 'function' ? value(current()) : value }; write(); changed(id); }
  function clearIf(snapshot) { if (JSON.stringify(current()) === JSON.stringify(snapshot)) { delete read()[id]; write(); changed(id); } }
  function request(payload) {
    const signature = JSON.stringify(payload), previous = read()[id]?.request;
    if (previous?.signature === signature) return previous.id;
    const request = { id: crypto.randomUUID(), signature }; read()[id] = { ...read()[id], value: current(), request }; write(); return request.id;
  }
  return [current(), set, clearIf, request];
}
