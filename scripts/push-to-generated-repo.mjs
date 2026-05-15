import { execSync } from 'child_process';
import { mkdtempSync, rmSync, readdirSync, cpSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const IGNORED_DIRS = new Set([
  'node_modules', '.next', '.turbo', '.cache', 'out', 'dist', 'build',
  '.vercel', '.netlify', '.svelte-kit', '.nuxt',
]);

const DEFAULT_GITIGNORE = `# dependencies
node_modules/

# Next.js
.next/
out/

# build outputs
dist/
build/

# env files
.env
.env.local
.env.*.local

# misc
.turbo/
.vercel/
.netlify/
*.log
`;

function removeIgnoredDirs(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const full = join(dir, entry.name);
    if (IGNORED_DIRS.has(entry.name)) {
      rmSync(full, { recursive: true, force: true });
      console.log(`  removed ${full.replace(dir, '.')}`);
    } else {
      removeIgnoredDirs(full);
    }
  }
}

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const SKILL_SLUG = process.env.SKILL_SLUG;
const HARNESS_SHA = process.env.HARNESS_SHA;

if (!GITHUB_TOKEN) {
  console.error('ERROR: GITHUB_TOKEN env var is required');
  process.exit(1);
}
if (!SKILL_SLUG) {
  console.error('ERROR: SKILL_SLUG env var is required');
  process.exit(1);
}
if (!HARNESS_SHA) {
  console.error('ERROR: HARNESS_SHA env var is required');
  process.exit(1);
}

const REMOTE_URL = `https://x-access-token:${GITHUB_TOKEN}@github.com/commercetools-demo/skills-scaffold.git`;
const BRANCH = process.env.TARGET_BRANCH || `${SKILL_SLUG}/main`;

let tmpDir;

function run(cmd, opts = {}) {
  return execSync(cmd, { stdio: 'inherit', ...opts });
}

function cleanup() {
  if (tmpDir) {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  }
}

process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(130); });
process.on('SIGTERM', () => { cleanup(); process.exit(143); });

try {
  // 1. Clone into a temp dir
  tmpDir = mkdtempSync(join(tmpdir(), 'skills-scaffold-'));
  console.log(`Cloning into ${tmpDir}...`);
  run(`git clone --depth=1 "${REMOTE_URL}" "${tmpDir}"`);

  // 2. Try to checkout the branch; if it doesn't exist, create an orphan branch
  try {
    run(`git -C "${tmpDir}" fetch origin "${BRANCH}"`, { stdio: 'pipe' });
    run(`git -C "${tmpDir}" checkout "${BRANCH}"`);
    console.log(`Checked out existing branch: ${BRANCH}`);
  } catch {
    console.log(`Branch ${BRANCH} not found — creating orphan branch`);
    run(`git -C "${tmpDir}" checkout --orphan "${BRANCH}"`);
    try {
      run(`git -C "${tmpDir}" rm -rf .`, { stdio: 'pipe' });
    } catch {
      // empty repo — nothing to remove
    }
  }

  // 3. Delete everything in the worktree (except .git/)
  const entries = readdirSync(tmpDir);
  for (const entry of entries) {
    if (entry === '.git') continue;
    rmSync(join(tmpDir, entry), { recursive: true, force: true });
  }

  // 4. Copy ./output/* into the worktree
  console.log('Copying ./output/* into worktree...');
  cpSync('./output', tmpDir, { recursive: true });

  // 4b. Remove large/generated directories before committing
  console.log('Removing ignored directories...');
  removeIgnoredDirs(tmpDir);

  // 4c. Ensure .gitignore exists
  const gitignorePath = join(tmpDir, '.gitignore');
  if (!existsSync(gitignorePath)) {
    writeFileSync(gitignorePath, DEFAULT_GITIGNORE);
    console.log('Added default .gitignore');
  }

  // 5. Commit and push
  run(`git -C "${tmpDir}" config user.email "ci-harness@commercetools.com"`);
  run(`git -C "${tmpDir}" config user.name "CI Harness"`);
  run(`git -C "${tmpDir}" add -A`);

  const commitMsg = `Update ${SKILL_SLUG} scaffold from harness ${HARNESS_SHA}`;
  try {
    run(`git -C "${tmpDir}" commit -m "${commitMsg}"`);
  } catch {
    console.log('Nothing to commit — worktree matches HEAD');
    process.exit(0);
  }

  run(`git -C "${tmpDir}" push --force origin "${BRANCH}"`);
  console.log(`Successfully pushed to ${BRANCH}`);
} catch (err) {
  console.error('ERROR pushing to generated repo:', err.message ?? err);
  cleanup();
  process.exit(1);
}
