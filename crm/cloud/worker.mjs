import {createServer} from 'node:http';
import {isIP} from 'node:net';
import {Buffer} from 'node:buffer';
import {connect} from 'node:tls';
import {httpServerHandler} from 'cloudflare:node';
import nodemailer from 'nodemailer';
import logo from '../public/assets/ploa-app-icon.png';
import configuration from './config.js';
import supabase from './supabase.js';
import mail from './gmail-mailer.js';
import emailSecurity from './email-security-provider.js';
import shared from './shared-runtime.js';
import access from './account-access.js';
import cloud from './http.js';
import redirects from './no-redirect-fetch.js';
import workerSmtp from './worker-smtp.js';

// All secrets are bindings supplied by the host, never compile-time values.
function createAdapter(env){
const config={...configuration.loadConfig({...env,PLOA_SERVER_MODE:'production',PLOA_STATE_MODE:'shared'}),fetch:redirects.createNoRedirectFetch()};
const gateway=supabase.createSupabaseGateway(config);
const mailer=mail.createGmailMailer({user:config.gmailUser,appPassword:config.gmailPassword,createTransport:workerSmtp.createWorkerSmtpTransport(nodemailer.createTransport,connect),logoContent:Buffer.from(logo),onFailure:details=>console.warn('PLOA_SMTP',JSON.stringify(details))});
const runtime=shared.createSharedRuntime({config,gateway,mailer,clientAddress:req=>{
 const address=req.headers['cf-connecting-ip'];
 // Only this Cloudflare entry point trusts the platform's replaced header.
 if(typeof address!=='string'||!isIP(address))throw Error('Trusted client address unavailable');
 return address;
}});
const handler=cloud.createCloudHandler({origin:config.origin,publicRoot:'/cloud',gateway,runtime,mailer,informationPages:'published',
 emailSecurity:emailSecurity.createEmailSecurityProvider(config),accessControl:access.createAccountAccess(config),
 assetReader:async pathname=>{const result=await env.ASSETS.fetch(new Request(config.origin+pathname));if(!result.ok)throw Error('Asset unavailable');return Buffer.from(await result.arrayBuffer());},
});
return httpServerHandler(createServer(handler));
}
let adapter;
export default {
 fetch(request,env,context){
  // First deployment may precede binding the secrets. Fail closed without
  // preventing the platform from accepting the code and its initial hostname.
  try{adapter||=createAdapter(env);}catch{return new Response(JSON.stringify({error:'O acesso do Ploa está em preparação. Tente novamente em alguns instantes.',code:'configuration'}),{status:503,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});}
  return adapter.fetch(request,env,context);
 }
};
