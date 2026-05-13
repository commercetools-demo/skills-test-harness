import { execSync } from 'child_process';
import { mkdtempSync, rmSync, cpSync, copyFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Parse CLI args
const args = process.argv.slice(2);
function getArg(name) {
  const idx = args.indexOf(name);
  return idx !== -1 ? args[idx + 1] : undefined;
}

const skillName = getArg('--skill-name');
const ref = getArg('--ref');
const sha = getArg('--sha');

if (!skillName) {
  console.error('ERROR: --skill-name is required');
  process.exit(1);
}
if (!ref) {
  console.error('ERROR: --ref is required');
  process.exit(1);
}

const GH_TOKEN = process.env.GH_TOKEN;
if (!GH_TOKEN) {
  console.error('ERROR: GH_TOKEN env var required. Ensure the GitHub App is installed on commercetools-demo/skills');
  process.exit(1);
}

let tmpDir;

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
  tmpDir = mkdtempSync(join(tmpdir(), 'skills-checkout-'));

  execSync(
    `git clone --depth 1 --branch "${ref}" "https://x-access-token:${GH_TOKEN}@github.com/commercetools-demo/skills.git" "${tmpDir}"`,
    { stdio: 'inherit' }
  );

  // Optional SHA verification
  if (sha) {
    const actual = execSync(`git -C "${tmpDir}" rev-parse HEAD`, { stdio: 'pipe' })
      .toString()
      .trim();
    if (actual !== sha) {
      console.error(
        `ERROR: SHA mismatch — force-push happened between dispatch and checkout`
      );
      process.exit(1);
    }
  }

  // Check skill directory exists
  const skillSrcDir = join(tmpDir, 'skills', skillName);
  if (!existsSync(skillSrcDir)) {
    console.error(
      `ERROR: skill '${skillName}' not found at ref '${ref}'. Check the skills repo has this directory.`
    );
    process.exit(1);
  }

  // Copy into .claude/skills/
  execSync('mkdir -p .claude/skills', { stdio: 'inherit' });
  const destDir = join('.claude', 'skills', skillName);
  cpSync(skillSrcDir, destDir, { recursive: true });

  console.log(`Checked out ${skillName}@${ref} into .claude/skills/${skillName}/`);

  // Copy HARNESS.md if present (per-run test instructions from the skills branch)
  const harnessSrc = join(tmpDir, 'skills', skillName, 'HARNESS.md');
  if (existsSync(harnessSrc)) {
    copyFileSync(harnessSrc, '.harness-instructions.md');
    console.log('Copied HARNESS.md → .harness-instructions.md');
  } else {
    console.log('No HARNESS.md found — skipping harness instructions');
  }
} catch (err) {
  if (err.message) console.error('ERROR:', err.message);
  cleanup();
  process.exit(1);
}
