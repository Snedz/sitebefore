import profile from './juniper.json' with { type: 'json' };

export function makeDemoProspect() {
  const businessUrl = 'https://example.com/juniper-motor-works';
  const checked = new Date().toISOString().slice(0, 10);
  const facts = Object.entries(profile)
    .filter(([field]) => ['name', 'location', 'trade', 'intro', 'story'].includes(field))
    .concat(profile.services.map(service => ['service', service]))
    .map(([field, value]) => ({ field, value, source: businessUrl, excerpt: value, checked }));
  return { currency: 'USD', businessUrl, facts };
}
