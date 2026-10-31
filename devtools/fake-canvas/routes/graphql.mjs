/**
 * `POST /api/graphql` for the fake Canvas (owned by the Announcements, activity,
 * and inbox workstream).
 *
 * The fake doesn't parse GraphQL. Easel names every operation it sends
 * (`operationName`), and each feature's route file answers its own operations at
 * an internal resolver path, so state stays with the feature that owns it. This
 * file asks each resolver in turn; a resolver answers 404 for operations it
 * doesn't know. Feature owners: append your resolver path to `resolvers`.
 *
 * Responses follow GraphQL over HTTP: `{ data, errors }` with status 200.
 */
import { Buffer } from 'node:buffer';

import { BASE } from '../data.mjs';

const resolvers = ['/fake/graphql/discussions', '/fake/graphql/inbox', '/fake/graphql/grades', '/fake/graphql/peer-reviews', '/fake/graphql/submission-drafts'];

export const routes = [
  {
    method: 'POST',
    path: '/api/graphql',
    handler: async ({ body, req }) => {
      const request = body && typeof body === 'object' && !Buffer.isBuffer(body) ? body : {};
      for (const path of resolvers) {
        try {
          const res = await fetch(`${BASE}${path}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: req.headers.authorization ?? '',
            },
            body: JSON.stringify(request),
          });
          if (res.status === 404) continue;
          return { status: 200, body: await res.json() };
        } catch (error) {
          return { status: 200, body: { data: null, errors: [{ message: String(error.message ?? error) }] } };
        }
      }
      return {
        status: 200,
        body: {
          data: null,
          errors: [
            { message: `Fake Canvas doesn't implement ${request.operationName ?? 'this operation'}.` },
          ],
        },
      };
    },
  },
];
