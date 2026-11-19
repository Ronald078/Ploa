// Display state only. Recovery permissions always come from the server session.
export function initialAccessView(href){
 const params=new URL(href).searchParams;
 if(params.get('notice')==='recovery')return 'reset';
 if(params.get('notice')==='recovery_failed'||params.get('desktop_recover')==='1')return 'recover';
 return 'login';
}
