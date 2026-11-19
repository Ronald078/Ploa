export const ACCOUNT_PAGES={
  details:{path:'/conta',title:'Detalhes da conta',description:'Seu acesso e as empresas vinculadas a ele.'},
  settings:{path:'/configuracoes',title:'Configurações',description:'Preferências e disponibilidade das funções da sua conta.'},
  security:{path:'/seguranca',title:'Segurança do acesso',description:'Gerencie sua senha e a confirmação por e-mail.'},
};
export function accountPageFromUrl(href){
  const url=new URL(href),path=url.pathname.replace(/\/$/,'');
  const direct=Object.keys(ACCOUNT_PAGES).find(key=>ACCOUNT_PAGES[key].path===path);
  if(direct)return direct;
  if(url.searchParams.get('account')==='1')return url.hash==='#account-security'?'security':url.hash==='#account-preferences'?'settings':'details';
  return null;
}
