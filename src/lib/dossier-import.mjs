import { createHash } from 'node:crypto';
import { businessPhoneLink, checkFreshness, isEvidenceDay, normalizeEvidenceText, normalizeProspect, requiredProspectFields, WorkflowError } from './prospect.mjs';

const fields = {
  name: ['name'], location: ['location', 'address', 'city'], trade: ['trade', 'category'],
  intro: ['intro'], service: ['service', 'services'], headline: ['headline'], story: ['story'], phone: ['phone'],
};
const emptySnapshotFields = new Set(['website', 'phone', 'category', 'city']);
const isObject = value => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const timestamp = /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-]\d{2}:[0-5]\d)$/;

function checkedDay(retrieved) {
  if (typeof retrieved !== 'string' || !isEvidenceDay(retrieved.slice(0, 10))) return null;
  if (retrieved.length === 10) return retrieved;
  return timestamp.test(retrieved) && Number.isFinite(Date.parse(retrieved))
    ? new Date(retrieved).toISOString().slice(0, 10) : null;
}

function httpsUrl(value) {
  if (typeof value !== 'string' || value.length > 1000) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

function duplicateKeys(raw) {
  const issues = [];
  const scopes = [];
  for (const [token, key] of raw.matchAll(/("(?:[^"\\]|\\[\s\S])*")\s*:|"(?:[^"\\]|\\[\s\S])*"|[{}\[\]]/g)) {
    if (token === '{' || token === '[') scopes.push(new Set());
    else if (token === '}' || token === ']') scopes.pop();
    else if (key !== undefined) {
      const name = JSON.parse(key);
      if (scopes.at(-1).has(name)) issues.push(`${JSON.stringify(name)}: duplicate JSON key; use a fact array for multiple values.`);
      scopes.at(-1).add(name);
    }
  }
  return issues;
}

export function parseDossierExport(raw, now = Date.now()) {
  let input;
  try { input = JSON.parse(raw); } catch { throw new WorkflowError('The 67 export must be valid JSON.'); }
  if (typeof raw !== 'string' || !isObject(input?.facts)) {
    throw new WorkflowError('Provide a 67 lead JSON export with an object of typed facts.');
  }
  const issues = duplicateKeys(raw);
  const reject = () => {
    if (issues.length) throw new WorkflowError('Import rejected:\n' + issues.map(issue => '- ' + issue).join('\n'));
  };
  const entries = Object.entries(input.facts).flatMap(([key, value]) =>
    (Array.isArray(value) ? value : [value]).map((fact, index) => ({
      key, label: Array.isArray(value) ? `${key}[${index + 1}]` : key, fact,
    })));
  if (entries.length > 64) throw new WorkflowError('A 67 export can contain at most 64 fact entries.');
  const evidence = [];
  const groups = new Map();
  for (const { key, label, fact } of entries) {
    if (emptySnapshotFields.has(key) && fact?.value === '') continue;
    if (!isObject(fact) || typeof fact.value !== 'string' || !fact.value.trim() || fact.value.length > 1000) {
      issues.push(`${label}: expected a typed fact with a nonempty text value (up to 1000 characters).`);
      continue;
    }
    const value = fact.value.trim();
    const source = httpsUrl(fact.source);
    const checked = checkedDay(fact.retrieved);
    const excerpt = typeof fact.excerpt === 'string' ? fact.excerpt.trim() : '';
    const field = Object.keys(fields).find(field => fields[field].includes(key));
    if (!source) issues.push(`${label}: missing or invalid HTTPS source URL.`);
    if (!checked) issues.push(`${label}: provide a valid retrieved date or timestamp with timezone.`);
    else {
      try { checkFreshness([{ field: label, checked }], now); } catch (error) { issues.push(error.message); }
    }
    if (!excerpt || excerpt.length > 1500) issues.push(`${label}: provide a captured excerpt (1–1500 characters).`);
    else if (!normalizeEvidenceText(excerpt).includes(normalizeEvidenceText(value))) {
      issues.push(`${label}: the fact value does not appear in the excerpt.`);
    }
    if (key === 'phone' && !businessPhoneLink(value)) issues.push(`${label}: invalid US or Canadian business phone number.`);
    if (field && value.length > (['intro', 'story'].includes(field) ? 500 : 110)) {
      issues.push(`${label}: the value is too long for the ${field} field.`);
    }
    const description = typeof fact.description === 'string' ? fact.description.trim() : '';
    if (fact.description !== undefined && (field !== 'service' || !description || description.length > 250 ||
        !normalizeEvidenceText(excerpt).includes(normalizeEvidenceText(description)))) {
      issues.push(`${label}: a service description must be 1–250 characters and appear in the excerpt.`);
    }
    const row = { field: key, value, source, excerpt, checked, retrieved: fact.retrieved, ...(description && { description }) };
    evidence.push(row);
    const group = ['trade', 'category'].includes(key) ? 'trade' : key === 'address' ? 'location' : key;
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push({ row, label });
  }
  for (const [key, rows] of groups) {
    if (['service', 'services'].includes(key)) continue;
    const values = new Set(rows.map(({ row }) => key === 'phone' ? businessPhoneLink(row.value) : normalizeEvidenceText(row.value)));
    if (values.size > 1) issues.push(`${rows.map(({ label }) => label).join(', ')}: contradictory values for ${key}.`);
  }
  const facts = Object.entries(fields).flatMap(([field, keys]) => {
    const matches = keys.flatMap(key => evidence.filter(row => row.field === key));
    return (field === 'service' ? matches : matches.slice(0, 1)).map(row => ({ ...row, field }));
  });
  for (const field of requiredProspectFields) {
    if (!facts.some(fact => fact.field === field)) issues.push(`${field}: required sourced fact is missing.`);
  }
  if (facts.length > 16) issues.push('Only 16 mapped dossier facts are allowed.');
  if (!['USD', 'CAD'].includes(input.currency)) issues.push('currency: set USD or CAD.');
  const urlFact = evidence.find(row => row.field === 'maps_url') ?? evidence.find(row => row.field === 'website');
  const businessUrl = httpsUrl(urlFact?.value);
  if (!businessUrl || businessUrl.length > 500) issues.push('maps_url or website: provide a sourced HTTPS business listing or website (up to 500 characters).');
  reject();
  const dossier = normalizeProspect({ currency: input.currency, businessUrl, facts });
  dossier.facts.forEach((fact, index) => { fact.retrieved = facts[index].retrieved; });
  return { dossier, evidence, sourceHash: createHash('sha256').update(raw).digest('hex') };
}
