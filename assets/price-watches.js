/* Exact-category price watches. Runs only on published data, never live inventory. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.OrionWatches=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const MAX_AGE=6*3600000;
const validMoney=x=>Number.isSafeInteger(x)&&x>0&&x<1e12;
const stamp=x=>typeof x==='string'&&/(?:Z|[+-]\d\d:\d\d)$/.test(x)&&Number.isFinite(Date.parse(x))?Date.parse(x):NaN;
function amount(product,column){const row=(product?.fares||[]).find(x=>Array.isArray(x)&&x[0]===column);return validMoney(row?.[1])?row[1]:null;}
function create(product,options,observedAt,now=Date.now()){
 const column=String(options.column||''),price=amount(product,column),t=stamp(observedAt);
 if(!product?.id||!column||price===null)throw Error('Choose an available published price category.');
 if(!Number.isFinite(t)||t>now+60000||now-t>MAX_AGE)throw Error('The published price is too old or undated to start a watch.');
 const target=options.targetPence===null||options.targetPence===undefined||options.targetPence===''?null:Number(options.targetPence);
 const percent=options.dropPercent===null||options.dropPercent===undefined||options.dropPercent===''?null:Number(options.dropPercent);
 if(target!==null&&!validMoney(target))throw Error('Enter a positive target price for two.');
 if(percent!==null&&(!Number.isFinite(percent)||percent<1||percent>95))throw Error('Choose a decrease between 1% and 95%.');
 if(target===null&&percent===null)throw Error('Choose a target price or a decrease threshold.');
 return {id:product.id+'::'+column,productId:product.id,column,itinerary:String(product.itinerary||''),ship:String(product.ship||''),departure:product.departure,targetPence:target,dropPercent:percent,baseline:price,lastPrice:price,lastSeenAt:observedAt,createdAt:new Date(now).toISOString(),lastAlertPrice:null,enabled:true};
}
function evaluate(watches,products,observedAt,existing=[],now=Date.now()){
 const t=stamp(observedAt),known=new Set(existing.map(x=>x.id)),map=new Map(products.map(x=>[x.id,x]));
 const events=[],states=[];const fresh=Number.isFinite(t)&&t<=now+60000&&now-t<=MAX_AGE;
 for(const original of watches){const w={...original};let state='unchanged';const p=map.get(w.productId);const price=amount(p,w.column);
  if(w.enabled!==true){states.push({id:w.id,state:'paused'});continue;}
  if(!fresh)state='stale_snapshot';
  else if(!p)state='voyage_missing';
  else if(p.departure<new Date(now).toISOString().slice(0,10))state='departed';
  else if(price===null)state='category_missing';
  else if(!validMoney(w.lastPrice)||!validMoney(w.baseline)||!Number.isFinite(stamp(w.lastSeenAt)))state='invalid_watch';
  else if(t<=stamp(w.lastSeenAt))state='already_checked';
  else{
   const reference=validMoney(w.lastAlertPrice)?w.lastAlertPrice:w.baseline;
   const decrease=100*(reference-price)/reference;
   const targetCrossed=validMoney(w.targetPence)&&w.lastPrice*2>w.targetPence&&price*2<=w.targetPence;
   const pctMet=Number.isFinite(w.dropPercent)&&w.dropPercent>=1&&w.dropPercent<=95&&decrease+1e-9>=w.dropPercent&&price<w.lastPrice;
   if(targetCrossed||pctMet){
    const reason=targetCrossed?'target_reached':'recorded_decrease';const id=[w.id,observedAt,price,reason].join('|');
    if(!known.has(id)){events.push({id,watchId:w.id,productId:w.productId,column:w.column,itinerary:w.itinerary,ship:w.ship,departure:w.departure,reason,previousPence:w.lastPrice*2,currentPence:price*2,percent:Math.round(100*(w.lastPrice-price)/w.lastPrice*100)/100,observedAt,detectedAt:new Date(now).toISOString(),classification:'unverified_published_change',viewedAt:null,browserNotice:'not_requested'});known.add(id)}
    w.lastAlertPrice=price;state='condition_met';
   }
   w.lastPrice=price;w.lastSeenAt=observedAt;
  }
  states.push({id:w.id,state});Object.assign(original,w);
 }
 return {watches,events,states,fresh,scope:'published_snapshot_only; page must be open; no background push'};
}
function displayState(event,now=Date.now()){return Number.isFinite(stamp(event.observedAt))&&now-stamp(event.observedAt)<=MAX_AGE&&stamp(event.observedAt)<=now+60000?'Recheck with seller':'Historical change; recheck price';}
return Object.freeze({create,evaluate,amount,displayState,MAX_AGE});
});
