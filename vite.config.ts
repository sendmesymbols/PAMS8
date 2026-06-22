import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';
import terser from '@rollup/plugin-terser';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// `npm run dev`        → serves the harness against the MS/ TypeScript source.
// `npm run dev:dist`   → runs with `--mode dist`; the `@lib` alias is repointed at
//   the built dist/MS/*.min.js so the SAME harness exercises the shipped output
//   (catches terser `_`-property mangling, tree-shaking, missing-export divergences).
export default defineConfig(({ mode }) => {
    const useDist = mode === 'dist';
    return {
    resolve: {
        // Harness library imports use the `@lib/...` specifier; remap it per mode.
        alias: { '@lib': resolve(__dirname, useDist ? 'dist/MS' : 'MS') },
        // dist emits `*.min.js`; allow extensionless `@lib/...` specifiers to resolve it.
        extensions: useDist
            ? ['.min.js', '.mjs', '.js', '.ts', '.json']
            : ['.mjs', '.js', '.ts', '.json'],
    },
    build: {
        target: 'esnext',
        lib: {
            entry: resolve(__dirname, 'MS/Engines/SymbolEngine.ts'),
            formats: ['es'],
        },
        outDir: 'dist/MS',
        emptyOutDir: true,
        rollupOptions: {
            input: [
                resolve(__dirname, 'MS/Engines/SymbolEngine.ts'),
                resolve(__dirname, 'MS/ThirdParty/MilSymbols/UEITypes.ts'),
            ],
            output: {
                preserveModules: true,
                preserveModulesRoot: 'MS',
                entryFileNames: '[name].min.js',
            },
            external: [
                /^@arcgis\//,
            ],
            plugins: [
                terser({
                    compress: {
                        passes: 3,               // Multiple passes over the code for deeper optimization
                        drop_console: true,      // Remove all console statements
                        drop_debugger: true,     // Remove debugger statements
                        pure_getters: true,      // Treat getter functions as pure for better optimization
                        unsafe: true,            // Enable potentially unsafe optimizations
                        unsafe_comps: true,      // Optimize comparisons (e.g., 'a' == 'b' can be simplified)
                        unsafe_math: true,       // Perform aggressive math optimizations
                        unsafe_proto: true,      // Optimize prototype chain manipulation
                        unsafe_regexp: true,     // Enable unsafe regex optimizations
                        booleans: true,          // Simplify boolean expressions
                        loops: true,             // Optimize loops aggressively
                        dead_code: true,         // Remove dead code (code that's never executed)
                        keep_fargs: false,       // Remove unused function arguments
                        reduce_vars: true,       // Reduce variable references (for better compression)
                        toplevel: true           // Perform top-level optimizations
                    },
                    mangle: {
                        toplevel: true,          // Mangle top-level variable names (chunk-local, safe)
                        // Property mangling REMOVED. With preserveModules,
                        // @rollup/plugin-terser minifies each chunk with an independent
                        // name table, so `_`-prefixed methods/props shared across modules
                        // (e.g. GeoTools._2PtLen / _vertexAngle / _ptCollectionLen, called
                        // from MainAttack, PhaseLine, …) got DIFFERENT mangled names in the
                        // caller vs the definition → "not a function" at runtime, swallowed by
                        // try/catch + drop_console → symbols silently failed to draw in dist.
                        // Property mangling is incompatible with code-splitting; do not re-add.
                    },
                    format: {
                        comments: false,         // Remove all comments
                        beautify: false,         // Ensure no beautification for compact output
                        max_line_len: 32000,     // Prevent line breaking
                        indent_level: 0          // Remove unnecessary indentation
                    }
                })
            ],
        },
        minify: false, // handled by terser plugin instead
    },
    server: {
        host: "0.0.0.0",
        // Different port per mode so source (:6547) and dist (:6548) can run together.
        port: useDist ? 6548 : 6547,
        proxy: {
            '/roadnet': {
                target: 'http://localhost:9191',
                changeOrigin: true,
                rewrite: (p) => p.replace(/^\/roadnet/, ''),
            },
        },
    },
    plugins: [
        dts({
            entryRoot: 'MS',
            outDir: 'dist/MS',
            tsconfigPath: 'tsconfig.build.json',
        }),
    ],
    };
});


