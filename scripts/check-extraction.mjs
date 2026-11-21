import {readFileSync,readdirSync,lstatSync} from 'node:fs';
import {join,relative} from 'node:path';
import {root} from './database.mjs';
const problems=[];
function scan(dir){for(const entry of readdirSync(dir,{withFileTypes:true})){
 if(['node_modules','.local','dist','.git'].includes(entry.name))continue;
 const path=join(dir,entry.name),name=relative(root,path);
 if(lstatSync(path).isSymbolicLink()){problems.push(`Unexpected symlink: ${name}`);continue;}
 if(entry.isDirectory()){scan(path);continue;}
 if(/^\.env/.test(entry.name)||/\.(pem|p12|mobileprovision|key|sqlite|zip|dmg)$/.test(entry.name))problems.push(`Unexpected publication artifact: ${name}`);
 if(/\.(js|mjs|tsx?|json|sql|html|css|md)$/.test(entry.name)){
  const content=readFileSync(path,'utf8');
  if(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bsk_live_[A-Za-z0-9]{16,}|\bsk-ant-[A-Za-z0-9_-]{20,}|\bghp_[A-Za-z0-9]{30,}/.test(content))problems.push(`Credential-shaped content: ${name}`);
 }
}}
scan(root);
const pkg=JSON.parse(readFileSync(join(root,'package.json')));
const expected=['express','pg','react','react-dom'];
if(!pkg.private||Object.keys(pkg.dependencies).some(name=>!expected.includes(name)))problems.push('Unexpected publication flag or runtime dependency');
if(problems.length){console.error(problems.join('\n'));process.exitCode=1;}else console.log('Source hygiene check passed: no environment files, symlinks, known credential shapes, or cloud SDK dependencies. Local Git metadata and generated runtime folders excluded; Git history requires separate review. This is not a comprehensive secrets audit.');
