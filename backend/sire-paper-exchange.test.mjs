import test from 'node:test';
import assert from 'node:assert/strict';
import {
  paperReset, paperPlaceOrder, paperGetOrder, paperCancelOrder, paperModifyOrder,
  paperPlaceTrigger, paperCancelTrigger, paperModifyTrigger,
  paperListOrders, paperListTriggers, paperEvaluateTriggers, paperEvaluateOrders, paperPositions, paperSetLeverage, paperAccount, paperCreateSchedule, paperListSchedules, paperControlSchedule, paperRunScheduleBatch
} from './sire-paper-exchange.mjs';

test('paper Spot market buy fills virtually using quote-quantity semantics', () => {
  paperReset();
  const r=paperPlaceOrder({category:'SPOT',symbol:'BTCUSDT',side:'buy',orderType:'market',qty:'100',clientOid:'spot-buy-1'},{ask:50000,bid:49999});
  assert.equal(r.mode,'PAPER');
  assert.equal(r.order.status,'filled');
  assert.equal(r.order.filledQty,0.002);
  assert.equal(r.order.fills.length,1);
  assert.equal(paperListOrders('SPOT','BTCUSDT',true).orders.length,1);
});

test('clientOid makes paper order placement idempotent', () => {
  paperReset();
  const input={category:'USDT-FUTURES',symbol:'BTCUSDT',side:'buy',orderType:'market',qty:'1',clientOid:'fut-idempotent-1',posSide:'long'};
  const first=paperPlaceOrder(input,{ask:50000,bid:49999});
  const second=paperPlaceOrder(input,{ask:50000,bid:49999});
  assert.equal(first.order.orderId,second.order.orderId);
  assert.equal(second.duplicate,true);
  assert.equal(paperPositions('USDT-FUTURES','BTCUSDT').positions.length,1);
});

test('limit order can be amended and cancelled; terminal order cannot be amended', () => {
  paperReset();
  const placed=paperPlaceOrder({category:'SPOT',symbol:'ETHUSDT',side:'buy',orderType:'limit',qty:'0.5',price:'1000',clientOid:'limit-lifecycle-1'},{ask:2000,bid:1999});
  assert.equal(placed.order.status,'new');
  assert.equal(paperGetOrder({clientOid:'limit-lifecycle-1'}).order.orderId,placed.order.orderId);
  const amended=paperModifyOrder({orderId:placed.order.orderId,price:'900',qty:'0.75'});
  assert.equal(amended.order.price,900);
  assert.equal(amended.order.qty,0.75);
  const cancelled=paperCancelOrder({orderId:placed.order.orderId});
  assert.equal(cancelled.order.status,'cancelled');
  assert.throws(()=>paperModifyOrder({orderId:placed.order.orderId,price:'800'}),/terminal/);
  assert.equal(paperListOrders('SPOT','ETHUSDT',false).orders.length,0);
  assert.equal(paperListOrders('SPOT','ETHUSDT',true).orders.length,1);
});

test('partial limit fills reconcile correctly before cancellation', async () => {
  paperReset();
  const placed=paperPlaceOrder({category:'SPOT',symbol:'ETHUSDT',side:'buy',orderType:'limit',qty:'1',price:'100',clientOid:'partial-limit-1'},{ask:101,bid:99});
  assert.equal(placed.order.status,'new');
  const result=await paperEvaluateOrders(async()=>({asks:[{price:99,quantity:0.25}],bids:[{price:98,quantity:10}]}));
  assert.equal(result.processed,1);
  const partial=paperGetOrder({orderId:placed.order.orderId}).order;
  assert.equal(partial.status,'partially_filled');
  assert.equal(partial.filledQty,0.25);
  assert.equal(partial.remaining,0.75);
  const cancelled=paperCancelOrder({orderId:placed.order.orderId}).order;
  assert.equal(cancelled.status,'cancelled');
  assert.equal(cancelled.filledQty,0.25);
  assert.equal(cancelled.remaining,0.75);
});

test('trigger order can be amended and cancelled without any exchange request', () => {
  paperReset();
  const placed=paperPlaceTrigger({category:'USDT-FUTURES',symbol:'BTCUSDT',side:'sell',qty:'1',triggerPrice:'45000',clientOid:'trigger-1',planType:'normal_plan'});
  assert.equal(placed.order.status,'live');
  const amended=paperModifyTrigger({orderId:placed.order.orderId,triggerPrice:'44000'});
  assert.equal(amended.order.triggerPrice,44000);
  assert.equal(paperListTriggers('USDT-FUTURES','BTCUSDT').orders.length,1);
  const cancelled=paperCancelTrigger({orderId:placed.order.orderId});
  assert.equal(cancelled.order.status,'cancelled');
  assert.equal(paperListTriggers('USDT-FUTURES','BTCUSDT').orders.length,0);
});

test('paper trigger activates into a child order when its trigger price is reached', async () => {
  paperReset();
  const trigger=paperPlaceTrigger({category:'SPOT',symbol:'BTCUSDT',side:'buy',qty:'100',triggerPrice:'50000',orderType:'market',clientOid:'spot-trigger-activate'});
  assert.equal(trigger.order.status,'live');
  const result=await paperEvaluateTriggers(async()=>({bids:[{price:50099}],asks:[{price:50100}]}));
  assert.equal(result.processed,1);
  const reconciled=paperGetOrder({orderId:trigger.order.orderId});
  assert.equal(reconciled.order.status,'triggered');
  assert.ok(reconciled.order.childOrderId);
  assert.equal(paperGetOrder({orderId:reconciled.order.childOrderId}).order.status,'filled');
});

test('futures open and reduce-only close update virtual positions', () => {
  paperReset();
  paperSetLeverage({category:'USDT-FUTURES',symbol:'BTCUSDT',leverage:'5'});
  const open=paperPlaceOrder({category:'USDT-FUTURES',symbol:'BTCUSDT',side:'buy',orderType:'market',qty:'2',posSide:'long',tradeSide:'open'},{ask:50000,bid:49999});
  assert.equal(open.order.status,'filled');
  assert.equal(paperPositions('USDT-FUTURES','BTCUSDT').positions[0].total,'2');
  const close=paperPlaceOrder({category:'USDT-FUTURES',symbol:'BTCUSDT',side:'sell',orderType:'market',qty:'0.5',posSide:'long',tradeSide:'close',reduceOnly:'yes'},{ask:50001,bid:50000});
  assert.equal(close.order.status,'filled');
  assert.equal(paperPositions('USDT-FUTURES','BTCUSDT').positions[0].total,'1.5');
});

test('paper Futures attached take-profit closes the virtual position when reached', async () => {
  paperReset();
  const opened=paperPlaceOrder({category:'USDT-FUTURES',symbol:'BTCUSDT',side:'buy',orderType:'market',qty:'1',clientOid:'tpsl-open-1',posSide:'long',tradeSide:'open',takeProfit:'51000',stopLoss:'49000'},{ask:50000,bid:49999});
  assert.equal(opened.order.status,'filled');
  assert.equal(paperPositions('USDT-FUTURES','BTCUSDT').positions[0].takeProfit,51000);
  const result=await paperEvaluateTriggers(async()=>({bids:[{price:51000}],asks:[{price:51002}]}));
  assert.equal(result.processed,1);
  assert.equal(paperPositions('USDT-FUTURES','BTCUSDT').positions.length,0);
  assert.equal(paperListOrders('USDT-FUTURES','BTCUSDT',true).orders.length,2);
});

test('invalid order inputs are rejected before any order is created', () => {
  paperReset();
  assert.throws(()=>paperPlaceOrder({category:'SPOT',symbol:'BTCUSDT',side:'buy',orderType:'market',qty:'0'} ,{ask:1,bid:1}),/greater than zero/);
  assert.throws(()=>paperPlaceOrder({category:'SPOT',symbol:'BTCUSDT',side:'hold',orderType:'market',qty:'1'},{ask:1,bid:1}),/Side/);
  assert.equal(paperAccount().mode,'PAPER');
});

test('paper TWAP/Split scheduler submits virtual slices and supports pause/resume/cancel', async () => {
  paperReset();
  const created=paperCreateSchedule({kind:'split',category:'USDT-FUTURES',symbol:'BTCUSDT',side:'buy',orderType:'market',totalQty:'2',perOrderQty:'1',sliceCount:2,intervalSeconds:5,posSide:'long',requestId:'split-idempotent'});
  assert.equal(created.mode,'PAPER');
  assert.equal(created.job.state,'running');
  const duplicate=paperCreateSchedule({kind:'split',category:'USDT-FUTURES',symbol:'BTCUSDT',side:'buy',orderType:'market',totalQty:'2',perOrderQty:'1',sliceCount:2,intervalSeconds:5,posSide:'long',requestId:'split-idempotent'});
  assert.equal(duplicate.duplicate,true);
  assert.equal(duplicate.job.id,created.job.id);
  const batch=await paperRunScheduleBatch(async()=>({bids:[{price:49999}],asks:[{price:50000}]}));
  assert.equal(batch.processed,1);
  assert.equal(paperListSchedules().jobs[0].completedSlices,1);
  const paused=paperControlSchedule(created.job.id,'pause');
  assert.equal(paused.job.state,'paused');
  assert.equal(paperControlSchedule(created.job.id,'resume').job.state,'running');
  assert.equal(paperControlSchedule(created.job.id,'cancel').job.state,'cancelled');
});
