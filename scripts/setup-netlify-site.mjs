import { execSync } from 'child_process';

const NETLIFY_AUTH_TOKEN = process.env.NETLIFY_AUTH_TOKEN;
const SKILL_SLUG = process.env.SKILL_SLUG;
const CTP_AUTH_URL = process.env.CTP_AUTH_URL;
const CTP_API_URL = process.env.CTP_API_URL;
const CTP_PROJECT_KEY = process.env.CTP_PROJECT_KEY;
const CTP_CLIENT_ID = process.env.CTP_CLIENT_ID;
const CTP_CLIENT_SECRET = process.env.CTP_CLIENT_SECRET;
const CTP_SCOPES = process.env.CTP_SCOPES;
const SESSION_SECRET = process.env.SESSION_SECRET;

if (!NETLIFY_AUTH_TOKEN) {
  console.error('ERROR: NETLIFY_AUTH_TOKEN env var is required');
  process.exit(1);
}
if (!SKILL_SLUG) {
  console.error('ERROR: SKILL_SLUG env var is required');
  process.exit(1);
}

const SITE_NAME = `harness-${SKILL_SLUG}-pr`;
const TEAM_SLUG = 'cofe-pre-sales';
const API_BASE = 'https://api.netlify.com/api/v1';

function netlifyHeaders() {
  return {
    Authorization: `Bearer ${NETLIFY_AUTH_TOKEN}`,
    'Content-Type': 'application/json',
  };
}

async function netlifyFetch(path, options = {}) {
  const url = path.startsWith('http') ? path : `${API_BASE}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: { ...netlifyHeaders(), ...(options.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Netlify API error ${res.status} ${res.statusText}: ${body}`);
  }
  return res.json();
}

async function findSite(name) {
  const sites = await netlifyFetch('/sites?filter=all');
  return sites.find((s) => s.name === name) ?? null;
}

async function createSite(name) {
  console.log(`Creating Netlify site: ${name}`);
  return netlifyFetch('/sites', {
    method: 'POST',
    body: JSON.stringify({ name, account_slug: TEAM_SLUG }),
  });
}

async function setSiteEnvVars(siteId) {
  const envVars = {
    CTP_AUTH_URL,
    CTP_API_URL,
    CTP_PROJECT_KEY,
    CTP_CLIENT_ID,
    CTP_CLIENT_SECRET,
    CTP_SCOPES,
    SESSION_SECRET,
  };

  const envPayload = Object.entries(envVars)
    .filter(([, v]) => v !== undefined)
    .map(([key, value]) => ({ key, value }));

  console.log(`Setting ${envPayload.length} env vars on site ${siteId}...`);
  await netlifyFetch(`/sites/${siteId}/env`, {
    method: 'PATCH',
    body: JSON.stringify(envPayload),
  });
}

try {
  let site = await findSite(SITE_NAME);
  if (site) {
    console.log(`Found existing site: ${SITE_NAME} (${site.id})`);
  } else {
    site = await createSite(SITE_NAME);
    console.log(`Created site: ${SITE_NAME} (${site.id})`);
  }

  await setSiteEnvVars(site.id);

  console.log(`Site URL: ${site.ssl_url ?? site.url}`);
} catch (err) {
  console.error('ERROR setting up Netlify site:', err.message ?? err);
  process.exit(1);
}
