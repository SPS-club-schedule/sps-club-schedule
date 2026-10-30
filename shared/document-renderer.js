'use strict';
const MarkdownIt=require('markdown-it');
const katex=require('katex');
const {MAX_DOCUMENT_BYTES}=require('./document-rules');
const md=new MarkdownIt({html:false,linkify:false,typographer:false});
const escape=md.utils.escapeHtml;
function math(source,displayMode) {
  try {return katex.renderToString(source,{displayMode,throwOnError:true,trust:false,strict:'ignore',maxExpand:500,maxSize:20,output:'htmlAndMathml'});}
  catch(error){return `<span class="math-error" role="note">公式暂不能显示：${escape(error.message)}<code>${escape(source)}</code></span>`;}
}
function closing(source,delimiter,from) {
  let pos=from;
  while((pos=source.indexOf(delimiter,pos))!==-1){let escapes=0;for(let i=pos-1;i>=0&&source[i]==='\\';i--)escapes++;if(escapes%2===0)return pos;pos+=delimiter.length;}
  return -1;
}
// Tokenize before Markdown escape processing; code spans/fences remain literal.
md.inline.ruler.before('escape','math',(state,silent)=>{
  const rest=state.src.slice(state.pos);
  const open=['$$','\\[','\\(','$'].find(x=>rest.startsWith(x));if(!open)return false;
  const close={'\\[':'\\]','\\(':'\\)'}[open]||open,begin=state.pos+open.length;
  if(open==='$'&&(state.src[begin]===' '||state.src[begin]==='\n'||/\d/.test(state.src[state.pos-1]||'')))return false;
  const end=closing(state.src,close,begin);if(end<0||end===begin)return false;
  const content=state.src.slice(begin,end);
  if(open==='$'&&(content.includes('\n')||/\s$/.test(content)||/\d/.test(state.src[end+1]||'')))return false;
  if(!silent){const token=state.push('math_inline','math',0);token.content=content;token.meta={display:open==='$$'||open==='\\['};}
  state.pos=end+close.length;return true;
});
md.renderer.rules.math_inline=(tokens,index)=>math(tokens[index].content,tokens[index].meta.display);
md.block.ruler.before('fence','math_block',(state,startLine,endLine,silent)=>{
  const start=state.bMarks[startLine]+state.tShift[startLine];
  if(state.sCount[startLine]-state.blkIndent>=4)return false;
  const open=['$$','\\['].find(x=>state.src.startsWith(x,start));if(!open)return false;
  const close=open==='$$'?'$$':'\\]',end=closing(state.src,close,start+open.length);if(end<0)return false;
  let last=startLine;while(last<endLine&&state.eMarks[last]<end+close.length)last++;
  if(last>=endLine||state.src.slice(end+close.length,state.eMarks[last]).trim())return false;
  if(silent)return true;
  const token=state.push('math_block','math',0);token.block=true;token.content=state.src.slice(start+open.length,end);token.map=[startLine,last+1];state.line=last+1;return true;
});
md.renderer.rules.math_block=(tokens,index)=>math(tokens[index].content,true)+'\n';
const defaultLink=md.renderer.rules.link_open||((tokens,index,options,env,self)=>self.renderToken(tokens,index,options));
md.renderer.rules.link_open=(tokens,index,options,env,self)=>{
  const token=tokens[index],href=token.attrGet('href');
  if(env.baseUrl&&href){try{token.attrSet('href',new URL(href,env.baseUrl).href);}catch{token.attrSet('href','#');}}
  token.attrSet('target','_blank');token.attrSet('rel','noopener noreferrer');
  return defaultLink(tokens,index,options,env,self);
};
const defaultImage=md.renderer.rules.image;
md.renderer.rules.image=(tokens,index,options,env,self)=>{
  const token=tokens[index],src=token.attrGet('src');
  if(env.baseUrl&&src){try{token.attrSet('src',new URL(src,env.baseUrl).href);}catch{token.attrSet('src','');}}
  token.attrSet('loading','lazy');token.attrSet('referrerpolicy','no-referrer');
  return defaultImage(tokens,index,options,env,self);
};
function renderDocument(source,kind='markdown',baseUrl='') {
  if(new TextEncoder().encode(source).length>MAX_DOCUMENT_BYTES)return '<p class="error">文档超过在线预览的 256 KB 上限，请下载查看。</p>';
  if(kind==='text')return '<pre class="document-plain">'+escape(source)+'</pre>';
  if(kind==='latex'){
    if(/\\(?:documentclass|usepackage|begin\{document\})/.test(source))return '<p class="hint">此处是 LaTeX 公式预览器。完整文档请下载后编译；可复制公式到新建的 LaTeX 公式文档中预览。</p><pre>'+escape(source)+'</pre>';
    const trimmed=source.trim(),delimited=/^(\$\$|\\\[|\\\()/.test(trimmed);
    return delimited?md.render(trimmed,{baseUrl}):math(source,true);
  }
  return md.render(source,{baseUrl});
}
module.exports={renderDocument};
