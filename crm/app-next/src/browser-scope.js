let scope='';
export const scopedStorageKey=key=>scope?key+':'+scope:key;
export function configureBrowserScope(next,{migrateLegacy=false}={}){
 scope=next||'';
 if(scope&&migrateLegacy)for(const key of ['ploa-next-drafts-v1','ploa-next-filters'])try{
  const old=sessionStorage.getItem(key),target=scopedStorageKey(key);
  if(old&&sessionStorage.getItem(target)===null){sessionStorage.setItem(target,old);sessionStorage.removeItem(key);}
 }catch{/* Optional drafts never block account access. */}
}
