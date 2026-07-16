export function fileAccessFailure(error) {
  const code = error?.code
  if (code === 'ENOENT' || code === 'ENOTDIR') {
    return { ok: false, reason: 'not-found', message: '文件不存在' }
  }
  if (code === 'EACCES' || code === 'EPERM') {
    return { ok: false, reason: 'permission', message: '无权限访问文件' }
  }
  return { ok: false, reason: 'open-failed', message: '文件不可用' }
}
