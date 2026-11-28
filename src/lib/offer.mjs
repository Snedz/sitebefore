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

export function displayPrice(currency = 'USD', amount = currentOffer.amount) {
  return `$${(amount / 100).toFixed(amount % 100 ? 2 : 0)} ${currency}`;
}
