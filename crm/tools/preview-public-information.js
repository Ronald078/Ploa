'use strict';
const http=require('node:http');
const {createCloudHandler}=require('../cloud/http');
const port=Number(process.env.PLOA_INFO_PREVIEW_PORT||4316);
const server=http.createServer(createCloudHandler({origin:'http://127.0.0.1:'+port,informationPages:'draft',gateway:{async capabilities(){return{google:false,signup:false};}}}));
server.listen(port,'127.0.0.1',()=>console.log('Prévia dos documentos Ploa: http://127.0.0.1:'+port+'/sobre'));
server.once('error',error=>{console.error(error.code==='EADDRINUSE'?'A porta da prévia já está em uso.':'Não foi possível abrir a prévia.');process.exitCode=1;});
process.on('SIGINT',()=>server.close());process.on('SIGTERM',()=>server.close());
