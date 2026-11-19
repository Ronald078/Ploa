'use strict';
const labels={
  'pt-BR':{intro:'Pelo que você contou, a ideia seria:',question:'É isso que você tinha em mente?'},
  'pt-PT':{intro:'Pelo que explicou, a ideia seria:',question:'É isto que tinha em mente?'},
  'en-US':{intro:"Based on what you've described, here's what I suggest:",question:'Is that what you had in mind?'},
  'es-ES':{intro:'Por lo que me cuentas, la idea sería:',question:'¿Es esto lo que tenías en mente?'}
};

function formatScope(assessment,language){
  const text=labels[language]||labels['pt-BR'];
  const seen=new Set();
  const requirements=assessment.requirements.filter(item=>{
    const key=item.text.trim().toLocaleLowerCase().replace(/[.!]+$/,'');
    if(seen.has(key))return false;seen.add(key);return true;
  });
  // Show each agreed function once. The internal assessment and pricing basis
  // retain the complete summary, requirements and evidence unchanged.
  return[text.intro,requirements.map(item=>'• '+item.text).join('\n'),text.question].join('\n\n');
}

module.exports={formatScope};
