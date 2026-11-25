// Separater serverseitiger Proxy für die Einbettung, nicht Teil der statischen Vorschau.
// Bestehende DaSo-Anmeldung/Berechtigung durch authorizeRequest anbinden; bis dahin gesperrt.
export default{async fetch(request,env){
 const url=new URL(request.url);if(!['/source/sub-teams','/source/catalog'].includes(url.pathname))return new Response('Not found',{status:404});if(request.method!=='GET')return new Response('Method not allowed',{status:405});
 if(typeof env.authorizeRequest!=='function'||!(await env.authorizeRequest(request)))return new Response('Unauthorized',{status:401});
 const month=url.searchParams.get('month');if(url.pathname==='/source/sub-teams'&&!/^\d{4}-(0[1-9]|1[0-2])$/.test(month||''))return Response.json({error:'month=YYYY-MM erforderlich'},{status:400});if(!env.DATA_API_TOKEN)return Response.json({error:'Datenzugang fehlt'},{status:503});
 const upstream=await fetch('https://daso-data-api.dasoluft.workers.dev'+(url.pathname==='/source/catalog'?'/api/catalog':'/api/sub-teams?month='+month),{headers:{Authorization:`Bearer ${env.DATA_API_TOKEN}`},signal:AbortSignal.timeout(15000)}).catch(()=>null);
 if(!upstream?.ok)return Response.json({error:'Aufmaßdaten nicht verfügbar'},{status:502});return new Response(await upstream.text(),{headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
}};
