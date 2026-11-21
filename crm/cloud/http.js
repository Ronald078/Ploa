'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { CloudError } = require('./errors');
const { createSessionStore } = require('./sessions');
const { createAccountRoutes } = require('./account-routes');
const { createAccessRoutes } = require('./access-routes');
const COOKIE = 'ploa_preview_session';

async function readBody(req) {
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) throw new CloudError(415, 'content_type', 'Formato inválido.');
  let size = 0, body = '';
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 8192) throw new CloudError(413, 'body_size', 'Os dados enviados são muito grandes.');
    body += chunk;
  }
  try {
    const value = JSON.parse(body);
    if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error();
    return value;
  } catch { throw new CloudError(400, 'json', 'Confira os dados enviados.'); }
}

function createCloudHandler({ origin, gateway, publicRoot = path.join(__dirname, 'public'), assetReader, now = Date.now, persistence, runtime, accessControl, moduleHandlers,localPanel,remote,informationPages,
  mailer = { ready: false }, emailSecurity = { ready: false } }) {
  const sessions = runtime?.sessions || createSessionStore({ gateway, now, persistence });
  const secureCookies = new URL(origin).protocol === 'https:';
  const sessionCookie = secureCookies ? '__Host-ploa_session' : COOKIE;
  const attempts = new Map();
  const expectedHost = new URL(origin).host;
  function json(res, status, body) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(body));
  }
  function cookie(req, name = sessionCookie) {
    return (req.headers.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith(name + '='))?.slice(name.length + 1);
  }
  function setCookie(res, id, maxAge, name = sessionCookie, sameSite = 'Strict') {
    const previous = res.getHeader('Set-Cookie') || [];
    res.setHeader('Set-Cookie', [...previous, `${name}=${id}; HttpOnly; SameSite=${sameSite}; Path=/${secureCookies ? '; Secure' : ''}${maxAge === undefined ? '' : '; Max-Age=' + maxAge}`]);
  }
  let desktop;
  const accounts = remote?.accounts||createAccountRoutes({ origin, gateway, sessions, persistence: runtime ? { available: true } : persistence, mailer, emailSecurity, now, runtime,
    cookie, setCookie, readBody,panelAvailable:Boolean(localPanel),desktopPending:req=>desktop?.pending(req)||false,checkLoginRate: runtime?.checkLoginRate || checkLoginRate });
  if(localPanel&&!remote)desktop=require('./desktop-login').createDesktopLogin({cookie,setCookie,readBody,normalSession:accounts.normalSession,verificationFor:accounts.verificationFor,restoreVerification:accounts.restoreVerification,now});
  else if(!remote&&runtime?.desktopState)desktop=require('./remote-desktop-login').createRemoteDesktopLogin({state:runtime.desktopState,accounts,cookie,setCookie,readBody,checkLoginRate:runtime.checkLoginRate||checkLoginRate,now});
  const accessRoutes=createAccessRoutes({accessControl,gateway,readBody,moduleHandlers});
  const localRoutes=localPanel?require('./local-panel'):null;
  const panel=localRoutes?.createLocalPanel({...localPanel,origin,gateway,accessControl,accounts,cookie,setCookie,readBody,resolveScope:remote?.resolveScope});
  function checkLoginRate(req) {
    const address = req.socket.remoteAddress;
    for (const [key, item] of attempts) if (item.until <= now()) attempts.delete(key);
    const item = attempts.get(address) || { count: 0, until: now() + 10 * 60 * 1000 };
    if (item.count >= 10 || attempts.size >= 1000 && !attempts.has(address)) throw new CloudError(429, 'login_limit', 'Aguarde alguns minutos antes de tentar entrar novamente.');
    item.count++; attempts.set(address, item);
  }
  const handle = async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if(secureCookies)res.setHeader('Strict-Transport-Security','max-age=15552000');
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    let url;
    try {
      if (req.headers.host !== expectedHost) throw new CloudError(403, 'host', 'Endereço de acesso inválido.');
      try { url = new URL(req.url, origin); }
      catch { throw new CloudError(400, 'url', 'Endereço de solicitação inválido.'); }
      if(req.method==='GET'&&url.pathname==='/healthz')return json(res,200,{ok:true});
      if(req.method==='GET'&&url.pathname==='/api/cloud/desktop-manifest'&&!localPanel&&runtime?.desktopState)return json(res,200,{application:'Ploa',protocol:1,localScripts:true});
      if (!['GET','HEAD'].includes(req.method) && req.headers.origin !== origin) throw new CloudError(403, 'origin', 'Abra esta página novamente para continuar.');
      if(desktop&&await desktop.handle(req,res,url,json))return;
      if (await accounts(req, res, url, json)) return;
      if(panel&&await panel.handle({req,res,url,json}))return;
      if (url.pathname.startsWith('/api/cloud/')) {
        if (!['GET', 'POST'].includes(req.method)) throw new CloudError(405, 'method', 'Método não permitido.');
        const session = await accounts.normalSession(req);
        const { identity, accessToken } = session;
        if(await accessRoutes({req,res,url,json,session}))return;
        if (url.pathname === '/api/cloud/workspaces') {
          if (req.method === 'GET') return json(res, 200, { workspaces: await gateway.workspaces(accessToken, identity) });
          const { name } = await readBody(req);
          return json(res, 201, { workspace: await gateway.createWorkspace(accessToken, identity, name) });
        }
        const match = url.pathname.match(/^\/api\/cloud\/workspaces\/([a-f0-9-]+)$/i);
        if (match && req.method === 'GET') return json(res, 200, { workspace: await gateway.requireWorkspace(accessToken, identity, match[1]) });
        throw new CloudError(404, 'route', 'Página não encontrada.');
      }
      if (req.method !== 'GET') throw new CloudError(405, 'method', 'Método não permitido.');
      if(informationPages==='draft'||informationPages==='published'){
        const page=require('./public-information').informationPage(url.pathname,{draft:informationPages==='draft'});
        if(page){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(page);return;}
      }
      let file, type;
      if (['/','/conta','/configuracoes','/seguranca'].includes(url.pathname.replace(/\/$/,'')||'/')) { file = path.join(publicRoot, 'cloud.html'); type = 'text/html'; }
      else if (/^\/cloud-assets\/[a-zA-Z0-9_-]+\.(js|css)$/.test(url.pathname)) {
        file = path.join(publicRoot, url.pathname.slice(1)); type = file.endsWith('.js') ? 'text/javascript' : 'text/css';
      } else if (url.pathname === '/assets/ploa-logo-transparent.png') {
        file = assetReader?url.pathname:path.join(__dirname, '../public/assets/ploa-logo-transparent.png'); type = 'image/png';
      } else throw new CloudError(404, 'route', 'Página não encontrada.');
      const assetPath=type==='text/html'?'/cloud.html':url.pathname;
      const bytes = await (assetReader?assetReader(assetPath):fs.readFile(file)).catch(() => { throw new CloudError(503, 'build', 'A tela de acesso ainda não foi preparada.'); });
      res.writeHead(200, { 'Content-Type': `${type}${type.startsWith('text/') ? '; charset=utf-8' : ''}` });
      res.end(bytes);
    } catch (error) {
      if(res.headersSent){res.destroy();return;}
      const pathname=url?.pathname;
      if(panel&&pathname&&req.method==='GET'&&localRoutes.isPanelPath(pathname)&&!pathname.startsWith('/api/')&&[401,409].includes(error.status)){
        res.writeHead(302,{Location:'/'});res.end();return;
      }
      // Never serialize upstream errors, request bodies, passwords or provider tokens.
      if (error.status === 401) setCookie(res, '', 0);
      json(res, error instanceof CloudError ? error.status : 500, {
        error: error instanceof CloudError ? error.message : 'Não foi possível concluir esta ação.',
        code: error instanceof CloudError ? error.code : 'internal',
      });
    }
  };
  handle.dispose = () => { desktop?.clear();accounts.dispose(); sessions.clear(); attempts.clear(); };
  return handle;
}

module.exports = { createCloudHandler,readBody };
