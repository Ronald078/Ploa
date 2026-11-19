import React,{useEffect,useId,useLayoutEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';

export function Select({label,value,onChange,options,disabled,id,...props}){
 const trigger=useRef(null),menu=useRef(null),uid=useId(),[open,setOpen]=useState(false),[active,setActive]=useState(0),[position,setPosition]=useState({}),typing=useRef({text:'',at:0});
 const selected=Math.max(0,options.findIndex(([key])=>String(key)===String(value))),listId='ploa-react-options-'+uid;
 function close(focus=false){setOpen(false);if(focus)trigger.current?.focus({preventScroll:true});}
 function show(){if(!trigger.current?.matches(':disabled')&&options.length){setActive(selected);setOpen(true);}}
 function choose(index){if(!options[index]||trigger.current?.matches(':disabled'))return;onChange(options[index][0]);close(true);}
 useLayoutEffect(()=>{if(open&&trigger.current?.matches(':disabled'))setOpen(false);});
 useLayoutEffect(()=>{if(!open)return;const rect=trigger.current.getBoundingClientRect(),below=innerHeight-rect.bottom-12,above=rect.top-12,up=below<180&&above>below,height=Math.max(64,Math.min(280,up?above:below)),width=Math.min(Math.max(rect.width,160),innerWidth-24),actual=Math.min(menu.current?.scrollHeight||height,height);setPosition({width,maxHeight:height,left:Math.max(12,Math.min(rect.left,innerWidth-width-12)),top:up?Math.max(12,rect.top-actual-6):rect.bottom+6});},[open,options]);
 useEffect(()=>{if(!open)return;const outside=event=>{if(!trigger.current?.contains(event.target)&&!menu.current?.contains(event.target))close();},scrolled=event=>{if(!menu.current?.contains(event.target))close();};document.addEventListener('pointerdown',outside);window.addEventListener('resize',scrolled);window.addEventListener('scroll',scrolled,true);return()=>{document.removeEventListener('pointerdown',outside);window.removeEventListener('resize',scrolled);window.removeEventListener('scroll',scrolled,true);};},[open]);
 useEffect(()=>{if(open)menu.current?.children[active]?.scrollIntoView({block:'nearest'});},[open,active]);
 function keyboard(event){const key=event.key;if(['ArrowDown','ArrowUp','Home','End','Enter',' ','Escape','Tab'].includes(key)){
  if(key==='Tab'){close();return;}event.preventDefault();if(key==='Escape'){close();return;}
  if(!open){show();if(key==='End')setActive(options.length-1);else if(key==='Home')setActive(0);return;}
  if(key==='Enter'||key===' '){choose(active);return;}if(key==='Home')setActive(0);else if(key==='End')setActive(options.length-1);else setActive(index=>(index+(key==='ArrowDown'?1:-1)+options.length)%options.length);
 }else if(key.length===1&&!event.ctrlKey&&!event.metaKey&&!event.altKey){event.preventDefault();const now=Date.now(),text=(now-typing.current.at<650?typing.current.text:'')+key.toLocaleLowerCase('pt-BR');typing.current={text,at:now};const index=options.findIndex(([,title])=>String(title).toLocaleLowerCase('pt-BR').startsWith(text));if(index>=0){if(!open)show();setActive(index);}}}
 return <span className="ploa-select-shell"><button ref={trigger} id={id} type="button" className="ploa-select-trigger" role="combobox" aria-label={label} aria-haspopup="listbox" aria-expanded={open} aria-controls={open?listId:undefined} aria-activedescendant={open?listId+'-'+active:undefined} disabled={disabled||!options.length} title={options[selected]?.[1]||'Selecione uma opção'} onClick={()=>open?close():show()} onKeyDown={keyboard}><span>{options[selected]?.[1]||'Selecione uma opção'}</span></button>{props.name?<input type="hidden" name={props.name} value={value}/>:null}
 {open?createPortal(<div className="ploa-select-menu" ref={menu} id={listId} role="listbox" aria-label={label} style={position}>{options.map(([key,title],index)=><div className={'ploa-select-option'+(index===active?' is-active':'')} role="option" id={listId+'-'+index} key={key} aria-selected={String(key)===String(value)} onPointerDown={event=>event.preventDefault()} onPointerMove={()=>setActive(index)} onClick={()=>choose(index)}>{title}</div>)}</div>,document.body):null}</span>;
}
