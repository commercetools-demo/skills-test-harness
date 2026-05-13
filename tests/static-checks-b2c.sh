#!/usr/bin/env bash
# static-checks-b2c.sh — B2C static analysis checks
#
# Usage: bash tests/static-checks-b2c.sh <output-dir>
#
# Checks the generated storefront code for B2C anti-patterns.
# ALWAYS exits 0 — all findings are warnings only.
# The judge LLM is the authoritative scorer; these checks feed into its context.
#
# Output: findings printed to stdout AND written to static-check-results.txt
#         in the current working directory.

set -euo pipefail

OUTPUT_DIR="${1:-./output}"
RESULTS_FILE="static-check-results.txt"
WARN_COUNT=0

if [[ ! -d "$OUTPUT_DIR" ]]; then
  echo "[ERROR] Output directory not found: $OUTPUT_DIR"
  echo "Output directory not found: $OUTPUT_DIR" > "$RESULTS_FILE"
  exit 0
fi

# Accumulate all output lines so we can write them to the results file at the end
declare -a ALL_LINES=()

log() {
  echo "$1"
  ALL_LINES+=("$1")
}

warn() {
  local check="$1"
  local file="$2"
  local line="$3"
  local msg="[WARN] ${check}: ${file}: ${line}"
  log "$msg"
  WARN_COUNT=$((WARN_COUNT + 1))
}

log "=== B2C Static Checks — $(date -u '+%Y-%m-%dT%H:%M:%SZ') ==="
log "Output directory: $OUTPUT_DIR"
log ""

# ---------------------------------------------------------------------------
# CHECK 1: NEXT_PUBLIC_CTP anywhere (CT credentials must never be public)
# ---------------------------------------------------------------------------
log "--- CHECK 1: NEXT_PUBLIC_CTP env var references ---"
while IFS= read -r match; do
  [[ -z "$match" ]] && continue
  file="${match%%:*}"
  rest="${match#*:}"
  lineno="${rest%%:*}"
  content="${rest#*:}"
  warn "NEXT_PUBLIC_CTP" "$file:$lineno" "$content"
done < <(grep -rn --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" --include="*.env*" --include="*.example" \
  'NEXT_PUBLIC_CTP' "$OUTPUT_DIR" 2>/dev/null || true)

# ---------------------------------------------------------------------------
# CHECK 2: NEXT_PUBLIC_CTP_CLIENT_SECRET specifically (extra loud)
# ---------------------------------------------------------------------------
log ""
log "--- CHECK 2: NEXT_PUBLIC_CTP_CLIENT_SECRET (CRITICAL — client secret must NEVER be public) ---"
while IFS= read -r match; do
  [[ -z "$match" ]] && continue
  file="${match%%:*}"
  rest="${match#*:}"
  lineno="${rest%%:*}"
  content="${rest#*:}"
  warn "NEXT_PUBLIC_CTP_CLIENT_SECRET" "$file:$lineno" "$content"
  log "[WARN] ^^^ THIS IS A SEVERE SECURITY VIOLATION: client secret exposed as NEXT_PUBLIC variable"
done < <(grep -rn --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" --include="*.env*" --include="*.example" \
  'NEXT_PUBLIC_CTP_CLIENT_SECRET' "$OUTPUT_DIR" 2>/dev/null || true)

# ---------------------------------------------------------------------------
# CHECK 3: 'use client' files importing from lib/ct (BFF boundary violation)
# ---------------------------------------------------------------------------
log ""
log "--- CHECK 3: 'use client' files importing from @/lib/ct ---"
while IFS= read -r filepath; do
  [[ -z "$filepath" ]] && continue
  # Check if this file has both 'use client' and an import from @/lib/ct
  if grep -q "'use client'" "$filepath" 2>/dev/null; then
    while IFS= read -r match; do
      [[ -z "$match" ]] && continue
      lineno="${match%%:*}"
      content="${match#*:}"
      warn "USE_CLIENT_IMPORTS_LIB_CT" "$filepath:$lineno" "$content"
    done < <(grep -n "from '@/lib/ct\|from \"@/lib/ct" "$filepath" 2>/dev/null || true)
  fi
done < <(find "$OUTPUT_DIR" -type f \( -name "*.ts" -o -name "*.tsx" \) 2>/dev/null || true)

# ---------------------------------------------------------------------------
# CHECK 4: Direct next/link or next/navigation imports (should use @/i18n/routing)
# ---------------------------------------------------------------------------
log ""
log "--- CHECK 4: Direct next/link or next/navigation imports (should use @/i18n/routing) ---"
while IFS= read -r match; do
  [[ -z "$match" ]] && continue
  file="${match%%:*}"
  rest="${match#*:}"
  lineno="${rest%%:*}"
  content="${rest#*:}"
  # Skip layout files — they are allowed to import directly
  if [[ "$file" == *"layout"* ]]; then
    continue
  fi
  warn "DIRECT_NEXT_ROUTING_IMPORT" "$file:$lineno" "$content"
done < <(grep -rn --include="*.ts" --include="*.tsx" \
  "from 'next/link'\|from \"next/link\"\|from 'next/navigation'\|from \"next/navigation\"" \
  "$OUTPUT_DIR" 2>/dev/null || true)

# ---------------------------------------------------------------------------
# CHECK 5: apiRoot.customers().login() — wrong login endpoint
# ---------------------------------------------------------------------------
log ""
log "--- CHECK 5: apiRoot.customers().login() — legacy login endpoint (should be apiRoot.login().post()) ---"
while IFS= read -r match; do
  [[ -z "$match" ]] && continue
  file="${match%%:*}"
  rest="${match#*:}"
  lineno="${rest%%:*}"
  content="${rest#*:}"
  warn "WRONG_LOGIN_ENDPOINT" "$file:$lineno" "$content"
done < <(grep -rn --include="*.ts" --include="*.tsx" --include="*.js" \
  'customers()\.login\(\|customers()\.login()' \
  "$OUTPUT_DIR" 2>/dev/null || true)

# Also catch the pattern without immediate invocation
while IFS= read -r match; do
  [[ -z "$match" ]] && continue
  file="${match%%:*}"
  rest="${match#*:}"
  lineno="${rest%%:*}"
  content="${rest#*:}"
  warn "WRONG_LOGIN_ENDPOINT" "$file:$lineno" "$content"
done < <(grep -rn --include="*.ts" --include="*.tsx" --include="*.js" \
  '\.customers()\.login' \
  "$OUTPUT_DIR" 2>/dev/null || true)

# ---------------------------------------------------------------------------
# CHECK 6: apiRoot imported in 'use client' files
# ---------------------------------------------------------------------------
log ""
log "--- CHECK 6: apiRoot imported in 'use client' files ---"
while IFS= read -r filepath; do
  [[ -z "$filepath" ]] && continue
  if grep -q "'use client'" "$filepath" 2>/dev/null; then
    while IFS= read -r match; do
      [[ -z "$match" ]] && continue
      lineno="${match%%:*}"
      content="${match#*:}"
      warn "APIROOT_IN_CLIENT_FILE" "$filepath:$lineno" "$content"
    done < <(grep -n "import.*apiRoot\|import { apiRoot" "$filepath" 2>/dev/null || true)
  fi
done < <(find "$OUTPUT_DIR" -type f \( -name "*.ts" -o -name "*.tsx" \) 2>/dev/null || true)

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
log ""
log "=== SUMMARY ==="
log "${WARN_COUNT} warnings found"

# Write all output to results file
printf '%s\n' "${ALL_LINES[@]}" > "$RESULTS_FILE"

echo "Results written to $RESULTS_FILE"

# Always exit 0 — warnings only; judge is the authoritative scorer
exit 0
