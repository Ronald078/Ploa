import React, { useState } from 'react';
import { Button, Details, Field } from './forms.jsx';
import { useDraft } from './drafts.js';
import { useCommand, scriptsRunning } from './operation-api.js';
import { OperationNotice } from './OperationNotice.jsx';
import { CopyHistory } from './CopyHistory.jsx';
import { copyCategories, currentCopies, changeCopies, categoriesWithoutCopies, categoryTitle, copyPreview } from './copy-model.js';
import { pageLink } from './navigation.js';
import {PageIntro} from './ProcessPanel.jsx';

const emptyEditor = { index:-1,text:'' };
export function Copies({ data, refresh }) {
  const metadata = data.copies;
  const [library,setLibrary,clearLibrary] = useDraft('copies','library',metadata.settings);
  const [filters,setFilters] = useDraft('copies','filters',{type:'firstContact',market:metadata.supportedMarkets[0].id,category:'__generic__'});
  const {type,market} = filters, groups = copyCategories(library,type,market,metadata,data.searchPlan);
  const category = groups.some(([id]) => id === filters.category) ? filters.category : groups[0]?.[0] || '';
  const groupKey = [type,market,category].join(':'), [editor,setEditor,clearEditor] = useDraft('copies',groupKey,emptyEditor);
  const [newCategory,setNewCategory,clearNewCategory] = useDraft('copies','new-' + market,{category:'',text:''});
  const [name,setName] = useState('Empresa Exemplo'), [variant,setVariant] = useState('0'), [previewOpen,setPreviewOpen] = useState(false),[previewDraft,setPreviewDraft] = useState(false);
  const {run,busy,notice,setNotice} = useCommand(refresh), locked = scriptsRunning(data.processes);
  const list = currentCopies(library,type,market,category,metadata), pending = categoriesWithoutCopies(library,market,data.searchPlan);
  const dirty = JSON.stringify(library) !== JSON.stringify(metadata.settings), textDirty = Boolean(editor.text.trim() || newCategory.text.trim());
  function switchGroup(patch) { setFilters({...filters,...patch});setVariant('0');setPreviewDraft(false);setNotice(null); }
  function addEditor(base = library) {
    const text = editor.text.replace(/\r\n/g,'\n').trim();
    if (!text) return {error:'Escreva a copy antes de adicionar.'};
    const existing = currentCopies(base,type,market,category,metadata);
    if (existing.some((item,index) => item === text && index !== editor.index)) return {error:'Essa copy já existe neste grupo.'};
    return {value:changeCopies(base,type,market,category,metadata,items => editor.index >= 0 ? items.map((item,index) => index === editor.index ? text : item) : [...items,text])};
  }
  function addCategory(base = library) {
    const text = newCategory.text.trim();
    if (!pending.some(([id]) => id === newCategory.category) || !text) return {error:'Escolha uma categoria da busca sem copys e escreva a primeira mensagem.'};
    return {value:changeCopies(base,'firstContact',market,newCategory.category,metadata,() => [text])};
  }
  async function save() {
    let next = library;
    if (editor.text.trim()) { const result = addEditor(next);if (result.error) {setNotice({error:true,text:result.error});return;}next = result.value; }
    if (newCategory.text.trim()) { const result = addCategory(next);if (result.error) {setNotice({error:true,text:result.error});return;}next = result.value; }
    const libStamp = library, editStamp = editor, newStamp = newCategory;
    const result = await run('/api/copies','PUT',next,'Copys salvas para a próxima execução.');
    if (result.ok) { clearLibrary(libStamp);clearEditor(editStamp);clearNewCategory(newStamp); }
  }
  const previewText = previewDraft ? editor.text.trim() : list[Number(variant)] || list[0] || '';
  return <section className="view-panel next-operation next-copies next-enter" data-view-panel="copies">
    <PageIntro eyebrow="Biblioteca de mensagens" title="Copys" description="Edite o primeiro contato e as respostas automáticas por país e categoria."/><OperationNotice notice={notice} />
    <section className="panel next-operation-panel copy-editor-panel"><div className="settings-heading copy-editor-heading"><div><span>Biblioteca utilizada pelo script</span><h2>Copys cadastradas</h2></div><p>Consulte e edite as mensagens do país e da categoria escolhidos. Novas categorias têm uma área própria abaixo.</p></div>
      <div className="copy-filter-grid next-operation-grid"><Field label="Tipo de mensagem" options={[['firstContact','Primeiro contato'],['automaticReplies','Resposta automática']]} value={type} onChange={value => switchGroup({type:value,category:value === 'firstContact' ? '__generic__' : ''})} /><Field label="País" options={metadata.supportedMarkets.map(item => [item.id,item.label])} value={market} onChange={value => switchGroup({market:value})} /><Field label="Categoria com copys" options={groups} value={category} onChange={value => switchGroup({category:value})} /></div>
      <div className="copy-editor-context next-copy-context"><div><span>{type === 'firstContact' ? 'Primeiro contato' : 'Resposta automática'}</span><h3>{market} · {groups.find(([id])=>id===category)?.[1]||categoryTitle(category,data.searchPlan)}</h3></div><p>{type === 'automaticReplies' ? metadata.automaticCategories.find(item=>item.id===category)?.description : category === '__generic__' ? 'Usadas quando o contato não possui uma categoria com copy própria.' : 'Mensagens específicas para os negócios desta categoria.'}</p><strong className="copy-count">{list.length} {list.length===1?'copy':'copys'}</strong></div>
      {locked ? <p className="next-notice" role="status">Consulta liberada. Edição e salvamento aguardam o fim dos disparos ou da busca.</p> : null}
      <details className="ploa-copy-preview next-copy-preview" open={previewOpen} onToggle={event => setPreviewOpen(event.currentTarget.open)}><summary>Pré-visualizar mensagem</summary><div className="next-form-grid"><Field label="Nome de exemplo" value={name} onChange={setName} maxLength={120} /><Field label="Variação da mensagem" value={variant} options={list.map((_,index) => [String(index),'Mensagem ' + (index + 1)])} onChange={value=>{setVariant(value);setPreviewDraft(false);}} /></div><blockquote>{copyPreview(previewText,name,categoryTitle(category,data.searchPlan)) || 'Este grupo ainda não tem uma mensagem.'}</blockquote><p className="ploa-note">Prévia local, sem envio. No script, o nome vem da planilha. {dirty || textDirty ? 'Há alterações ainda não salvas.' : ''}</p></details>
      <div className="copy-list next-copy-grid">{list.map((text,index) => <article className="copy-card" key={index}><span className="copy-card-number">{String(index + 1).padStart(2,'0')}</span><p className="copy-card-text">{text}</p><div className="copy-card-actions"><Button className="copy-action" onClick={() => {setVariant(String(index));setPreviewDraft(false);setPreviewOpen(true);}}>Pré-visualizar</Button><Button className="copy-action" disabled={locked || busy} onClick={() => {setEditor({index,text});setPreviewDraft(true);setPreviewOpen(true);}}>Editar</Button><Button className="copy-action copy-action-remove" disabled={locked || busy} onClick={() => {
        if (type === 'automaticReplies' && list.length === 1) {setNotice({error:true,text:'Respostas automáticas precisam manter ao menos uma copy por idioma e categoria.'});return;}
        if (!window.confirm('Excluir esta variação do rascunho da biblioteca? A exclusão será aplicada ao salvar.')) return;
        setLibrary(changeCopies(library,type,market,category,metadata,items => items.filter((_,i) => i !== index)));
        if(editor.index===index)clearEditor(editor);else if(editor.index>index)setEditor({...editor,index:editor.index-1});
      }}>Excluir</Button></div></article>)}</div>
      {!list.length ? <p className="ploa-note">Este filtro ainda não possui copys.</p> : null}
      <fieldset className="copy-item-form" disabled={locked || busy}><Field label={editor.index >= 0 ? 'Editar copy ' + (editor.index + 1) : 'Adicionar variação a este grupo'} type="textarea" maxLength={2500} value={editor.text} onChange={text => {setEditor({...editor,text});setPreviewDraft(true);}} /><div className="ploa-actions"><Button onClick={() => {const result = addEditor();if (result.error) setNotice({error:true,text:result.error});else {setLibrary(result.value);clearEditor(editor);}}}>{editor.index >= 0 ? 'Salvar edição no rascunho' : 'Adicionar copy'}</Button>{editor.text ? <Button onClick={() => clearEditor(editor)}>Cancelar edição</Button> : null}</div></fieldset>
      {type === 'firstContact' ? <section className="copy-category-create"><h3>Criar copys para uma categoria da busca</h3><p>Selecione uma categoria já salva em Buscar leads. Ela aparecerá na biblioteca quando tiver sua primeira copy.</p><fieldset disabled={locked || busy || !pending.length}><Field label="Categoria da busca sem copys neste país" value={newCategory.category} options={[["","Selecione uma categoria"],...pending]} onChange={value => setNewCategory({...newCategory,category:value})} /><Field label="Primeira copy da categoria" type="textarea" maxLength={2500} value={newCategory.text} onChange={text => setNewCategory({...newCategory,text})} /><div className="ploa-actions"><Button onClick={() => {const result = addCategory();if (result.error) setNotice({error:true,text:result.error});else {setLibrary(result.value);switchGroup({category:newCategory.category});clearNewCategory(newCategory);}}}>Adicionar categoria e primeira copy</Button></div></fieldset><a className="text-action" href={pageLink('search')}>Adicionar categoria em Buscar leads</a>{!pending.length ? <p>Todas as categorias ativas têm copys para este país.</p> : null}</section> : null}
      <div className="settings-footer copy-editor-footer next-operation-footer"><p className="ploa-note" role="status">{dirty || textDirty ? 'Rascunho preservado nesta aba. Salve a biblioteca para aplicar ao script.' : 'Biblioteca salva. As mensagens permanecem disponíveis para o script.'}</p><div className="ploa-actions"><Button disabled={locked || busy || !(dirty || textDirty)} onClick={() => {if (window.confirm('Descartar as alterações não salvas desta biblioteca?')) {clearLibrary(library);clearEditor(editor);clearNewCategory(newCategory);}}}>Descartar alterações</Button><Button primary disabled={locked || busy || !(dirty || textDirty)} onClick={save}>Salvar alterações da biblioteca</Button></div></div>
    </section>
    <CopyHistory data={data} market={market} category={category} command={run} busy={busy} reset={() => {clearLibrary(library);clearEditor(editor);clearNewCategory(newCategory);}} />
  </section>;
}
