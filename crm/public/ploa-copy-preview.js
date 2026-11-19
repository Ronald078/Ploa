/* Prévia local. Não consulta IA, não envia mensagens e não altera a biblioteca. */
(() => {
  'use strict';
  window.PloaCopyPreview={create({elements,state,node,getList,getCategory}){
    const panel=node('details','ploa-copy-preview');panel.append(node('summary',null,'Pré-visualizar mensagem'));
    const grid=node('div','ploa-preview-fields'),label=node('label'),name=node('input');
    name.type='text';name.value='Empresa Exemplo';name.maxLength=120;name.autocomplete='off';
    label.append(node('span',null,'Nome de exemplo'),name);
    const variantLabel=node('label'),variant=node('select');variantLabel.append(node('span',null,'Variação da mensagem'),variant);
    grid.append(label,variantLabel);
    const note=node('p','ploa-note'),message=node('blockquote','ploa-copy-preview-message');
    panel.append(grid,note,message);elements.copyList.before(panel);
    let source='list',version='';
    function render(){
      const list=getList(),signature=JSON.stringify([state.copyType,state.copyMarket,state.copyCategory,list.length]);
      if(version!==signature){const previous=variant.value||'0';variant.replaceChildren(...list.map((_,index)=>{
        const option=node('option',null,'Mensagem '+(index+1));option.value=String(index);return option;
      }));if(Number(previous)<list.length)variant.value=previous;version=signature;}
      if(source==='draft'&&!elements.copyText.value.trim())source='list';
      const text=source==='draft'?elements.copyText.value:(list[Number(variant.value)]||list[0]||'');
      message.textContent=text?text.replaceAll('{nome}',name.value.trim()||'Empresa Exemplo').replaceAll('{categoria}',getCategory()):'Este grupo ainda não tem uma mensagem para visualizar.';
      note.textContent=(source==='draft'?'Prévia do texto em edição; ainda não salvo. ':state.copySettingsDirty?'Prévia de alterações ainda não salvas. ':'Prévia da biblioteca salva. ')+
        'O nome usado aqui é apenas um exemplo; no envio, vem da planilha.';
    }
    name.addEventListener('input',render);variant.addEventListener('change',()=>{source='list';render();});
    return{render,showDraft(){source='draft';panel.open=true;render();},resetDraft(){source='list';render();},show(index){source='list';variant.value=String(index);panel.open=true;render();panel.scrollIntoView({block:'nearest',behavior:'smooth'});}};
  }};
})();
