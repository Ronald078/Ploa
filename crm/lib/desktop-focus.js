'use strict';

// Restore the content's input focus only when the user already owns this window.
// Never raise the application over another app or change authentication state.
function restoreContentFocus(window){
  if(!window||window.isDestroyed()||!window.isFocused()||window.isMinimized()||window.isEnabled?.()===false)return false;
  if(window.getChildWindows?.().some(child=>!child.isDestroyed()&&child.isModal?.()&&child.isVisible()))return false;
  const contents=window.webContents;
  if(!contents||contents.isDestroyed?.())return false;
  contents.focus();return true;
}

function attachContentFocus(window,{schedule=setImmediate}={}){
  // The BrowserWindow.webContents getter can throw once the native window has
  // been destroyed. Keep its EventEmitter while it is alive for later cleanup.
  const contents=window.webContents;
  let disposed=false;
  const restore=()=>{schedule(()=>{if(!disposed)restoreContentFocus(window);});};
  const dispose=()=>{if(disposed)return;disposed=true;window.removeListener('focus',restore);window.removeListener('restore',restore);contents.removeListener('did-finish-load',restore);window.removeListener('closed',dispose);};
  window.on('focus',restore);window.on('restore',restore);contents.on('did-finish-load',restore);window.once('closed',dispose);
  return{restore,dispose};
}
module.exports={restoreContentFocus,attachContentFocus};
