import domain from '../shared/domain.js';
const { ClubError, duplicateAccount } = domain;

export function username(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_]{3,30}$/.test(value)) {
    throw new ClubError('VALIDATION', '用户名须为3—30位英文字母、数字或下划线');
  }
  return value.toLowerCase();
}

export function requireAvailableUsername(sql, name) {
  if (sql.exec('SELECT 1 FROM accounts WHERE username=?', name).toArray().length) {
    duplicateAccount('这个用户名已被使用');
  }
}
