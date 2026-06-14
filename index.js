const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const axios = require('axios');

const DATA_PATH = path.join(__dirname, 'data.json');
const HTML_PATH = path.join(__dirname, 'index.html');
const CSS_PATH = path.join(__dirname, 'style.css');
const OUTPUT_PATH = path.join(__dirname, 'output.png');
const DEBUG_PATH = path.join(__dirname, 'debug-before-data.png');
const RENDER_HTML = path.join(__dirname, 'poster-render.html');

// ─── CSS VAR RESOLVER ─────────────────────────────
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
  for (let i = 0; i < 3; i++) {
    resolved = resolved.replace(/var\((--[\w-]+)\)/g, (_, name) => vars[name] ?? name);
  }

  return resolved;
}

// ─── TABLE ─────────────────────────────
function changeClass(value) {
  if (value === 0 || value === '0') return 'change-flat';
  return String(value).startsWith('+') ? 'change-up' : 'change-down';
}

function changeLabel(value) {
  return String(value) === '0' ? '—' : String(value);
}

function buildTableRows(items = []) {
  if (!Array.isArray(items)) items = [];

  return items.map(item => `
    <tr>
      <td>
        <div>${item?.model ?? ''}</div>
        <div>${item?.trim ?? ''}</div>
      </td>
      <td>${item?.price ?? ''}</td>
      <td class="${changeClass(item?.change ?? 0)}">
        ${changeLabel(item?.change ?? 0)}
      </td>
    </tr>
  `).join('');
}

// ─── CHROMIUM ─────────────────────────────
function resolveChromium() {
  const candidates = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    (() => {
      try { return execSync('which chromium', { encoding: 'utf8' }).trim(); }
      catch { return null; }
    })(),
    '/usr/bin/chromium',
    '/usr/bin/google-chrome'
  ];

  for (const p of candidates) {
    if (p && fs.existsSync(p)) return p;
  }

  return undefined;
}

// ─── TELEGRAM TEST ─────────────────────────────
async function sendToTelegram(filePath) {
  const TOKEN = process.env.BOT_TOKEN;
  const CHAT_ID = process.env.CHAT_ID;

  if (!TOKEN || !CHAT_ID) {
    console.log('⚠️ Telegram env not set → skipping send');
    return;
  }

  console.log('📤 Sending to Telegram...');

  try {
    const url = `https://api.telegram.org/bot${TOKEN}/sendPhoto`;

    const formData = new FormData();
    formData.append('chat_id', CHAT_ID);
    formData.append('photo', fs.createReadStream(filePath));

    await axios.post(url, formData, {
      headers: formData.getHeaders()
    });

    console.log('✅ Telegram send SUCCESS');
  } catch (err) {
    console.error('❌ Telegram send FAILED:', err?.response?.data || err.message);
  }
}

// ─── MAIN ─────────────────────────────
async function generatePoster(data) {
  const rawCss = fs.readFileSync(CSS_PATH, 'utf8');
  const css = resolveCssVars(rawCss);
  const html = fs.readFileSync(HTML_PATH, 'utf8');

  const finalHtml = html
    .replace('</head>', `<style>${css}</style></head>`)
    .replace('{{DATE}}', data?.date ?? '')
    .replace('{{DAY_NAME}}', data?.dayName ?? '')
    .replace('{{SAIPA_ROWS}}', buildTableRows(data?.saipa))
    .replace('{{IKCO_ROWS}}', buildTableRows(data?.iranKhodro));

  const browser = await puppeteer.launch({
    headless: true,
    ...(resolveChromium() ? { executablePath: resolveChromium() } : {}),
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1080, height: 1080 });

  await page.setContent(finalHtml, { waitUntil: 'networkidle0' });

  await page.evaluate(() => document.fonts?.ready);
  await new Promise(r => setTimeout(r, 1500));

  await page.screenshot({ path: OUTPUT_PATH });
  await page.screenshot({ path: DEBUG_PATH });

  await browser.close();

  console.log('🖼 Poster created:', OUTPUT_PATH);

  // 🔥 TEST REAL TELEGRAM SEND
  await sendToTelegram(OUTPUT_PATH);
}

// ─── ENTRY ─────────────────────────────
(async () => {
  let data = {};

  try {
    data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  } catch {}

  const args = process.argv.slice(2);
  if (args.length > 0) {
    try {
      Object.assign(data, JSON.parse(args[0]));
    } catch {}
  }

  data.saipa = data.saipa ?? [];
  data.iranKhodro = data.iranKhodro ?? [];

  await generatePoster(data);
})();
