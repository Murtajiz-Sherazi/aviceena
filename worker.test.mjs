import {test} from 'node:test';
import assert from 'node:assert/strict';
import worker from './worker.mjs';

const invite = 'a'.repeat(64);
const origin = 'https://aviceena.example';
const auth = {Authorization:'Bearer '+invite};
function chat(headers=auth,content='Hello',review) {
  return new Request(origin+'/api/chat',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...headers},
    body:JSON.stringify({messages:[{role:'user',content}],records:[{private:'unrequested'}],review})});
}

test('hosted chat denies access before model inference',async()=>{
  const env = {AVICEENA_INVITE:invite, AI:{run:()=>assert.fail('Unauthorized request reached the model')}};
  assert.equal((await worker.fetch(chat({}),env)).status,401);
  assert.equal((await worker.fetch(chat({...auth,Origin:'https://other.example'}),env)).status,403);
  assert.equal((await worker.fetch(chat(),{...env,AVICEENA_INVITE:undefined})).status,401);
});

test('hosted inference accepts explicit recovery evidence and drops raw records and notes',async()=>{
  const review = {sleep:[],energy:[{date:'2026-11-20',energy:'steady',note:'private text'}],end:'2026-11-20'};
  const env = {AVICEENA_INVITE:invite,CHAT_LIMIT:{limit:async()=>({success:true})},AI:{run:async(_,input)=>{
    assert.match(input.messages[0].content,/weekly recovery review/);
    assert.doesNotMatch(input.messages[0].content,/private text|unrequested/);
    return {response:'A hosted reply'};
  }}};
  const response = await worker.fetch(chat(auth,'Hello',review),env);
  assert.deepEqual(await response.json(),{text:'A hosted reply',urgent:false});
  env.CHAT_LIMIT.limit=async()=>({success:false});
  assert.equal((await worker.fetch(chat(),env)).status,429);
  const urgent = await worker.fetch(chat(auth,"I can't breathe"),env);
  assert.equal((await urgent.json()).urgent,true);
});
