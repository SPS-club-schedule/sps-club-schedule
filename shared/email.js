function normalizeEmail(value) {
  if (typeof value !== 'string') throw new Error('请填写常用邮箱');
  const email=value.trim(), at=email.lastIndexOf('@'), local=email.slice(0,at), domain=email.slice(at+1).toLowerCase();
  if (email.length>254 || at<1 || local.length>64 || !/^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local) || local.startsWith('.') || local.endsWith('.') || local.includes('..') || !domain.includes('.') || domain.split('.').some(part=>!/^([a-z0-9]|[a-z0-9][a-z0-9-]{0,61}[a-z0-9])$/.test(part))) throw new Error('请输入有效的常用邮箱，例如 name@example.com');
  return local+'@'+domain;
}
module.exports={normalizeEmail};
