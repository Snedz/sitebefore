export function agencyPage(value) {
  const page = Number(value);
  return Number.isInteger(page) && page > 0 && page <= 1_000_000 ? page : 1;
}

export function agencyPath(page, id) {
  const query = new URLSearchParams();
  if (page > 1) query.set('page', String(page));
  if (id) query.set('lead', id);
  return '/agency/' + (query.size ? '?' + query : '');
}
