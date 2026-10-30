import {e,button} from './ui';
import {documentKind,MAX_DOCUMENT_BYTES} from '../shared/document-rules';
import {experienceFileUrl} from './api';
export {documentKind,MAX_DOCUMENT_BYTES};
export const documentTemplate=kind=>kind==='latex'?'\\begin{aligned}\nE &= mc^2 \\\\\n\\int_0^1 x^2\\,dx &= \\frac{1}{3}\n\\end{aligned}\n':kind==='text'?'在这里写下经验。\n':'# 经验记录\n\n在这里写下经验。\n\n行内公式：$E=mc^2$\n\n$$\n\\int_0^1 x^2\\,dx=\\frac{1}{3}\n$$\n';
let renderer;
export async function loadDocumentRenderer(){if(!renderer){const module=await import('../shared/document-renderer');renderer=module.renderDocument||module.default.renderDocument;}}
export const previewDocument=doc=>renderer?renderer(doc.source,documentKind(doc.path),doc.baseUrl):'<p>正在加载预览…</p>';
export const documentDirty=doc=>!!doc?.editing&&(doc.newFile||doc.source!==doc.original);
export async function readDocument(item) {
  if(item.size>MAX_DOCUMENT_BYTES)throw new Error('在线预览最多 256 KB，请下载此文件查看');
  const url=item.source==='github'?new URL('./experience/'+item.path.split('/').map(encodeURIComponent).join('/'),location.href.split('#')[0]).href:experienceFileUrl(item.id);
  const response=await fetch(url,{cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw new Error('文档读取失败，可能已被更新或收起，请刷新档案后重试');
  const buffer=await response.arrayBuffer();if(buffer.byteLength>MAX_DOCUMENT_BYTES)throw new Error('在线预览最多 256 KB，请下载查看');
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',buffer)),x=>x.toString(16).padStart(2,'0')).join('');
  if(item.sha256&&hash!==item.sha256)throw new Error('文档已发生变化，请刷新档案后重新打开');
  let source;try{source=new TextDecoder('utf-8',{fatal:true}).decode(buffer);}catch{throw new Error('在线查看需要 UTF-8 编码，请转换编码后重新上传');}
  await loadDocumentRenderer();
  return {item,path:item.path,source,original:source,editing:false,newFile:false,baseUrl:url};
}
export function documentView(s) {
  const doc=s.experienceDocument;if(!doc)return '';
  const kind=documentKind(doc.path),editable=doc.item?.canEdit||doc.newFile,dirty=documentDirty(doc);
  return `<section class="experience-document" aria-label="在线文档"><div class="row between document-toolbar"><div>${button('experienceDocumentClose','← 返回目录','plain small')}<h2 class="h2">${e(doc.path.split('/').at(-1))}</h2><p class="hint">${doc.newFile?'新文档':doc.item?.source==='github'?'仓库文档':`网页文档 · 版本 ${doc.item?.revision}`} · ${kind==='latex'?'LaTeX 公式':kind==='text'?'纯文本':'Markdown + LaTeX'}</p></div><div class="row">${!doc.editing&&editable?button('experienceDocumentEdit','编辑正文','primary compact',s.busy?'disabled':''):''}${!doc.editing&&s.experience?.canWrite&&!editable?button('experienceDocumentCopy','编辑并另存副本','secondary compact',s.busy?'disabled':''):''}${button('experienceDocumentDownload','下载源码','secondary compact')}</div></div>
  ${doc.editing?`<form data-form="experienceDocument"><div class="document-save-row">${doc.newFile?`<label class="label" for="experienceDocumentFormat">文档格式</label><select id="experienceDocumentFormat" name="experienceDocumentFormat" ${s.busy?'disabled':''}>${[['md','Markdown + LaTeX'],['tex','LaTeX 公式'],['txt','纯文本']].map(([ext,label])=>`<option value="${ext}" ${doc.path.toLowerCase().endsWith('.'+ext)?'selected':''}>${label}</option>`).join('')}</select><label class="label" for="experienceDocumentPath">文档路径（.md / .tex / .txt）</label><input id="experienceDocumentPath" name="experienceDocumentPath" value="${e(doc.path)}" required maxlength="400" ${s.busy?'disabled':''}>`:''}<div class="row between"><span class="hint" data-document-status role="status">${dirty?'有未保存的更改':'所有更改已保存'} · 保存后公开可读</span><div class="row"><button class="primary compact" ${s.busy?'disabled':''}>${s.busy?'正在保存…':doc.newFile?'保存并公开':'保存更改'}</button>${button('experienceDocumentCancel','退出编辑','plain small',s.busy?'disabled':'')}</div></div></div><p class="hint">Markdown 支持标题、列表、表格和代码。行内公式：<code>$E=mc^2$</code>；独立公式：<code>$$…$$</code>，也支持 <code>\\(…\\)</code>、<code>\\[…\\]</code>。LaTeX 文件用于公式预览。</p><div class="document-editor-grid"><div><label class="label" for="experienceDocumentSource">源代码</label><textarea id="experienceDocumentSource" name="experienceDocumentSource" class="document-source" spellcheck="false" ${s.busy?'disabled':''}>${e(doc.source)}</textarea></div><section aria-label="实时预览"><h3 class="label">实时预览</h3><div class="document-preview" data-document-preview>${previewDocument(doc)}</div></section></div></form>`:`<article class="document-preview document-reading" data-document-preview>${previewDocument(doc)}</article>`}</section>`;
}
