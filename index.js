const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const os = require('os');
const axios = require('axios');

const DATA_PATH = path.join(__dirname, 'data.json');
const HTML_PATH = path.join(__dirname, 'index.html');
const CSS_PATH = path.join(__dirname, 'style.css');
const OUTPUT_PATH = path.join(__dirname, 'output.png');
const DEBUG_PATH = path.join(__dirname, 'debug.png');
const RENDER_HTML = path.join(__dirname, 'render.html');

// ─── ENV ─────────────────────────────
const BOT_TOKEN = process.env.BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;

// ─── CSS VAR RESOLVER ────────────────
function resolveCssVars(css) {
  const vars = {};
  const rootBlock = css.match(/:root\s*\{([^}]+)\}/);

  if (rootBlock) {
    rootBlock[1].split('\n').forEach(line => {
      const m = line.match(/^\s*(--[\w-]+)\s*:\s*(.+?)\s*;/);
      if (m) vars[m[1]] = m[2].trim();
    });
  }

  let resolved = css;
  for (let i = 0; i < 3; i++) {
    resolved = resolved.replace(/var\((--[\w-]+)\)/g, (_, v) => vars[v] || v);
  }

  return resolved;
}

// ─── TABLE BUILDER ───────────────────
function buildTableRows(items = []) {
  return (Array.isArray(items) ? items : []).map(item => `
    <tr>
      <td>
        <div>${item?.model || ''}</div>
        <small>${item?.trim || ''}</small>
      </td>
      <td>${item?.price || ''} میلیون</td>
      <td>${item?.change ?? 0}</td>
    </tr>
  `).join('');
}

// ─── CHROMIUM ────────────────────────
function resolveChromium() {
  const { execSync } = require('child_process');

  const candidates = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    (() => { try { return execSync('which chromium', { encoding: 'utf8' }).trim(); } catch { return null; } })(),
    '/usr/bin/chromium',
    '/usr/bin/google-chrome'
  ];

  for (const p of candidates) {
    if (p && fs.existsSync(p)) return p;
  }

  return undefined;
}

// ─── TELEGRAM TEST ───────────────────
async function sendToTelegram(imagePath) {
  if (!BOT_TOKEN || !CHAT_ID) {
    console.log('⚠️ Telegram env not set → skip sending');
    return;
  }

  try {
    await axios.post(
      `https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`,
      {
        chat_id: CHAT_ID,
        photo: fs.createReadStream(imagePath)
      },
      { headers: { 'Content-Type': 'multipart/form-data' } }
    );

    console.log('📨 Sent to Telegram successfully');
  } catch (err) {
    console.error('❌ Telegram error:', err?.response?.data || err.message);
  }
}

// ─── MAIN RENDER ─────────────────────
async function generatePoster(data) {
  const rawCss = fs.readFileSync(CSS_PATH, 'utf8');
  const html = fs.readFileSync(HTML_PATH, 'utf8');

  const finalHtml = html
    .replace('</head>', `<style>${resolveCssVars(rawCss)}</style></head>`)
    .replace('{{DATE}}', data?.date || '')
    .replace('{{DAY_NAME}}', data?.dayName || '')
    .replace('{{SAIPA_ROWS}}', buildTableRows(data?.saipa))
    .replace('{{IKCO_ROWS}}', buildTableRows(data?.iranKhodro));

  fs.writeFileSync(RENDER_HTML, finalHtml);

  const browser = await puppeteer.launch({
    headless: true,
    executablePath: resolveChromium(),
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage'
    ]
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1080, height: 1080 });

  await page.setContent(finalHtml, { waitUntil: 'domcontentloaded' });

  // جایگزین waitForTimeout (مشکل قبلی تو همین بود)
  await page.waitForSelector('body');

  await new Promise(r => setTimeout(r, 1500));

  await page.screenshot({ path: DEBUG_PATH });
  await page.screenshot({ path: OUTPUT_PATH });

  await browser.close();

  console.log('✅ Poster generated');

  await sendToTelegram(OUTPUT_PATH);
}

// ─── ENTRY ───────────────────────────
(async () => {
  let data = {};

  try {
    data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  } catch {}

  const args = process.argv.slice(2);
  if (args[0]) {
    try { Object.assign(data, JSON.parse(args[0])); } catch {}
  }

  data.saipa = data.saipa || [];
  data.iranKhodro = data.iranKhodro || [];

  await generatePoster(data);
})();
