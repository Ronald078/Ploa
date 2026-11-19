'use strict';
const path=require('node:path');
const {createMobileAccessStatus}=require('../lib/mobile-access-status');
createMobileAccessStatus({root:path.resolve(__dirname,'../..')}).snapshot().then(result=>console.log(JSON.stringify(result,null,2))).catch(()=>{console.error('Não foi possível conferir o acesso pelo celular.');process.exitCode=1;});
