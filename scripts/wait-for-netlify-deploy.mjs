import { appendFileSync } from 'fs';

const NETLIFY_AUTH_TOKEN = process.env.NETLIFY_AUTH_TOKEN;
const SKILL_SLUG = process.env.SKILL_SLUG;
const TARGET_BRANCH = process.env.TARGET_BRANCH; // e.g. b2c/preview/main

if (!NETLIFY_AUTH_TOKEN) {
  console.error('ERROR: NETLIFY_AUTH_TOKEN env var is required');
  process.exit(1);
}
if (!SKILL_SLUG) {
  console.error('ERROR: SKILL_SLUG env var is required');
  process.exit(1);
}

const SITE_NAME = process.env.NETLIFY_SITE_NAME || 'skills-scaffold';
const BRANCH = TARGET_BRANCH || `${SKILL_SLUG}/main`;
const API_BASE = 'https://api.netlify.com/api/v1';
const POLL_INTERVAL_MS = 15_000;
const MAX_POLLS = 40; // 10 minutes
// Accept deploys created up to 3 minutes before this script started
// (covers clock skew and the time between push and Netlify picking it up)
const STARTED_AT = new Date(Date.now() - 3 * 60 * 1000);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function netlifyFetch(path) {
  const url = path.startsWith('http') ? path : `${API_BASE}${path}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${NETLIFY_AUTH_TOKEN}` },
  });
  if (!res.ok) throw new Error(`Netlify API ${res.status} ${res.statusText}`);
  return res.json();
}

// Resolve site ID from name
const sites = await netlifyFetch('/sites?filter=all');
const site = sites.find((s) => s.name === SITE_NAME);
if (!site) {
  console.error(`ERROR: Netlify site '${SITE_NAME}' not found. Create it and link it to the skills-scaffold repo.`);
  process.exit(1);
}

console.log(`Site: ${SITE_NAME} (${site.id})`);
console.log(`Waiting for deploy on branch '${BRANCH}'...`);

let polls = 0;
while (polls < MAX_POLLS) {
  polls++;
  try {
    const deploys = await netlifyFetch(`/sites/${site.id}/deploys?per_page=10`);

    const candidate = deploys
      .filter((d) => d.branch === BRANCH && new Date(d.created_at) >= STARTED_AT)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];

    if (!candidate) {
      console.log(`Poll ${polls}/${MAX_POLLS}: no deploy found on '${BRANCH}' yet...`);
    } else {
      console.log(`Poll ${polls}/${MAX_POLLS}: deploy ${candidate.id} state=${candidate.state}`);

      if (candidate.state === 'ready') {
        const url = candidate.ssl_url || candidate.url;
        console.log(`Deploy ready! Preview URL: ${url}`);
        if (process.env.GITHUB_OUTPUT) {
          appendFileSync(process.env.GITHUB_OUTPUT, `preview_url=${url}\n`);
        }
        process.exit(0);
      }

      if (candidate.state === 'error') {
        console.error(`Deploy failed: ${candidate.error_message ?? '(no message)'}`);
        process.exit(1);
      }
    }
  } catch (err) {
    console.error(`Poll ${polls}/${MAX_POLLS} failed:`, err.message);
  }

  if (polls < MAX_POLLS) await sleep(POLL_INTERVAL_MS);
}

console.error(`Timeout: no ready deploy on '${BRANCH}' within 10 minutes`);
process.exit(1);
