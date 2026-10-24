#!/usr/bin/env bash
set -euo pipefail

tmp_dir="$(mktemp -d)"
tmp_site="${tmp_dir}/site"

cleanup() {
  rm -rf "${tmp_dir}"
}
trap cleanup EXIT

bundle exec jekyll build -d "${tmp_site}" >/dev/null

if [ ! -f "${tmp_site}/blog/index.html" ]; then
  echo "blog page was not generated" >&2
  exit 1
fi

transforms_runtime="$(PATH="$HOME/.rbenv/shims:$PATH" bundle exec ruby -e 'spec = Gem.loaded_specs["al_folio_distill"]; puts(spec ? File.join(spec.full_gem_path, "assets/js/distillpub/transforms.v2.js") : "")')"
if [ ! -f "${transforms_runtime}" ]; then
  echo "distill transforms runtime missing from installed al_folio_distill gem" >&2
  exit 1
fi

expected_transforms_hash="5d85590f5652b910ab2411019749c83ef5a5a3fbb9b739adc92b4557b6bf3d39"
actual_transforms_hash="$(ruby -rdigest -e 'print Digest::SHA256.file(ARGV[0]).hexdigest' "${transforms_runtime}")"
if [ "${actual_transforms_hash}" != "${expected_transforms_hash}" ]; then
  echo "unexpected distill transforms runtime hash: ${actual_transforms_hash}" >&2
  exit 1
fi

echo "distill runtime integration check passed"
