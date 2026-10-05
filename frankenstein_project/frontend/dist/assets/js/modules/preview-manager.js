const activeUrls = new Set();

export function create(blob) {
  if (!(blob instanceof Blob)) throw new TypeError('A Blob is required to create a preview URL.');
  const url = URL.createObjectURL(blob);
  activeUrls.add(url);
  return url;
}

export function release(url) {
  if (!url) return;
  URL.revokeObjectURL(url);
  activeUrls.delete(url);
}

export function replace(previousUrl, blob) {
  if (previousUrl) release(previousUrl);
  return create(blob);
}

export function releaseAll() {
  [...activeUrls].forEach(release);
}

export function download(blob, filename, { revokeAfterMs = 1000 } = {}) {
  const url = create(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => release(url), revokeAfterMs);
  return url;
}

export const previewManager = Object.freeze({ create, release, replace, releaseAll, download });
globalThis.LabelKitPreview = previewManager;

globalThis.addEventListener?.('pagehide', releaseAll);
