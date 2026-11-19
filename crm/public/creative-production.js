'use strict';
window.PloaCreativeProduction={render({host,ad,el,button,actions,notify,onRender}){
 const p=ad.analysis.production;
 const note=text=>el('p','cm-note',text);
 const block=(label,text)=>{const node=el('div','cm-production-block');node.append(el('strong',null,label),el('p','cm-detail-text',text));return node;};
 const intro=el('div','cm-production-intro');intro.append(el('h4',null,p.concept),note(({video:'Vídeo',image:'Imagem única',carousel:'Carrossel'}[p.config.format]||p.config.format)+(p.config.durationSeconds?' de '+p.config.durationSeconds+' segundos':'')+' · Plano para produzir e revisar'));
 host.append(intro,note(p.coverage.summary));
 const nav=el('div','cm-production-nav');nav.setAttribute('aria-label','Partes da modelagem');const body=el('div','cm-production-content');
 const tabs=[['script','Roteiro e cenas'],['copy','Texto e ganchos'],['direction','Produção e testes'],['reference','Análise da referência']];
 function show(id){body.replaceChildren();for(const item of nav.children)item.setAttribute('aria-pressed',String(item.dataset.section===id));
  if(id==='script'){
   for(const [index,row] of p.scenes.entries()){const shot=el('article','cm-shot'),head=el('div','cm-shot-head');head.append(el('strong',null,row.role),el('span','cm-time',p.config.format==='video'?row.start+'–'+row.end+' s':p.config.format==='carousel'?'Slide '+(index+1):'Imagem única'));shot.append(head);
    const columns=el('div','cm-shot-grid');columns.append(block('O que mostrar',row.visual),block(p.config.format==='video'?'Fala / narração':'Mensagem',row.voiceover||'Sem narração.'),block('Texto na tela',row.onScreen||'Sem texto adicional.'));shot.append(columns,note('Direção: '+row.editing));body.append(shot);}
  }else if(id==='copy'){
   body.append(block('Texto principal',p.copy.primaryText),block('Título',p.copy.headline),block('Descrição',p.copy.description||'Sem descrição adicional.'),block('Chamada para ação',p.copy.cta));
   body.append(actions(button('Copiar texto do anúncio',async()=>{await navigator.clipboard.writeText(p.copy.primaryText+'\n\n'+p.copy.headline+'\n'+p.copy.cta);notify('Texto do anúncio copiado.');})));
   body.append(el('h4',null,'Alternativas para a abertura'),note('Escolha uma abertura para cada versão do anúncio.'));
   for(const [index,row] of p.copy.hooks.entries()){const box=el('article','cm-hook');box.append(el('strong',null,'Variação '+(index+1)),el('p','cm-detail-text',row.line),note('Visual: '+row.visual));body.append(box);}
  }else if(id==='direction'){
   const grid=el('div','cm-direction-grid');for(const [key,label] of [['identity','Identidade visual'],['framing','Enquadramento'],['editing','Edição'],['sound','Som sugerido']])grid.append(block(label,p.direction[key]));body.append(grid,el('h4',null,'Materiais para produzir'));
   const assets=el('ul','cm-production-list');for(const item of p.copy.assets)assets.append(el('li',null,item));body.append(assets,el('h4',null,'O que testar'));
   for(const row of p.copy.tests){const box=el('article','cm-test');box.append(block('Mudar uma variável',row.change),note('Hipótese: '+row.hypothesis),note('Acompanhar: '+row.metric));body.append(box);}
   body.append(el('h4',null,'Conferir antes de publicar'));const checks=el('ul','cm-production-list');for(const item of p.copy.checks)checks.append(el('li',null,item));body.append(checks);
  }else{
   body.append(block('Lógica aproveitada',p.reference.mechanism));for(const [key,label] of [['hook','Gancho original'],['audience','Público'],['problem','Problema'],['offer','Oferta da referência'],['claimedProof','Prova alegada'],['cta','Ação proposta']])body.append(block(label,p.reference[key]));
   if(p.coverage.boardUrl){const image=el('img','cm-storyboard');image.src=p.coverage.boardUrl;image.alt='Quadros da referência usados na análise, em ordem de leitura';image.loading='lazy';body.append(image,note((p.coverage.samples||[]).map(row=>row.id+': '+row.seconds+' s').join(' · ')));}
   for(const row of p.reference.observations){const box=el('article','cm-observation');box.append(el('strong',null,({observed:'Observado no material',inferred:'Inferência a conferir',unknown:'Sem evidência disponível'}[row.kind]||row.kind)),el('p','cm-detail-text',row.detail));if(row.evidenceIds.length)box.append(note('Base: '+row.evidenceIds.join(', ')));body.append(box);}
   const avoid=el('ul','cm-production-list');for(const item of p.reference.avoidCopying)avoid.append(el('li',null,item));body.append(el('h4',null,'O que não reproduzir'),avoid);for(const item of p.coverage.notes||[])body.append(note(item));
  }
 }
 for(const [id,label] of tabs){const item=button(label,()=>show(id));item.dataset.section=id;item.setAttribute('aria-pressed','false');nav.append(item);}host.append(nav,body);show('script');
 const exports=actions(button('Copiar plano completo',async()=>{const response=await fetch('/api/creative-miner/ads/'+ad.id+'/brief');if(!response.ok)throw new Error('Não foi possível exportar a modelagem.');await navigator.clipboard.writeText(await response.text());notify('Plano completo copiado.');}));
 const download=el('a','button button-secondary','Baixar plano de produção');download.href='/api/creative-miner/ads/'+ad.id+'/brief';download.download='ploa-modelagem.md';exports.append(download);host.append(exports);
 window.PloaCreativeRender.mount({host,ad,el,button,actions,notify,onRender});
}};
