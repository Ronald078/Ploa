'use strict';
// Workers does not support redirect:'error'. Preserve its security semantics:
// make one request in manual mode and reject every redirect without forwarding
// the authorization header or body to a second destination.
function createNoRedirectFetch(fetcher=fetch){
 return async(input,options={})=>{
  const response=await fetcher(input,{...options,redirect:'manual'});
  if(response.status>=300&&response.status<400){try{await response.body?.cancel();}catch{}throw new TypeError('Unexpected upstream redirect.');}
  return response;
 };
}
module.exports={createNoRedirectFetch};
