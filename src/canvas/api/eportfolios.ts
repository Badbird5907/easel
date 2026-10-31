import { CanvasError, type CanvasClient } from '../client';
import { useCanvasQuery } from '../query';

/** lib/api/v1/eportfolio.rb: no html_url or private share key is serialized. */
export type CanvasEPortfolio = {
  id: string;
  user_id: string;
  name: string | null;
  public: boolean;
  created_at?: string | null;
  updated_at?: string | null;
  workflow_state?: string;
  deleted_at?: string | null;
};

export type EPortfolio = {
  id: string;
  title: string;
  titleFallback?: 'untitled';
  public: boolean;
  updatedAt: string | null;
  createdAt: string | null;
  path: string;
};

function validDate(value?: string | null): string | null {
  return value && Number.isFinite(Date.parse(value)) ? value : null;
}

export function toEPortfolio(value: CanvasEPortfolio): EPortfolio {
  return {
    id: String(value.id),
    title: value.name?.trim() || 'Untitled ePortfolio',
    ...(!value.name?.trim() ? { titleFallback: 'untitled' as const } : {}),
    public: value.public === true,
    createdAt: validDate(value.created_at),
    updatedAt: validDate(value.updated_at),
    // config/routes.rb resources :eportfolios; owner access uses their browser session.
    path: `/eportfolios/${encodeURIComponent(value.id)}`,
  };
}

export function ePortfoliosUnavailable(error: unknown): boolean {
  return error instanceof CanvasError && [403, 404, 405, 501].includes(error.status);
}

export async function fetchEPortfolios(client: CanvasClient, signal?: AbortSignal): Promise<EPortfolio[]> {
  const self = await client.get<{ id: string }>('/api/v1/users/self', undefined, signal);
  const portfolios = await client.getAll<CanvasEPortfolio>('/api/v1/users/self/eportfolios', undefined, { signal });
  return portfolios
    .filter((p) => String(p.user_id) === String(self.id) && p.workflow_state !== 'deleted' && !p.deleted_at)
    .map(toEPortfolio)
    .sort((a, b) => (Date.parse(b.updatedAt ?? b.createdAt ?? '') || 0) - (Date.parse(a.updatedAt ?? a.createdAt ?? '') || 0));
}

export function useEPortfolios() {
  return useCanvasQuery(['eportfolios', 'self'], fetchEPortfolios);
}
