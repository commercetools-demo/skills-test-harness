import { execSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';

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

const clonePath = 'local-marketplace/plugins/commercetools-demo';

try {
  execSync(`mkdir -p local-marketplace/plugins local-marketplace/.claude-plugin`, { stdio: 'inherit' });

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

  // Copy marketplace.json from the source repo, repointing plugin sources to
  // their location within the local-marketplace tree (source repo uses "./"
  // relative to its root; here the clone lives at ./plugins/commercetools-demo).
  const marketplace = JSON.parse(
    readFileSync(`${clonePath}/.claude-plugin/marketplace.json`, 'utf8')
  );
  for (const plugin of marketplace.plugins) {
    plugin.source = './plugins/commercetools-demo';
  }
  writeFileSync(
    'local-marketplace/.claude-plugin/marketplace.json',
    JSON.stringify(marketplace, null, 2) + '\n'
  );
  console.log('Copied local-marketplace/.claude-plugin/marketplace.json from source repo');
} catch (err) {
  if (err.message) console.error('ERROR:', err.message);
  process.exit(1);
}
