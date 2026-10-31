/** CONTENT-13. lib/api/v1/eportfolio.rb#EPORTFOLIO_ATTRIBUTES.
 * The two-item pages intentionally exercise CanvasClient Link pagination.
 * Fake-only query scenario=empty|denied allows read-only validation without
 * changing shared data. Browser pages are placeholders: the fake session_token
 * endpoint does not implement real browser authentication.
 */
import { user } from '../data.mjs';

const portfolios = [
  { id: '92001', name: 'Learning journal', public: false, created_at: '2025-09-01T12:00:00Z', updated_at: '2026-10-28T12:00:00Z' },
  { id: '92002', name: 'Design and research', public: true, created_at: '2026-01-15T12:00:00Z', updated_at: '2026-10-29T12:00:00Z' },
  { id: '92003', name: 'Writing & reflection', public: false, created_at: '2026-09-01T12:00:00Z', updated_at: '2026-10-30T12:00:00Z' },
].map((portfolio) => ({ ...portfolio, user_id: String(user.id), workflow_state: 'active', deleted_at: null, spam_status: null }));

const page = (title, body) => ({ status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' }, body: `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title></head><body><h1>${title}</h1>${body}</body></html>` });

export const routes = [
  {
    path: '/api/v1/users/:userId/eportfolios',
    handler: ({ params, query, url }) => {
      if (!['self', String(user.id)].includes(params.userId) || query.scenario === 'denied')
        return { status: 403, body: { errors: [{ message: 'You are not authorized to perform that action.' }] } };
      if (query.scenario === 'empty') return [];
      const current = Math.max(1, Number(query.page) || 1);
      const size = Math.min(2, Math.max(1, Number(query.per_page) || 2));
      const start = (current - 1) * size;
      const next = new URL(url);
      next.searchParams.set('page', String(current + 1));
      return {
        status: 200, body: portfolios.slice(start, start + size),
        headers: start + size < portfolios.length ? { Link: `<${next}>; rel="next"` } : {},
      };
    },
  },
  { path: '/dashboard/eportfolios', public: true, handler: () => page('ePortfolios', '<p>Fake Canvas portfolio website. Browser authentication is a mocked boundary.</p>') },
  {
    path: '/eportfolios/:portfolioId', public: true,
    handler: ({ params }) => {
      const portfolio = portfolios.find((p) => p.id === params.portfolioId);
      return portfolio ? page(portfolio.name.replaceAll('&', '&amp;'), '<p>Fake Canvas portfolio page. No real portfolio content or authentication is provided here.</p>')
        : { status: 404, body: { errors: [{ message: 'Portfolio not found' }] } };
    },
  },
];
