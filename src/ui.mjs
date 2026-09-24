// Terminal presentation: manual ANSI colors (no dependency) plus a couple of
// small formatting helpers for the boot banner. Colors auto-disable for
// non-TTY output and when NO_COLOR is set. Mirrors portkill's ui.mjs.

/** Build a set of style functions. When `enabled` is false they are no-ops. */
export function makeStyler(enabled) {
  const wrap = (open, close) => (s) => (enabled ? `\x1b[${open}m${s}\x1b[${close}m` : String(s));
  return {
    enabled,
    red: wrap(31, 39),
    green: wrap(32, 39),
    yellow: wrap(33, 39),
    cyan: wrap(36, 39),
    magenta: wrap(35, 39),
    dim: wrap(2, 22),
    bold: wrap(1, 22),
  };
}

/** Decide whether to emit colors. Honors NO_COLOR and FORCE_COLOR conventions. */
export function colorEnabled(env = process.env, stream = process.stdout) {
  if (env.NO_COLOR != null) return false;
  if (env.FORCE_COLOR != null) return true;
  return Boolean(stream && stream.isTTY);
}

/**
 * Render the REST route table shown on boot, e.g.
 *   GET|POST              /posts
 *   GET|PUT|PATCH|DELETE  /posts/:id
 * @param {string[]} collections
 * @param {ReturnType<typeof makeStyler>} [c]
 */
export function formatRoutes(collections, c = makeStyler(false)) {
  if (!collections || collections.length === 0) return '';
  const rows = [];
  for (const name of collections) {
    rows.push(['GET|POST', `/${name}`]);
    rows.push(['GET|PUT|PATCH|DELETE', `/${name}/:id`]);
  }
  const width = Math.max(...rows.map((r) => r[0].length));
  return rows
    .map(([methods, path]) => `  ${c.cyan(methods.padEnd(width))}  ${c.bold(path)}`)
    .join('\n');
}
