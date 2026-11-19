import {safety} from './engine.mjs';
import {prepareChat} from './chat-core.mjs';

const model = '@cf/meta/llama-3.1-8b-instruct-fast';
const headers = {
  'Cache-Control':'no-store',
  'X-Content-Type-Options':'nosniff',
  'Referrer-Policy':'no-referrer',
};
const json = (status,data)=>Response.json(data,{status,headers});

async function authorized(request, invite) {
  const supplied = request.headers.get('Authorization');
  if (!invite || invite.length < 32 || !supplied || !/^Bearer [a-f0-9]{64}$/.test(supplied)) return false;
  const encoder = new TextEncoder();
  const hashes = await Promise.all([supplied.slice(7),invite].map(value=>
    crypto.subtle.digest('SHA-256',encoder.encode(value))));
  const actual = new Uint8Array(hashes[0]);
  const expected = new Uint8Array(hashes[1]);
  let difference = 0;
  for (let i=0;i<actual.length;i++) difference |= actual[i]^expected[i];
  return difference===0;
}

async function readJson(request) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error();
  const decoder = new TextDecoder('utf-8',{fatal:true});
  let total = 0, body = '';
  while (true) {
    const {done,value} = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > 24000) {
      await reader.cancel();
      throw new Error();
    }
    body += decoder.decode(value,{stream:true});
  }
  return JSON.parse(body+decoder.decode());
}

export default {
  async fetch(request,env) {
    const url = new URL(request.url);
    if (!['/api/models','/api/chat'].includes(url.pathname)) {
      return url.pathname.startsWith('/api/') ? json(404,{error:'Unknown endpoint.'}) : env.ASSETS.fetch(request);
    }
    const chat = url.pathname==='/api/chat';
    if (request.method!==(chat?'POST':'GET')) return json(405,{error:'Method not allowed.'});
    if (chat && (request.headers.get('Origin')!==url.origin ||
        !/^application\/json(?:;|$)/i.test(request.headers.get('Content-Type')??''))) {
      return json(403,{error:'Open the hosted Aviceena app to send a message.'});
    }
    if (!await authorized(request,env.AVICEENA_INVITE)) return json(401,{error:'Enter a valid beta invite code.'});
    if (!chat) return json(200,{models:[model]});
    let prepared;
    try {
      const data = await readJson(request);
      // Hosted chat accepts only the separately confirmed recovery attachment.
      prepared = prepareChat({...data,records:[]});
    } catch {
      return json(400,{error:'This message or its attached review could not be read.'});
    }
    const emergency = safety(prepared.latest);
    if (emergency) return json(200,{text:emergency,urgent:true});
    try {
      const {success} = await env.CHAT_LIMIT.limit({key:request.headers.get('CF-Connecting-IP') || 'anonymous'});
      if (!success) return json(429,{error:'Please wait a minute before sending another message.'});
      const output = await env.AI.run(model,{messages:prepared.messages,max_tokens:320,temperature:.6});
      const value = output.response?.trim();
      if (!value) throw new Error();
      return json(200,{text:value,urgent:false});
    } catch {
      return json(503,{error:'Hosted AI is unavailable or has reached its quota. Try again later.'});
    }
  }
};
