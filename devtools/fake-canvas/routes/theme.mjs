/**
 * School theme (HTML-8), owned by the theme-injection workstream.
 *
 * - `GET /api/v1/brand_variables` (brand_configs_api_controller.rb#show) needs no token and
 *   redirects to the account's static brand JSON (`BrandConfig#public_json_path`,
 *   `dist/brandable_css/<md5>/variables-<defaults md5>.json`). The JSON is
 *   BrandableCSS.all_brand_variable_values: the computed darkened and lightened colors
 *   first, then every brandable variable with its explicit value or its default.
 * - The mobile theme files are public-read uploads (brand_configs_controller.rb#upload_file
 *   stores `attachment.s3_url`). `/fake-s3/...` stands in for that bucket.
 * - Canvas puts the files into API HTML itself (Api::Html::Content.add_overrides_to_html):
 *   `withMobileOverrides(html)` below does the same, for routes that serve HTML through
 *   `api_user_content`.
 *
 * The test theme is easy to spot in light mode: blue h2 and h3, blockquotes as blue
 * callouts, and a rule under each heading that only appears when the JS ran. The "guard
 * checks" try what Easel must refuse; none of them should change anything.
 */
import { BASE } from '../data.mjs';

// Fake md5s: a new theme upload makes a new BrandConfig, and with it a new URL.
const BRAND_MD5 = 'e2a8f4b6c1d3e5f7a9b0c2d4e6f8a1b3';
const DEFAULTS_MD5 = '7c9e1f3a5b7d9f1e3c5a7b9d1f3e5a7c';

const files = {
  9901: {
    name: 'easel-test-mobile.css',
    type: 'text/css',
    body: `/* Fake school mobile theme (Theme Editor, "Mobile CSS file"). */
h2, h3 { color: #1D58A7; }
.school-heading { padding-bottom: 0.2em; border-bottom: 2px solid #1D58A7; }
blockquote, .school-callout {
  margin: 0 0 1em; padding: 0.75em 1em; border: 0; border-inline-start: 4px solid #1D58A7;
  border-radius: 6px; background: #EAF2FB; color: #12345A; font-style: normal;
}

/* Guard checks: Easel keeps its body type, links, page, and layout. */
body { font-size: 11px !important; background: #FFFFFF !important; }
a { color: #FF00FF !important; }
.school-banner { position: fixed; top: 0; left: 0; right: 0; }
`,
  },
  9902: {
    name: 'easel-test-mobile.js',
    type: 'application/javascript',
    body: `/* Fake school mobile theme (Theme Editor, "Mobile JavaScript file"). */
document.querySelectorAll('h2, h3').forEach(function (h) { h.classList.add('school-heading'); });

/* Guard checks: Easel blocks network calls and keeps its bridge. The server logs any beacon that gets through. */
try { navigator.sendBeacon('${BASE}/fake-s3/beacon', 'sendBeacon'); } catch (e) {}
try { fetch('${BASE}/fake-s3/beacon?via=fetch').catch(function () {}); } catch (e) {}
try { window.easelPostHeight = function () {}; } catch (e) {}
try { window.ReactNativeWebView.postMessage = function () {}; } catch (e) {}
try { window.ReactNativeWebView = { postMessage: function () {} }; } catch (e) {}
`,
  },
  9903: {
    name: 'logo.svg',
    type: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 32"><rect width="96" height="32" rx="6" fill="#13294B"/><text x="48" y="21" font-family="sans-serif" font-size="14" font-weight="700" fill="#FFFFFF" text-anchor="middle">FAKE U</text></svg>',
  },
};

const fileUrl = (id) => `${BASE}/fake-s3/account_1/attachments/${id}/${files[id].name}`;

/** What `BrandConfig#mobile_css_overrides` and `mobile_js_overrides` resolve to, root account first. */
export const mobileOverrides = { mobile_css_overrides: [fileUrl(9901)], mobile_js_overrides: [fileUrl(9902)] };

/**
 * Api::Html::Content.add_overrides_to_html: a stylesheet link per CSS file at the start, a
 * script per JS file at the end, serialized the way Nokogiri::HTML5 does (`&` as `&amp;`).
 * Canvas does this for token requests (not `in_app?`) whenever the account has a brand config.
 */
export function withMobileOverrides(html) {
  if (!html || process.env.FAKE_CANVAS_THEME === '0') return html;
  const attr = (url) => url.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  const links = mobileOverrides.mobile_css_overrides.map((u) => `<link rel="stylesheet" href="${attr(u)}">`);
  const scripts = mobileOverrides.mobile_js_overrides.map((u) => `<script src="${attr(u)}"></script>`);
  return `${links.join('')}${html}${scripts.join('')}`;
}

/** The school's explicit Theme Editor values. Everything else falls back to the defaults. */
const explicit = {
  'ic-brand-primary': '#1D58A7',
  'ic-link-color': '#1D58A7',
  'ic-brand-global-nav-bgd': '#13294B',
  'ic-brand-global-nav-logo-bgd': '#13294B',
  'ic-brand-header-image': fileUrl(9903),
  'ic-brand-mobile-global-nav-logo': fileUrl(9903),
};

/** app/stylesheets/brandable_variables.json, in order: [name, type, default]. */
const VARIABLES = [
  ['ic-brand-primary', 'color', '#2B7ABC'],
  ['ic-brand-font-color-dark', 'color', '#273540'],
  ['ic-link-color', 'color', '#0E68B3'],
  ['ic-brand-button--primary-bgd', 'color', '$ic-brand-primary'],
  ['ic-brand-button--primary-text', 'color', '#ffffff'],
  ['ic-brand-button--secondary-bgd', 'color', '#273540'],
  ['ic-brand-button--secondary-text', 'color', '#ffffff'],
  ['ic-brand-global-nav-bgd', 'color', '#334451'],
  ['ic-brand-global-nav-ic-icon-svg-fill', 'color', '#ffffff'],
  ['ic-brand-global-nav-ic-icon-svg-fill--active', 'color', '$ic-brand-primary'],
  ['ic-brand-global-nav-menu-item__text-color', 'color', '#ffffff'],
  ['ic-brand-global-nav-menu-item__text-color--active', 'color', '$ic-link-color'],
  ['ic-brand-global-nav-avatar-border', 'color', '#ffffff'],
  ['ic-brand-global-nav-menu-item__badge-bgd', 'color', '#ffffff'],
  ['ic-brand-global-nav-menu-item__badge-bgd--active', 'color', '$ic-brand-primary'],
  ['ic-brand-global-nav-menu-item__badge-text', 'color', '#000000'],
  ['ic-brand-global-nav-menu-item__badge-text--active', 'color', '#ffffff'],
  ['ic-brand-global-nav-logo-bgd', 'color', '#334451'],
  ['ic-brand-header-image', 'image', '/images/canvas_logomark_only@2x.png'],
  ['ic-brand-mobile-global-nav-logo', 'image', '/images/mobile-global-nav-logo.svg'],
  ['ic-brand-watermark', 'image', ''],
  ['ic-brand-watermark-opacity', 'percentage', '1.0'],
  ['ic-brand-favicon', 'image', '/images/favicon.ico'],
  ['ic-brand-apple-touch-icon', 'image', '/images/apple-touch-icon.png'],
  ['ic-brand-msapplication-tile-color', 'color', '$ic-brand-primary'],
  ['ic-brand-msapplication-tile-square', 'image', '/images/windows-tile.png'],
  ['ic-brand-msapplication-tile-wide', 'image', '/images/windows-tile-wide.png'],
  ['ic-brand-right-sidebar-logo', 'image', ''],
  ['ic-brand-Login-body-bgd-color', 'color', '#334451'],
  ['ic-brand-Login-body-bgd-image', 'image', ''],
  ['ic-brand-Login-body-bgd-shadow-color', 'color', '#273540'],
  ['ic-brand-Login-logo', 'image', '/images/login/canvas-logo.svg'],
  ['ic-brand-Login-Content-bgd-color', 'color', 'none'],
  ['ic-brand-Login-Content-border-color', 'color', 'none'],
  ['ic-brand-Login-Content-inner-bgd', 'color', 'none'],
  ['ic-brand-Login-Content-inner-border', 'color', 'none'],
  ['ic-brand-Login-Content-inner-body-bgd', 'color', 'none'],
  ['ic-brand-Login-Content-inner-body-border', 'color', 'none'],
  ['ic-brand-Login-Content-label-text-color', 'color', '#ffffff'],
  ['ic-brand-Login-Content-password-text-color', 'color', '#ffffff'],
  ['ic-brand-Login-footer-link-color', 'color', '#ffffff'],
  ['ic-brand-Login-footer-link-color-hover', 'color', '#ffffff'],
  ['ic-brand-Login-instructure-logo', 'color', '#ffffff'],
  ['ic-brand-Login-custom-message', 'textarea', ''],
  ['ic-brand-Discovery-custom-message', 'textarea', ''],
  ['ic-brand-Registration-custom-message', 'textarea', ''],
  ['ic-brand-Registration-parent-custom-message', 'textarea', ''],
];
const defaults = new Map(VARIABLES.map(([name, , value]) => [name, value]));

/** BrandableCSS.brand_variable_value: the explicit value, else the default, following `$` references. */
function value(name) {
  if (explicit[name]) return explicit[name];
  const fallback = defaults.get(name);
  return fallback?.startsWith('$') ? value(fallback.slice(1)) : fallback;
}

/** CanvasColor#darken and #lighten: each channel moves toward black or white, truncated. Uppercase hex. */
function shade(hex, mode, percent) {
  const n = parseInt(hex.replace('#', ''), 16);
  const amount = percent / 100;
  return `#${[(n >> 16) & 255, (n >> 8) & 255, n & 255]
    .map((c) => (mode === 'darken' ? c - Math.trunc(c * amount) : c + Math.trunc((255 - c) * amount)))
    .map((c) => c.toString(16).toUpperCase().padStart(2, '0'))
    .join('')}`;
}

/** BrandableCSS.computed_variables. */
const COMPUTED = [
  ['ic-brand-primary', 'darken', 5],
  ['ic-brand-primary', 'darken', 10],
  ['ic-brand-primary', 'darken', 15],
  ['ic-brand-primary', 'lighten', 5],
  ['ic-brand-primary', 'lighten', 10],
  ['ic-brand-primary', 'lighten', 15],
  ['ic-brand-button--primary-bgd', 'darken', 5],
  ['ic-brand-button--primary-bgd', 'darken', 15],
  ['ic-brand-button--secondary-bgd', 'darken', 5],
  ['ic-brand-button--secondary-bgd', 'darken', 15],
  ['ic-brand-font-color-dark', 'lighten', 15],
  ['ic-brand-font-color-dark', 'lighten', 28],
  ['ic-link-color', 'darken', 10],
  ['ic-link-color', 'lighten', 10],
];

function brandVariables() {
  const json = {};
  for (const [name, mode, percent] of COMPUTED) json[`${name}-${mode}ed-${percent}`] = shade(value(name), mode, percent);
  for (const [name] of VARIABLES) json[name] = value(name);
  return json;
}

/** Beacons that got past Easel's guard, for `GET /fake-s3/beacon/hits`. Resets when this file reloads. */
let beaconHits = 0;

const notFound = { status: 404, body: { errors: [{ message: 'The specified resource does not exist.' }] } };

export const routes = [
  {
    // Unauthenticated, and a redirect: clients shouldn't store the target, which changes with the theme.
    path: '/api/v1/brand_variables',
    public: true,
    handler: () => ({
      status: 302,
      body: '',
      headers: {
        Location: `${BASE}/dist/brandable_css/${BRAND_MD5}/variables-${DEFAULTS_MD5}.json`,
        'Access-Control-Allow-Origin': '*',
      },
    }),
  },
  {
    path: '/dist/brandable_css/:md5/:file',
    public: true,
    handler: ({ params }) =>
      params.md5 === BRAND_MD5 && params.file === `variables-${DEFAULTS_MD5}.json` ? brandVariables() : notFound,
  },
  {
    // The S3 bucket: public-read, cached for 15 years (upload_file's cache_control).
    path: '/fake-s3/account_1/attachments/:id/:name',
    public: true,
    handler: ({ params }) => {
      const file = files[params.id];
      if (!file || file.name !== params.name) return { status: 404, body: '<Error><Code>NoSuchKey</Code></Error>' };
      return {
        status: 200,
        body: file.body,
        headers: { 'Content-Type': file.type, 'Cache-Control': 'max-age=473040000, public' },
      };
    },
  },
  ...['GET', 'POST'].map((method) => ({
    // Guard check: Easel's theme policy should keep the test JS from ever reaching this.
    method,
    path: '/fake-s3/beacon',
    public: true,
    handler: ({ query }) => {
      beaconHits += 1;
      console.warn(`THEME BEACON GOT THROUGH (${method}${query.via ? ` via ${query.via}` : ''})`);
      return { status: 204, body: '' };
    },
  })),
  { path: '/fake-s3/beacon/hits', public: true, handler: () => ({ hits: beaconHits }) },
];
