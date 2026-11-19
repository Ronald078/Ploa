// This preference chooses a destination only. The server rechecks access on every open.
const key=userId=>'ploa.access.workspace.v1:'+userId;
export function preferredWorkspace(storage,userId,spaces){
  if(!userId)return null;
  try{const id=storage.getItem(key(userId));return spaces.some(space=>space.id===id)?id:null;}catch{return null;}
}
export function rememberWorkspace(storage,userId,workspaceId){
  if(!userId||!workspaceId)return;
  try{storage.setItem(key(userId),workspaceId);}catch{/* Storage unavailable: keep manual entry usable. */}
}
