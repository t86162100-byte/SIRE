import test from 'node:test';
import assert from 'node:assert/strict';

const enabled=String(process.env.SIRE_RUN_BITGET_DEMO_INTEGRATION||'').toLowerCase()==='true'
  && String(process.env.SIRE_TRADING_MODE||'').toUpperCase()==='BITGET_DEMO'
  && Boolean(process.env.BITGET_API_KEY&&process.env.BITGET_API_SECRET&&process.env.BITGET_API_PASSPHRASE);

test('Bitget Demo Spot/Futures limit and Spot trigger lifecycle', {skip:!enabled}, async () => {
  const api=await import('./sire-provider-execution.ts');
  const book=await api.bitgetMarketOrderBook('SPOT','BTCUSDT',5);
  const reference=Number(book.bids?.[0]?.price||0);
  assert.ok(reference>0,'BTCUSDT demo test needs a public order book');

  const spotOid='SIRE_DEMO_SPOT_'+Date.now();
  let spotOrderId='';
  try {
    const placed=await api.bitgetOwnerPlaceOrder({category:'SPOT',symbol:'BTCUSDT',side:'buy',orderType:'limit',qty:'0.001',price:String(Number((reference*0.5).toFixed(2))),clientOid:spotOid,timeInForce:'gtc'});
    spotOrderId=String(placed.orderId||'');
    assert.ok(spotOrderId,'Spot limit order should return an order ID');
    const info=await api.bitgetOwnerOrderInfo(spotOrderId);
    assert.ok(info?.orderId||info?.clientOid,'Spot order status should be queryable');
    await api.bitgetOwnerModifyOrder({category:'SPOT',symbol:'BTCUSDT',orderId:spotOrderId,price:String(Number((reference*0.49).toFixed(2))),orderType:'limit'});
    await api.bitgetOwnerCancelOrder({category:'SPOT',orderId:spotOrderId});
    const final=await api.bitgetOwnerOrderInfo(spotOrderId);
    assert.match(String(final?.orderStatus||'').toLowerCase(),/cancel/,'Spot order should be cancelled after amendment');
  } finally {
    if(spotOrderId) await api.bitgetOwnerCancelOrder({category:'SPOT',orderId:spotOrderId}).catch(()=>{});
  }

  const triggerOid='SIRE_DEMO_TRIG_'+Date.now();
  let triggerOrderId='';
  try {
    const trigger=await api.bitgetOwnerPlaceTriggerOrder({category:'SPOT',symbol:'BTCUSDT',side:'buy',qty:'0.001',triggerPrice:String(Number((reference*2).toFixed(2))),orderType:'limit',price:String(Number((reference*0.5).toFixed(2))),clientOid:triggerOid,planType:'normal_plan'});
    triggerOrderId=String(trigger?.data?.orderId||'');
    assert.ok(triggerOrderId,'Spot trigger should return an order ID');
    const pending=await api.bitgetOwnerPendingTriggerOrders('SPOT','BTCUSDT','normal_plan');
    assert.ok(pending.orders.some(o=>String(o.orderId||'')===triggerOrderId||String(o.clientOid||'')===triggerOid),'Spot trigger should be visible in pending strategy orders');
    await api.bitgetOwnerCancelTriggerOrder({category:'SPOT',orderId:triggerOrderId,clientOid:triggerOid});
  } finally {
    if(triggerOrderId) await api.bitgetOwnerCancelTriggerOrder({category:'SPOT',orderId:triggerOrderId,clientOid:triggerOid}).catch(()=>{});
  }

  const futuresBook=await api.bitgetMarketOrderBook('USDT-FUTURES','BTCUSDT',5);
  const futuresReference=Number(futuresBook.bids?.[0]?.price||0);
  assert.ok(futuresReference>0,'BTCUSDT Futures demo test needs a public order book');
  const futuresOid='SIRE_DEMO_FUT_'+Date.now();
  let futuresOrderId='';
  try {
    const placed=await api.bitgetOwnerPlaceOrder({category:'USDT-FUTURES',symbol:'BTCUSDT',side:'buy',orderType:'limit',qty:'0.001',price:String(Number((futuresReference*0.5).toFixed(2))),clientOid:futuresOid,posSide:'long',marginMode:'crossed',tradeSide:'open',timeInForce:'gtc'});
    futuresOrderId=String(placed.orderId||'');
    assert.ok(futuresOrderId,'Futures limit order should return an order ID');
    const info=await api.bitgetOwnerOrderInfo(futuresOrderId);
    assert.ok(info?.orderId||info?.clientOid,'Futures order status should be queryable');
    await api.bitgetOwnerModifyOrder({category:'USDT-FUTURES',symbol:'BTCUSDT',orderId:futuresOrderId,price:String(Number((futuresReference*0.49).toFixed(2))),orderType:'limit'});
    await api.bitgetOwnerCancelOrder({category:'USDT-FUTURES',orderId:futuresOrderId});
    const final=await api.bitgetOwnerOrderInfo(futuresOrderId);
    assert.match(String(final?.orderStatus||'').toLowerCase(),/cancel/,'Futures order should be cancelled after amendment');
  } finally {
    if(futuresOrderId) await api.bitgetOwnerCancelOrder({category:'USDT-FUTURES',orderId:futuresOrderId}).catch(()=>{});
  }
});
