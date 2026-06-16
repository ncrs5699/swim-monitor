const { chromium } = require('playwright');
const crypto = require('crypto');
const fs = require('fs');
const https = require('https');

const STATE_FILE = 'state.json';
const SWIM_URL = process.env.SWIM_URL;
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

function sendDiscordNotification(message) {
  const payload = JSON.stringify({ content: message, username: 'Swim Schedule Monitor' });
  return new Promise((resolve, reject) => {
    const url = new URL(DISCORD_WEBHOOK_URL);
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      timeout: 10000
    }, res => resolve(res.statusCode));
    req.on('error', (err) => { console.warn('Discord notification failed:', err.message); resolve(null); });
    req.on('timeout', () => { req.destroy(); console.warn('Discord webhook timed out, skipping'); resolve(null); });
    req.write(payload);
    req.end();
  });
}

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {}
  return { hash: null };
}

function saveState(hash) {
  fs.writeFileSync(STATE_FILE, JSON.stringify({ hash, updatedAt: new Date().toISOString() }, null, 2));
}

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  try {
    await page.goto(SWIM_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    const frames = page.frames();
    const texts = await Promise.all(
      frames.map(f => f.evaluate(() => document.body?.innerText?.trim() || '').catch(() => ''))
    );
    const content = texts.join('\n').trim();
    const hash = crypto.createHash('sha256').update(content).digest('hex');
    const state = loadState();
    const now = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });

    if (!state.hash) {
      console.log('First run — baseline stored.');
      saveState(hash);
      await sendDiscordNotification(`🏊 **Swim Schedule Monitor started**\nNow watching: ${SWIM_URL}\nBaseline captured at ${now} ET`);
    } else if (state.hash !== hash) {
      console.log('Change detected!');
      saveState(hash);
      await sendDiscordNotification(`🚨 **Swim Schedule Changed!**\n\nThe Orange Township swim lesson page was just updated.\n👉 **Register now:** ${SWIM_URL}\n\nDetected at ${now} ET`);
    } else {
      console.log(`No changes at ${now}`);
    }
  } finally {
    await browser.close();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
