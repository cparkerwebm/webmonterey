/*
 * Bundle the CLI to plain JS.
 *
 * WHY THIS EXISTS: Node refuses to strip TypeScript types for any file under node_modules -
 *
 *   "Stripping types is currently unsupported for files under node_modules"
 *
 * The library does not care: Astro and Vite compile .ts themselves, so src/ ships as source and a
 * client site's build handles it. But the `webm` CLI runs in plain Node, from inside the installed
 * package, which is exactly the case Node refuses.
 *
 * THIS IS INVISIBLE DURING DEVELOPMENT. A `file:` dependency resolves through a SYMLINK, so the
 * real path is not under node_modules and stripping works - which is why examples/minimal built
 * happily while a real tarball install did not. Test the CLI against a packed tarball, not a link.
 *
 * One bundled file rather than a compiled tree: the bin then has no import resolution to get
 * wrong, and nothing at runtime depends on how the package was installed.
 */
import { build } from 'esbuild';

const result = await build({
  entryPoints: ['bin/webm.mjs'],
  outfile: 'dist/webm.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22.18',
  packages: 'bundle',
  // No banner: bin/webm.mjs already carries the shebang and esbuild preserves it.
  logLevel: 'warning',
  metafile: true,
});

const [out] = Object.values(result.metafile.outputs);
console.log(`dist/webm.mjs  ${(out.bytes / 1024).toFixed(1)}kb`);
