import { router, json } from '@appdeploy/sdk';
import { providerRoute } from './standalone-market-providers';

export const handler = router({
  'GET /api/_healthcheck': [
    async () => json({ ok: true, service: 'sire-backend', marketData: 'configured' }),
  ],
  'GET /api/sire/markets/provider/:provider': [
    async ({ params }: any) => providerRoute(String(params?.provider || '')),
  ],
});
