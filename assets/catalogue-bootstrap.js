/* Start one bounded catalogue request early. App validation remains authoritative.
   A shared promise avoids browser-specific duplicate fetch-preload downloads. */
(()=>{
 'use strict';
 const path=document.querySelector('meta[name="orion-catalogue"]')?.content;
 if(!/^data\/catalogue\.[a-f0-9]{14,64}\.json$/.test(path||''))return;
 const base=new URL('.',document.baseURI),url=new URL(path,base);
 if(url.origin!==location.origin||!url.pathname.startsWith(base.pathname))return;
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
 const promise=fetch(url,{signal:controller.signal}).then(response=>{
  if(!response.ok)throw Error('Catalogue HTTP '+response.status);
  return response.json();
 }).finally(()=>clearTimeout(timer));
 // An early rejection must wait for the app's real error/retry UI, not create an unhandled error.
 promise.catch(()=>{});
 window.ORIONInitialCatalogue={path,promise,claimed:false};
})();
