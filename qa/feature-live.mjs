import fs from 'node:fs/promises';
const app = await fs.readFile(new URL('../app.js', import.meta.url), 'utf8');
const definitions = ['CATALOG_FIELDS','DISCOVER_QUERY'].map(name=>app.match(new RegExp('  var '+name+' = (.*);'))[0]).join('\n') + '\n' + app.match(/  function catalogQuery \(variables\) \{[\s\S]*?\n  \}/)[0];
const queries = Function(definitions+';return {catalog:catalogQuery,discover:DISCOVER_QUERY};')();
for(const [name,query,variables] of [
  ['season',queries.catalog,{page:1,type:'ANIME',season:'FALL',year:2026,genre:null,format:null,score:null,sort:['POPULARITY_DESC'],exclude:null}],
  ['genre fallback',queries.catalog,{page:1,type:'MANGA',season:null,year:null,genre:['Romance'],format:null,score:null,sort:['SCORE_DESC','POPULARITY_DESC'],exclude:[109302]}],
  ['recommendations',queries.discover,{ids:[5114],type:'ANIME'}]
]) {
  const response = await fetch('https://graphql.anilist.co',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({query:typeof query==='function'?query(variables):query,variables})});
  const payload = await response.json();
  console.log(JSON.stringify({name,status:response.status,errors:payload.errors,genres:payload.data?.GenreCollection?.length,count:payload.data?.Page?.media?.length,first:payload.data?.Page?.media?.[0]?.title},null,2));
  if(!response.ok||payload.errors)process.exitCode=1;
}
