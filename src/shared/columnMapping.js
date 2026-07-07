const STANDARD_COLUMNS = ['name', 'query', 'website', 'company_phone', 'email'];

const COLUMN_ALIASES = {
  name: ['name', 'lead name', 'company name', 'business name', 'firm name', 'contact name'],
  query: ['query', 'search', 'search term', 'search query'],
  website: ['website', 'url', 'site', 'web', 'webpage'],
  company_phone: ['company_phone', 'company phone', 'phone', 'telephone', 'contact number', 'mobile', 'phone number', 'cell', 'tel'],
  email: ['email', 'e-mail', 'mail', 'contact email', 'email address']
};

function normalizeHeader(h) {
  return String(h).toLowerCase().trim().replace(/[\s_-]+/g, ' ');
}

function detectColumns(headers) {
  const mapping = {};
  const normalizedHeaders = headers.map(h => ({ original: h, normalized: normalizeHeader(h) }));
  for (const [standardCol, aliases] of Object.entries(COLUMN_ALIASES)) {
    const found = normalizedHeaders.find(nh =>
      aliases.some(alias => nh.normalized === alias || nh.normalized.includes(alias))
    );
    mapping[standardCol] = found ? found.original : null;
  }
  return mapping;
}

function mapRowData(row, columnMapping) {
  const mapped = {};
  for (const [standardCol, sourceCol] of Object.entries(columnMapping)) {
    mapped[standardCol] = sourceCol && row[sourceCol] != null ? String(row[sourceCol]).trim() : '';
  }
  return mapped;
}

module.exports = { STANDARD_COLUMNS, COLUMN_ALIASES, normalizeHeader, detectColumns, mapRowData };
