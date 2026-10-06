const {inlineMask}=require('./assets.cjs');
// Evaluate loaded styles on synthetic Markdown, then export scalar computed styles.
// No note DOM/content is accessed and no body-class script is injected into Quick Look.
const PROPERTIES=['color','background-color','background-image','font-family','font-size','font-weight','font-style','font-variant','font-feature-settings','font-kerning','font-optical-sizing','font-variation-settings','font-stretch','-webkit-font-smoothing','text-rendering','line-height','letter-spacing','text-transform','text-decoration-line','text-decoration-color','text-decoration-style','text-decoration-thickness','text-decoration-skip-ink','text-underline-offset','text-align','text-indent','white-space','overflow-wrap','word-break','border-top-color','border-right-color','border-bottom-color','border-left-color','border-top-width','border-right-width','border-bottom-width','border-left-width','border-top-style','border-right-style','border-bottom-style','border-left-style','border-radius','padding-top','padding-right','padding-bottom','padding-left','margin-top','margin-bottom','box-shadow','list-style-type'];
const VARIABLES=/^--(?:font-|line-height-|file-line-width$|file-margins$|p-spacing$|heading-|h[1-6]-|text-|background-|color-|code-|blockquote-|list-|table-|callout-|link-|hr-|tag-|checkbox-|highlight-|bold-|italic-|embed-|accent-|interactive-accent)/;
const SAMPLE=`<div class="app-container"><div class="horizontal-main-container"><div class="workspace"><div class="workspace-split mod-root"><div class="workspace-leaf"><div class="workspace-leaf-content" data-type="markdown"><div class="view-content"><div class="markdown-preview-view markdown-rendered is-readable-line-width"><div class="markdown-preview-sizer markdown-preview-section"><h1>Reading with your theme</h1><p>A synthetic paragraph with <strong>bold words</strong>, <em>italic words</em>, <a class="internal-link" href="#">a link</a> and <mark>a highlight</mark>.</p><h2>Headings and emphasis</h2><h3>Heading three</h3><h4>Heading four</h4><h5>Heading five</h5><h6>Heading six</h6><blockquote><p>A quotation wraps across lines so you can compare spacing and its vertical rule. Theme colors should remain readable on this canvas.</p></blockquote><p>Some <code>inline code</code>.</p><pre><code><span class="token keyword">const</span> appearance <span class="token operator">=</span> <span class="token string">"captured"</span><span class="token punctuation">;</span><span class="token comment"> // synthetic</span><span class="token function">capture</span><span class="token number">1</span><span class="token boolean">true</span></code></pre><h2>Lists and tasks</h2><ul><li>A list item</li><li>A second item<ul><li>A nested item</li></ul></li></ul><ol><li>A numbered item</li></ol><ul class="contains-task-list"><li class="task-list-item" data-task=" "><input class="task-list-item-checkbox" type="checkbox"> An open task</li><li class="task-list-item is-checked" data-task="x"><input class="task-list-item-checkbox" type="checkbox" checked> A completed task</li></ul><hr><h2>Tables</h2><div class="el-table"><table><thead><tr><th>Column</th><th>Value</th><th>Detail</th></tr></thead><tbody><tr><td>Theme</td><td>Current</td><td>First</td></tr><tr><td>Content</td><td>Synthetic</td><td>Middle</td></tr><tr><td>State</td><td>Captured</td><td>Last</td></tr></tbody></table></div><h2>Callouts</h2>${['note','info','tip','warning','danger','success'].map(type=>`<div class="callout" data-callout="${type}"><div class="callout-title"><div class="callout-title-inner">${type}</div></div><div class="callout-content"><p>A ${type} callout.</p></div></div>`).join('')}<h2>Links and tags</h2><p><a class="tag" href="#">#sample</a> · <a class="internal-link" href="#">An internal link</a> · <a class="external-link" href="https://example.invalid">An external link</a></p><p class="quickcss-preview-end">End of preview — both canvases scroll with the settings page.</p></div></div></div></div></div></div></div></div></div>`;
const TARGETS=[
 ['.markdown-preview-view','.markdown-preview-view'],
 ...['h1','h2','h3','h4','h5','h6','p','strong','em','a.internal-link','mark','blockquote','blockquote p','code','pre','pre code','ul:not(.contains-task-list)','ul.contains-task-list','ol','li:not(.task-list-item)','li.task-list-item','li.task-list-item.is-checked','input.task-list-item-checkbox','input.task-list-item-checkbox:checked','hr','a.tag'].map(x=>['.markdown-rendered '+x,'.markdown-rendered '+x]),
 ...['keyword','operator','string','punctuation','comment','function','number','boolean'].map(x=>[`.markdown-rendered pre .token.${x}`,`.markdown-rendered pre .token.${x}`]),
 ...['note','info','tip','warning','danger','success'].flatMap(type=>['',' .callout-title',' .callout-title-inner',' .callout-content',' .callout-content p'].map(suffix=>{const selector=`.markdown-rendered .callout[data-callout="${type}"]${suffix}`;return [selector,selector];}))
];
const TABLE_LAYOUT=['border-collapse','border-spacing','table-layout','min-width','max-width','box-sizing','overflow-x','overflow-y'];
const RADII=['border-top-left-radius','border-top-right-radius','border-bottom-left-radius','border-bottom-right-radius'];
const CELL_PROPERTIES=PROPERTIES.filter(p=>p!=='border-radius');
const TABLE_TARGETS=[
 ['table','table',[...PROPERTIES,...TABLE_LAYOUT]],
 ['thead','thead',PROPERTIES],['tbody','tbody',PROPERTIES],
 ['thead tr','thead tr',PROPERTIES],['tbody tr','tbody tr:nth-child(2)',PROPERTIES],
 ...['odd','even'].map(x=>[`tbody tr:nth-child(${x})`,`tbody tr:nth-child(${x})`,PROPERTIES]),
 ['th','thead th:nth-child(2)',[...CELL_PROPERTIES,...RADII]],
 ['td','tbody tr:nth-child(2) td:nth-child(2)',[...CELL_PROPERTIES,...RADII]],
 ...['thead','tbody'].flatMap(section=>{
  const cell=section==='thead'?'th':'td';
  return [
   ...['first','last'].map(edge=>[`${section} tr>${cell}:${edge}-child`,`${section} tr:nth-child(${section==='thead'?1:2})>${cell}:${edge}-child`,CELL_PROPERTIES]),
   ...['first','last'].map(edge=>[`${section} tr:${edge}-child>${cell}`,`${section} tr:${edge}-child>${cell}:nth-child(2)`,CELL_PROPERTIES.filter(p=>!/^border-(left|right)-/.test(p))]),
   ...[['first','first','top-left'],['first','last','top-right'],['last','first','bottom-left'],['last','last','bottom-right']].map(([row,col,corner])=>[`${section} tr:${row}-child>${cell}:${col}-child`,`${section} tr:${row}-child>${cell}:${col}-child`,[`border-${corner}-radius`]])
  ];
 })
].map(([selector,query,properties])=>[`.markdown-rendered table ${selector}`,`.markdown-rendered table ${query}`,properties]);
// The table element itself is not a descendant of another table.
TABLE_TARGETS[0][0]='.markdown-rendered table';TABLE_TARGETS[0][1]='.markdown-rendered table';
function quoteDecoration(win,doc){
 const element=doc.querySelector('.markdown-rendered blockquote'),owner=win.getComputedStyle(element),before=win.getComputedStyle(element,'::before');
 const out=[['.markdown-rendered blockquote',owner,['position']]];
 if(!['none','normal',''].includes(before.getPropertyValue('content'))){
  const props=[...PROPERTIES,'content','position','display','top','right','bottom','left','width','pointer-events','opacity'];
  if(before.getPropertyValue('top')==='auto'||before.getPropertyValue('bottom')==='auto')props.push('height');
  out.push(['.markdown-rendered blockquote::before',before,props]);
 }
 return out;
}
const TASK_LAYOUT=['display','position','top','right','bottom','left','width','height','box-sizing','vertical-align','appearance','-webkit-appearance','flex-shrink','margin-left','margin-right','margin-inline-start','margin-inline-end'];
function taskStyles(win,doc){
 const selectors=['ul.contains-task-list','li.task-list-item','li.task-list-item.is-checked','input.task-list-item-checkbox','input.task-list-item-checkbox:checked'];
 const out=selectors.map(x=>{const selector='.markdown-rendered '+x;return [selector,win.getComputedStyle(doc.querySelector(selector)),x.startsWith('input')?TASK_LAYOUT:TASK_LAYOUT.filter(p=>!['width','height','top','right','bottom','left'].includes(p))];});
 const checked=win.getComputedStyle(doc.querySelector('input:checked'),'::after');
 if(!['none','normal',''].includes(checked.content))out.push(['.markdown-rendered input.task-list-item-checkbox:checked::after',checked,[...PROPERTIES,...TASK_LAYOUT,'content','transform','-webkit-mask-size','-webkit-mask-position','-webkit-mask-repeat','-webkit-mask-image','mask-image']]);
 return out;
}
// Chrome can evaluate newer theme color functions that the native WebKit renderer
// cannot. Sample in the source browser and export portable sRGB, including alpha.
function colorResolver(win,doc){
 const canvas=doc.createElement('canvas');canvas.width=canvas.height=1;
 const ctx=canvas.getContext('2d',{willReadFrequently:true}),probe=doc.createElement('span'),cache=new Map();
 doc.querySelector('.markdown-preview-view').append(probe);
 const resolve=value=>{
  if(!value||/^(inherit|initial|unset|revert|revert-layer)$/i.test(value)||!safeValue(value)||!win.CSS.supports('color',value))return value;
  if(cache.has(value))return cache.get(value);
  probe.style.color=value;const computed=win.getComputedStyle(probe).color;
  ctx.clearRect(0,0,1,1);ctx.fillStyle=computed;ctx.fillRect(0,0,1,1);
  const [r,g,b,a]=ctx.getImageData(0,0,1,1).data;
  const result=a===255?`rgb(${r}, ${g}, ${b})`:`rgba(${r}, ${g}, ${b}, ${+(a/255).toFixed(4)})`;
  cache.set(value,result);return result;
 };
 return {resolve,dispose:()=>probe.remove()};
}
function readingBackground(win,view,resolve,mode){
 const ancestors=[];for(let node=view;node;node=node.parentElement)ancestors.unshift(node);
 const primary=resolve(win.getComputedStyle(view).getPropertyValue('--background-primary').trim());
 let rgba=[...(mode==='light'?[255,255,255]:[30,30,30]),1];
 const composite=color=>{const match=/^rgba?\(([^)]+)\)$/.exec(resolve(color));if(!match)return;const parts=match[1].split(',').map(Number),alpha=parts[3]??1;rgba=rgba.map((v,i)=>i<3?parts[i]*alpha+v*(1-alpha):1);};
 // Primary supplies a canvas when the synthetic ancestors have no paint. Opaque
 // actual ancestor backgrounds override it; translucent layers are composited.
 composite(primary);for(const node of ancestors)composite(win.getComputedStyle(node).backgroundColor);
 return `rgb(${rgba.slice(0,3).map(Math.round).join(', ')})`;
}
function safeValue(value){return typeof value==='string'&&value.length<4096&&!/url\s*\(|image-set\s*\(|[{};]|quickcss:(?:begin|end)|@import/i.test(value);}
function declarations(style,properties,resolve=value=>value){return properties.map(name=>{const raw=style.getPropertyValue(name).trim(),value=name==='color'||name.endsWith('-color')?resolve(raw):raw;if(name==='mask-image'||name==='-webkit-mask-image'){const mask=inlineMask(raw);return mask?`${name}: ${mask};`:'';}return value&&safeValue(value)?`${name}: ${value};`:'';}).filter(Boolean).join('\n');}
function serializeMode(mode,bodyStyle,viewStyle,targetStyles,options={}){
 const resolve=options.resolve|| (value=>value);
 if(!['light','dark'].includes(mode))throw Error('Invalid color scheme');
 const names=new Set([...Array.from(bodyStyle),...Array.from(viewStyle)].filter(name=>VARIABLES.test(name)));
 const variables=Array.from(names).sort().map(name=>{const raw=viewStyle.getPropertyValue(name).trim()||bodyStyle.getPropertyValue(name).trim(),value=/^--(?:font-|line-height-|file-|p-spacing|heading-|h[1-6]-(?!color))/.test(name)?raw:resolve(raw);return value&&safeValue(value)?`${name}: ${value};`:'';}).filter(Boolean).join('\n');
 const body=`body.theme-${mode} {\n${variables}\n${declarations(bodyStyle,['color','font-family','font-size','line-height'],resolve)}\n${options.background?`--quickcss-canvas-background: ${options.background};\nbackground-color: ${options.background};`:declarations(bodyStyle,['background-color'],resolve)}\n}`;
 return body+'\n'+targetStyles.map(([selector,style,properties=PROPERTIES])=>`body.theme-${mode} ${selector} {\n${declarations(style,properties,resolve)}\n}`).join('\n')+`\nbody.theme-${mode} .markdown-preview-sizer { max-width: var(--file-line-width, 760px); margin-inline: auto; }\n`;
}
function loadedCSS(doc){const chunks=[];let skipped=0;for(const sheet of [...Array.from(doc.styleSheets),...Array.from(doc.adoptedStyleSheets||[])]){if(sheet.disabled)continue;try{const rules=Array.from(sheet.cssRules).filter(rule=>rule.type!==3&&rule.type!==5);const text=rules.map(rule=>rule.cssText).join('\n');const media=sheet.media?.mediaText;chunks.push(media?`@media ${media}{${text}}`:text);}catch{skipped++;}}return {css:chunks.join('\n'),skipped};}
function schemeCSS(styles,mode){return styles.replace(/\(prefers-color-scheme:\s*(light|dark)\)/gi,(_match,scheme)=>scheme.toLowerCase()===mode?'(min-width: 0px)':'(min-width: 10000000px)');}
function preparePreview(el,mode,container){
 const d=el.contentDocument,style=d.createElement('style');
 const canvas=d.defaultView.getComputedStyle(d.body).getPropertyValue('--quickcss-canvas-background').trim();
 if(canvas&&safeValue(canvas))d.documentElement.style.setProperty('--quickcss-canvas-background',canvas);
 style.textContent=`html { display: block !important; contain: none !important; height: auto !important; color-scheme: ${mode}; background: var(--quickcss-canvas-background, var(--background-primary, ${mode==='light'?'#ffffff':'#1e1e1e'})) !important; overflow: hidden !important; }
 body { display: block !important; position: static !important; contain: none !important; background: var(--quickcss-canvas-background, var(--background-primary, ${mode==='light'?'#ffffff':'#1e1e1e'})) !important; color: var(--text-normal, ${mode==='light'?'#242424':'#dddddd'}) !important; margin: 0 !important; height: auto !important; min-height: 0 !important; overflow: visible !important; }
 .app-container,.horizontal-main-container,.workspace,.workspace-split,.workspace-leaf,.workspace-leaf-content,.view-content { display: block !important; position: static !important; contain: none !important; flex: none !important; float: none !important; width: 100% !important; height: auto !important; min-height: 0 !important; max-height: none !important; overflow: visible !important; }
 .markdown-preview-view { box-sizing: border-box !important; height: auto !important; min-height: 0 !important; max-height: none !important; overflow: visible !important; padding: 20px !important; background: var(--quickcss-canvas-background, var(--background-primary)) !important; }
 .markdown-preview-sizer { max-width: 100% !important; padding: 0 !important; margin: 0 !important; }
 .quickcss-preview-end { opacity: .7; }`;
 d.head.append(style);el.removeAttribute('aria-hidden');el.setAttribute('title',`${mode==='light'?'Light':'Dark'} appearance preview`);
 el.style.cssText='display:block;width:100%;height:600px;border:1px solid var(--background-modifier-border);border-radius:8px;';
 // A single parent scroll surface prevents the cursor getting trapped in a frame.
 const resize=()=>{el.style.height=Math.ceil(Math.max(d.body.getBoundingClientRect().height,d.querySelector('.markdown-preview-view').getBoundingClientRect().bottom-d.body.getBoundingClientRect().top)+2)+'px';};resize();
 const observer=new el.contentWindow.ResizeObserver(resize);observer.observe(d.body);
 const wheel=e=>{if(Math.abs(e.deltaX)>Math.abs(e.deltaY)||e.ctrlKey)return;let parent=container;
  while(parent){const cs=container.ownerDocument.defaultView.getComputedStyle(parent);if(parent.scrollHeight>parent.clientHeight&&/(auto|scroll)/.test(cs.overflowY)){parent.scrollTop+=e.deltaY*(e.deltaMode===1?16:e.deltaMode===2?parent.clientHeight:1);e.preventDefault();return;}parent=parent.parentElement;}
 };
 d.addEventListener('wheel',wheel,{passive:false});
 return ()=>{observer.disconnect();d.removeEventListener('wheel',wheel);el.remove();};
}
function abortError(){const error=new Error('Appearance evaluation cancelled');error.name='AbortError';return error;}
function checkAbort(signal){if(signal?.aborted)throw abortError();}
function frame(doc,mode,bodyClasses,styles,parent=doc.body,options={}){return new Promise((resolve,reject)=>{
 const signal=options.signal;if(signal?.aborted){reject(abortError());return;}
 const el=doc.createElement('iframe');el.setAttribute('sandbox','allow-same-origin');el.setAttribute('aria-hidden','true');el.style.cssText='position:fixed;left:-100000px;top:0;width:960px;height:900px;visibility:hidden;pointer-events:none;border:0';
 let timer,settled=false;
 const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',cancel);el.onload=null;};
 const fail=error=>{if(settled)return;settled=true;cleanup();el.remove();reject(error);};
 const cancel=()=>fail(abortError());signal?.addEventListener('abort',cancel,{once:true});
 timer=setTimeout(()=>fail(Error('Appearance evaluation timed out')),5000);
 el.onload=()=>{if(settled)return;try{checkAbort(signal);const d=el.contentDocument;d.body.className=[...bodyClasses.filter(c=>!/^theme-(light|dark)$/.test(c)),`theme-${mode}`,'is-render-complete'].join(' ');const style=d.createElement('style');style.textContent=schemeCSS(styles,mode);d.head.append(style);d.body.innerHTML=SAMPLE;settled=true;cleanup();resolve(el);}catch(e){fail(e);}};
 el.srcdoc='<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\';"><meta charset="utf-8"></head><body></body></html>';
 try{checkAbort(signal);parent.append(el);}catch(e){fail(e);}
 });}
async function capture(doc,appearance={},options={}){
 checkAbort(options.signal);
 const loaded=loadedCSS(doc);if(!loaded.css)throw Error('No readable loaded stylesheets');
 const classes=Array.from(doc.body.classList),parts=[];
 for(const mode of ['light','dark']){checkAbort(options.signal);const el=await frame(doc,mode,classes,loaded.css,doc.body,options);try{checkAbort(options.signal);const d=el.contentDocument,w=el.contentWindow;d.documentElement.style.cssText=doc.documentElement.style.cssText;d.body.style.cssText=doc.body.style.cssText;const view=d.querySelector('.markdown-preview-view'),colors=colorResolver(w,d);try{parts.push(serializeMode(mode,w.getComputedStyle(d.body),w.getComputedStyle(view),[...TARGETS.map(([selector,query])=>[selector,w.getComputedStyle(d.querySelector(query))]),...TABLE_TARGETS.map(([selector,query,properties])=>[selector,w.getComputedStyle(d.querySelector(query)),properties]),...quoteDecoration(w,d),...taskStyles(w,d)],{resolve:colors.resolve,background:readingBackground(w,view,colors.resolve,mode)}));}finally{colors.dispose();}}finally{el.remove();}}
 // Native Quick Look supplies its own renderer geometry and visibility rules.
 checkAbort(options.signal);
 const style=parts.join('\n')+'\nbody { --font-preferred-size: var(--font-text-size); }\n';
 return {schema:2,css:style,theme:appearance.cssTheme||'Default',snippets:appearance.enabledCssSnippets||[],styleSettings:!!doc.getElementById('css-settings-manager'),capturedAt:new Date().toISOString(),skippedStylesheets:loaded.skipped,warning:'External/font assets and editor/UI styles are not exported. Validated inline SVG task masks are included. Interactive states and renderer text rasterization may differ.'};
}
module.exports={capture,frame,SAMPLE,PROPERTIES,VARIABLES,safeValue,declarations,serializeMode,loadedCSS,schemeCSS,preparePreview,TABLE_TARGETS,TABLE_LAYOUT,quoteDecoration,TASK_LAYOUT,taskStyles,colorResolver,readingBackground,inlineMask};
