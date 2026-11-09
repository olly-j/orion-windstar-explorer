/* ORION public catalogue contract. Pure functions shared by browser and Node tests. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ORIONCatalogue=api;})(globalThis,function(){
'use strict';
const LIMIT=6*60*60*1000;
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
function timestamp(x){
 if(typeof x!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(x)||!date(x.slice(0,10)))return null;
 if(Number(x.slice(11,13))>23||Number(x.slice(14,16))>59||Number(x.slice(17,19))>59)return null;
 return Number.isFinite(Date.parse(x))?Date.parse(x):null;
}
const date=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&Number.isFinite(Date.parse(x+'T12:00:00Z'))&&new Date(x+'T12:00:00Z').toISOString().slice(0,10)===x;
const dataPath=x=>typeof x==='string'&&/^data\/[a-z0-9-]+\.[a-f0-9]{14,64}\.json$/.test(x);
function age(value,now){const t=timestamp(value);return t===null||t>now?null:now-t;}
// Discovery groups connect route variants. They never identify a price series.
function discoveryKey(p){return JSON.stringify([p.ship,p.kind,p.discovery_family_id||p.family_id||p.id]);}
function relatedProducts(products,selected){const key=discoveryKey(selected);return products.filter(p=>discoveryKey(p)===key).sort((a,b)=>a.departure.localeCompare(b.departure)||a.duration-b.duration||a.id.localeCompare(b.id));}
function sameDateComparison(a,b){return !!a.family_id&&a.family_id===b.family_id&&['ship','kind','duration','from_port','to_port'].every(k=>a[k]===b[k]);}
function historyColumns(p){return [...new Set([...(p.fares||[]).map(cell=>cell[0]),...Object.keys(p.price_history||{})])];}
function isRetired(p,today){return ['past_departure','not_in_latest_feed'].includes(p.catalogue_status)||!!today&&p.departure<today;}
function decodeShipEnvelope(document){
 if(!object(document))return document;
 if(!Object.hasOwn(document,'history_encoding')){
  if(Object.hasOwn(document,'shared_values')||Object.hasOwn(document,'object_schemas'))throw Error('History table lacks its encoding contract');
  return document;
 }
 const version=document.history_encoding;
 if(!['shared_values_v1','shared_values_v2'].includes(version)||document.schema_version!==2||typeof document.ship!=='string'||!Array.isArray(document.shared_values)||document.shared_values.length>250000||!object(document.products))throw Error('Invalid shared history envelope');
 if(version==='shared_values_v1'&&Object.hasOwn(document,'object_schemas'))throw Error('Object schemas require the v2 encoding contract');
 const schemas=version==='shared_values_v2'?document.object_schemas:[];
 if(!Array.isArray(schemas)||schemas.length>10000)throw Error('Invalid history object schemas');
 let keyCount=0;const schemaSignatures=new Set();
 for(const keys of schemas){
  if(!Array.isArray(keys)||keys.length<1||keys.length>256||keys.some(key=>typeof key!=='string'||key==='$')||new Set(keys).size!==keys.length||(keyCount+=keys.length)>100000)throw Error('Invalid history object schema keys');
  const signature=JSON.stringify(keys);if(schemaSignatures.has(signature))throw Error('Duplicate history object schema');schemaSignatures.add(signature);
 }
 const decoded=[];let visits=0;
 function expand(value,depth,ceiling){
  if(++visits>2000000||depth>128)throw Error('Expanded history exceeds safe bounds');
  if(value===null||typeof value==='string'||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value))return value;
  if(Array.isArray(value))return value.map(item=>expand(item,depth+1,ceiling));
  if(!object(value))throw Error('Invalid shared history value');
  const keys=Object.keys(value);
  if(Object.hasOwn(value,'$')){
   const reference=value.$;
   if(keys.length!==1)throw Error('Invalid mixed history reference');
   if(version==='shared_values_v2'&&Array.isArray(reference)){
    const schemaIndex=reference[0];
    if(!Number.isSafeInteger(schemaIndex)||schemaIndex<0||schemaIndex>=schemas.length)throw Error('Invalid history object schema index');
    const fields=schemas[schemaIndex];
    if(reference.length!==fields.length+1)throw Error('Invalid history object schema arity');
    return Object.fromEntries(fields.map((key,index)=>[key,expand(reference[index+1],depth+1,ceiling)]));
   }
   if(!Number.isSafeInteger(reference)||reference<0||reference>=ceiling||reference>=decoded.length)throw Error('Invalid shared history reference');
   return expand(decoded[reference],depth+1,ceiling);
  }
  return Object.fromEntries(keys.map(key=>[key,expand(value[key],depth+1,ceiling)]));
 }
 for(let i=0;i<document.shared_values.length;i++)decoded.push(expand(document.shared_values[i],0,i));
 const products=expand(document.products,0,decoded.length);if(!object(products))throw Error('Invalid decoded ship products');
 const result={...document,products};delete result.history_encoding;delete result.shared_values;if(version==='shared_values_v2')delete result.object_schemas;return result;
}


/* Oversized ship files retain the shared-value contract inside a bounded, lossless gzip envelope. */
function parseShipJSON(text){
 // JSON.parse alone accepts duplicate object keys. Reject them before decoding immutable evidence.
 const stack=[];
 for(let i=0;i<text.length;i++){
  const char=text[i];
  if(char==='"'){
   const start=i;let closed=false;
   while(++i<text.length){if(text[i]==='\\'){i++;continue}if(text[i]==='"'){closed=true;break}}
   if(!closed)throw Error('Unterminated compressed history string');
   const frame=stack[stack.length-1];
   if(frame?.keys&&frame.key){const key=JSON.parse(text.slice(start,i+1));if(frame.keys.has(key))throw Error('Duplicate compressed history object key');frame.keys.add(key);frame.key=false;}
  }else if(char==='{')stack.push({keys:new Set(),key:true});
  else if(char==='[')stack.push({});
  else if(char==='}'||char===']')stack.pop();
  else if(char===','&&stack[stack.length-1]?.keys)stack[stack.length-1].key=true;
 }
 return JSON.parse(text);
}
async function readShipEnvelope(document){
 if(object(document)&&!Object.hasOwn(document,'history_encoding')&&['gzip_base64','uncompressed_bytes','uncompressed_sha256'].some(key=>Object.hasOwn(document,key)))throw Error('Compressed ship history lacks its encoding contract');
 if(!object(document)||document.history_encoding!=='gzip_shared_values_v3')return decodeShipEnvelope(document);
 const fields=['schema_version','ship','history_encoding','uncompressed_bytes','uncompressed_sha256','gzip_base64'];
 if(Object.keys(document).length!==fields.length||Object.keys(document).some(key=>!fields.includes(key))||document.schema_version!==2||typeof document.ship!=='string'||!Number.isSafeInteger(document.uncompressed_bytes)||document.uncompressed_bytes<1||document.uncompressed_bytes>64*1024*1024||typeof document.uncompressed_sha256!=='string'||!/^[a-f0-9]{64}$/.test(document.uncompressed_sha256)||typeof document.gzip_base64!=='string'||!document.gzip_base64.length||document.gzip_base64.length>8000000||document.gzip_base64.length%4!==0||new TextEncoder().encode(JSON.stringify(document)).length>8000000)throw Error('Invalid compressed ship history envelope');
 const binary=atob(document.gzip_base64);if(btoa(binary)!==document.gzip_base64)throw Error('Noncanonical ship history base64');
 const compressed=Uint8Array.from(binary,char=>char.charCodeAt(0));
 if(compressed.length<18||compressed[0]!==31||compressed[1]!==139||compressed[2]!==8||compressed[3]!==0||compressed.slice(4,8).some(x=>x!==0)||![0,2,4].includes(compressed[8]))throw Error('Invalid ship history gzip framing');
 if(typeof DecompressionStream!=='function'||!globalThis.crypto?.subtle)throw Error('This browser cannot open the complete ship history. Use a current browser.');
 // Native gzip rejects extra members/trailing bytes; the streamed bound also stops oversized output.
 const reader=new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip')).getReader(),chunks=[];let length=0;
 try{while(true){const part=await reader.read();if(part.done)break;length+=part.value.byteLength;if(length>document.uncompressed_bytes||length>64*1024*1024)throw Error('Ship history decompression exceeds declared bounds');chunks.push(part.value);}}
 catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
 if(length!==document.uncompressed_bytes)throw Error('Ship history decoded length differs');
 const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
 const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');
 if(digest!==document.uncompressed_sha256)throw Error('Ship history decoded checksum differs');
 const inner=parseShipJSON(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes));
 if(!object(inner)||inner.schema_version!==2||inner.ship!==document.ship||!['shared_values_v1','shared_values_v2'].includes(inner.history_encoding))throw Error('Compressed ship history identity or encoding differs');
 return decodeShipEnvelope(inner);
}

const UNMATCHED_SCOPE='Unassigned public seller observations; no inferred association to a supplier voyage.';
function checkUnmatchedLogical(value,encoded){
 const allowed=['schema_version','scope','observations','ships','seller_history_attribution'];
 if(!object(value)||Object.keys(value).some(key=>!allowed.includes(key))||value.schema_version!==1||value.scope!==UNMATCHED_SCOPE||!Number.isSafeInteger(value.observations)||value.observations<0||!object(value.ships)||(encoded||Object.hasOwn(value,'seller_history_attribution'))&&!object(value.seller_history_attribution))throw Error('Invalid unmatched history document');
 let count=0,visits=0;const pending=[[value,0]];
 while(pending.length){const [item,depth]=pending.pop();if(++visits>2000000||depth>128)throw Error('Unmatched history exceeds safe bounds');if(item===null||['string','boolean'].includes(typeof item)||typeof item==='number'&&Number.isFinite(item))continue;if(typeof item!=='object')throw Error('Invalid unmatched history value');for(const child of Object.values(item))pending.push([child,depth+1]);}
 for(const groups of Object.values(value.ships)){if(!object(groups))throw Error('Invalid unmatched ship history');for(const series of Object.values(groups)){if(!object(series)||!Array.isArray(series.points))throw Error('Invalid unmatched price series');count+=series.points.length;}}
 if(count!==value.observations)throw Error('Unmatched observation count differs');
 return value;
}
async function readUnmatchedEnvelope(document){
 if(!object(document))throw Error('Invalid unmatched history envelope');
 if(document.history_encoding===undefined){const data=checkUnmatchedLogical(document,false),text=JSON.stringify(data);if(new TextEncoder().encode(text).length>64*1024*1024)throw Error('Unmatched history exceeds safe bounds');return {data,text};}
 const fields=['schema_version','history_encoding','scope','observations','uncompressed_bytes','uncompressed_sha256','gzip_base64'];
 if(Object.keys(document).length!==fields.length||Object.keys(document).some(key=>!fields.includes(key))||document.schema_version!==1||document.history_encoding!=='gzip_json_v1'||document.scope!==UNMATCHED_SCOPE||!Number.isSafeInteger(document.observations)||document.observations<0||!Number.isSafeInteger(document.uncompressed_bytes)||document.uncompressed_bytes<1||document.uncompressed_bytes>64*1024*1024||typeof document.uncompressed_sha256!=='string'||!/^[a-f0-9]{64}$/.test(document.uncompressed_sha256)||typeof document.gzip_base64!=='string'||document.gzip_base64.length>8000000||!document.gzip_base64.length||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(document.gzip_base64)||new TextEncoder().encode(JSON.stringify(document)).length>8000000)throw Error('Invalid compressed unmatched history envelope');
 const binary=atob(document.gzip_base64);if(btoa(binary)!==document.gzip_base64)throw Error('Noncanonical unmatched base64');
 const compressed=Uint8Array.from(binary,char=>char.charCodeAt(0));
 if(compressed.length<18||compressed[0]!==31||compressed[1]!==139||compressed[2]!==8||compressed[3]!==0||compressed.slice(4,8).some(x=>x!==0)||![0,2,4].includes(compressed[8]))throw Error('Invalid unmatched gzip framing');
 if(typeof DecompressionStream!=='function'||!globalThis.crypto?.subtle)throw Error('This browser cannot open the complete history download. Use a current browser.');
 const reader=new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip')).getReader(),chunks=[];let length=0;
 try{while(true){const part=await reader.read();if(part.done)break;length+=part.value.byteLength;if(length>document.uncompressed_bytes||length>64*1024*1024)throw Error('Unmatched decompression exceeds declared bounds');chunks.push(part.value);}}
 catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
 if(length!==document.uncompressed_bytes)throw Error('Unmatched decoded length differs');
 const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
 const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');
 if(digest!==document.uncompressed_sha256)throw Error('Unmatched decoded checksum differs');
 const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes),data=checkUnmatchedLogical(JSON.parse(text),true);
 if(data.scope!==document.scope||data.observations!==document.observations)throw Error('Unmatched envelope metadata differs');
 return {data,text};
}
async function decodeUnmatchedEnvelope(document){return (await readUnmatchedEnvelope(document)).data;}
async function unmatchedHistoryDownload(document){return (await readUnmatchedEnvelope(document)).text;}

function sellerPointAttribution(product,pointId){
 const map=product?.seller_history_attribution,entry=object(map?.observations)?map.observations[pointId]:null;
 const fallback={state:'unverified',reason:typeof map?.default_reason==='string'?map.default_reason:'Source attribution has not been validated',replacement_ids:[]};
 if(!object(map)||map.schema_version!==1||map.default_state!=='unverified'||!object(entry))return fallback;
 if(entry.state==='withdrawn')return {state:'withdrawn',reason:typeof entry.reason==='string'?entry.reason:'Source attribution was withdrawn',replacement_ids:Array.isArray(entry.replacement_ids)?entry.replacement_ids.filter(x=>typeof x==='string'&&/^[a-f0-9]{16}$/.test(x)):[]};
 const proof=typeof entry.proof_id==='string'&&/^[a-f0-9]{16}$/.test(entry.proof_id)&&object(map.proofs)?map.proofs[entry.proof_id]:null;
 if(entry.state==='validated'&&object(proof)&&['bounded_catalogue_card','wexas_primary_category','pure_card_primary_price','reviewed_publisher_page','iglu_primary_category'].includes(proof.method)&&/^[a-f0-9]{64}$/.test(proof.evidence_sha256||''))return {state:'validated',reason:'Exact source attribution checked',proof_id:entry.proof_id,replacement_ids:[]};
 return {...fallback,reason:typeof entry.reason==='string'?entry.reason:fallback.reason};
}
function validateAgentOffers(product){
 if(product.agent_offers===undefined)return;
 if(!Array.isArray(product.agent_offers))throw Error('Invalid agent offers');
 const ids=new Set(),url=value=>{try{const u=new URL(value);return typeof value==='string'&&u.protocol==='https:'&&!u.username&&!u.password&&!u.search&&!u.hash}catch{return false}},hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
 for(const a of product.agent_offers){
  if(!object(a)||!hash(a.id)||ids.has(a.id)||typeof a.provider!=='string'||!a.provider||typeof a.provider_group!=='string'||!a.provider_group||!url(a.url)||!url(a.evidence_url)||timestamp(a.observed_at)===null||typeof a.cabin!=='string'||typeof a.basis!=='string'||a.currency!=='GBP'||a.unit!=='per_person_advertised'||!Number.isSafeInteger(a.amount_pence)||a.amount_pence<=0||(a.pair_total_pence!=null&&(!Number.isSafeInteger(a.pair_total_pence)||a.pair_total_pence<=0))||a.availability_verified!==false||a.costs_verified!==false||!object(a.attribution)||a.attribution.state!=='validated'||!['bounded_catalogue_card','wexas_primary_category','pure_card_primary_price','reviewed_publisher_page','iglu_primary_category'].includes(a.attribution.method)||!hash(a.attribution.evidence_sha256)||(!hash(a.attribution.observation_id)||a.attribution.observation_id!==a.id))throw Error('Agent guide lacks validated primary source attribution');
  ids.add(a.id);
 }
 if(isRetired(product)&&product.agent_offers.length)throw Error('Retained voyage cannot publish an active agent guide');
}
function reviewedTCLCardSource(p){
 try{
  const e=p.supplemental_source_evidence,a=p.advertised_price;
  if(p.source_kind!=='supplemental_advertisement'||!object(e)||e.identity_basis!=='retained_supplier_and_exact_card'||e.provider!=='The Cruise Line'||e.method!=='bounded_catalogue_card'||typeof p.cruise_id!=='string'||!p.cruise_id||typeof p.voyage_id!=='string'||!/^\d+$/.test(p.voyage_id)||p.id!==[p.cruise_id,p.voyage_id,p.departure,p.duration].join('|')||e.retained_product_id!==p.id||e.voyage_id!==p.voyage_id||e.ship!==p.ship||e.departure!==p.departure||e.published_nights!==p.duration||!date(p.departure)||!Number.isSafeInteger(p.duration)||p.duration<1||timestamp(e.observed_at)===null||e.observed_at!==p.supplemental_observed_at||typeof e.body_sha256!=='string'||!/^[a-f0-9]{64}$/.test(e.body_sha256)||typeof e.observation_id!=='string'||!/^[a-f0-9]{64}$/.test(e.observation_id)||typeof e.url!=='string'||typeof e.evidence_url!=='string')return false;
  const url=new URL(e.url),capture=new URL(e.evidence_url),safe=u=>u.protocol==='https:'&&u.hostname==='www.cruiseline.co.uk'&&!u.username&&!u.password&&!u.search&&!u.hash&&(!u.port||u.port==='443');
  if(!safe(url)||!safe(capture))return false;
  const slug=p.ship.toLowerCase().replace(/ /g,'-'),encodedDate=p.departure.slice(8,10)+p.departure.slice(5,7)+p.departure.slice(2,4),parts=url.pathname.replace(/\/$/,'').split('/');
  if(parts.length!==6||parts[1]!=='cruise-lines'||parts[2]!=='windstar-cruises'||parts[3]!==slug||!/^[a-z0-9-]+$/.test(parts[4])||parts[5]!==encodedDate+'-'+p.duration+'-nights'||!/^\/cruise-lines\/windstar-cruises\/(?:20\d{2}\/)?(?:page\/[1-9]\d*\/)?$/.test(capture.pathname))return false;
  if(p.kind==='Tour or special bundle'&&(p.end_date!==null||p.end_date_basis!=='unverified_package_dates'))return false;
  validateAgentOffers(p);
  // Retain checked source evidence after a current or retired guide loses its active price.
  if(a==null)return !(p.agent_offers||[]).length;
  const linked=(p.agent_offers||[]).filter(o=>o.id===e.observation_id);
  if(linked.length!==1)return false;
  const offer=linked[0];
  return a.provider===e.provider&&a.provider_group===offer.provider_group&&offer.provider_group==='windstar-uk-tcl'&&a.url===e.url&&a.observed_at===e.observed_at&&a.amount_pence===offer.amount_pence&&a.cabin===offer.cabin&&a.currency==='GBP'&&a.unit==='per_person_advertised'&&a.availability_verified===false&&a.costs_verified===false&&offer.provider===e.provider&&offer.url===e.url&&offer.evidence_url===e.evidence_url&&offer.observed_at===e.observed_at&&offer.basis==='visible_catalogue_card'&&offer.attribution.observation_id===e.observation_id&&offer.attribution.method===e.method&&offer.attribution.evidence_sha256===e.body_sha256;
 }catch{return false;}
}
function validateSupplementalDetail(p){
 const e=p.supplemental_source_evidence;
 if(p.source_kind!=='supplemental_advertisement'||e?.identity_basis!=='retained_supplier_and_exact_card')return p;
 if(!reviewedTCLCardSource(p))throw Error('Invalid retained supplier advertisement identity');
 const a=p.advertised_price,id=e.observation_id.slice(0,16),map=p.seller_history_attribution,entry=map?.observations?.[id],proof=map?.proofs?.[entry?.proof_id],matches=[];
 if(!object(p.seller_history)||!object(map)||map.schema_version!==1||map.default_state!=='unverified'||entry?.state!=='validated'||typeof entry.proof_id!=='string'||!/^[a-f0-9]{16}$/.test(entry.proof_id)||proof?.method!==e.method||proof?.evidence_sha256!==e.body_sha256)throw Error('Retained advertisement history proof is missing');
 for(const series of Object.values(p.seller_history)){
  if(!object(series)||!Array.isArray(series.points))throw Error('Invalid retained advertisement history series');
  for(const point of series.points){
   if(!Array.isArray(point))throw Error('Invalid retained advertisement history point');
   if(point[2]===id)matches.push({series,point});
  }
 }
 if(matches.length!==1)throw Error('Retained advertisement history link is not unique');
 const {series,point}=matches[0],identity=series.identity;
 if(point[0]!==e.observed_at||!Number.isSafeInteger(point[1])||point[1]<=0||a&&point[1]!==a.amount_pence||series.provider!==e.provider||series.provider_group!=='windstar-uk-tcl'||series.url!==e.url||series.evidence_url!==e.evidence_url||series.basis!=='visible_catalogue_card'||series.currency!=='GBP'||series.unit!=='per_person_advertised'||series.availability_verified!==false||series.costs_verified!==false||!object(identity)||identity.voyage_id!==p.voyage_id||identity.ship!==p.ship||identity.departure!==p.departure||identity.duration!==p.duration||a&&series.cabin!==a.cabin||a&&(!Array.isArray(p.agent_offer_ids)||p.agent_offer_ids.filter(value=>value===e.observation_id).length!==1))throw Error('Retained advertisement and exact seller history disagree');
 return p;
}

function retiredProduct(p,today,observedAt=null){
 if(!isRetired(p,today))return p;
 // This is a display projection. Keep the source and observation history intact.
 return {...p,catalogue_status:today&&p.departure<today?'past_departure':p.catalogue_status,
  last_low_pence:Number.isSafeInteger(p.low_pence)&&p.low_pence>0?p.low_pence:(p.last_low_pence??null),
  last_observed_at:p.last_observed_at||p.feed_observed_at||observedAt||null,
  last_published_fares:(p.fares?.length?p.fares:p.last_published_fares||[]).map(cell=>cell.slice()),
  fares:[],low_pence:null,advertised_price:null,last_agent_offers:p.agent_offers?.length?p.agent_offers:p.last_agent_offers||[],agent_offers:[],changes:{},drop:null};
}
function partitionProducts(data,today){const current=[],retired=[];for(const p of [...data.products,...(data.retired_products||[])]){if(isRetired(p,today))retired.push(retiredProduct(p,today,data.feed?.observed_at));else current.push({...p});}return {current,retired};}
function freshness(data,now=Date.now()){
 const feed=object(data?.feed)?data.feed:{};
 const editionAge=age(data?.built_at,now),observedAge=age(feed.observed_at,now);
 const hasConfirmation=Object.prototype.hasOwnProperty.call(feed,'last_confirmed_at');
 const checkedAge=hasConfirmation?age(feed.last_confirmed_at,now):null;
 const attemptAge=age(feed.last_attempt_at,now);
 const chronology=checkedAge!==null&&observedAge!==null&&attemptAge!==null&&attemptAge<=checkedAge&&timestamp(feed.last_confirmed_at)>=timestamp(feed.observed_at);
 const sourceSucceeded=['success','not_modified'].includes(feed.last_attempt_status);
 const confirmed=chronology&&sourceSucceeded;
 return {editionAge,observedAge,checkedAge,confirmed,
  editionFresh:editionAge!==null&&editionAge<=LIMIT,
  feedFresh:confirmed&&checkedAge<=LIMIT,
  legacyFallback:!hasConfirmation&&observedAge!==null,
  confirmationAt:confirmed?feed.last_confirmed_at:null,
  unchangedBytes:feed.last_attempt_status==='not_modified'};
}
function validate(data){
 if(!object(data)||data.schema_version!==2||!Array.isArray(data.products)||data.products.length<100||!object(data.feed)||!object(data.detail_files))throw Error('Unexpected catalogue format');
 if(!Array.isArray(data.offers)||!object(data.families)||!object(data.archive))throw Error('Invalid catalogue supporting evidence');
 for(const offer of data.offers){if(!object(offer)||!Array.isArray(offer.sources)||offer.sources.some(x=>!object(x)||typeof x.url!=='string'))throw Error('Invalid offer evidence');}
 if(data.retired_products!==undefined&&!Array.isArray(data.retired_products))throw Error('Invalid retained voyage archive');
 const retiredIds=new Set((data.retired_products||[]).map(p=>p?.id));
 const ids=new Set();
 for(const p of [...data.products,...(data.retired_products||[])]){
  if(!object(p)||typeof p.id!=='string'||!p.id||ids.has(p.id)||typeof p.ship!=='string'||!p.ship||!date(p.departure)||!Array.isArray(p.fares))throw Error('Invalid or duplicated voyage');
  for(const key of ['itinerary','region','from_port','to_port','cruise_id','voyage_id','kind','family_id'])if(typeof p[key]!=='string')throw Error('Invalid voyage description');
  for(const key of ['discovery_family_id','discovery_family_name'])if(p[key]!==undefined&&(typeof p[key]!=='string'||!p[key]))throw Error('Invalid discovery family');
  if(p.history_count!==undefined&&(!Number.isSafeInteger(p.history_count)||p.history_count<0))throw Error('Invalid history count');
  if(retiredIds.has(p.id)&&(!isRetired(p)||p.fares.length||p.low_pence!==null))throw Error('Retained voyage cannot publish a current fare');
  if(!Number.isSafeInteger(p.duration)||p.duration<1||!object(p.changes)||!Number.isSafeInteger(p.archive_count)||p.archive_count<0)throw Error('Invalid voyage dimensions');
  validateAgentOffers(p);
  ids.add(p.id);
  if(!dataPath(data.detail_files[p.ship]))throw Error('Missing or invalid ship evidence file');
  const columns=new Set();
  for(const cell of p.fares){if(!Array.isArray(cell)||cell.length!==2||typeof cell[0]!=='string'||!cell[0]||columns.has(cell[0])||!Number.isSafeInteger(cell[1])||cell[1]<=0)throw Error('Invalid or conflicting fare category');columns.add(cell[0]);}
  const low=p.fares.length?Math.min(...p.fares.map(x=>x[1])):null;
  if(p.low_pence!==low)throw Error('Price summary does not match published categories');
  if(p.source_kind==='supplemental_advertisement'){
   if(p.kind==='Tour or special bundle'&&(p.end_date!==null||p.end_date_basis!=='unverified_package_dates'))throw Error('Unverified full package end date');
   const e=p.supplemental_source_evidence,a=p.advertised_price;
   const publisher=object(e)&&['encoded_url_identity','publisher_id_and_departure','reviewed_page_body'].includes(e.identity_basis)&&/^https:\/\/www\.windstarcruises\.co\.uk\/itineraries\/[a-z0-9-]+-wind[0-9]+\/?$/.test(e.url)&&e.url.replace(/\/$/,'').endsWith('-wind'+p.voyage_id);
   if(p.fares.length||p.low_pence!==null||p.drop||Object.keys(p.changes).length||!object(e)||e.voyage_id!==p.voyage_id||e.ship!==p.ship||e.departure!==p.departure||e.published_nights!==p.duration||(!publisher&&!reviewedTCLCardSource(p))||typeof e.body_sha256!=='string'||!/^([a-f0-9]{64})$/.test(e.body_sha256)||timestamp(e.observed_at)===null||e.observed_at!==p.supplemental_observed_at)throw Error('Invalid reviewed supplemental identity');
   if(a!=null&&(!object(a)||!Number.isSafeInteger(a.amount_pence)||a.amount_pence<=0||a.currency!=='GBP'||a.unit!=='per_person_advertised'||a.url!==e.url||a.observed_at!==e.observed_at||a.availability_verified!==false||a.costs_verified!==false||retiredIds.has(p.id)))throw Error('Invalid supplemental advertised price');
  }else if(p.advertised_price!=null)throw Error('Advertised guide lacks reviewed supplemental source');
 }
 return data;
}
function matchesManifest(data,manifest){return !manifest||(data.release===manifest.release&&data.built_at===manifest.built_at&&dataPath(manifest.data_file));}
return Object.freeze({timestamp,date,dataPath,freshness,validate,matchesManifest,discoveryKey,relatedProducts,sameDateComparison,historyColumns,isRetired,retiredProduct,partitionProducts,decodeShipEnvelope,readShipEnvelope,decodeUnmatchedEnvelope,unmatchedHistoryDownload,reviewedTCLCardSource,validateSupplementalDetail,sellerPointAttribution,validateAgentOffers,LIMIT});
});

