'use strict';
const fs=require('node:fs/promises'),{createReadStream,constants}=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const {releaseVersion}=require('./prepare-desktop');
const ROOT=path.resolve(__dirname,'../..'),OUTPUT=path.join(ROOT,'output');
async function checksum(file){const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);return hash.digest('hex');}
async function packageInfo(directory){
 const base=await fs.realpath(path.resolve(directory)),relative=path.relative(OUTPUT,base);
 if(!relative||path.isAbsolute(relative)||relative==='..'||relative.startsWith('..'+path.sep))throw Error('Use somente pacotes preparados em output.');
 const manifest=JSON.parse(await fs.readFile(path.join(base,'MANIFEST.json'),'utf8'));
 if(manifest.application!=='Ploa'||manifest.protocol!==1||manifest.privateDataIncluded!==false||manifest.serverSecretsIncluded!==false||manifest.validatedPublicService!==true)throw Error('O pacote precisa estar validado e sem dados privados.');
 const version=releaseVersion(manifest.version),name='Ploa-'+version+'-Setup.exe',file=path.join(base,'installer',name);
 const stat=await fs.stat(file);if(!stat.isFile())throw Error('Instalador não encontrado.');
 return{file,name,version,bytes:stat.size,sha256:await checksum(file)};
}
async function preparePilotKit({baseDirectory=path.join(OUTPUT,'windows-setup-20261114'),updateDirectory=path.join(OUTPUT,'windows-update-pilot-20261115'),destination=path.join(OUTPUT,'pilot-kit-20261115')}={}){
 const initial=await packageInfo(baseDirectory),update=await packageInfo(updateDirectory);
 if(initial.version===update.version)throw Error('O teste exige duas versões diferentes.');
 const runtime=JSON.parse(await fs.readFile(path.join(updateDirectory,'runtime-check.json'),'utf8'));
 const checks=JSON.parse(runtime.stdout);
 if(runtime.status!==0||checks.python!==true||checks.pythonLibraries!==true||checks.isolatedCommercialWorker!==true||checks.developerDependenciesUsed!==false||checks.automationsStarted!==false||checks.publicServiceValidated!==true)throw Error('Confira o runtime do pacote de atualização antes de distribuir o piloto.');
 const target=path.resolve(destination),relative=path.relative(OUTPUT,target);
 if(!relative||path.isAbsolute(relative)||relative==='..'||relative.startsWith('..'+path.sep))throw Error('Prepare o kit somente em output.');
 await fs.mkdir(target);
 for(const item of [initial,update]){const dest=path.join(target,item.name);await fs.copyFile(item.file,dest,constants.COPYFILE_EXCL);if(await checksum(dest)!==item.sha256)throw Error('A cópia do instalador não conferiu.');}
 const readme=`PLOA — PILOTO EM OUTRO WINDOWS\n\nUse este kit no outro computador Windows 10/11 de 64 bits.\nEle não deve substituir a instalação em uso no notebook de desenvolvimento.\n\n1. PRIMEIRA INSTALAÇÃO\nExecute ${initial.name}. Não é preciso instalar Node ou Python manualmente. O WhatsApp depende de Edge/Chrome/Opera compatível disponível; não conecte WhatsApp nem execute busca, disparos ou IA neste ensaio.\n\n2. ENTRADA E DADOS LOCAIS\nEntre na sua conta existente do Ploa, usando a senha atual ou Google, e conclua o código na própria página quando solicitado. Marque Lembrar de mim. Escolha a empresa existente; não crie outra empresa só para o teste.\nEsta instalação começa com uma base comercial local nova: contatos e copys do notebook não são importados automaticamente. A base original permanece no notebook.\n\n3. MARCADOR DO TESTE\nEm Copys, cadastre apenas uma mensagem local identificada como “Teste de preservação do piloto — não enviar”. Não inicie envios. Essa mensagem permite conferir o arquivo local depois da atualização.\nFeche o Ploa normalmente e reabra; confira conta e mensagem.\n\n4. ATUALIZAÇÃO\nFeche o Ploa normalmente. Execute ${update.name} no mesmo usuário Windows e diretório de instalação. Reabra e confira se a mesma conta e a mensagem de teste continuam disponíveis. Não apague pastas de dados.\n\n5. RESULTADO\nInforme se a primeira instalação abriu, se a conta foi lembrada ao reabrir e se a mensagem local permaneceu após a atualização. Registre o texto de qualquer erro; não envie senha, código de e-mail ou chave de API. Se houver bloqueio de segurança do Windows, registre a mensagem e pare essa etapa.\n\nOBSERVAÇÕES\nEstes instaladores são pilotos ainda sem assinatura de código. A execução do pacote foi conferida na máquina de desenvolvimento; instalação e atualização em outro Windows ainda precisam deste teste. Não são um lançamento comercial validado.\nOs arquivos SHA256 estão em SHA256SUMS.txt. Os dados ficam fora dos arquivos do programa, em AppData/Roaming/Ploa/BusinessData do usuário Windows. FFmpeg e Tesseract opcionais do minerador não estão incluídos.\n`;
 await fs.writeFile(path.join(target,'LEIA-PRIMEIRO.txt'),readme.replace(/\n/g,'\r\n'));
 await fs.writeFile(path.join(target,'SHA256SUMS.txt'),[initial,update].map(item=>item.sha256+'  '+item.name).join('\r\n')+'\r\n');
 const files=[initial,update].map(({file,...metadata})=>metadata);
 await fs.writeFile(path.join(target,'KIT.json'),JSON.stringify({application:'Ploa',purpose:'Windows installation and update pilot',files,installed:false,validatedOnOtherWindows:false},null,2));
 return{directory:target,files,installed:false};
}
if(require.main===module)preparePilotKit().then(result=>console.log(JSON.stringify(result))).catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={preparePilotKit};
