// Previously released previews without a stored offer use these original terms.
export const launchOffer = {
  amount: 59900,
  version: 'launch-v1',
  scope: [
    'One mobile-friendly page based on your approved preview',
    'One round of copy and layout edits',
    'Setup on a domain you own',
    'Launch handoff with a copy of your site',
  ],
};

export const currentOffer = launchOffer;

export const monthlyOffer = {
  amount: 4900,
  version: 'launch-monthly-v1',
  publishAmount: 0,
  interval: 'month',
  cancelAnytime: true,
  scope: launchOffer.scope,
};

export const offersForApproval = (defaultOffer = currentOffer) => [defaultOffer, monthlyOffer];

export const checkoutModeForOffer = offer => offer.interval ? 'subscription' : 'payment';

export function displayPrice(currency = 'USD', amount = currentOffer.amount) {
  return `$${(amount / 100).toFixed(amount % 100 ? 2 : 0)} ${currency}`;
}

export function offerTerms(offer, currency = 'USD') {
  if (!offer.interval) return displayPrice(currency, offer.amount) + ' one time';
  return `${displayPrice(currency, offer.publishAmount)} to publish + ${displayPrice(currency, offer.amount)}/month` +
    (offer.cancelAnytime ? ', cancel anytime' : '');
}
