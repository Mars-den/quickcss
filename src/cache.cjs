const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {css,validate}=require('./profile.cjs');
const {safeSnapshot}=require('./assets.cjs');
const BEGIN='\n/* quickcss:begin v1 */\n',END='\n/* quickcss:end v1 */\n';
function strip(source){
 const b=source.indexOf(BEGIN),e=source.indexOf(END);
 if(b<0&&e<0){if(source.includes('quickcss:begin')||source.includes('quickcss:end'))throw Error('Unrecognized QuickCss markers; manual review required');return source;}
 if(b<0||e<b||source.indexOf(BEGIN,b+1)>=0||source.indexOf(END,e+1)>=0)throw Error('Damaged or duplicate QuickCss block; manual review required');
 return source.slice(0,b)+source.slice(e+END.length);
}
function patch(source,style){return strip(source)+BEGIN+style+END;}
function atomic(file,value,expected){
 if(expected!==undefined&&fs.readFileSync(file,'utf8')!==expected)throw Error('Resource changed during operation; retry');
 const mode=fs.existsSync(file)?fs.statSync(file).mode&0o777:0o600;
 const tmp=file+'.quickcss-'+crypto.randomUUID();
 try{const fd=fs.openSync(tmp,'wx',mode);try{fs.writeFileSync(fd,value);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 if(expected!==undefined&&fs.readFileSync(file,'utf8')!==expected)throw Error('Resource changed during operation; retry');fs.renameSync(tmp,file);
 }finally{if(fs.existsSync(tmp))fs.unlinkSync(tmp);}
}
class Cache {
 constructor(root=path.join(os.homedir(),'Library/Application Support/obsidian/quicklook'),stateRoot=path.join(os.homedir(),'Library/Application Support/QuickCss')){this.root=root;this.stateRoot=stateRoot;this.stateFile=path.join(stateRoot,'profile.json');}
 state(){if(!fs.existsSync(this.stateFile))return {schema:1,enabled:false};const s=JSON.parse(fs.readFileSync(this.stateFile,'utf8'));if(![1,2].includes(s.schema)||typeof s.enabled!=='boolean'||(s.enabled&&typeof s.css!=='string'))throw Error('Unsupported shared profile');return s;}
 locked(fn){fs.mkdirSync(this.stateRoot,{recursive:true,mode:0o700});const lock=path.join(this.stateRoot,'write.lock');let fd;try{fd=fs.openSync(lock,'wx',0o600);}catch(e){throw Error('Another QuickCss instance is writing, or a stale write.lock requires review');}try{fs.writeFileSync(fd,String(process.pid));return fn();}finally{fs.closeSync(fd);fs.unlinkSync(lock);}}
 current(){const dir=fs.realpathSync(path.join(this.root,'current'));if(path.dirname(dir)!==fs.realpathSync(this.root)||! /^[a-f0-9]{64}$/.test(path.basename(dir)))throw Error('Unsupported Quick Look cache location');
 const file=path.join(dir,'quicklook.css');for(const name of ['quicklook.css','quicklook.js','index.html'])if(!fs.lstatSync(path.join(dir,name)).isFile())throw Error('Unsupported Quick Look resource');
 const html=fs.readFileSync(path.join(dir,'index.html'),'utf8'),js=fs.readFileSync(path.join(dir,'quicklook.js'),'utf8'),source=fs.readFileSync(file,'utf8');
 if(!html.includes('href="quicklook.css"')||!html.includes('src="quicklook.js"')||!js.includes('onQuickLookReady')||!source.includes('--font-text-size')||!source.includes('.markdown-rendered'))throw Error('Unsupported Quick Look renderer; nothing patched');
 return {dir,file,source};}
 writeCurrent(style){const {dir,file,source}=this.current();const next=patch(source,style);if(next===source)return {changed:false,cache:path.basename(dir)};
 const backups=path.join(this.stateRoot,'backups');fs.mkdirSync(backups,{recursive:true,mode:0o700});const base=strip(source),id=crypto.createHash('sha256').update(base).digest('hex'),backup=path.join(backups,id+'.css');
 if(!fs.existsSync(backup))atomic(backup,base);atomic(file,next,source);return {changed:true,cache:path.basename(dir)};}
 apply(profile,label,version){const p=validate(profile),style=css(p);return this.locked(()=>{this.current();atomic(this.stateFile,JSON.stringify({schema:1,enabled:true,profile:p,css:style,label,version,appliedAt:new Date().toISOString()},null,2));return this.writeCurrent(style);});}
 applySnapshot(snapshot,label,version,owner){
 if(snapshot?.schema!==2||typeof snapshot.css!=='string'||snapshot.css.length>1000000||!safeSnapshot(snapshot.css))throw Error('Invalid captured appearance');
 return this.locked(()=>{const previous=this.state();if(owner&&previous.owner!==owner)return {skipped:true};this.current();if(previous.enabled&&previous.css===snapshot.css&&previous.owner===owner&&previous.label===label&&previous.version===version)return this.writeCurrent(snapshot.css);atomic(this.stateFile,JSON.stringify({schema:2,owner:owner||previous.owner,enabled:true,snapshot,css:snapshot.css,label,version,appliedAt:new Date().toISOString()},null,2));return this.writeCurrent(snapshot.css);});
 }
 claim(owner,label,force=false){return this.locked(()=>{const s=this.state();if(s.owner&&s.owner!==owner&&!force)return false;atomic(this.stateFile,JSON.stringify({...s,owner,ownerLabel:label},null,2));return true;});}
 reconcile(){return this.locked(()=>{const s=this.state();if(!s.enabled)return {enabled:false};return {...this.writeCurrent(s.css),enabled:true,label:s.label,version:s.version};});}
 restore(owner){return this.locked(()=>{const s=this.state();if(owner&&s.owner!==owner)return 0;atomic(this.stateFile,JSON.stringify({...s,enabled:false},null,2));let count=0;
 if(fs.existsSync(this.root))for(const name of fs.readdirSync(this.root)){if(!/^[a-f0-9]{64}$/.test(name))continue;const dir=path.join(this.root,name);if(!fs.lstatSync(dir).isDirectory())continue;const file=path.join(dir,'quicklook.css');if(!fs.existsSync(file)||!fs.lstatSync(file).isFile())continue;const source=fs.readFileSync(file,'utf8'),next=strip(source);if(next!==source){atomic(file,next,source);count++;}}
 return count;});}
}
module.exports={Cache,strip,patch,atomic,BEGIN,END};
