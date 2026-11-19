'use strict';
// Área de selects; os dados compartilhados são acessados pelo contexto.
window.PloaWorkspaceModules = window.PloaWorkspaceModules || {};
window.PloaWorkspaceModules.selects = function mountArea(ctx) {
function closePicker() {
    if(!ctx.openPicker)return;
    ctx.openPicker.trigger.setAttribute('aria-expanded','false');
    ctx.openPicker.trigger.removeAttribute('aria-activedescendant');
    ctx.openPicker.menu.remove();ctx.openPicker=null;
  }

function refreshSelects() {
    for(const [select,widget] of ctx.selectWidgets){
      if(!select.isConnected){if(ctx.openPicker===widget)closePicker();ctx.selectWidgets.delete(select);continue;}
      widget.sync();
    }
  }

function enhanceSelect(select) {
    if(ctx.selectWidgets.has(select)||select.multiple||select.size>1)return;
    const shell=ctx.node('span','ploa-select-shell');
    select.before(shell);shell.append(select);
    select.classList.add('ploa-select-native');
    select.tabIndex=-1;select.setAttribute('aria-hidden','true');
    const trigger=ctx.node('button','ploa-select-trigger');
    trigger.type='button';trigger.setAttribute('role','combobox');
    trigger.setAttribute('aria-haspopup','listbox');trigger.setAttribute('aria-expanded','false');
    const caption=ctx.node('span');trigger.append(caption);shell.append(trigger);
    const number=++ctx.nextSelectId;
    const menu=ctx.node('div','ploa-select-menu');menu.id='ploa-options-'+number;menu.setAttribute('role','listbox');
    trigger.setAttribute('aria-controls',menu.id);
    let active=-1,typeText='',lastTyped=0;
    const name=()=>select.closest('label')?.querySelector(':scope > span:not(.ploa-select-shell)')?.textContent?.trim()
      || (select.id ? document.querySelector('label[for="'+CSS.escape(select.id)+'"]')?.textContent?.trim() : '') || 'Escolher opção';
    const enabledIndexes=()=>[...select.options].map((option,index)=>!option.disabled&&!option.parentElement?.disabled?index:-1).filter(index=>index>=0);
    const widget={select,trigger,menu,position:()=>position(),sync:()=>{
      const text=select.selectedOptions[0]?.textContent?.trim()||'Selecione uma opção';
      if(caption.textContent!==text)caption.textContent=text;
      trigger.setAttribute('aria-label',name());trigger.title=text;
      trigger.disabled=select.matches(':disabled')||select.options.length===0;
      if(trigger.disabled&&ctx.openPicker===widget)closePicker();
      if(ctx.openPicker===widget){
        for(const option of menu.children){
          option.setAttribute('aria-selected',String(Number(option.dataset.index)===select.selectedIndex));
        }
      }
    }};
    ctx.selectWidgets.set(select,widget);
    function highlight(index){
      active=index;
      for(const option of menu.children)option.classList.toggle('is-active',Number(option.dataset.index)===index);
      const option=menu.querySelector('[data-index="'+index+'"]');
      if(option){
        trigger.setAttribute('aria-activedescendant',option.id);
        if(option.offsetTop<menu.scrollTop)menu.scrollTop=option.offsetTop;
        else if(option.offsetTop+option.offsetHeight>menu.scrollTop+menu.clientHeight){
          menu.scrollTop=option.offsetTop+option.offsetHeight-menu.clientHeight;
        }
      }
    }
    function choose(index){
      const option=select.options[index];if(!option||option.disabled)return;
      select.value=option.value;
      closePicker();
      select.dispatchEvent(new Event('input',{bubbles:true}));
      select.dispatchEvent(new Event('change',{bubbles:true}));
      refreshSelects();trigger.focus({preventScroll:true});
    }
    function position(){
      const rect=trigger.getBoundingClientRect();
      if(!trigger.getClientRects().length||rect.bottom<0||rect.top>window.innerHeight){closePicker();return;}
      const below=window.innerHeight-rect.bottom-12,above=rect.top-12;
      const upward=below<180&&above>below;
      const height=Math.max(64,Math.min(280,upward?above:below));
      const width=Math.min(Math.max(rect.width,160),window.innerWidth-24);
      menu.style.width=width+'px';menu.style.maxHeight=height+'px';
      menu.style.left=Math.max(12,Math.min(rect.left,window.innerWidth-width-12))+'px';
      const actualHeight=Math.min(menu.scrollHeight,height);
      menu.style.top=(upward?Math.max(12,rect.top-actualHeight-6):rect.bottom+6)+'px';
    }
    function open(){
      if(trigger.disabled)return;
      closePicker();menu.replaceChildren();
      [...select.options].forEach((option,index)=>{
        const item=ctx.node('div','ploa-select-option',option.textContent);
        item.id=menu.id+'-'+index;item.dataset.index=String(index);
        item.setAttribute('role','option');item.setAttribute('aria-selected',String(index===select.selectedIndex));
        item.setAttribute('aria-disabled',String(option.disabled||Boolean(option.parentElement?.disabled)));
        item.addEventListener('pointerdown',event=>event.preventDefault());
        item.addEventListener('click',()=>{if(item.getAttribute('aria-disabled')!=='true')choose(index);});
        menu.append(item);
      });
      // A native modal is in the browser's top layer. Its menus must belong to it.
      const owner=select.closest('dialog');(owner?.open?owner:document.body).append(menu);ctx.openPicker=widget;trigger.setAttribute('aria-expanded','true');
      position();
      highlight(enabledIndexes().includes(select.selectedIndex)?select.selectedIndex:enabledIndexes()[0]??-1);
    }
    trigger.addEventListener('click',()=>{if(ctx.openPicker===widget)closePicker();else open();});
    trigger.addEventListener('keydown',event=>{
      const keys=['ArrowDown','ArrowUp','Home','End','Enter',' ','Escape'];
      if(event.key==='Tab'){closePicker();return;}
      if(keys.includes(event.key)){
        event.preventDefault();
        if(event.key==='Escape'){closePicker();return;}
        if(event.key==='Enter'||event.key===' '){if(ctx.openPicker===widget)choose(active);else open();return;}
        if(ctx.openPicker!==widget)open();
        const indexes=enabledIndexes();if(!indexes.length)return;
        let position=Math.max(0,indexes.indexOf(active));
        if(event.key==='Home')position=0;
        else if(event.key==='End')position=indexes.length-1;
        else position=Math.max(0,Math.min(indexes.length-1,position+(event.key==='ArrowDown'?1:-1)));
        highlight(indexes[position]);return;
      }
      if(event.key.length===1&&!event.ctrlKey&&!event.metaKey&&!event.altKey){
        event.preventDefault();
        if(ctx.openPicker!==widget)open();
        typeText=Date.now()-lastTyped>700?'':typeText;typeText+=event.key;lastTyped=Date.now();
        const index=enabledIndexes().find(index=>normalizeSearch(select.options[index].textContent).startsWith(normalizeSearch(typeText)));
        if(index!==undefined)highlight(index);
      }
    });
    select.addEventListener('change',()=>{widget.sync();if(ctx.openPicker===widget)closePicker();});
    select.addEventListener('focus',()=>trigger.focus({preventScroll:true}));
    select.addEventListener('invalid',()=>trigger.focus({preventScroll:true}));
    widget.sync();
  }

document.querySelectorAll('select').forEach(enhanceSelect);

const selectObserver=new MutationObserver(records=>{
    let affected=false;
    for(const record of records){
      if(record.type==='attributes'&&(record.target.matches?.('select, fieldset, option, optgroup')))affected=true;
      if(record.type==='childList'){
        if(record.target.closest?.('select'))affected=true;
        for(const added of record.addedNodes)if(added.nodeType===1){
          if(added.matches?.('select')){enhanceSelect(added);affected=true;}
          added.querySelectorAll?.('select').forEach(select=>{enhanceSelect(select);affected=true;});
        }
      }
    }
    if(affected)refreshSelects();
  });

selectObserver.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['disabled','selected','label']});

document.addEventListener('pointerdown',event=>{
    if(ctx.openPicker&&!ctx.openPicker.trigger.contains(event.target)&&!ctx.openPicker.menu.contains(event.target))closePicker();
  });
document.addEventListener('close',event=>{if(ctx.openPicker?.trigger.closest('dialog')===event.target)closePicker();},true);

let pickerPositionFrame=null;

document.addEventListener('scroll',event=>{
    if(ctx.openPicker&&event.target!==ctx.openPicker.menu&&!ctx.openPicker.menu.contains(event.target)&&pickerPositionFrame===null){
      pickerPositionFrame=requestAnimationFrame(()=>{pickerPositionFrame=null;ctx.openPicker?.position();});
    }
  },true);
  return Object.defineProperties({}, {
    closePicker: { enumerable: true, get: () => closePicker },
    refreshSelects: { enumerable: true, get: () => refreshSelects },
    enhanceSelect: { enumerable: true, get: () => enhanceSelect },
    selectObserver: { enumerable: true, get: () => selectObserver },
    pickerPositionFrame: { enumerable: true, get: () => pickerPositionFrame, set: value => { pickerPositionFrame = value; } }
  });
};
