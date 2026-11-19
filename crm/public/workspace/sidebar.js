'use strict';
// Área de sidebar; os dados compartilhados são acessados pelo contexto.
window.PloaWorkspaceModules = window.PloaWorkspaceModules || {};
window.PloaWorkspaceModules.sidebar = function mountArea(ctx) {
const collapse=ctx.button('Recolher menu',()=>{
    updateMenuState(!document.body.classList.contains('ploa-collapsed'));
    ctx.localSet('ploa-collapsed',String(document.body.classList.contains('ploa-collapsed')));
  });

function updateMenuState(collapsed){
    document.body.classList.toggle('ploa-collapsed',collapsed);
    const label=collapsed?'Expandir menu':'Recolher menu';
    collapseLabel.textContent=label;collapse.title=label;collapse.setAttribute('aria-label',label);
    collapse.setAttribute('aria-expanded',String(!collapsed));
  }

const collapseIcon=ctx.node('span','ploa-collapse-icon');

collapseIcon.setAttribute('aria-hidden','true');

collapseIcon.innerHTML='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m14 7-5 5 5 5"/></svg>';

const collapseLabel=ctx.node('span','ploa-collapse-label','Recolher menu');

collapse.replaceChildren(collapseIcon,collapseLabel);

collapse.classList.add('ploa-collapse');

collapse.setAttribute('aria-expanded','true');

collapse.title='Recolher menu';

collapse.setAttribute('aria-label','Recolher menu');

const sideNav=ctx.$('.side-nav');

sideNav.id='ploa-side-nav';

collapse.setAttribute('aria-controls',sideNav.id);

for(const item of sideNav.querySelectorAll('.nav-item')){
    const label=ctx.$('strong',item)?.textContent.trim();
    if(label){item.title=label;item.setAttribute('aria-label',label);}
    ctx.$('.nav-icon',item)?.setAttribute('aria-hidden','true');
  }

const sidebar=sideNav.closest('.sidebar');
const brand=ctx.$('.sidebar-brand');
const header=ctx.node('div','ploa-sidebar-header'),tools=ctx.node('div','ploa-sidebar-tools');
brand.before(header);header.append(brand,tools);
tools.append(collapse);

updateMenuState(ctx.localGet('ploa-collapsed')==='true');

requestAnimationFrame(()=>requestAnimationFrame(()=>document.body.classList.add('ploa-sidebar-ready')));

// Keep the same navigation and listeners on desktop and phone.
const mobile=window.matchMedia('(max-width: 860px)');
const shell=ctx.$('.app-shell');
const menu=ctx.button('Abrir menu',()=>setMobileOpen(true));
menu.classList.add('ploa-mobile-menu-button');
menu.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg>';
menu.setAttribute('aria-label','Abrir menu');
menu.setAttribute('aria-controls',sideNav.id);
menu.setAttribute('aria-expanded','false');
const close=ctx.button('×',()=>setMobileOpen(false));
close.classList.add('ploa-mobile-menu-close');
close.setAttribute('aria-label','Fechar menu');
const backdrop=ctx.button('',()=>setMobileOpen(false));
backdrop.classList.add('ploa-mobile-backdrop');
backdrop.setAttribute('aria-label','Fechar menu');backdrop.tabIndex=-1;
ctx.$('.topbar').prepend(menu);sidebar.prepend(close);sidebar.before(backdrop);
let mobileOpen=false;
function setMobileOpen(open,restore=true){
  mobileOpen=mobile.matches&&open;
  document.body.classList.toggle('ploa-mobile-menu-open',mobileOpen);
  menu.setAttribute('aria-expanded',String(mobileOpen));
  shell.inert=mobileOpen;
  sidebar.inert=mobile.matches&&!mobileOpen;
  if(mobile.matches)sidebar.setAttribute('aria-hidden',String(!mobileOpen));
  else sidebar.removeAttribute('aria-hidden');
  if(mobileOpen)(sideNav.querySelector('[aria-current="page"]')||close).focus({preventScroll:true});
  else if(restore&&mobile.matches)menu.focus({preventScroll:true});
}
sideNav.addEventListener('click',event=>{if(mobileOpen&&event.target.closest('.nav-item'))setMobileOpen(false);});
document.addEventListener('keydown',event=>{
  if(!mobileOpen)return;
  if(event.key==='Escape'){event.preventDefault();setMobileOpen(false);}
  if(event.key==='Tab'){
    const items=[...sidebar.querySelectorAll('button:not(:disabled),a[href]')].filter(item=>item.getClientRects().length);
    const first=items[0],last=items.at(-1);
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
  }
});
mobile.addEventListener('change',()=>setMobileOpen(false,false));
setMobileOpen(false,false);
  return Object.defineProperties({}, {
    collapse: { enumerable: true, get: () => collapse },
    updateMenuState: { enumerable: true, get: () => updateMenuState },
    collapseIcon: { enumerable: true, get: () => collapseIcon },
    collapseLabel: { enumerable: true, get: () => collapseLabel },
    sideNav: { enumerable: true, get: () => sideNav }
  });
};
