// jsonhook.mjs -- lets a test import an engine that imports a .json file without an import attribute (Vite allows it).
export async function load(url, context, nextLoad) {
  if (url.endsWith('.json')) return nextLoad(url, { ...context, importAttributes: { ...(context.importAttributes ?? {}), type: 'json' } });
  return nextLoad(url, context);
}
