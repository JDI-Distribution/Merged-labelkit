const DEFAULT_PERMISSIONS = Object.freeze({
  view: false,
  generate: false,
  table_crud: false,
  save_mpl: false,
  delete_mpl: false,
  audit_view: false,
  admin: false,
});

function runtime() {
  return globalThis.__labelKitState?.runtime || {};
}

export function has(permission, config = runtime()) {
  return !!config?.permissions?.[permission];
}

export function allowBrowserCache(config = runtime()) {
  return config?.allow_browser_local_cache !== false;
}

export function allowLocalFallback(config = runtime()) {
  return config?.allow_local_json_fallback !== false;
}

export function userLabel(config = runtime()) {
  const user = config?.user || {};
  return user.email || user.name || 'Signed in';
}

export function normalizedPermissions(config = runtime()) {
  return { ...DEFAULT_PERMISSIONS, ...(config?.permissions || {}) };
}

export const permissions = Object.freeze({
  has,
  allowBrowserCache,
  allowLocalFallback,
  userLabel,
  normalizedPermissions,
});

globalThis.LabelKitPermissions = permissions;
