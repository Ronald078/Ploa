'use strict';
const path=require('node:path'),http=require('node:http'),https=require('node:https'),dns=require('node:dns').promises,{execFile}=require('node:child_process');
const {readConfig}=require('./remote-access');
function command(executable,args){return new Promise((resolve,reject)=>execFile(executable,args,{windowsHide:true,timeout:5000,maxBuffer:1024*1024},(error,stdout)=>{if(error)return reject(error);try{resolve(JSON.parse(stdout));}catch{reject(new Error('Resposta inválida.'));}}));}
function bounded(promise){let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Tempo excedido.')),3500);})]).finally(()=>clearTimeout(timer));}
function probe(url,headers={}){return new Promise(resolve=>{let done=false;const finish=value=>{if(done)return;done=true;clearTimeout(timer);resolve(value);};const transport=url.startsWith('https:')?https:http;const request=transport.get(url,{headers},response=>{response.resume();finish({ok:response.statusCode===200,status:response.statusCode});});const timer=setTimeout(()=>{request.destroy();finish({ok:false,status:0});},3500);request.on('error',()=>finish({ok:false,status:0}));});}
function createMobileAccessStatus({root,targetPort=4310,gatewayPort=4311,run=command,lookup=host=>dns.lookup(host),check=probe,loadConfig=()=>readConfig(root),now=Date.now}={}){
 let cached=null,expires=0,pending=null;
 async function inspect(){
  const config=loadConfig(),tool=path.join(process.env.ProgramFiles||'C:/Program Files','Tailscale','tailscale.exe');
  const [stateResult,serveResult,app]=await Promise.allSettled([run(tool,['status','--json']),run(tool,['serve','status','--json']),check('http://127.0.0.1:'+targetPort+'/healthz')]);
  const state=stateResult.status==='fulfilled'?stateResult.value:null,serve=serveResult.status==='fulfilled'?serveResult.value:null;
  const actualHost=String(state?.Self?.DNSName||'').replace(/\.$/,'').toLowerCase(),actualLogin=state?.User?.[state?.Self?.UserID]?.LoginName;
  const matching=Boolean(config&&actualHost===config.hostname&&actualLogin===config.login);
  const handler=serve?.Web?.[config?.hostname+':443']?.Handlers?.['/']?.Proxy;
  const serving=Boolean(config&&serve?.TCP?.['443']?.HTTPS===true&&['http://127.0.0.1:'+gatewayPort,'http://127.0.0.1:'+gatewayPort+'/'].includes(handler)&&!Object.values(serve?.AllowFunnel||{}).some(Boolean));
  const [resolution,gateway,secure]=config?await Promise.allSettled([
    bounded(lookup(config.hostname)),check('http://127.0.0.1:'+gatewayPort+'/healthz',{host:config.hostname,'tailscale-user-login':config.login}),
    matching&&serving?check('https://'+config.hostname+'/healthz'):Promise.resolve({ok:false,status:0})
  ]):[];
  const dnsOk=resolution?.status==='fulfilled'&&(state?.Self?.TailscaleIPs||[]).includes(resolution.value?.address);
  const phones=matching?Object.values(state?.Peer||{}).filter(peer=>['android','ios'].includes(String(peer.OS).toLowerCase())&&String(peer.UserID)===String(state?.Self?.UserID)).slice(0,10).map(peer=>({name:String(peer.HostName||'Celular').slice(0,80),online:peer.Online===true})):[];
  const item=(id,label,status,detail)=>({id,label,status,detail});
  const checks=[
   item('app','Ploa no notebook',app.status==='fulfilled'&&app.value.ok?'ok':'error',app.status==='fulfilled'&&app.value.ok?'O servidor está respondendo.':'Abra o Ploa e tente novamente.'),
   item('config','Endereço e conta',matching?'ok':'error',matching?'Endereço vinculado à conta proprietária.':!config?'Configure o acesso pelo celular no notebook.':!state?'Não foi possível consultar o Tailscale; confira se ele está instalado e autorizado.':'A configuração não corresponde ao dispositivo/conta atuais. Execute Acesso pelo celular.cmd.'),
   item('tailscale','Tailscale no notebook',state?.BackendState==='Running'?'ok':'error',state?.BackendState==='Running'?'Conectado à rede privada.':'Abra o Tailscale no notebook e conecte sua conta.'),
   item('dns','Nome privado no notebook',dnsOk?'ok':'warning',dnsOk?'O endereço resolve neste notebook. O DNS do celular é independente.':'Confira o MagicDNS e o uso do DNS do Tailscale.'),
   item('gateway','Encaminhamento do painel',gateway?.status==='fulfilled'&&gateway.value.ok?'ok':'error',gateway?.status==='fulfilled'&&gateway.value.ok?'A entrada privada alcança o painel.':'Reabra o Ploa para carregar a entrada privada.'),
   item('https','HTTPS privado',secure?.status==='fulfilled'&&secure.value.ok?'ok':'error',secure?.status==='fulfilled'&&secure.value.ok?'O endereço HTTPS respondeu pelo notebook.':!serving?'O compartilhamento privado não corresponde à configuração. Execute Acesso pelo celular.cmd.':'A conexão HTTPS não respondeu; confira o Tailscale e tente novamente.'),
   item('phone','Celular na rede',phones.some(phone=>phone.online)?'ok':'warning',!state||!matching?'Confirme a conexão, o endereço e a conta no notebook para consultar seus dispositivos.':phones.some(phone=>phone.online)?'Há um celular da sua conta conectado. Isso não confirma o DNS do navegador.':phones.length?'O celular aparece desconectado. Abra o Tailscale nele e mantenha conectado.':'Nenhum celular foi encontrado na mesma conta.')
  ];
  return{checkedAt:new Date(now()).toISOString(),url:config?'https://'+config.hostname:'',cacheSeconds:30,checks,phones,phoneConfirmed:false};
 }
 return{snapshot(){if(cached&&now()<expires)return Promise.resolve(cached);if(pending)return pending;pending=inspect().then(result=>{cached=result;expires=now()+30000;return result;}).finally(()=>{pending=null;});return pending;}};
}
module.exports={createMobileAccessStatus};
