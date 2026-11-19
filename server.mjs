import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {safety} from './engine.mjs';
import {prepareChat} from './chat-core.mjs';

const assets = new Map([
  ['/', ['index.html','text/html']], ['/style.css',['style.css','text/css']],
  ['/app.mjs',['app.mjs','text/javascript']], ['/engine.mjs',['engine.mjs','text/javascript']]
]);
const port = Number(process.env.PORT || 4173);
const address = '127.0.0.1';
const origin = 'http://'+address+':'+port;
const ollama = 'http://127.0.0.1:11434';
const headers = {
  'Cache-Control':'no-store',
  'X-Content-Type-Options':'nosniff',
  'Referrer-Policy':'no-referrer',
  'Permissions-Policy':'bluetooth=(self)',
  'Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
};


function json(response,status,value) {
  response.writeHead(status,{...headers,'Content-Type':'application/json; charset=utf-8'}).end(JSON.stringify(value));
}

async function models() {
  const response = await fetch(ollama+'/api/tags',{signal:AbortSignal.timeout(4000),redirect:'error'});
  if (!response.ok) throw new Error();
  const data = await response.json();
  return data.models.filter(item=>item.size>0 && typeof item.name==='string' && !item.remote_host &&
    !item.remote_model && !/(?:cloud|online)(?:$|[-:])/i.test(item.name)).map(item=>item.name);
}

async function bodyOf(request) {
  request.setEncoding('utf8');
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 200000) throw new Error('Request is too large.');
  }
  return JSON.parse(body);
}

async function chat(request,response) {
  let input, prepared;
  try {
    input = await bodyOf(request);
    prepared = prepareChat(input);
  } catch {
    return json(response,400,{error:'This message or its attached readings could not be read.'});
  }
  const emergency = safety(prepared.latest);
  if (emergency) return json(response,200,{text:emergency,urgent:true});
  try {
    const available = await models();
    if (!available.includes(input.model)) return json(response,409,{error:'Choose an installed local Ollama model and try again.'});
    const upstream = await fetch(ollama+'/api/chat',{
      method:'POST',headers:{'Content-Type':'application/json'},redirect:'error',signal:AbortSignal.timeout(180000),
      body:JSON.stringify({model:input.model,stream:false,options:{temperature:.65,num_predict:480,num_ctx:4096},
        messages:prepared.messages})
    });
    if (!upstream.ok) throw new Error();
    const text = (await upstream.json()).message?.content?.trim();
    if (!text) throw new Error();
    return json(response,200,{text,urgent:false});
  } catch {
    return json(response,503,{error:'Ollama could not finish the reply. Check that Ollama is running, then try again.'});
  }
}

createServer(async (request,response)=>{
  if (request.headers.host !== address+':'+port) return json(response,403,{error:'Use '+origin});
  const path = request.url?.split('?')[0];
  if (path === '/api/models' && request.method === 'GET') {
    try { return json(response,200,{models:await models()}); }
    catch { return json(response,503,{error:'Start Ollama to enable conversations.'}); }
  }
  if (path === '/api/chat' && request.method === 'POST') {
    if (request.headers.origin !== origin || !/^application\/json(?:;|$)/i.test(request.headers['content-type']??''))
      return json(response,403,{error:'Open Aviceena locally to send a message.'});
    return chat(request,response);
  }
  const asset = assets.get(path);
  if (!asset || !['GET','HEAD'].includes(request.method)) return json(response,404,{error:'Page not found.'});
  try {
    const body = await readFile(new URL(asset[0],import.meta.url));
    response.writeHead(200,{...headers,'Content-Type':asset[1]+'; charset=utf-8'}).end(request.method === 'HEAD' ? undefined : body);
  } catch {
    json(response,500,{error:'Could not read the application.'});
  }
}).listen(port,address,()=>console.log('Aviceena is running at '+origin));
