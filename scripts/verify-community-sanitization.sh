#!/usr/bin/env bash
set -euo pipefail

script_path='scripts/verify-community-sanitization.sh'
patterns=(
  "YO""FC"
  "yo""fc"
  "长""飞"
  "git""cc"
  "fibre""wms"
  "hrms.""yofc"
  "wms_""ai"
  "ai_""agent"
)

failed=0
for pattern in "${patterns[@]}"; do
  if git grep -n -I -i -- "$pattern" -- . ":!$script_path"; then
    failed=1
  fi
  filename_matches=$(git ls-files | grep -iF -- "$pattern" || true)
  if [[ -n "$filename_matches" ]]; then
    printf 'Disallowed tracked filename for %s:\n%s\n' "$pattern" "$filename_matches" >&2
    failed=1
  fi
done

if git grep -n -I -E -- '10\.(140|192|98|90)\.' -- . ":!$script_path"; then
  failed=1
fi

if git grep -n -I -E -- '(^|[^0-9])(5000270|0104486|06996)([^0-9]|$)' -- . ":!$script_path"; then
  failed=1
fi

if [[ "$failed" -ne 0 ]]; then
  printf '%s\n' 'Community sanitization failed: private organization markers remain.' >&2
  exit 1
fi

printf '%s\n' 'Community sanitization passed.'
