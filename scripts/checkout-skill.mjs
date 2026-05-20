import { execSync } from 'child_process';

// Parse CLI args
const args = process.argv.slice(2);
function getArg(name) {
  const idx = args.indexOf(name);
  return idx !== -1 ? args[idx + 1] : undefined;
}

const ref = getArg('--ref');
const sha = getArg('--sha');
const sourceRepo = getArg('--source-repo') ?? 'commercetools-demo/skills';

if (!ref) {
  console.error('ERROR: --ref is required');
  process.exit(1);
}

const GH_TOKEN = process.env.GH_TOKEN;
if (!GH_TOKEN) {
  console.error(`ERROR: GH_TOKEN env var required. Ensure the GitHub App is installed on ${sourceRepo}`);
  process.exit(1);
}

const clonePath = 'local-marketplace/commercetools-demo';

try {
  execSync(`mkdir -p local-marketplace`, { stdio: 'inherit' });
  execSync(
    `git clone --depth 1 --branch "${ref}" "https://x-access-token:${GH_TOKEN}@github.com/${sourceRepo}.git" ${clonePath}`,
    { stdio: 'inherit' }
  );

  // Optional SHA verification
  if (sha) {
    const actual = execSync(`git -C ${clonePath} rev-parse HEAD`, { stdio: 'pipe' })
      .toString()
      .trim();
    if (actual !== sha) {
      console.error('ERROR: SHA mismatch — force-push happened between dispatch and checkout');
      process.exit(1);
    }
  }

  console.log(`Checked out ${sourceRepo}@${ref} into ./${clonePath}/`);
} catch (err) {
  if (err.message) console.error('ERROR:', err.message);
  process.exit(1);
}
