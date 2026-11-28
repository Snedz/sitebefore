const singleFields = ['name', 'location', 'trade', 'headline', 'intro', 'story', 'phone'];
export const requiredProspectFields = ['name', 'location', 'trade', 'intro', 'service'];

export class WorkflowError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function clean(value, max, label) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw new WorkflowError(`${label} must contain 1–${max} characters.`);
  }
  return value.trim();
}

export const normalizeEvidenceText = text => text.normalize('NFKC').replace(/\s+/g, ' ').toLowerCase();

export const isEvidenceDay = day => /^\d{4}-\d{2}-\d{2}$/.test(day) &&
  Number.isFinite(Date.parse(day)) && new Date(day).toISOString().slice(0, 10) === day;

export function businessPhoneLink(value) {
  if (typeof value !== 'string') return null;
  const number = value.replace(/[\u2010-\u2013]/g, '-').replace(/[\u00A0\u202F]/g, ' ');
  if (!/^(?:\+?1[ .-]?)?(?:\([2-9]\d{2}\)|[2-9]\d{2})[ .-]?[2-9]\d{2}[ .-]?\d{4}$/.test(number)) {
    return null;
  }
  return 'tel:+1' + number.replace(/\D/g, '').slice(-10);
}

export function normalizeProspect(input) {
  if (!input || typeof input !== 'object' || !['USD', 'CAD'].includes(input.currency)) {
    throw new WorkflowError('Set the prospect currency to USD or CAD.');
  }
  if (!Array.isArray(input.facts) || input.facts.length > 16) {
    throw new WorkflowError('Provide up to 16 sourced facts.');
  }
  const seen = new Set();
  const facts = input.facts.map((row) => {
    if (!row || ![...singleFields, 'service'].includes(row.field)) {
      throw new WorkflowError('Fact field must be name, location, trade, headline, intro, story, phone or service.');
    }
    const { field } = row;
    if (field !== 'service' && seen.has(field)) throw new WorkflowError(`Duplicate ${field} fact.`);
    seen.add(field);
    const value = clean(row.value, field === 'story' || field === 'intro' ? 500 : 110, field);
    if (field === 'phone' && !businessPhoneLink(value)) {
      throw new WorkflowError('Use a 10-digit US or Canadian business phone number with optional +1.');
    }
    const excerpt = clean(row.excerpt, 1500, 'Evidence excerpt');
    const evidenceText = normalizeEvidenceText(excerpt);
    if (!evidenceText.includes(normalizeEvidenceText(value))) {
      throw new WorkflowError(`The ${field} value must appear in its evidence excerpt.`);
    }
    let description;
    if (field === 'service' && row.description !== undefined) {
      description = clean(row.description, 250, 'Service description');
      if (!evidenceText.includes(normalizeEvidenceText(description))) {
        throw new WorkflowError('The service description must appear in its evidence excerpt.');
      }
    }
    const source = clean(row.source, 1000, 'Evidence URL');
    let url;
    try { url = new URL(source); } catch { throw new WorkflowError('Evidence needs a valid HTTPS URL.'); }
    if (url.protocol !== 'https:' || url.username || url.password) {
      throw new WorkflowError('Evidence needs an HTTPS URL without credentials.');
    }
    const checked = clean(row.checked, 10, 'Evidence date');
    if (!isEvidenceDay(checked)) {
      throw new WorkflowError('Use an evidence date in YYYY-MM-DD format.');
    }
    return { field, value, source: url.href, excerpt, checked, ...(description && { description }) };
  });
  if (requiredProspectFields.some(field => !seen.has(field))) {
    throw new WorkflowError('Include the business name, location, trade, intro and at least one service.');
  }
  const contactUrl = clean(input.businessUrl, 500, 'Business URL');
  let business;
  try { business = new URL(contactUrl); } catch { throw new WorkflowError('Add a valid HTTPS business or booking URL.'); }
  if (business.protocol !== 'https:' || business.username || business.password) {
    throw new WorkflowError('Add an HTTPS business or booking URL without credentials.');
  }
  const businessKey = business.hostname.replace(/^www\./, '') + business.pathname.replace(/\/+$/, '');
  return { currency: input.currency, businessUrl: business.href, businessKey, facts };
}

export function checkFreshness(facts, now = Date.now()) {
  const currentDay = Math.floor(now / 86400000);
  const issue = facts.find(fact => {
    const age = currentDay - Date.parse(fact.checked) / 86400000;
    return age < 0 || age > 30;
  });
  if (issue) throw new WorkflowError(`Refresh the ${issue.field} evidence before sharing (maximum age 30 days).`);
}

export function publicProfile(prospect) {
  const services = new Map();
  for (const { field, value, description } of prospect.facts) {
    if (field !== 'service') continue;
    if (!services.has(value)) services.set(value, new Set());
    if (description) services.get(value).add(description);
  }
  return {
    ...Object.fromEntries(prospect.facts.filter(item => item.field !== 'service').map(item => [item.field, item.value])),
    services: Array.from(services, ([name, descriptions]) => ({ name, descriptions: [...descriptions] })),
  };
}
