'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {restoreContentFocus,attachContentFocus}=require('../lib/desktop-focus');
function fixture(){
 const window=new EventEmitter(),contents=new EventEmitter(),state={focused:true,minimized:false,enabled:true,destroyed:false,child:false,calls:0};
 Object.assign(contents,{isDestroyed:()=>false,focus:()=>state.calls++});
 Object.assign(window,{webContents:contents,isFocused:()=>state.focused,isMinimized:()=>state.minimized,isEnabled:()=>state.enabled,isDestroyed:()=>state.destroyed,getChildWindows:()=>state.child?[{isDestroyed:()=>false,isModal:()=>true,isVisible:()=>true}]:[]});return{window,state};
}
test('recupera foco do conteúdo sem alterar a janela e respeita foco de outros apps/modais',()=>{
 const f=fixture();assert.equal(restoreContentFocus(f.window),true);assert.equal(f.state.calls,1);
 for(const [key,value] of [['focused',false],['minimized',true],['enabled',false],['destroyed',true],['child',true]]){
  const g=fixture();g.state[key]=value;assert.equal(restoreContentFocus(g.window),false);assert.equal(g.state.calls,0);
 }
});
test('foco, restauração e carregamento recuperam entrada; fechar cancela callbacks pendentes',()=>{
 const f=fixture(),pending=[],service=attachContentFocus(f.window,{schedule:fn=>pending.push(fn)});
 f.window.emit('focus');f.window.emit('restore');f.window.webContents.emit('did-finish-load');pending.splice(0).forEach(fn=>fn());assert.equal(f.state.calls,3);
 service.restore();f.window.emit('closed');pending.splice(0).forEach(fn=>fn());assert.equal(f.state.calls,3);assert.equal(f.window.listenerCount('focus'),0);
});
test('fechamento não consulta webContents da janela destruída e suporta limpeza repetida',()=>{
 const f=fixture(),contents=f.window.webContents,pending=[];
 Object.defineProperty(f.window,'webContents',{get(){if(f.state.destroyed)throw TypeError('Object has been destroyed');return contents;}});
 const service=attachContentFocus(f.window,{schedule:fn=>pending.push(fn)});
 service.restore();f.state.destroyed=true;
 assert.doesNotThrow(()=>f.window.emit('closed'));
 assert.doesNotThrow(()=>service.dispose());pending.splice(0).forEach(fn=>fn());
 assert.equal(contents.listenerCount('did-finish-load'),0);assert.equal(f.window.listenerCount('closed'),0);assert.equal(f.state.calls,0);
});
