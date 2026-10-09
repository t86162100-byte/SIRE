import test from 'node:test';
import assert from 'node:assert/strict';
import {
  paperReset, paperPlaceOrder, paperCancelOrder, paperModifyOrder,
  paperPlaceTrigger, paperCancelTrigger, paperModifyTrigger,
  paperListOrders, paperListTriggers, paperPositions, paperSetLeverage, paperAccount
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
  const amended=paperModifyOrder({orderId:placed.order.orderId,price:'900',qty:'0.75'});
  assert.equal(amended.order.price,900);
  assert.equal(amended.order.qty,0.75);
  const cancelled=paperCancelOrder({orderId:placed.order.orderId});
  assert.equal(cancelled.order.status,'cancelled');
  assert.throws(()=>paperModifyOrder({orderId:placed.order.orderId,price:'800'}),/terminal/);
  assert.equal(paperListOrders('SPOT','ETHUSDT',false).orders.length,0);
  assert.equal(paperListOrders('SPOT','ETHUSDT',true).orders.length,1);
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

test('invalid order inputs are rejected before any order is created', () => {
  paperReset();
  assert.throws(()=>paperPlaceOrder({category:'SPOT',symbol:'BTCUSDT',side:'buy',orderType:'market',qty:'0'} ,{ask:1,bid:1}),/greater than zero/);
  assert.throws(()=>paperPlaceOrder({category:'SPOT',symbol:'BTCUSDT',side:'hold',orderType:'market',qty:'1'},{ask:1,bid:1}),/Side/);
  assert.equal(paperAccount().mode,'PAPER');
});
