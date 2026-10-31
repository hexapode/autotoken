import {posix} from 'node:path';

// Suggest names only. Never rewrite or execute a failed command: it may contain
// other actions, intentional absent-file checks, or shell state we cannot infer.
export function suggestPaths(missing, trackedFiles, limit=5) {
 if(typeof missing!=='string'||missing.length>300||missing.startsWith('/')||missing.split('/').includes('..')||/[\s*?{}\[\]$`<>\\]/.test(missing))return {status:'unsupported',paths:[]};
 if(!Array.isArray(trackedFiles)||trackedFiles.length>50000)return {status:'index_limit',paths:[]};
 const names=new Set();
 for(const file of trackedFiles){
  if(typeof file!=='string'||file.startsWith('/')||file.split('/').some(x=>x==='..'||x.startsWith('.')))continue;
  names.add(file);
  let dir=posix.dirname(file);while(dir!=='.'){names.add(dir);dir=posix.dirname(dir);}
 }
 if(names.has(missing))return {status:'already_exists',paths:[]};
 const base=posix.basename(missing);
 const exact=[...names].filter(path=>posix.basename(path)===base).sort();
 const variants=exact.length?[]:[...names].filter(path=>{
  const name=posix.basename(path);
  return base.startsWith('test_')&&name==='unit'+base||base.startsWith('unittest_')&&name===base.slice(4);
 }).sort();
 const paths=exact.length?exact:variants;
 if(paths.length>limit)return {status:'ambiguous_over_limit',paths:[],matches:paths.length};
 return {status:paths.length===0?'no_match':paths.length===1?'unique_suggestion':'ambiguous',method:exact.length?'basename':'test_prefix_variant',paths};
}
