export function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

export function getFileIcon(type) {
  if (!type) return 'file';
  if (type.startsWith('image/')) return 'image';
  if (type.startsWith('video/')) return 'video';
  if (type.startsWith('audio/')) return 'music';
  if (type.includes('pdf')) return 'file-text';
  if (type.includes('zip') || type.includes('rar') || type.includes('tar')) return 'archive';
  if (type.includes('text') || type.includes('document')) return 'file-text';
  return 'file';
}

export function truncate(str, len = 28) {
  if (!str) return '';
  if (str.length <= len) return str;
  const ext = str.lastIndexOf('.');
  if (ext > 0 && str.length - ext <= 6) {
    const name = str.substring(0, ext);
    const extension = str.substring(ext);
    const maxName = len - extension.length - 3;
    return name.substring(0, maxName) + '...' + extension;
  }
  return str.substring(0, len - 3) + '...';
}