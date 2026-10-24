const { PNG } = require("pngjs");
const pixelmatchModule = require("pixelmatch");
const pixelmatch = pixelmatchModule.default || pixelmatchModule;

// Slippy-map basemap tiles, requested by the Plotly figure embedded in the
// distill post. Blocked because pixel-diffing a map whose artwork streams from
// a third-party CDN is not reproducible: the two sides of a parity comparison
// are fetched seconds apart and nothing guarantees they render the same tiles.
//
// The v0.16.3 baseline additionally requests a Stamen endpoint that was retired
// and no longer serves, which is a plausible (though unconfirmed) contributor
// to the intermittent `waitUntil: "networkidle"` timeouts seen on the baseline
// distill page — a host that black-holes a connection keeps the request in
// flight until Chromium gives up. Both basemaps are listed either way, so the
// candidate and the baseline are stubbed symmetrically.
const BLOCKED_DOMAINS = [
  "google-analytics.com",
  "plausible.io",
  "badge.dimensions.ai",
  "cartocdn.com",
  "openstreetmap.org",
  "stadiamaps.com",
  "mapbox.com",
];
// Stamen sharded its tiles across stamen-tiles-{a,b,c,d}.a.ssl.fastly.net.
// Matching the suffix would blocklist Fastly at large, so match the prefix.
const BLOCKED_HOST_PREFIXES = ["stamen-tiles"];

async function applyNetworkStubs(page) {
  const matchesBlockedHost = (requestUrl) => {
    try {
      const hostname = new URL(requestUrl).hostname.toLowerCase();
      return (
        BLOCKED_DOMAINS.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`)) ||
        BLOCKED_HOST_PREFIXES.some((prefix) => hostname.startsWith(prefix))
      );
    } catch {
      return false;
    }
  };

  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (matchesBlockedHost(url)) {
      route.abort();
      return;
    }
    route.continue();
  });
}

async function preparePage(page, themeSetting = "light") {
  await page.addInitScript((setting) => {
    window.localStorage.setItem("theme", setting);
  }, themeSetting);
  await applyNetworkStubs(page);
}

async function stabilizeVisuals(page) {
  await page.evaluate(() => {
    const styleId = "__alfolio_visual_stabilize";
    if (document.getElementById(styleId)) {
      return;
    }
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = `
      *, *::before, *::after {
        animation-duration: 0ms !important;
        animation-delay: 0ms !important;
        caret-color: transparent !important;
      }
      .altmetric-embed,
      .__dimensions_badge_embed__,
      iframe.giscus-frame,
      #giscus_thread,
      .cc-window {
        visibility: hidden !important;
      }
    `;
    document.head.appendChild(style);
  });
}

function diffRatio(actualPng, baselinePng) {
  const width = Math.min(actualPng.width, baselinePng.width);
  const height = Math.min(actualPng.height, baselinePng.height);
  const actual = new PNG({ width, height });
  const baseline = new PNG({ width, height });
  PNG.bitblt(actualPng, actual, 0, 0, width, height, 0, 0);
  PNG.bitblt(baselinePng, baseline, 0, 0, width, height, 0, 0);
  const diff = new PNG({ width, height });
  const changed = pixelmatch(actual.data, baseline.data, diff.data, width, height, {
    threshold: 0.1,
    includeAA: false,
  });
  return changed / (width * height);
}

async function compareWithBaseline(context, currentPage, route, themeSetting, options = {}) {
  const fullPage = options.fullPage !== false;

  const captureParityScreenshot = async (page) => {
    if (!fullPage) {
      return page.screenshot({ fullPage: false });
    }

    const maxScreenshotDimension = 32760;
    const dimensions = await page.evaluate(() => {
      const doc = document.documentElement;
      const body = document.body || { scrollWidth: 0, scrollHeight: 0 };
      return {
        width: Math.max(doc.scrollWidth, body.scrollWidth, doc.clientWidth),
        height: Math.max(doc.scrollHeight, body.scrollHeight, doc.clientHeight),
      };
    });

    if (dimensions.width <= maxScreenshotDimension && dimensions.height <= maxScreenshotDimension) {
      return page.screenshot({ fullPage: true });
    }

    const viewport = page.viewportSize() || { width: 1280, height: 720 };
    const clipWidth = Math.max(1, Math.min(Math.max(viewport.width, dimensions.width), maxScreenshotDimension));
    const clipHeight = Math.max(1, Math.min(Math.max(viewport.height, dimensions.height), maxScreenshotDimension));

    return page.screenshot({
      fullPage: false,
      clip: {
        x: 0,
        y: 0,
        width: clipWidth,
        height: clipHeight,
      },
    });
  };

  const baselineURL = process.env.BASELINE_URL;
  if (!baselineURL) {
    return null;
  }
  const normalizedRoute = route.replace(/^\//, "");
  const normalizedBaselineRoot = baselineURL.endsWith("/") ? baselineURL : `${baselineURL}/`;
  const baselineTarget = new URL(normalizedRoute, normalizedBaselineRoot).toString();

  const baselinePage = await context.newPage();
  await preparePage(baselinePage, themeSetting);
  await baselinePage.goto(baselineTarget, { waitUntil: "networkidle" });
  await stabilizeVisuals(baselinePage);
  await baselinePage.waitForTimeout(500);
  const baselineBuffer = await captureParityScreenshot(baselinePage);

  await currentPage.goto(normalizedRoute, { waitUntil: "networkidle" });
  await stabilizeVisuals(currentPage);
  await currentPage.waitForTimeout(500);
  const currentBuffer = await captureParityScreenshot(currentPage);

  await baselinePage.close();

  return diffRatio(PNG.sync.read(currentBuffer), PNG.sync.read(baselineBuffer));
}

module.exports = {
  preparePage,
  stabilizeVisuals,
  compareWithBaseline,
};
