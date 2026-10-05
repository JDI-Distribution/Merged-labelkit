export class LabelKitHttpError extends Error {
  constructor(message, { status = 0, payload = null, url = '' } = {}) {
    super(message);
    this.name = 'LabelKitHttpError';
    this.status = status;
    this.payload = payload;
    this.url = url;
  }
}

export async function request(resource, options = {}, timeoutMs = 60000) {
  const controller = new AbortController();
  const externalSignal = options.signal;
  const abort = () => controller.abort(externalSignal?.reason);
  externalSignal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(resource, { ...options, signal: controller.signal });
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new LabelKitHttpError(`Request timed out after ${Math.round(timeoutMs / 1000)} seconds.`, { url: String(resource) });
    }
    throw error;
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener('abort', abort);
  }
}

export async function json(resource, options = {}, timeoutMs = 60000) {
  const response = await request(resource, options, timeoutMs);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new LabelKitHttpError(payload.detail || payload.message || `Request failed with status ${response.status}.`, {
      status: response.status,
      payload,
      url: String(resource),
    });
  }
  return payload;
}

export async function blob(resource, options = {}, timeoutMs = 120000) {
  const response = await request(resource, options, timeoutMs);
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new LabelKitHttpError(payload.detail || payload.message || `Request failed with status ${response.status}.`, {
      status: response.status,
      payload,
      url: String(resource),
    });
  }
  return response.blob();
}

export function errorMessage(error, fallback = 'The request could not be completed.') {
  return String(error?.payload?.detail || error?.message || fallback);
}

export const apiClient = Object.freeze({ request, json, blob, errorMessage, LabelKitHttpError });
globalThis.LabelKitAPI = apiClient;

