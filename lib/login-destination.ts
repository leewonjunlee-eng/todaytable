/** Only return to known app pages, never an external URL or an auth/API endpoint. */
export function loginDestination(value:unknown,operator=false):string|undefined {
  if(typeof value!=='string'||!value.startsWith('/')||value.startsWith('//')||/[\\\u0000-\u001f\u007f]/.test(value))return;
  try {
    const url=new URL(value,'https://todaytable.invalid');
    if(url.origin!=='https://todaytable.invalid')return;
    const path=decodeURIComponent(url.pathname);
    if(/[\\\u0000-\u001f\u007f]/.test(path)||path.startsWith('//'))return;
    if(operator){if(!/^\/admin(?:\/|$)/.test(path)||path==='/admin/login')return;}
    else if(!['/','/apply','/applications','/tables','/chats','/history','/profile','/payments','/notifications','/support','/account','/restaurants','/guide','/privacy'].some(prefix=>path===prefix||(prefix!=='/'&&path.startsWith(prefix+'/'))))return;
    return url.pathname+url.search+url.hash;
  } catch{return;}
}
