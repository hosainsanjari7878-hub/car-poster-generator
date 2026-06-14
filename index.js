const puppeteer = require('puppeteer');
const fs   = require('fs');
const path = require('path');
const os   = require('os');

const DATA_PATH    = path.join(__dirname, 'data.json');
const HTML_PATH    = path.join(__dirname, 'index.html');
const CSS_PATH     = path.join(__dirname, 'style.css');
const OUTPUT_PATH  = path.join(__dirname, 'output.png');
const DEBUG_PATH   = path.join(__dirname, 'debug-before-data.png');
const RENDER_HTML  = path.join(__dirname, 'poster-render.html');

// ─── CSS VAR RESOLVER ────────────────────────────────────────────────────────
function resolveCssVars(css) {
  const vars = {};

  const rootBlock = css.match(/:root\s*\{([^}]+)\}/);
  if (rootBlock) {
    const lines = rootBlock[1].split('\n');
    for (const line of lines) {
      const m = line.match(/^\s*(--[\w-]+)\s*:\s*(.+?)\s*;/);
      if (m) vars[m[1]] = m[2].trim();
    }
  }

  let resolved = css;
  for (let pass = 0; pass < 3; pass++) {
    resolved = resolved.replace(/var\((--[\w-]+)\)/g, (_, name) => vars[name] ?? name);
  }

  return resolved;
}

// ─── TABLE BUILDER ────────────────────────────────────────────────────────────
function changeClass(value) {
  if (value === '0' || value === 0) return 'change-flat';
  return String(value).startsWith('+') ? 'change-up' : 'change-down';
}

function changeLabel(value) {
  const str = String(value);
  return str === '0' ? '—' : str;
}

function buildTableRows(items) {
  return items.map(item => `
    <tr>
      <td class="td-model">
        <div class="model-name">${item.model}</div>
        <div class="model-trim">${item.trim}</div>
      </td>
      <td class="td-price">
        <span class="price-value">${item.price}</span>
        <span class="price-unit">میلیون تومان</span>
      </td>
      <td class="td-change">
        <span class="change-badge ${changeClass(item.change)}">
          ${changeLabel(item.change)}
        </span>
      </td>
    </tr>
  `).join('\n');
}

// ─── CHROMIUM RESOLVER ────────────────────────────────────────────────────────
function resolveChromium() {
  const { execSync } = require('child_process');

  const candidates = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    (() => { try { return execSync('which chromium', { encoding: 'utf8' }).trim(); } catch { return null; } })(),
    (() => { try { return execSync('which chromium-browser', { encoding: 'utf8' }).trim(); } catch { return null; } })(),
    `${os.homedir()}/.cache/puppeteer/chrome/linux-127.0.6533.88/chrome-linux64/chrome`,
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/usr/bin/google-chrome',
  ];

  for (const p of candidates) {
    if (p && fs.existsSync(p)) {
      console.log(`🔍 Chromium → ${p}`);
      return p;
    }
  }

  console.warn('⚠️ No explicit Chromium found — auto-detecting');
  return undefined;
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
async function generatePoster(data) {
  const rawCss = fs.readFileSync(CSS_PATH, 'utf8');
  const resolvedCss = resolveCssVars(rawCss);

  const templateHtml = fs.readFileSync(HTML_PATH, 'utf8');

  const htmlWithCss = templateHtml.replace(
    '</head>',
    `<style>\n${resolvedCss}\n</style>\n</head>`
  );

  const browser = await puppeteer.launch({
    headless: true,
    ...(resolveChromium() ? { executablePath: resolveChromium() } : {}),
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--force-color-profile=srgb',
      '--font-render-hinting=none',
    ],
  });

  const page = await browser.newPage();

  page.on('console', msg => console.log(`[browser:${msg.type()}]`, msg.text()));
  page.on('pageerror', err => console.error('[page error]', err.message));

  await page.setViewport({ width: 1080, height: 1080, deviceScaleFactor: 1 });

  const finalHtml = htmlWithCss
    .replace('{{DATE}}', data.date)
    .replace('{{DAY_NAME}}', data.dayName || '')
    .replace('{{SAIPA_ROWS}}', buildTableRows(data.saipa))
    .replace('{{IKCO_ROWS}}', buildTableRows(data.iranKhodro));

  // 🔥 DEBUG: save final HTML
  fs.writeFileSync(RENDER_HTML, finalHtml, 'utf8');

  console.log('🌐 Rendering final HTML...');

  // ✅ FIX اصلی اینجاست
  await page.setContent(finalHtml, {
    waitUntil: 'networkidle0'
  });

  await page.evaluate(() => document.fonts.ready);
  await new Promise(r => setTimeout(r, 2000));

  // Debug screenshot
  await page.screenshot({
    path: DEBUG_PATH,
    type: 'png'
  });

  console.log('📸 Debug saved');

  // Final screenshot
  await page.screenshot({
    path: OUTPUT_PATH,
    type: 'png'
  });

  await browser.close();

  console.log('✅ Done → output.png generated');
}

// ─── ENTRY ────────────────────────────────────────────────────────────────────
(async () => {
  const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));

  const args = process.argv.slice(2);
  if (args.length > 0) {
    try {
      Object.assign(data, JSON.parse(args[0]));
    } catch {
      console.warn('⚠️ Invalid override JSON');
    }
  }

  await generatePoster(data);
})();