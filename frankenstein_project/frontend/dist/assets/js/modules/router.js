const PAGE_NAMES = Object.freeze(['home', 'michaels', 'kehe', 'operations', 'mpl', 'b2b', 'partners']);

export function normalizePageName(pageName) {
  return PAGE_NAMES.includes(pageName) ? pageName : 'home';
}

export function normalizeRoute(route = '') {
  const clean = String(route || '')
    .replace(/^#/, '')
    .replace(/^\/+|\/+$/g, '')
    .trim();
  if (!clean) return 'home';
  const [page, ...rest] = clean.split('/').filter(Boolean);
  return [normalizePageName(page), ...rest].join('/');
}

export function page(route = '') {
  return normalizePageName(normalizeRoute(route).split('/')[0]);
}

export function subpath(route = '') {
  return normalizeRoute(route).split('/').slice(1).join('/');
}

export function fromHash(hash = globalThis.location?.hash || '#home') {
  return normalizeRoute(hash);
}

export function write(route, { replace = false } = {}) {
  const normalized = normalizeRoute(route);
  const nextHash = `#${normalized}`;
  const state = {
    page: page(normalized),
    route: normalized,
    isOverlayRoute: !!subpath(normalized),
    pushedOverlayRoute: !replace && !!subpath(normalized),
  };
  if (replace) globalThis.history.replaceState(state, '', `/${nextHash}`);
  else if ((globalThis.location.hash || '#home') !== nextHash) globalThis.history.pushState(state, '', `/${nextHash}`);
  else if (!globalThis.history.state || globalThis.history.state.route !== normalized) globalThis.history.replaceState(state, '', `/${nextHash}`);
  return normalized;
}

export const router = Object.freeze({ normalizePageName, normalizeRoute, page, subpath, fromHash, write });
globalThis.LabelKitRouter = router;

