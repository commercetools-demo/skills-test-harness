import { readFileSync, appendFileSync } from 'fs';

const NETLIFY_AUTH_TOKEN = process.env.NETLIFY_AUTH_TOKEN;

if (!NETLIFY_AUTH_TOKEN) {
  console.error('ERROR: NETLIFY_AUTH_TOKEN env var is required');
  process.exit(1);
}

// 2. Read deploy info
let deployInfo;
try {
  deployInfo = JSON.parse(readFileSync('netlify-deploy.json', 'utf8'));
} catch (err) {
  console.error('ERROR reading netlify-deploy.json:', err.message);
  process.exit(1);
}

const { site_id: siteId, deploy_id: deployId } = deployInfo;
if (!deployId) {
  console.error('ERROR: deploy_id not found in netlify-deploy.json');
  process.exit(1);
}

const API_BASE = 'https://api.netlify.com/api/v1';
const POLL_INTERVAL_MS = 15_000;
const MAX_POLLS = 40; // 10 minutes

async function pollDeploy() {
  const res = await fetch(`${API_BASE}/deploys/${deployId}`, {
    headers: { Authorization: `Bearer ${NETLIFY_AUTH_TOKEN}` },
  });
  if (!res.ok) {
    throw new Error(`Netlify API error ${res.status} ${res.statusText}`);
  }
  return res.json();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

console.log(`Waiting for deploy ${deployId} on site ${siteId}...`);

let polls = 0;
while (polls < MAX_POLLS) {
  polls++;
  let deploy;
  try {
    deploy = await pollDeploy();
  } catch (err) {
    console.error(`Poll ${polls}/${MAX_POLLS} failed:`, err.message);
    if (polls >= MAX_POLLS) break;
    await sleep(POLL_INTERVAL_MS);
    continue;
  }

  const { state, ssl_url: sslUrl, error_message: errorMessage } = deploy;
  console.log(`Poll ${polls}/${MAX_POLLS}: state=${state}`);

  if (state === 'ready') {
    console.log(`Deploy ready! Preview URL: ${sslUrl}`);
    const outputFile = process.env.GITHUB_OUTPUT;
    if (outputFile) {
      appendFileSync(outputFile, `preview_url=${sslUrl}\n`);
    }
    process.exit(0);
  }

  if (state === 'error') {
    console.error(`Deploy failed with error: ${errorMessage ?? '(no message)'}`);
    process.exit(1);
  }

  if (polls < MAX_POLLS) {
    await sleep(POLL_INTERVAL_MS);
  }
}

console.error(`Timeout: deploy ${deployId} did not reach 'ready' state within 10 minutes`);
process.exit(1);
