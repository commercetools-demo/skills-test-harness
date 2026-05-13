#!/usr/bin/env bash
# static-checks-b2b.sh — B2B static analysis checks
#
# Usage: bash tests/static-checks-b2b.sh <output-dir>
#
# Checks the generated storefront code for B2B anti-patterns.
# Includes all B2C checks plus B2B-specific checks.
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

log "=== B2B Static Checks — $(date -u '+%Y-%m-%dT%H:%M:%SZ') ==="
log "Output directory: $OUTPUT_DIR"
log ""

# ===========================================================================
# SHARED B2C CHECKS (also apply to B2B)
# ===========================================================================

# ---------------------------------------------------------------------------
# CHECK 1: NEXT_PUBLIC_CTP anywhere
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
# CHECK 2: NEXT_PUBLIC_CTP_CLIENT_SECRET specifically
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
# CHECK 3: 'use client' files importing from lib/ct
# ---------------------------------------------------------------------------
log ""
log "--- CHECK 3: 'use client' files importing from @/lib/ct ---"
while IFS= read -r filepath; do
  [[ -z "$filepath" ]] && continue
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
# CHECK 4: Direct next/link or next/navigation imports (non-layout files)
# ---------------------------------------------------------------------------
log ""
log "--- CHECK 4: Direct next/link or next/navigation imports (should use @/i18n/routing) ---"
while IFS= read -r match; do
  [[ -z "$match" ]] && continue
  file="${match%%:*}"
  rest="${match#*:}"
  lineno="${rest%%:*}"
  content="${rest#*:}"
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
log "--- CHECK 5: apiRoot.customers().login() — legacy login endpoint ---"
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

# ===========================================================================
# B2B-SPECIFIC CHECKS
# ===========================================================================

# ---------------------------------------------------------------------------
# CHECK 7: apiRoot.carts() without asAssociate chain (B2B carts must use associate endpoint)
# ---------------------------------------------------------------------------
log ""
log "--- CHECK 7: apiRoot.carts() without asAssociate chain (B2B cart operations must use asAssociate) ---"
while IFS= read -r match; do
  [[ -z "$match" ]] && continue
  file="${match%%:*}"
  rest="${match#*:}"
  lineno="${rest%%:*}"
  content="${rest#*:}"
  # Warn if line contains apiRoot.carts() but does NOT also contain asAssociate
  if echo "$content" | grep -q 'apiRoot\.carts()'; then
    if ! echo "$content" | grep -q 'asAssociate'; then
      warn "BARE_APIROOT_CARTS" "$file:$lineno" "$content"
    fi
  fi
done < <(grep -rn --include="*.ts" --include="*.tsx" --include="*.js" \
  'apiRoot\.carts()' \
  "$OUTPUT_DIR" 2>/dev/null || true)

# ---------------------------------------------------------------------------
# CHECK 8: apiRoot.shoppingLists() without asAssociate (purchase lists must use associate endpoint)
# ---------------------------------------------------------------------------
log ""
log "--- CHECK 8: apiRoot.shoppingLists() without asAssociate (purchase lists must use associate chain) ---"
while IFS= read -r match; do
  [[ -z "$match" ]] && continue
  file="${match%%:*}"
  rest="${match#*:}"
  lineno="${rest%%:*}"
  content="${rest#*:}"
  # Only flag in purchase-list related files
  if [[ "$file" == *"purchase"* ]] || [[ "$file" == *"shopping"* ]] || [[ "$file" == *"wishlist"* ]] || [[ "$file" == *"list"* ]]; then
    if echo "$content" | grep -q 'apiRoot\.shoppingLists()'; then
      if ! echo "$content" | grep -q 'asAssociate'; then
        warn "BARE_APIROOT_SHOPPING_LISTS" "$file:$lineno" "$content"
      fi
    fi
  fi
done < <(grep -rn --include="*.ts" --include="*.tsx" --include="*.js" \
  'apiRoot\.shoppingLists()' \
  "$OUTPUT_DIR" 2>/dev/null || true)

# Also catch non-purchase-list files with bare shoppingLists
while IFS= read -r match; do
  [[ -z "$match" ]] && continue
  file="${match%%:*}"
  rest="${match#*:}"
  lineno="${rest%%:*}"
  content="${rest#*:}"
  if echo "$content" | grep -q 'apiRoot\.shoppingLists()'; then
    if ! echo "$content" | grep -q 'asAssociate'; then
      warn "BARE_APIROOT_SHOPPING_LISTS" "$file:$lineno" "$content"
    fi
  fi
done < <(grep -rn --include="*.ts" --include="*.tsx" --include="*.js" \
  'apiRoot\.shoppingLists()' \
  "$OUTPUT_DIR" 2>/dev/null || true)

# ---------------------------------------------------------------------------
# CHECK 9: StagedQuote.sellerComment used for display (should use Quote.sellerComment)
# ---------------------------------------------------------------------------
log ""
log "--- CHECK 9: StagedQuote.sellerComment used for display (should use Quote.sellerComment) ---"
while IFS= read -r match; do
  [[ -z "$match" ]] && continue
  file="${match%%:*}"
  rest="${match#*:}"
  lineno="${rest%%:*}"
  content="${rest#*:}"
  warn "STAGED_QUOTE_SELLER_COMMENT" "$file:$lineno" "$content"
done < <(grep -rn --include="*.ts" --include="*.tsx" --include="*.js" \
  'StagedQuote.*sellerComment\|stagedQuote.*sellerComment\|\.sellerComment.*staged\|stagedQuote\b.*comment' \
  "$OUTPUT_DIR" 2>/dev/null || true)

# ---------------------------------------------------------------------------
# CHECK 10: session.locale used in URL routing context (should be session.urlLocale)
# ---------------------------------------------------------------------------
log ""
log "--- CHECK 10: session.locale used in routing/URL context (should be session.urlLocale for URL params) ---"
while IFS= read -r match; do
  [[ -z "$match" ]] && continue
  file="${match%%:*}"
  rest="${match#*:}"
  lineno="${rest%%:*}"
  content="${rest#*:}"
  # Flag session.locale used in redirect, pathname, or URL-building contexts
  if echo "$content" | grep -qE 'redirect|pathname|router\.push|href.*session\.locale|session\.locale.*href|params.*session\.locale'; then
    warn "SESSION_LOCALE_IN_URL_CONTEXT" "$file:$lineno" "$content"
  fi
done < <(grep -rn --include="*.ts" --include="*.tsx" --include="*.js" \
  'session\.locale' \
  "$OUTPUT_DIR" 2>/dev/null || true)

# ===========================================================================
# Summary
# ===========================================================================
log ""
log "=== SUMMARY ==="
log "${WARN_COUNT} warnings found"

printf '%s\n' "${ALL_LINES[@]}" > "$RESULTS_FILE"

echo "Results written to $RESULTS_FILE"

# Always exit 0 — warnings only; judge is the authoritative scorer
exit 0
