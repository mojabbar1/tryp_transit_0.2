/**
 * TEST-ONLY offline answer for the one Google Fonts stylesheet the app requests (app/layout.tsx: Poppins, weights 500
 * and 900, the default `display: swap`), used by `npm run test:integration` and nothing else.
 *
 * The harness points Next's own test hook, NEXT_FONT_GOOGLE_MOCKED_RESPONSES, at this file in the environment of the
 * `next build` it starts (never in .env, next.config or `npm run build`). With it, next/font/google reads the
 * stylesheet below instead of requesting fonts.googleapis.com, so the build makes no network request.
 *
 * The faces name the font with `local()` only: there is no `src: url(...)`, so Next has no font file to download and
 * none is copied or committed (no third-party font binary here). The HTTP checks therefore validate routes, data and
 * citations, not typography: the test build renders Poppins only if it happens to be installed locally, otherwise the
 * fallback font Next generates. Production builds are unaffected and still fetch the real stylesheet and font files.
 *
 * Keyed by the exact URL Next computes; if the layout's font call changes, the build fails with "url not found" (or
 * "Missing mocked response") until this key is updated, so a stale fixture can't pass silently.
 */
module.exports = {
  'https://fonts.googleapis.com/css2?family=Poppins:wght@500;900&display=swap': `/* latin */
@font-face {
  font-family: 'Poppins';
  font-style: normal;
  font-weight: 500;
  font-display: swap;
  src: local('Poppins Medium'), local('Poppins-Medium');
}
/* latin */
@font-face {
  font-family: 'Poppins';
  font-style: normal;
  font-weight: 900;
  font-display: swap;
  src: local('Poppins Black'), local('Poppins-Black');
}
`,
};
