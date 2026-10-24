#!/usr/bin/env bash
# Covers al_email_protect: it renders when enabled and renders nothing when
# disabled.
#
# The "off" half is the point. A regression does not raise an error — the Liquid
# tag just returns an empty string and the feature silently disappears. Only
# asserting the rendered output catches that.
set -euo pipefail

tmp_dir="$(mktemp -d)"
cleanup() {
  rm -rf "${tmp_dir}"
}
trap cleanup EXIT

build() {
  local name="$1"
  shift
  local out="${tmp_dir}/site-${name}"
  bundle exec jekyll build "$@" -d "${out}" >/dev/null
  echo "${out}"
}

fail() {
  echo "FAIL: $1" >&2
  exit 1
}

default_site="$(build default)"

# --- al_email_protect -------------------------------------------------------

# Off by default, so this builds with an override rather than changing the
# shipped config: turning it on for the demo site would flip the default for
# everyone who copies this template.
override="${tmp_dir}/protect-email.yml"
printf 'protect_email: true\n' >"${override}"
protected_site="$(build protected --config "_config.yml,${override}")"

# Scope note: this asserts the gating and the runtime, NOT that site-wide
# addresses are obfuscated. `al_folio_core`'s metadata.liquid renders social
# emails itself (`mailto:{{ social[1] | encode_email }}`), so the plugin is not
# consulted for them — a layout has to call {% al_email_protect_link %}. Wiring
# core's socials through the plugin needs a change in that gem; until then,
# asserting "no mailto: anywhere" would be asserting something untrue, and
# asserting "mailto: still present" would codify the gap as correct.
grep -q 'assets/al_email_protect/js/email-protect.js' "${protected_site}/index.html" \
  || fail "email-protect runtime not loaded with protect_email on"
[ -f "${protected_site}/assets/al_email_protect/js/email-protect.js" ] \
  || fail "email-protect runtime referenced but not published"
grep -q 'assets/al_email_protect/css/email-protect.css' "${protected_site}/index.html" \
  || fail "email-protect stylesheet not loaded with protect_email on"
[ -f "${protected_site}/assets/al_email_protect/css/email-protect.css" ] \
  || fail "email-protect stylesheet referenced but not published"

# ...and with it off (the default), the plugin costs nothing.
grep -q 'al_email_protect' "${default_site}/index.html" \
  && fail "email-protect assets loaded while disabled"

echo "new plugin integration checks passed"
