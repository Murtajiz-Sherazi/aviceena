import {test} from 'node:test';
import assert from 'node:assert/strict';
import {reading,trends,importReadings,decodeHeartRate,safety} from './engine.mjs';

const time = '2026-11-19T05:00:00Z';

test('readings validate input and preserve provenance',()=>{
  assert.equal(reading('heart','72',time,'manual').source,'manual');
  for (const value of ['',null,Infinity,0,401]) assert.throws(()=>reading('heart',value,time,'manual'));
  assert.throws(()=>reading('heart',72,'unknown','manual'));
  assert.throws(()=>reading('heart',72,time,'unknown'));
});

test('trends begin empty and order data by reading timestamp',()=>{
  assert.deepEqual(trends([]),[]);
  const result = trends([reading('heart',75,'2026-11-20T05:00:00Z','bluetooth'),reading('heart',72,time,'manual')])[0];
  assert.equal(result.change,3);
  assert.equal(result.latest.source,'bluetooth');
});

test('imports accept timezone-qualified readings and reject invalid rows',()=>{
  assert.equal(importReadings('timestamp,metric,value\n'+time+',sleep,7.5')[0].source,'import');
  assert.throws(()=>importReadings('timestamp,metric,value\n2026-11-19T05:00:00,heart,72'),/row 2/);
  assert.throws(()=>importReadings('timestamp,metric,value\n'+time+',heart,abc'),/row 2/);
});

test('Bluetooth heart-rate frames support 8- and 16-bit values and reject missing contact',()=>{
  const view = (...bytes)=>new DataView(Uint8Array.from(bytes).buffer);
  assert.equal(decodeHeartRate(view(0,80)),80);
  assert.equal(decodeHeartRate(view(1,4,1)),260);
  assert.equal(decodeHeartRate(view(4,80)),null);
  assert.equal(decodeHeartRate(view(1,4)),null);
});

test('emergency phrases have separate guidance while everyday stress goes to chat',()=>{
  assert.match(safety("I can't breathe"),/emergency services/);
  assert.match(safety('I want to hurt myself'),/emergency services/);
  assert.equal(safety('I feel stressed after work'),null);
});
