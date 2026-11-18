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

test('weekly review counts distinct logged nights and uses latest per local day',async()=>{
  const {sleepReview} = await import('./engine.mjs');
  const entry = (day,value,hour='08')=>({day,value,time:day+'T'+hour+':00:00Z',source:'manual'});
  const review = sleepReview([
    entry('2026-11-19',6),entry('2026-11-19',8,'10'),entry('2026-11-18',7),
    entry('2026-11-13',6),entry('2026-11-12',5),entry('2026-11-11',6),entry('2026-11-10',7),
    entry('2026-11-05',19),entry('2026-11-20',20)
  ],[{date:'2026-11-19',energy:'low',note:'Late meeting'}],'2026-11-19');
  assert.equal(review.start,'2026-11-13');
  assert.equal(review.previousStart,'2026-11-06');
  assert.deepEqual(review.current.map(item=>item.value),[6,7,8]);
  assert.equal(review.average,7);
  assert.equal(review.previousAverage,6);
  assert.equal(review.difference,1);
  assert.equal(review.context[0].note,'Late meeting');
});

test('sparse sleep stays unestimated and invalid check-ins are rejected',async()=>{
  const {checkIn,sleepReview} = await import('./engine.mjs');
  const result = sleepReview([{day:'2026-11-19',value:8,time,source:'manual'}],[],'2026-11-19');
  assert.equal(result.current.length,1);
  assert.equal(result.average,null);
  assert.equal(result.difference,null);
  assert.throws(()=>checkIn('2026-02-30','steady',''));
  assert.throws(()=>checkIn('2026-11-19','unknown',''));
});
