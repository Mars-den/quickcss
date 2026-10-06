// Only declarative inline SVG geometry is portable. No files, network URLs,
// scripts, event handlers, styles, references, entities or embedded content.
const TAGS=new Set(['svg','g','path','rect','circle','ellipse','line','polyline','polygon']);
const NUM=/^[\d\s.,+eE-]+$/;
function validSVG(svg){
 if(typeof svg!=='string'||svg.length>16384||/[&]|<!|<\?/.test(svg))return false;
 const tokens=svg.match(/<[^>]+>/g)||[];if(tokens.join('').replace(/\s/g,'')!==svg.replace(/\s/g,''))return false;
 const stack=[];let root=false;
 for(const token of tokens){
  const closing=/^<\/([a-z]+)\s*>$/.exec(token);
  if(closing){if(stack.pop()!==closing[1])return false;continue;}
  const open=/^<([a-z]+)([\s\S]*?)(\/?)>$/.exec(token);if(!open||!TAGS.has(open[1]))return false;
  if(!stack.length){if(root||open[1]!=='svg')return false;root=true;}
  let attrs=open[2],match;const names=new Set();
  while(attrs.trim()){
   match=/^\s+([A-Za-z-]+)\s*=\s*(["'])([^"']*)\2/.exec(attrs);if(!match)return false;
   const [,name,,value]=match;if(names.has(name))return false;names.add(name);
   if(name==='xmlns'){if(open[1]!=='svg'||value!=='http://www.w3.org/2000/svg')return false;}
   else if(['fill','stroke'].includes(name)){if(!/^(none|black|white|currentColor|#[\da-fA-F]{3,8})$/.test(value))return false;}
   else if(['fill-rule','clip-rule'].includes(name)){if(!/^(evenodd|nonzero)$/.test(value))return false;}
   else if(['stroke-linecap'].includes(name)){if(!/^(butt|round|square)$/.test(value))return false;}
   else if(['stroke-linejoin'].includes(name)){if(!/^(miter|round|bevel)$/.test(value))return false;}
   else if(name==='d'){if(open[1]!=='path'||! /^[MmZzLlHhVvCcSsQqTtAa\d\s.,+eE-]+$/.test(value))return false;}
   else if(name==='transform'){if(!/^(\s*(matrix|translate|scale|rotate|skewX|skewY)\([\d\s.,+eE-]+\)\s*)+$/.test(value))return false;}
   else if(['viewBox','width','height','x','y','x1','y1','x2','y2','cx','cy','r','rx','ry','points','opacity','fill-opacity','stroke-opacity','stroke-width','stroke-miterlimit'].includes(name)){if(!NUM.test(value))return false;}
   else return false;
   attrs=attrs.slice(match[0].length);
  }
  if(!open[3])stack.push(open[1]);
 }
 return root&&stack.length===0;
}
function inlineMask(value){
 const match=/^url\(\s*(["'])(data:image\/svg\+xml,[\s\S]*)\1\s*\)$/i.exec(value||'');if(!match)return null;
 try{const svg=decodeURIComponent(match[2].slice('data:image/svg+xml,'.length));if(!validSVG(svg))return null;
  // Encode punctuation too, making the CSS URL unambiguous to both parsers.
  const encoded=encodeURIComponent(svg).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());
  return `url("data:image/svg+xml,${encoded}")`;
 }catch{return null;}
}
function safeSnapshot(css){
 if(/quickcss:(begin|end)|@import|image-set\s*\(/i.test(css))return false;
 const remaining=css.replace(/url\(\s*["']data:image\/svg\+xml,[^"']*["']\s*\)/gi,value=>inlineMask(value)?'none':value);
 return !/url\s*\(/i.test(remaining);
}
module.exports={validSVG,inlineMask,safeSnapshot};
