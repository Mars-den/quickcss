const defaults = {font:'system-ui',size:18,lineHeight:1.6,width:760,spacing:1,headingScale:1.15,headingWeight:650,lightBackground:'#ffffff',lightText:'#242424',darkBackground:'#1e1e1e',darkText:'#dddddd',accent:'#9874ee',customCss:''};
const limits={size:[12,36],lineHeight:[1,2.5],width:[320,1400],spacing:[0.3,3],headingScale:[0.7,1.8],headingWeight:[300,900]};
function validate(p){
 const out={...defaults,...p};
 for(const [k,[min,max]] of Object.entries(limits)) if(!Number.isFinite(out[k])||out[k]<min||out[k]>max) throw Error(`${k} must be between ${min} and ${max}`);
 if(!['system-ui','serif','monospace','Georgia','Helvetica Neue'].includes(out.font)) throw Error('Unsupported font');
 for(const k of ['lightBackground','lightText','darkBackground','darkText','accent']) if(!/^#[0-9a-f]{6}$/i.test(out[k])) throw Error(`${k} must be a six-digit hex color`);
 if(typeof out.customCss!=='string'||out.customCss.length>50000||/quickcss:(begin|end)/i.test(out.customCss)) throw Error('Invalid custom CSS or reserved ownership marker');
 // CSS-only local styling; reject fetch rules even though native CSP also restricts them.
 if(/@import|url\s*\(|<\/style/i.test(out.customCss)) throw Error('Custom CSS cannot import or reference assets');
 return out;
}
function css(profile){const p=validate(profile);const font=['system-ui','serif','monospace'].includes(p.font)?p.font:`"${p.font}"`;return `body {
 --font-text-theme: ${font}; --font-text: ${font}; --font-text-size: ${p.size}px; --font-preferred-size: ${p.size}px;
 --line-height-normal: ${p.lineHeight}; --file-line-width: ${p.width}px; --p-spacing: ${p.spacing}em; --text-accent: ${p.accent}; --interactive-accent: ${p.accent};
}
body.theme-light { --background-primary: ${p.lightBackground}; --text-normal: ${p.lightText}; }
body.theme-dark { --background-primary: ${p.darkBackground}; --text-normal: ${p.darkText}; }
.markdown-preview-view { font-family: ${font}; font-size: ${p.size}px; line-height: ${p.lineHeight}; color: var(--text-normal); background: var(--background-primary); }
.markdown-preview-sizer { max-width: ${p.width}px !important; margin-inline: auto; }
.markdown-rendered p { margin-block: ${p.spacing}em; }
${[1,2,3,4,5,6].map((n)=>`.markdown-rendered h${n} { font-size: ${([2,1.6,1.35,1.2,1.1,1][n-1]*p.headingScale).toFixed(3)}em; font-weight: ${p.headingWeight}; }`).join('\n')}
.markdown-rendered a { color: ${p.accent}; }
${p.customCss}`;}
module.exports={defaults,limits,validate,css};
