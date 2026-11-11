// hooks.mjs -- lets Node load the library's TypeScript as the browser build does: an import without an extension
// ('./MovementGuideScan') is tried again with '.ts'. Registered by plans.mjs.
export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (err) {
    if (err?.code === 'ERR_MODULE_NOT_FOUND' && (specifier.startsWith('.') || specifier.startsWith('/')) && !specifier.endsWith('.ts')) {
      return next(`${specifier}.ts`, context);
    }
    throw err;
  }
}
