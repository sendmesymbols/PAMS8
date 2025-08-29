import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';
import terser from '@rollup/plugin-terser';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default defineConfig({
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
                        toplevel: true,          // Mangle top-level variable names
                        properties: {
                            regex: /^_/            // Mangle object properties starting with "_"
                        }
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
        port: 3000
    },
    plugins: [
        dts({
            entryRoot: 'MS',
            outDir: 'dist/MS',
            tsconfigPath: 'tsconfig.build.json',
        }),
    ],
});


