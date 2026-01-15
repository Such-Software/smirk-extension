import { defineConfig } from 'vite';
import { resolve } from 'path';
import { copyFileSync, mkdirSync, readdirSync, statSync } from 'fs';

function copyDirRecursive(src: string, dest: string) {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src)) {
    const srcPath = `${src}/${entry}`;
    const destPath = `${dest}/${entry}`;
    if (statSync(srcPath).isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      copyFileSync(srcPath, destPath);
    }
  }
}

function copyStaticAssets() {
  return {
    name: 'copy-static-assets',
    writeBundle() {
      // Copy manifest.json
      copyFileSync('manifest.json', 'dist/manifest.json');

      // Copy icons (recursively to handle subdirs like coins/)
      copyDirRecursive('icons', 'dist/icons');

      // Copy smirk-wasm files
      mkdirSync('dist/wasm', { recursive: true });
      const wasmPkgDir = '../smirk-wasm/pkg';
      try {
        copyFileSync(`${wasmPkgDir}/smirk_wasm.js`, 'dist/wasm/smirk_wasm.js');
        copyFileSync(`${wasmPkgDir}/smirk_wasm_bg.wasm`, 'dist/wasm/smirk_wasm_bg.wasm');
      } catch (e) {
        console.warn('Warning: Could not copy smirk-wasm files. Build smirk-wasm first.');
      }

      // Copy Grin WASM and JS files
      mkdirSync('dist/src/lib/grin', { recursive: true });
      const grinDir = 'src/lib/grin';
      try {
        for (const file of readdirSync(grinDir)) {
          if (file.endsWith('.wasm') || file.endsWith('.js')) {
            copyFileSync(`${grinDir}/${file}`, `dist/src/lib/grin/${file}`);
          }
        }
      } catch (e) {
        console.warn('Warning: Could not copy Grin files.', e);
      }
    },
  };
}

export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'popup.html'),
        background: resolve(__dirname, 'src/background/index.ts'),
        content: resolve(__dirname, 'src/content/index.ts'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  plugins: [copyStaticAssets()],
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'preact',
  },
});
