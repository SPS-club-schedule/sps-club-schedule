const test=require('node:test'),assert=require('node:assert/strict');
const {renderDocument}=require('../shared/document-renderer');
test('Markdown renders headings, tables and LaTeX while code and escaped delimiters stay literal',()=>{
  const html=renderDocument('# 经验\n\n| 项目 | 结果 |\n| --- | --- |\n| A | B |\n\n行内 $E=mc^2$ 与 \\(x^2\\)。\n\n$$\n\\begin{aligned}a&=b+c\\\\d&=e\\end{aligned}\n$$\n\n\\[\\frac{1}{2}\\]\n\n`$literal$`\n\n```tex\n$literal$\n```\n\n\\$5 and \\$10');
  assert.match(html,/<h1>经验<\/h1>/);assert.match(html,/<table>/);assert.equal((html.match(/class="katex"/g)||[]).length,4);
  assert.match(html,/<code>\$literal\$<\/code>/);assert.match(html,/<code class="language-tex">\$literal\$/);assert.match(html,/\$5 and \$10/);
});
test('untrusted Markdown and LaTeX cannot introduce active HTML or javascript URLs',()=>{
  const html=renderDocument('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[unsafe](javascript:alert(1))\n\n$\\href{javascript:alert(1)}{click}$\n\n$$\\htmlClass{evil}{x}$$');
  assert.doesNotMatch(html,/<script|<img|href="javascript:|class="evil"/);assert.match(html,/&lt;script&gt;/);
  const safe=renderDocument('[参考](https://example.com)\n\n[相邻文档](./other.md)','markdown','https://site.test/experience/note.md');
  assert.match(safe,/rel="noopener noreferrer"/);assert.match(safe,/href="https:\/\/site.test\/experience\/other.md"/);
});
test('LaTeX viewer supports matrices, reports malformed formulas and keeps full documents as source',()=>{
  assert.match(renderDocument('\\begin{pmatrix}1&0\\\\0&1\\end{pmatrix}','latex'),/class="katex"/);
  assert.match(renderDocument('\\frac{','latex'),/math-error/);
  assert.match(renderDocument('\\documentclass{article}\n\\begin{document}Text\\end{document}','latex'),/完整文档请下载后编译/);
  assert.equal(renderDocument('<b>plain</b>','text'),'<pre class="document-plain">&lt;b&gt;plain&lt;/b&gt;</pre>');
  assert.match(renderDocument('字'.repeat(90000)),/256 KB/);
});
test('browser-bundled document viewer loads its renderer and keeps editing controls permission-scoped',async()=>{
  const {buildSync}=require('esbuild');
  const bundle=buildSync({entryPoints:['client/experience-document.js'],bundle:true,format:'esm',platform:'browser',write:false});
  const viewer=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
  await viewer.loadDocumentRenderer();
  const doc={path:'经验.md',source:'# 内容\n\n$x^2$',original:'# 内容\n\n$x^2$',item:{source:'member',revision:2,canEdit:false}};
  assert.match(viewer.previewDocument(doc),/class="katex"/);
  assert.doesNotMatch(viewer.documentView({experienceDocument:doc,experience:{canWrite:false}}),/编辑正文|另存副本/);
  assert.match(viewer.documentView({experienceDocument:doc,experience:{canWrite:true}}),/编辑并另存副本/);
  doc.item.canEdit=true;assert.match(viewer.documentView({experienceDocument:doc}),/编辑正文/);
  doc.editing=true;assert.equal(viewer.documentDirty(doc),false);doc.source+='\n草稿';assert.equal(viewer.documentDirty(doc),true);
  assert.match(viewer.previewDocument({path:'公式.tex',source:viewer.documentTemplate('latex')}),/class="katex"/);
});
