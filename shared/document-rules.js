'use strict';
const MAX_DOCUMENT_BYTES=256*1024;
const documentKind=path=>({md:'markdown',tex:'latex',txt:'text'}[String(path).split('.').at(-1).toLowerCase()]||'');
module.exports={MAX_DOCUMENT_BYTES,documentKind};
