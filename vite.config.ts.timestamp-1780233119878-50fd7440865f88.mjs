// vite.config.ts
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { defineConfig } from "file:///D:/Projects/PAMS8/node_modules/vite/dist/node/index.js";
import dts from "file:///D:/Projects/PAMS8/node_modules/vite-plugin-dts/dist/index.mjs";
import terser from "file:///D:/Projects/PAMS8/node_modules/@rollup/plugin-terser/dist/es/index.js";
var __vite_injected_original_import_meta_url = "file:///D:/Projects/PAMS8/vite.config.ts";
var __filename = fileURLToPath(__vite_injected_original_import_meta_url);
var __dirname = dirname(__filename);
var vite_config_default = defineConfig({
  build: {
    target: "esnext",
    lib: {
      entry: resolve(__dirname, "MS/Engines/SymbolEngine.ts"),
      formats: ["es"]
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
  server: {
    host: "0.0.0.0",
    port: 6547,
    proxy: {
      "/roadnet": {
        target: "http://localhost:8080",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/roadnet/, "")
      }
    }
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCJEOlxcXFxQcm9qZWN0c1xcXFxQQU1TOFwiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9maWxlbmFtZSA9IFwiRDpcXFxcUHJvamVjdHNcXFxcUEFNUzhcXFxcdml0ZS5jb25maWcudHNcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfaW1wb3J0X21ldGFfdXJsID0gXCJmaWxlOi8vL0Q6L1Byb2plY3RzL1BBTVM4L3ZpdGUuY29uZmlnLnRzXCI7aW1wb3J0IHsgZmlsZVVSTFRvUGF0aCB9IGZyb20gJ3VybCc7XHJcbmltcG9ydCB7IGRpcm5hbWUsIHJlc29sdmUgfSBmcm9tICdwYXRoJztcclxuaW1wb3J0IHsgZGVmaW5lQ29uZmlnIH0gZnJvbSAndml0ZSc7XHJcbmltcG9ydCBkdHMgZnJvbSAndml0ZS1wbHVnaW4tZHRzJztcclxuaW1wb3J0IHRlcnNlciBmcm9tICdAcm9sbHVwL3BsdWdpbi10ZXJzZXInO1xyXG5cclxuY29uc3QgX19maWxlbmFtZSA9IGZpbGVVUkxUb1BhdGgoaW1wb3J0Lm1ldGEudXJsKTtcclxuY29uc3QgX19kaXJuYW1lID0gZGlybmFtZShfX2ZpbGVuYW1lKTtcclxuXHJcbmV4cG9ydCBkZWZhdWx0IGRlZmluZUNvbmZpZyh7XHJcbiAgICBidWlsZDoge1xyXG4gICAgICAgIHRhcmdldDogJ2VzbmV4dCcsXHJcbiAgICAgICAgbGliOiB7XHJcbiAgICAgICAgICAgIGVudHJ5OiByZXNvbHZlKF9fZGlybmFtZSwgJ01TL0VuZ2luZXMvU3ltYm9sRW5naW5lLnRzJyksXHJcbiAgICAgICAgICAgIGZvcm1hdHM6IFsnZXMnXSxcclxuICAgICAgICB9LFxyXG4gICAgICAgIG91dERpcjogJ2Rpc3QvTVMnLFxyXG4gICAgICAgIGVtcHR5T3V0RGlyOiB0cnVlLFxyXG4gICAgICAgIHJvbGx1cE9wdGlvbnM6IHtcclxuICAgICAgICAgICAgaW5wdXQ6IFtcclxuICAgICAgICAgICAgICAgIHJlc29sdmUoX19kaXJuYW1lLCAnTVMvRW5naW5lcy9TeW1ib2xFbmdpbmUudHMnKSxcclxuICAgICAgICAgICAgICAgIHJlc29sdmUoX19kaXJuYW1lLCAnTVMvVGhpcmRQYXJ0eS9NaWxTeW1ib2xzL1VFSVR5cGVzLnRzJyksXHJcbiAgICAgICAgICAgIF0sXHJcbiAgICAgICAgICAgIG91dHB1dDoge1xyXG4gICAgICAgICAgICAgICAgcHJlc2VydmVNb2R1bGVzOiB0cnVlLFxyXG4gICAgICAgICAgICAgICAgcHJlc2VydmVNb2R1bGVzUm9vdDogJ01TJyxcclxuICAgICAgICAgICAgICAgIGVudHJ5RmlsZU5hbWVzOiAnW25hbWVdLm1pbi5qcycsXHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgIGV4dGVybmFsOiBbXHJcbiAgICAgICAgICAgICAgICAvXkBhcmNnaXNcXC8vLFxyXG4gICAgICAgICAgICBdLFxyXG4gICAgICAgICAgICBwbHVnaW5zOiBbXHJcbiAgICAgICAgICAgICAgICB0ZXJzZXIoe1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbXByZXNzOiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHBhc3NlczogMywgICAgICAgICAgICAgICAvLyBNdWx0aXBsZSBwYXNzZXMgb3ZlciB0aGUgY29kZSBmb3IgZGVlcGVyIG9wdGltaXphdGlvblxyXG4gICAgICAgICAgICAgICAgICAgICAgICBkcm9wX2NvbnNvbGU6IHRydWUsICAgICAgLy8gUmVtb3ZlIGFsbCBjb25zb2xlIHN0YXRlbWVudHNcclxuICAgICAgICAgICAgICAgICAgICAgICAgZHJvcF9kZWJ1Z2dlcjogdHJ1ZSwgICAgIC8vIFJlbW92ZSBkZWJ1Z2dlciBzdGF0ZW1lbnRzXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHB1cmVfZ2V0dGVyczogdHJ1ZSwgICAgICAvLyBUcmVhdCBnZXR0ZXIgZnVuY3Rpb25zIGFzIHB1cmUgZm9yIGJldHRlciBvcHRpbWl6YXRpb25cclxuICAgICAgICAgICAgICAgICAgICAgICAgdW5zYWZlOiB0cnVlLCAgICAgICAgICAgIC8vIEVuYWJsZSBwb3RlbnRpYWxseSB1bnNhZmUgb3B0aW1pemF0aW9uc1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB1bnNhZmVfY29tcHM6IHRydWUsICAgICAgLy8gT3B0aW1pemUgY29tcGFyaXNvbnMgKGUuZy4sICdhJyA9PSAnYicgY2FuIGJlIHNpbXBsaWZpZWQpXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHVuc2FmZV9tYXRoOiB0cnVlLCAgICAgICAvLyBQZXJmb3JtIGFnZ3Jlc3NpdmUgbWF0aCBvcHRpbWl6YXRpb25zXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHVuc2FmZV9wcm90bzogdHJ1ZSwgICAgICAvLyBPcHRpbWl6ZSBwcm90b3R5cGUgY2hhaW4gbWFuaXB1bGF0aW9uXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHVuc2FmZV9yZWdleHA6IHRydWUsICAgICAvLyBFbmFibGUgdW5zYWZlIHJlZ2V4IG9wdGltaXphdGlvbnNcclxuICAgICAgICAgICAgICAgICAgICAgICAgYm9vbGVhbnM6IHRydWUsICAgICAgICAgIC8vIFNpbXBsaWZ5IGJvb2xlYW4gZXhwcmVzc2lvbnNcclxuICAgICAgICAgICAgICAgICAgICAgICAgbG9vcHM6IHRydWUsICAgICAgICAgICAgIC8vIE9wdGltaXplIGxvb3BzIGFnZ3Jlc3NpdmVseVxyXG4gICAgICAgICAgICAgICAgICAgICAgICBkZWFkX2NvZGU6IHRydWUsICAgICAgICAgLy8gUmVtb3ZlIGRlYWQgY29kZSAoY29kZSB0aGF0J3MgbmV2ZXIgZXhlY3V0ZWQpXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGtlZXBfZmFyZ3M6IGZhbHNlLCAgICAgICAvLyBSZW1vdmUgdW51c2VkIGZ1bmN0aW9uIGFyZ3VtZW50c1xyXG4gICAgICAgICAgICAgICAgICAgICAgICByZWR1Y2VfdmFyczogdHJ1ZSwgICAgICAgLy8gUmVkdWNlIHZhcmlhYmxlIHJlZmVyZW5jZXMgKGZvciBiZXR0ZXIgY29tcHJlc3Npb24pXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHRvcGxldmVsOiB0cnVlICAgICAgICAgICAvLyBQZXJmb3JtIHRvcC1sZXZlbCBvcHRpbWl6YXRpb25zXHJcbiAgICAgICAgICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgICAgICAgICBtYW5nbGU6IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgdG9wbGV2ZWw6IHRydWUsICAgICAgICAgIC8vIE1hbmdsZSB0b3AtbGV2ZWwgdmFyaWFibGUgbmFtZXNcclxuICAgICAgICAgICAgICAgICAgICAgICAgcHJvcGVydGllczoge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcmVnZXg6IC9eXy8gICAgICAgICAgICAvLyBNYW5nbGUgb2JqZWN0IHByb3BlcnRpZXMgc3RhcnRpbmcgd2l0aCBcIl9cIlxyXG4gICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgICAgICAgICBmb3JtYXQ6IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29tbWVudHM6IGZhbHNlLCAgICAgICAgIC8vIFJlbW92ZSBhbGwgY29tbWVudHNcclxuICAgICAgICAgICAgICAgICAgICAgICAgYmVhdXRpZnk6IGZhbHNlLCAgICAgICAgIC8vIEVuc3VyZSBubyBiZWF1dGlmaWNhdGlvbiBmb3IgY29tcGFjdCBvdXRwdXRcclxuICAgICAgICAgICAgICAgICAgICAgICAgbWF4X2xpbmVfbGVuOiAzMjAwMCwgICAgIC8vIFByZXZlbnQgbGluZSBicmVha2luZ1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBpbmRlbnRfbGV2ZWw6IDAgICAgICAgICAgLy8gUmVtb3ZlIHVubmVjZXNzYXJ5IGluZGVudGF0aW9uXHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfSlcclxuICAgICAgICAgICAgXSxcclxuICAgICAgICB9LFxyXG4gICAgICAgIG1pbmlmeTogZmFsc2UsIC8vIGhhbmRsZWQgYnkgdGVyc2VyIHBsdWdpbiBpbnN0ZWFkXHJcbiAgICB9LFxyXG4gICAgc2VydmVyOiB7XHJcbiAgICAgICAgaG9zdDogXCIwLjAuMC4wXCIsXHJcbiAgICAgICAgcG9ydDogNjU0NyxcclxuICAgICAgICBwcm94eToge1xyXG4gICAgICAgICAgICAnL3JvYWRuZXQnOiB7XHJcbiAgICAgICAgICAgICAgICB0YXJnZXQ6ICdodHRwOi8vbG9jYWxob3N0OjgwODAnLFxyXG4gICAgICAgICAgICAgICAgY2hhbmdlT3JpZ2luOiB0cnVlLFxyXG4gICAgICAgICAgICAgICAgcmV3cml0ZTogKHApID0+IHAucmVwbGFjZSgvXlxcL3JvYWRuZXQvLCAnJyksXHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgfSxcclxuICAgIH0sXHJcbiAgICBwbHVnaW5zOiBbXHJcbiAgICAgICAgZHRzKHtcclxuICAgICAgICAgICAgZW50cnlSb290OiAnTVMnLFxyXG4gICAgICAgICAgICBvdXREaXI6ICdkaXN0L01TJyxcclxuICAgICAgICAgICAgdHNjb25maWdQYXRoOiAndHNjb25maWcuYnVpbGQuanNvbicsXHJcbiAgICAgICAgfSksXHJcbiAgICBdLFxyXG59KTtcclxuXHJcblxyXG4iXSwKICAibWFwcGluZ3MiOiAiO0FBQTJPLFNBQVMscUJBQXFCO0FBQ3pRLFNBQVMsU0FBUyxlQUFlO0FBQ2pDLFNBQVMsb0JBQW9CO0FBQzdCLE9BQU8sU0FBUztBQUNoQixPQUFPLFlBQVk7QUFKNEgsSUFBTSwyQ0FBMkM7QUFNaE0sSUFBTSxhQUFhLGNBQWMsd0NBQWU7QUFDaEQsSUFBTSxZQUFZLFFBQVEsVUFBVTtBQUVwQyxJQUFPLHNCQUFRLGFBQWE7QUFBQSxFQUN4QixPQUFPO0FBQUEsSUFDSCxRQUFRO0FBQUEsSUFDUixLQUFLO0FBQUEsTUFDRCxPQUFPLFFBQVEsV0FBVyw0QkFBNEI7QUFBQSxNQUN0RCxTQUFTLENBQUMsSUFBSTtBQUFBLElBQ2xCO0FBQUEsSUFDQSxRQUFRO0FBQUEsSUFDUixhQUFhO0FBQUEsSUFDYixlQUFlO0FBQUEsTUFDWCxPQUFPO0FBQUEsUUFDSCxRQUFRLFdBQVcsNEJBQTRCO0FBQUEsUUFDL0MsUUFBUSxXQUFXLHNDQUFzQztBQUFBLE1BQzdEO0FBQUEsTUFDQSxRQUFRO0FBQUEsUUFDSixpQkFBaUI7QUFBQSxRQUNqQixxQkFBcUI7QUFBQSxRQUNyQixnQkFBZ0I7QUFBQSxNQUNwQjtBQUFBLE1BQ0EsVUFBVTtBQUFBLFFBQ047QUFBQSxNQUNKO0FBQUEsTUFDQSxTQUFTO0FBQUEsUUFDTCxPQUFPO0FBQUEsVUFDSCxVQUFVO0FBQUEsWUFDTixRQUFRO0FBQUE7QUFBQSxZQUNSLGNBQWM7QUFBQTtBQUFBLFlBQ2QsZUFBZTtBQUFBO0FBQUEsWUFDZixjQUFjO0FBQUE7QUFBQSxZQUNkLFFBQVE7QUFBQTtBQUFBLFlBQ1IsY0FBYztBQUFBO0FBQUEsWUFDZCxhQUFhO0FBQUE7QUFBQSxZQUNiLGNBQWM7QUFBQTtBQUFBLFlBQ2QsZUFBZTtBQUFBO0FBQUEsWUFDZixVQUFVO0FBQUE7QUFBQSxZQUNWLE9BQU87QUFBQTtBQUFBLFlBQ1AsV0FBVztBQUFBO0FBQUEsWUFDWCxZQUFZO0FBQUE7QUFBQSxZQUNaLGFBQWE7QUFBQTtBQUFBLFlBQ2IsVUFBVTtBQUFBO0FBQUEsVUFDZDtBQUFBLFVBQ0EsUUFBUTtBQUFBLFlBQ0osVUFBVTtBQUFBO0FBQUEsWUFDVixZQUFZO0FBQUEsY0FDUixPQUFPO0FBQUE7QUFBQSxZQUNYO0FBQUEsVUFDSjtBQUFBLFVBQ0EsUUFBUTtBQUFBLFlBQ0osVUFBVTtBQUFBO0FBQUEsWUFDVixVQUFVO0FBQUE7QUFBQSxZQUNWLGNBQWM7QUFBQTtBQUFBLFlBQ2QsY0FBYztBQUFBO0FBQUEsVUFDbEI7QUFBQSxRQUNKLENBQUM7QUFBQSxNQUNMO0FBQUEsSUFDSjtBQUFBLElBQ0EsUUFBUTtBQUFBO0FBQUEsRUFDWjtBQUFBLEVBQ0EsUUFBUTtBQUFBLElBQ0osTUFBTTtBQUFBLElBQ04sTUFBTTtBQUFBLElBQ04sT0FBTztBQUFBLE1BQ0gsWUFBWTtBQUFBLFFBQ1IsUUFBUTtBQUFBLFFBQ1IsY0FBYztBQUFBLFFBQ2QsU0FBUyxDQUFDLE1BQU0sRUFBRSxRQUFRLGNBQWMsRUFBRTtBQUFBLE1BQzlDO0FBQUEsSUFDSjtBQUFBLEVBQ0o7QUFBQSxFQUNBLFNBQVM7QUFBQSxJQUNMLElBQUk7QUFBQSxNQUNBLFdBQVc7QUFBQSxNQUNYLFFBQVE7QUFBQSxNQUNSLGNBQWM7QUFBQSxJQUNsQixDQUFDO0FBQUEsRUFDTDtBQUNKLENBQUM7IiwKICAibmFtZXMiOiBbXQp9Cg==
