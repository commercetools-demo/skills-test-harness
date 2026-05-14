import { appendFileSync } from 'fs';

// Parse CLI args
const args = process.argv.slice(2);
function getArg(name) {
  const idx = args.indexOf(name);
  return idx !== -1 ? args[idx + 1] : undefined;
}

const sha = getArg('--sha');
const name = getArg('--name');
const runUrl = getArg('--run-url');
const repo = getArg('--repo') ?? 'commercetools-demo/commercetools-plugin';

const GITHUB_OUTPUT = process.env.GITHUB_OUTPUT;

function writeOutput(value) {
  if (GITHUB_OUTPUT) {
    appendFileSync(GITHUB_OUTPUT, `check_run_id=${value}\n`);
  }
}

if (!sha) {
  console.log('No SHA provided — skipping check run creation');
  writeOutput('');
  process.exit(0);
}

const GH_TOKEN = process.env.GH_TOKEN;
if (!GH_TOKEN) {
  console.error(`ERROR: GH_TOKEN env var required. Ensure the GitHub App is installed on ${repo}`);
  process.exit(1);
}

if (!name) {
  console.error('ERROR: --name is required');
  process.exit(1);
}
if (!runUrl) {
  console.error('ERROR: --run-url is required');
  process.exit(1);
}

try {
  const res = await fetch(
    `https://api.github.com/repos/${repo}/check-runs`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${GH_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({
        name,
        head_sha: sha,
        status: 'in_progress',
        details_url: runUrl,
        started_at: new Date().toISOString(),
      }),
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub API error ${res.status} ${res.statusText}: ${text}`);
  }

  const data = await res.json();
  console.log(`Created check run ${data.id}`);
  writeOutput(String(data.id));
} catch (err) {
  console.error('ERROR creating check run:', err.message ?? err);
  process.exit(1);
}
