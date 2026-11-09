import { endpointPath } from './webhooks.mappers';

describe('webhook endpoint path', () => {
  it('is the public ingress URL path', () => {
    expect(endpointPath('acme', 'orders')).toBe('/api/v1/hooks/acme/orders');
  });
});
