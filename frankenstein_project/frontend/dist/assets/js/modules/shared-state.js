const registry = globalThis.__labelKitState ||= Object.create(null);
const listeners = new Map();

export function register(name, initialValue = {}) {
  if (!name) throw new TypeError('State name is required.');
  if (!(name in registry)) registry[name] = initialValue;
  return registry[name];
}

export function get(name) {
  return registry[name];
}

export function patch(name, values = {}) {
  const current = register(name);
  if (!current || typeof current !== 'object' || Array.isArray(current)) {
    throw new TypeError(`State "${name}" cannot be patched.`);
  }
  Object.assign(current, values);
  emit(name, current);
  return current;
}

export function replace(name, value) {
  registry[name] = value;
  emit(name, value);
  return value;
}

export function subscribe(name, listener) {
  if (typeof listener !== 'function') return () => {};
  const group = listeners.get(name) || new Set();
  group.add(listener);
  listeners.set(name, group);
  return () => group.delete(listener);
}

function emit(name, value) {
  listeners.get(name)?.forEach(listener => listener(value));
}

export const state = Object.freeze({ register, get, patch, replace, subscribe });
globalThis.LabelKitState = state;
