/* Exact-category price watches. Runs only on published data, never live inventory. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.OrionWatches=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const MAX_AGE=6*3600000;
const validMoney=x=>Number.isSafeInteger(x)&&x>0&&x<1e12;
const stamp=x=>typeof x==='string'&&/(?:Z|[+-]\d\d:\d\d)$/.test(x)&&Number.isFinite(Date.parse(x))?Date.parse(x):NaN;
function amount(product,column){const row=(product?.fares||[]).find(x=>Array.isArray(x)&&x[0]===column);return validMoney(row?.[1])?row[1]:null;}
function freshEvidence(observedAt,confirmedAt,now){const t=stamp(observedAt),c=stamp(confirmedAt);return Number.isFinite(t)&&Number.isFinite(c)&&t<=c&&c<=now+60000&&now-c<=MAX_AGE;}
function create(product,options,observedAt,now=Date.now(),confirmedAt=observedAt){
 const column=String(options.column||''),price=amount(product,column),t=stamp(observedAt);
 if(!product?.id||!column||price===null)throw Error('Choose an available published price category.');
 if(!freshEvidence(observedAt,confirmedAt,now))throw Error('A recent confirmed price check is needed to start a watch.');
 const target=options.targetPence===null||options.targetPence===undefined||options.targetPence===''?null:Number(options.targetPence);
 const percent=options.dropPercent===null||options.dropPercent===undefined||options.dropPercent===''?null:Number(options.dropPercent);
 if(target!==null&&!validMoney(target))throw Error('Enter a positive target price for two.');
 if(percent!==null&&(!Number.isFinite(percent)||percent<1||percent>95))throw Error('Choose a decrease between 1% and 95%.');
 if(target===null&&percent===null)throw Error('Choose a target price or a decrease threshold.');
 return {id:product.id+'::'+column,productId:product.id,column,itinerary:String(product.itinerary||''),ship:String(product.ship||''),departure:product.departure,targetPence:target,dropPercent:percent,baseline:price,lastPrice:price,lastSeenAt:observedAt,lastConfirmedAt:confirmedAt,createdAt:new Date(now).toISOString(),lastAlertPrice:null,enabled:true};
}
function evaluate(watches,products,observedAt,existing=[],now=Date.now(),confirmedAt=observedAt){
 const t=stamp(observedAt),known=new Set(existing.map(x=>x.id)),map=new Map(products.map(x=>[x.id,x]));
 const events=[],states=[];const fresh=freshEvidence(observedAt,confirmedAt,now);
 for(const original of watches){const w={...original};let state='unchanged';const p=map.get(w.productId);const price=amount(p,w.column);
  if(w.enabled!==true){states.push({id:w.id,state:'paused'});continue;}
  if(!fresh)state='stale_snapshot';
  else if(!p)state='voyage_missing';
  else if(p.departure<new Date(now).toISOString().slice(0,10))state='departed';
  else if(price===null)state='category_missing';
  else if(!validMoney(w.lastPrice)||!validMoney(w.baseline)||!Number.isFinite(stamp(w.lastSeenAt)))state='invalid_watch';
  else if(t<stamp(w.lastSeenAt))state='older_snapshot';
  else if(t===stamp(w.lastSeenAt)){state=price===w.lastPrice?'already_checked':'price_timestamp_conflict';if(price===w.lastPrice)w.lastConfirmedAt=confirmedAt;}
  else{
   const reference=validMoney(w.lastAlertPrice)?w.lastAlertPrice:w.baseline;
   const decrease=100*(reference-price)/reference;
   const targetCrossed=validMoney(w.targetPence)&&w.lastPrice*2>w.targetPence&&price*2<=w.targetPence;
   const pctMet=Number.isFinite(w.dropPercent)&&w.dropPercent>=1&&w.dropPercent<=95&&decrease+1e-9>=w.dropPercent&&price<w.lastPrice;
   if(targetCrossed||pctMet){
    const reason=targetCrossed?'target_reached':'recorded_decrease';const id=[w.id,observedAt,price,reason].join('|');
    if(!known.has(id)){events.push({id,watchId:w.id,productId:w.productId,column:w.column,itinerary:w.itinerary,ship:w.ship,departure:w.departure,reason,previousPence:w.lastPrice*2,currentPence:price*2,percent:Math.round(100*(w.lastPrice-price)/w.lastPrice*100)/100,observedAt,confirmedAt,detectedAt:new Date(now).toISOString(),classification:'unverified_published_change',viewedAt:null,browserNotice:'not_requested'});known.add(id)}
    w.lastAlertPrice=price;state='condition_met';
   }
   w.lastPrice=price;w.lastSeenAt=observedAt;w.lastConfirmedAt=confirmedAt;
  }
  states.push({id:w.id,state});Object.assign(original,w);
 }
 return {watches,events,states,fresh,scope:'published_snapshot_only; page must be open; no background push'};
}
function displayState(event,now=Date.now()){return freshEvidence(event.observedAt,event.confirmedAt===undefined?event.observedAt:event.confirmedAt,now)?'Recheck with seller':'Historical change; recheck price';}
return Object.freeze({create,evaluate,amount,displayState,MAX_AGE});
});
