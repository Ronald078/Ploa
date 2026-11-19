import {useLayoutEffect} from 'react';

// Preserve the navigation motion explicitly requested for Ploa, including on
// Windows installations that disable OS animations. This is not scroll reveal.
export function usePageMotion(ref,key,ready=true){
 useLayoutEffect(()=>{
  const panel=ref.current;if(!ready||!panel?.animate)return;
  const transition=panel.animate([{opacity:.45,transform:'translateY(40px)'},{opacity:1,transform:'none'}],{duration:640,easing:'cubic-bezier(.22,.61,.36,1)'});
  transition.pause();const frame=requestAnimationFrame(()=>transition.play());
  return()=>{cancelAnimationFrame(frame);transition.cancel();};
 },[ref,key,ready]);
}
