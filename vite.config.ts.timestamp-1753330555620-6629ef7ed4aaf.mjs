// vite.config.ts
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { defineConfig } from "file:///D:/Projects/Web/PAMS8/node_modules/vite/dist/node/index.js";
import dts from "file:///D:/Projects/Web/PAMS8/node_modules/vite-plugin-dts/dist/index.mjs";
import terser from "file:///D:/Projects/Web/PAMS8/node_modules/@rollup/plugin-terser/dist/es/index.js";
var __vite_injected_original_import_meta_url = "file:///D:/Projects/Web/PAMS8/vite.config.ts";
var __filename = fileURLToPath(__vite_injected_original_import_meta_url);
var __dirname = dirname(__filename);
var vite_config_default = defineConfig({
  build: {
    target: "esnext",
    lib: {
      entry: resolve(__dirname, "MS/Engines/SymbolEngine.ts"),
      formats: ["es", "umd"],
      name: "SymbolEngine",
      fileName: "SymbolEngine.umd"
    },
    outDir: "dist/MS",
    emptyOutDir: true,
    rollupOptions: {
      input: [
        resolve(__dirname, "MS/Engines/SymbolEngine.ts"),
        resolve(__dirname, "MS/ThirdParty/MilSymbols/UEITypes.ts")
      ],
      output: {
        preserveModules: true,
        preserveModulesRoot: "MS",
        entryFileNames: "[name].min.js"
      },
      external: [
        /^@arcgis\//
      ],
      plugins: [
        terser({
          compress: {
            passes: 3,
            // Multiple passes over the code for deeper optimization
            drop_console: true,
            // Remove all console statements
            drop_debugger: true,
            // Remove debugger statements
            pure_getters: true,
            // Treat getter functions as pure for better optimization
            unsafe: true,
            // Enable potentially unsafe optimizations
            unsafe_comps: true,
            // Optimize comparisons (e.g., 'a' == 'b' can be simplified)
            unsafe_math: true,
            // Perform aggressive math optimizations
            unsafe_proto: true,
            // Optimize prototype chain manipulation
            unsafe_regexp: true,
            // Enable unsafe regex optimizations
            booleans: true,
            // Simplify boolean expressions
            loops: true,
            // Optimize loops aggressively
            dead_code: true,
            // Remove dead code (code that's never executed)
            keep_fargs: false,
            // Remove unused function arguments
            reduce_vars: true,
            // Reduce variable references (for better compression)
            toplevel: true
            // Perform top-level optimizations
          },
          mangle: {
            toplevel: true,
            // Mangle top-level variable names
            properties: {
              regex: /^_/
              // Mangle object properties starting with "_"
            }
          },
          format: {
            comments: false,
            // Remove all comments
            beautify: false,
            // Ensure no beautification for compact output
            max_line_len: 32e3,
            // Prevent line breaking
            indent_level: 0
            // Remove unnecessary indentation
          }
        })
      ]
    },
    minify: false
    // handled by terser plugin instead
  },
  plugins: [
    dts({
      entryRoot: "MS",
      outDir: "dist/MS",
      tsconfigPath: "tsconfig.build.json"
    })
  ]
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCJEOlxcXFxQcm9qZWN0c1xcXFxXZWJcXFxcUEFNUzhcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfZmlsZW5hbWUgPSBcIkQ6XFxcXFByb2plY3RzXFxcXFdlYlxcXFxQQU1TOFxcXFx2aXRlLmNvbmZpZy50c1wiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9pbXBvcnRfbWV0YV91cmwgPSBcImZpbGU6Ly8vRDovUHJvamVjdHMvV2ViL1BBTVM4L3ZpdGUuY29uZmlnLnRzXCI7aW1wb3J0IHsgZmlsZVVSTFRvUGF0aCB9IGZyb20gJ3VybCc7XHJcbmltcG9ydCB7IGRpcm5hbWUsIHJlc29sdmUgfSBmcm9tICdwYXRoJztcclxuaW1wb3J0IHsgZGVmaW5lQ29uZmlnIH0gZnJvbSAndml0ZSc7XHJcbmltcG9ydCBkdHMgZnJvbSAndml0ZS1wbHVnaW4tZHRzJztcclxuaW1wb3J0IHRlcnNlciBmcm9tICdAcm9sbHVwL3BsdWdpbi10ZXJzZXInO1xyXG5cclxuY29uc3QgX19maWxlbmFtZSA9IGZpbGVVUkxUb1BhdGgoaW1wb3J0Lm1ldGEudXJsKTtcclxuY29uc3QgX19kaXJuYW1lID0gZGlybmFtZShfX2ZpbGVuYW1lKTtcclxuXHJcbmV4cG9ydCBkZWZhdWx0IGRlZmluZUNvbmZpZyh7XHJcbiAgICBidWlsZDoge1xyXG4gICAgICAgIHRhcmdldDogJ2VzbmV4dCcsXHJcbiAgICAgICAgbGliOiB7XHJcbiAgICAgICAgICAgIGVudHJ5OiByZXNvbHZlKF9fZGlybmFtZSwgJ01TL0VuZ2luZXMvU3ltYm9sRW5naW5lLnRzJyksXHJcbiAgICAgICAgICAgIGZvcm1hdHM6IFsnZXMnLCAndW1kJ10sXHJcbiAgICAgICAgICAgIG5hbWU6ICdTeW1ib2xFbmdpbmUnLFxyXG4gICAgICAgICAgICBmaWxlTmFtZTogJ1N5bWJvbEVuZ2luZS51bWQnLFxyXG4gICAgICAgIH0sXHJcbiAgICAgICAgb3V0RGlyOiAnZGlzdC9NUycsXHJcbiAgICAgICAgZW1wdHlPdXREaXI6IHRydWUsXHJcbiAgICAgICAgcm9sbHVwT3B0aW9uczoge1xyXG4gICAgICAgICAgICBpbnB1dDogW1xyXG4gICAgICAgICAgICAgICAgcmVzb2x2ZShfX2Rpcm5hbWUsICdNUy9FbmdpbmVzL1N5bWJvbEVuZ2luZS50cycpLFxyXG4gICAgICAgICAgICAgICAgcmVzb2x2ZShfX2Rpcm5hbWUsICdNUy9UaGlyZFBhcnR5L01pbFN5bWJvbHMvVUVJVHlwZXMudHMnKSxcclxuICAgICAgICAgICAgXSxcclxuICAgICAgICAgICAgb3V0cHV0OiB7XHJcbiAgICAgICAgICAgICAgICBwcmVzZXJ2ZU1vZHVsZXM6IHRydWUsXHJcbiAgICAgICAgICAgICAgICBwcmVzZXJ2ZU1vZHVsZXNSb290OiAnTVMnLFxyXG4gICAgICAgICAgICAgICAgZW50cnlGaWxlTmFtZXM6ICdbbmFtZV0ubWluLmpzJyxcclxuICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgZXh0ZXJuYWw6IFtcclxuICAgICAgICAgICAgICAgIC9eQGFyY2dpc1xcLy8sXHJcbiAgICAgICAgICAgIF0sXHJcbiAgICAgICAgICAgIHBsdWdpbnM6IFtcclxuICAgICAgICAgICAgICAgIHRlcnNlcih7XHJcbiAgICAgICAgICAgICAgICAgICAgY29tcHJlc3M6IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgcGFzc2VzOiAzLCAgICAgICAgICAgICAgIC8vIE11bHRpcGxlIHBhc3NlcyBvdmVyIHRoZSBjb2RlIGZvciBkZWVwZXIgb3B0aW1pemF0aW9uXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGRyb3BfY29uc29sZTogdHJ1ZSwgICAgICAvLyBSZW1vdmUgYWxsIGNvbnNvbGUgc3RhdGVtZW50c1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBkcm9wX2RlYnVnZ2VyOiB0cnVlLCAgICAgLy8gUmVtb3ZlIGRlYnVnZ2VyIHN0YXRlbWVudHNcclxuICAgICAgICAgICAgICAgICAgICAgICAgcHVyZV9nZXR0ZXJzOiB0cnVlLCAgICAgIC8vIFRyZWF0IGdldHRlciBmdW5jdGlvbnMgYXMgcHVyZSBmb3IgYmV0dGVyIG9wdGltaXphdGlvblxyXG4gICAgICAgICAgICAgICAgICAgICAgICB1bnNhZmU6IHRydWUsICAgICAgICAgICAgLy8gRW5hYmxlIHBvdGVudGlhbGx5IHVuc2FmZSBvcHRpbWl6YXRpb25zXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHVuc2FmZV9jb21wczogdHJ1ZSwgICAgICAvLyBPcHRpbWl6ZSBjb21wYXJpc29ucyAoZS5nLiwgJ2EnID09ICdiJyBjYW4gYmUgc2ltcGxpZmllZClcclxuICAgICAgICAgICAgICAgICAgICAgICAgdW5zYWZlX21hdGg6IHRydWUsICAgICAgIC8vIFBlcmZvcm0gYWdncmVzc2l2ZSBtYXRoIG9wdGltaXphdGlvbnNcclxuICAgICAgICAgICAgICAgICAgICAgICAgdW5zYWZlX3Byb3RvOiB0cnVlLCAgICAgIC8vIE9wdGltaXplIHByb3RvdHlwZSBjaGFpbiBtYW5pcHVsYXRpb25cclxuICAgICAgICAgICAgICAgICAgICAgICAgdW5zYWZlX3JlZ2V4cDogdHJ1ZSwgICAgIC8vIEVuYWJsZSB1bnNhZmUgcmVnZXggb3B0aW1pemF0aW9uc1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBib29sZWFuczogdHJ1ZSwgICAgICAgICAgLy8gU2ltcGxpZnkgYm9vbGVhbiBleHByZXNzaW9uc1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBsb29wczogdHJ1ZSwgICAgICAgICAgICAgLy8gT3B0aW1pemUgbG9vcHMgYWdncmVzc2l2ZWx5XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGRlYWRfY29kZTogdHJ1ZSwgICAgICAgICAvLyBSZW1vdmUgZGVhZCBjb2RlIChjb2RlIHRoYXQncyBuZXZlciBleGVjdXRlZClcclxuICAgICAgICAgICAgICAgICAgICAgICAga2VlcF9mYXJnczogZmFsc2UsICAgICAgIC8vIFJlbW92ZSB1bnVzZWQgZnVuY3Rpb24gYXJndW1lbnRzXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHJlZHVjZV92YXJzOiB0cnVlLCAgICAgICAvLyBSZWR1Y2UgdmFyaWFibGUgcmVmZXJlbmNlcyAoZm9yIGJldHRlciBjb21wcmVzc2lvbilcclxuICAgICAgICAgICAgICAgICAgICAgICAgdG9wbGV2ZWw6IHRydWUgICAgICAgICAgIC8vIFBlcmZvcm0gdG9wLWxldmVsIG9wdGltaXphdGlvbnNcclxuICAgICAgICAgICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICAgICAgICAgIG1hbmdsZToge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB0b3BsZXZlbDogdHJ1ZSwgICAgICAgICAgLy8gTWFuZ2xlIHRvcC1sZXZlbCB2YXJpYWJsZSBuYW1lc1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBwcm9wZXJ0aWVzOiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICByZWdleDogL15fLyAgICAgICAgICAgIC8vIE1hbmdsZSBvYmplY3QgcHJvcGVydGllcyBzdGFydGluZyB3aXRoIFwiX1wiXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICAgICAgICAgIGZvcm1hdDoge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb21tZW50czogZmFsc2UsICAgICAgICAgLy8gUmVtb3ZlIGFsbCBjb21tZW50c1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBiZWF1dGlmeTogZmFsc2UsICAgICAgICAgLy8gRW5zdXJlIG5vIGJlYXV0aWZpY2F0aW9uIGZvciBjb21wYWN0IG91dHB1dFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBtYXhfbGluZV9sZW46IDMyMDAwLCAgICAgLy8gUHJldmVudCBsaW5lIGJyZWFraW5nXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGluZGVudF9sZXZlbDogMCAgICAgICAgICAvLyBSZW1vdmUgdW5uZWNlc3NhcnkgaW5kZW50YXRpb25cclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9KVxyXG4gICAgICAgICAgICBdLFxyXG4gICAgICAgIH0sXHJcbiAgICAgICAgbWluaWZ5OiBmYWxzZSwgLy8gaGFuZGxlZCBieSB0ZXJzZXIgcGx1Z2luIGluc3RlYWRcclxuICAgIH0sXHJcbiAgICBwbHVnaW5zOiBbXHJcbiAgICAgICAgZHRzKHtcclxuICAgICAgICAgICAgZW50cnlSb290OiAnTVMnLFxyXG4gICAgICAgICAgICBvdXREaXI6ICdkaXN0L01TJyxcclxuICAgICAgICAgICAgdHNjb25maWdQYXRoOiAndHNjb25maWcuYnVpbGQuanNvbicsXHJcbiAgICAgICAgfSksXHJcbiAgICBdLFxyXG59KTtcclxuXHJcblxyXG4iXSwKICAibWFwcGluZ3MiOiAiO0FBQXlQLFNBQVMscUJBQXFCO0FBQ3ZSLFNBQVMsU0FBUyxlQUFlO0FBQ2pDLFNBQVMsb0JBQW9CO0FBQzdCLE9BQU8sU0FBUztBQUNoQixPQUFPLFlBQVk7QUFKc0ksSUFBTSwyQ0FBMkM7QUFNMU0sSUFBTSxhQUFhLGNBQWMsd0NBQWU7QUFDaEQsSUFBTSxZQUFZLFFBQVEsVUFBVTtBQUVwQyxJQUFPLHNCQUFRLGFBQWE7QUFBQSxFQUN4QixPQUFPO0FBQUEsSUFDSCxRQUFRO0FBQUEsSUFDUixLQUFLO0FBQUEsTUFDRCxPQUFPLFFBQVEsV0FBVyw0QkFBNEI7QUFBQSxNQUN0RCxTQUFTLENBQUMsTUFBTSxLQUFLO0FBQUEsTUFDckIsTUFBTTtBQUFBLE1BQ04sVUFBVTtBQUFBLElBQ2Q7QUFBQSxJQUNBLFFBQVE7QUFBQSxJQUNSLGFBQWE7QUFBQSxJQUNiLGVBQWU7QUFBQSxNQUNYLE9BQU87QUFBQSxRQUNILFFBQVEsV0FBVyw0QkFBNEI7QUFBQSxRQUMvQyxRQUFRLFdBQVcsc0NBQXNDO0FBQUEsTUFDN0Q7QUFBQSxNQUNBLFFBQVE7QUFBQSxRQUNKLGlCQUFpQjtBQUFBLFFBQ2pCLHFCQUFxQjtBQUFBLFFBQ3JCLGdCQUFnQjtBQUFBLE1BQ3BCO0FBQUEsTUFDQSxVQUFVO0FBQUEsUUFDTjtBQUFBLE1BQ0o7QUFBQSxNQUNBLFNBQVM7QUFBQSxRQUNMLE9BQU87QUFBQSxVQUNILFVBQVU7QUFBQSxZQUNOLFFBQVE7QUFBQTtBQUFBLFlBQ1IsY0FBYztBQUFBO0FBQUEsWUFDZCxlQUFlO0FBQUE7QUFBQSxZQUNmLGNBQWM7QUFBQTtBQUFBLFlBQ2QsUUFBUTtBQUFBO0FBQUEsWUFDUixjQUFjO0FBQUE7QUFBQSxZQUNkLGFBQWE7QUFBQTtBQUFBLFlBQ2IsY0FBYztBQUFBO0FBQUEsWUFDZCxlQUFlO0FBQUE7QUFBQSxZQUNmLFVBQVU7QUFBQTtBQUFBLFlBQ1YsT0FBTztBQUFBO0FBQUEsWUFDUCxXQUFXO0FBQUE7QUFBQSxZQUNYLFlBQVk7QUFBQTtBQUFBLFlBQ1osYUFBYTtBQUFBO0FBQUEsWUFDYixVQUFVO0FBQUE7QUFBQSxVQUNkO0FBQUEsVUFDQSxRQUFRO0FBQUEsWUFDSixVQUFVO0FBQUE7QUFBQSxZQUNWLFlBQVk7QUFBQSxjQUNSLE9BQU87QUFBQTtBQUFBLFlBQ1g7QUFBQSxVQUNKO0FBQUEsVUFDQSxRQUFRO0FBQUEsWUFDSixVQUFVO0FBQUE7QUFBQSxZQUNWLFVBQVU7QUFBQTtBQUFBLFlBQ1YsY0FBYztBQUFBO0FBQUEsWUFDZCxjQUFjO0FBQUE7QUFBQSxVQUNsQjtBQUFBLFFBQ0osQ0FBQztBQUFBLE1BQ0w7QUFBQSxJQUNKO0FBQUEsSUFDQSxRQUFRO0FBQUE7QUFBQSxFQUNaO0FBQUEsRUFDQSxTQUFTO0FBQUEsSUFDTCxJQUFJO0FBQUEsTUFDQSxXQUFXO0FBQUEsTUFDWCxRQUFRO0FBQUEsTUFDUixjQUFjO0FBQUEsSUFDbEIsQ0FBQztBQUFBLEVBQ0w7QUFDSixDQUFDOyIsCiAgIm5hbWVzIjogW10KfQo=
