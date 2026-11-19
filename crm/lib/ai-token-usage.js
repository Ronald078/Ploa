'use strict';
const fs=require('node:fs'),path=require('node:path');
const dayKey=at=>new Date(at).toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'});
const count=value=>Number.isFinite(Number(value))?Math.max(0,Math.trunc(Number(value))):0;
const read=file=>{try{return JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));}catch{return{};}};
const cache=new Map();
const modelToday=(models,day)=>models.map(model=>({...model,today:model.daily.find(row=>row.day===day)||{day,input:0,output:0,total:0}}));
function readTokenUsage(root,legacy={},now=Date.now()){
  const file=path.join(root,'ploa_tokens.jsonl');let signature='';
  try{const stat=fs.statSync(file);signature=stat.mtimeMs+':'+stat.size;}catch{}
  const saved=cache.get(file);
  if(signature&&saved?.signature===signature){const today=saved.daily.find(row=>row.day===dayKey(now))||{day:dayKey(now),input:0,output:0,total:0};return{...saved.report,daily:saved.daily,today,byModel:modelToday(saved.report.byModel||[],dayKey(now))};}
  const modelDays=new Map();
  const days=new Map(),put=(day,input,output)=>{
    if(!/^\d{4}-\d{2}-\d{2}$/.test(day))return;
    const value=days.get(day)||{day,input:0,output:0,total:0};value.input+=count(input);value.output+=count(output);value.total=value.input+value.output;days.set(day,value);
  };
  let imported=false,warning='';
  try{
    const rows=fs.readFileSync(file,'utf8').split('\n').filter(Boolean);
    for(const line of rows){try{const row=JSON.parse(line);
      if(row.kind==='baseline'){if(!imported){for(const [day,value] of Object.entries(row.days||{}))put(day,value.input,value.output);imported=true;}}
      else if(row.kind==='usage'&&Number.isFinite(Date.parse(row.at))){
        const day=dayKey(row.at);put(day,row.input,row.output);
        if(typeof row.model==='string'&&row.model.length<=160){const provider=String(row.provider||'').slice(0,30),key=provider+':'+row.model;
          const model=modelDays.get(key)||{provider,model:row.model,days:new Map()},value=model.days.get(day)||{day,input:0,output:0,total:0};
          value.input+=count(row.input);value.output+=count(row.output);value.total=value.input+value.output;model.days.set(day,value);modelDays.set(key,model);
        }
      }
    }catch{warning='Há um registro de consumo incompleto. O total pode estar parcial.';}}
  }catch(error){if(error.code!=='ENOENT')warning='Não foi possível ler todo o registro de consumo.';}
  if(!imported)for(const [day,value] of Object.entries(legacy||{}))put(day,value.input,value.output);
  const daily=[...days.values()].sort((a,b)=>a.day.localeCompare(b.day));
  const today=daily.find(row=>row.day===dayKey(now))||{day:dayKey(now),input:0,output:0,total:0};
  const byModel=modelToday([...modelDays.values()].map(({days,...model})=>({...model,daily:[...days.values()].sort((a,b)=>a.day.localeCompare(b.day))})),dayKey(now));
  const report={today,daily,byModel,warning,scope:'Tokens informados ao Ploa pelo provedor; não representa o total da conta Groq.'};
  if(signature&&imported){if(cache.size>=16)cache.delete(cache.keys().next().value);cache.set(file,{signature,daily,report});}
  return report;
}
function createTokenRecorder(root,getLegacy=()=>({})){
  const file=path.join(root,'ploa_tokens.jsonl');let warning='';
  function record(value){try{
    if(!fs.existsSync(file)){
      const baseline={kind:'baseline',at:new Date().toISOString(),days:Object.fromEntries(Object.entries(getLegacy()||{}).map(([day,item])=>[day,{input:count(item.input),output:count(item.output)}]))};
      try{fs.writeFileSync(file,JSON.stringify(baseline)+'\n',{flag:'wx',mode:0o600});}catch(error){if(error.code!=='EEXIST')throw error;}
    }
    fs.appendFileSync(file,JSON.stringify({kind:'usage',at:value.at||new Date().toISOString(),provider:value.provider,model:value.model,input:count(value.input),output:count(value.output)})+'\n',{mode:0o600});warning='';
  }catch{warning='O último consumo não pôde ser gravado. Os totais podem estar parciais.';}}
  return{record,warning:()=>warning};
}
function tokenDashboard(root,legacy={},now=Date.now()){
  const attendance=readTokenUsage(root,legacy,now);let tests={today:{input:0,output:0,total:0},daily:[]};
  const config=read(path.join(root,'crm','ai-test-contact.json'));
  if(/^\d{7,16}$/.test(config.contact||'')){
    const testRoot=path.join(root,'teste_ia_local',config.contact),testData=read(path.join(testRoot,'ploa_workspace.json'));
    tests=readTokenUsage(testRoot,testData.usage||{},now);
  }
  return{updatedAt:new Date(now).toISOString(),day:dayKey(now),timezone:'America/Sao_Paulo',sources:{attendance,tests},scope:attendance.scope};
}
module.exports={createTokenRecorder,readTokenUsage,tokenDashboard,dayKey};
