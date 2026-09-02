/*
 * Module hooks that let Node's built-in test runner load this codebase unmodified.
 *
 * Two things in `src/` are legal for Astro and Vite but not for plain Node ESM, and both
 * would otherwise force a choice between "no tests" and "rewrite every import in the app to
 * suit the test runner". The app wins that argument, so the adaptation lives here.
 *
 *   1. EXTENSIONLESS RELATIVE IMPORTS — `from '../webmaster/webmaster'`. Node ESM requires the
 *      extension; bundlers resolve it. The resolve hook appends `.ts` when the bare specifier
 *      does not resolve but the `.ts` file exists.
 *
 *   2. JSON IMPORTED WITHOUT AN ATTRIBUTE — `import site from '../../webmonterey.json'`.
 *      Node needs `with { type: 'json' }`; adding that to the source would be noise for a
 *      requirement no other toolchain in this project has. The load hook serves the file as
 *      an ES module with a default export instead.
 *
 *   3. TYPESCRIPT UNDER node_modules. The framework package ships .ts source, and Node REFUSES
 *      to strip types from anything under node_modules - ERR_UNSUPPORTED_NODE_MODULES_TYPE_
 *      STRIPPING, with no flag to change it. So a site test that imports a package module dies
 *      before it runs, and every test in that FILE dies with it, which reads as the test being
 *      broken rather than the loader. The load hook strips the types itself with
 *      `stripTypeScriptTypes`, which has no such restriction.
 *
 * `registerHooks`, NOT `register`: the older `register()` is deprecated, and it also runs
 * hooks on a separate thread, which this does not need. These are synchronous and in-process.
 *
 * Dependency-free and test-only — loaded via `--import` from the `test` script and nowhere
 * else. Nothing here runs in a build or in a Worker.
 */
import { readFileSync, existsSync } from 'node:fs';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { fileURLToPath } from 'node:url';

registerHooks({
  resolve(specifier, context, nextResolve) {
    const relative = specifier.startsWith('./') || specifier.startsWith('../');
    const hasExtension = /\.[a-z0-9]+$/i.test(specifier);

    if (relative && !hasExtension && context.parentURL) {
      const candidate = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(fileURLToPath(candidate))) {
        /*
         * No `format` here. Setting it to 'module' would tell Node the file is plain
         * JavaScript and skip its built-in type stripping, so the first `export type` in the
         * target is a SyntaxError. Leaving it unset lets Node infer TypeScript from the
         * extension.
         */
        return { url: candidate.href, shortCircuit: true };
      }
    }

    return nextResolve(specifier, context);
  },

  load(url, context, nextLoad) {
    if (url.endsWith('.json')) {
      /*
       * Parse then re-serialize, rather than inlining the raw text: the file is embedded into
       * a module body here, and a lone `</script>` or an unescaped line separator in it would
       * otherwise be a syntax error in the generated source.
       */
      const raw = readFileSync(fileURLToPath(url), 'utf8');
      return {
        format: 'module',
        shortCircuit: true,
        source: `export default ${JSON.stringify(JSON.parse(raw))};`,
      };
    }

    return nextLoad(url, context);
  },
});

/*
 * TypeScript under node_modules. Node's own stripper refuses these; this one does not.
 *
 * STRIPPED UNCONDITIONALLY, not as a fallback. The obvious shape is to call nextLoad and catch
 * ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING - and it never fires, because the throw happens
 * during TRANSLATION, after the load hook has already returned its result. There is nothing to
 * catch at the point you can catch it.
 *
 * Narrow on purpose: only .ts, only under node_modules. A site's own .ts is handled by Node
 * directly and is not touched here.
 */
registerHooks({
  load(url, context, nextLoad) {
    if (!url.endsWith('.ts') || !url.includes('/node_modules/')) return nextLoad(url, context);

    const source = readFileSync(fileURLToPath(url), 'utf8');
    return {
      format: 'module',
      shortCircuit: true,
      source: stripTypeScriptTypes(source, { mode: 'strip', sourceUrl: url }),
    };
  },
});
