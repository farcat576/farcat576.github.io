#!/usr/bin/env bash
set -euo pipefail

tmp_dir="$(mktemp -d)"
tmp_site="${tmp_dir}/site"

cleanup() {
  rm -rf "${tmp_dir}"
}
trap cleanup EXIT

bundle exec jekyll build -d "${tmp_site}" >/dev/null

blog_index="${tmp_site}/blog/index.html"
[ -f "${blog_index}" ] || {
  echo "blog page was not generated at ${blog_index}" >&2
  exit 1
}

if find "${tmp_site}/blog" -mindepth 2 -type f -name index.html -print -quit | grep -q .; then
  echo "placeholder blog posts or archives were generated" >&2
  exit 1
fi

echo "empty blog integration check passed"
