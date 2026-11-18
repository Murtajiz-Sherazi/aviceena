import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {reading,trends,safety} from './engine.mjs';

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
const prompt = `You are Aviceena, a warm, grounded AI companion for everyday wellbeing. Respond naturally to the user's latest message in the language they use, drawing on the recent conversation. Acknowledge specifics rather than repeating a generic greeting. Ask at most one relevant follow-up. Keep replies concise. You can listen, suggest gentle everyday wellbeing practices, or explain descriptive trends in explicitly shared records. Treat those records as user-reported and potentially incomplete. Never invent values, infer causes from trends, diagnose, triage based on readings, recommend medication or dosage changes, or claim to be a clinician. For health decisions encourage a qualified professional. If the person describes an emergency or immediate danger, tell them to contact local emergency services. You cannot call for help or monitor anyone in the background. Do not imply a human or romantic relationship. Reply in plain text.`;

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
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 200000) throw new Error('Request is too large.');
  }
  return JSON.parse(body);
}

async function chat(request,response) {
  let input, messages, records;
  try {
    input = await bodyOf(request);
    if (!Array.isArray(input.messages) || !input.messages.length || input.messages.length > 16 ||
        !Array.isArray(input.records) || input.records.length > 300) throw new Error();
    messages = input.messages.map(({role,content})=>{
      if (!['user','assistant'].includes(role) || typeof content!=='string'||!content.trim()||content.length>4000) throw new Error();
      return {role,content};
    });
    if (messages.at(-1).role !== 'user') throw new Error();
    records = input.records.map(item=>reading(item.metric,item.value,item.time,item.source));
  } catch {
    return json(response,400,{error:'This message or its attached readings could not be read.'});
  }
  const emergency = safety(messages.at(-1).content);
  if (emergency) return json(response,200,{text:emergency,urgent:true});
  try {
    const available = await models();
    if (!available.includes(input.model)) return json(response,409,{error:'Choose an installed local Ollama model and try again.'});
    const context = records.length ? 'The user chose to share these descriptive summaries: '+JSON.stringify(trends(records)) : 'No readings were shared with you.';
    const upstream = await fetch(ollama+'/api/chat',{
      method:'POST',headers:{'Content-Type':'application/json'},redirect:'error',signal:AbortSignal.timeout(180000),
      body:JSON.stringify({model:input.model,stream:false,options:{temperature:.65,num_predict:480,num_ctx:4096},
        messages:[{role:'system',content:prompt+'\n'+context},...messages]})
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
