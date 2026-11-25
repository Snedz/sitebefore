export const price = 59900;
export const offerVersion = 'launch-v1';
export const scope = [
  'One mobile-friendly page based on your approved preview',
  'One round of copy and layout edits',
  'Setup on a domain you own',
  'Launch handoff with a copy of your site',
];
export const displayPrice = (currency = 'USD') => `$${price / 100} ${currency}`;
