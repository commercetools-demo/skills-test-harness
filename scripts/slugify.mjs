// Lowercases, replaces non-alphanumeric with -, collapses multiples, trims, caps at 30 chars
export function slugify(input) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30);
}

// CLI usage: node scripts/slugify.mjs "feat/cart-fix"
if (process.argv[2]) {
  console.log(slugify(process.argv[2]));
}
