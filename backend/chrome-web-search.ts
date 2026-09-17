import puppeteer, { type Browser } from 'puppeteer';

export type BrowserSearchResult = {
  title: string;
  url: string;
  snippet: string;
  source: string;
};

let browserPromise: Promise<Browser> | null = null;

async function getBrowser() {
  if (!browserPromise) {
    browserPromise = puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--no-zygote',
      ],
    }).catch(error => {
      browserPromise = null;
      throw error;
    });
  }
  return browserPromise;
}

function clean(value: string) {
  return value.replace(/\\s+/g, ' ').trim();
}

function googleUrl(query: string) {
  return `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=en&num=10`;
}

async function searchGoogle(query: string, limit: number): Promise<BrowserSearchResult[]> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setUserAgent(
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari/537.36 SIRE/1.0',
    );
    await page.setViewport({ width: 1365, height: 900 });
    await page.goto(googleUrl(query), { waitUntil: 'domcontentloaded', timeout: 20000 });
    await new Promise(resolve => setTimeout(resolve, 900));

    const title = await page.title();
    const bodyText = clean(await page.locator('body').innerText().catch(() => ''));
    if (/unusual traffic|captcha|not a robot|automated queries/i.test(`${title} ${bodyText.slice(0, 3000)}`)) {
      throw new Error('Google presented an anti-bot challenge');
    }

    const results = await page.evaluate(() => {
      const anchors = Array.from(document.querySelectorAll('a'));
      const seen = new Set<string>();
      const output: Array<{ title: string; url: string; snippet: string }> = [];
      for (const anchor of anchors) {
        const href = (anchor as HTMLAnchorElement).href;
        const text = (anchor.textContent || '').replace(/\\s+/g, ' ').trim();
        if (!href || !text || !/^https?:/i.test(href)) continue;
        const parsed = new URL(href);
        if (parsed.hostname === 'www.google.com' || parsed.hostname === 'google.com') continue;
        if (seen.has(href)) continue;
        const container = anchor.closest('div');
        const snippet = (container?.textContent || '').replace(/\\s+/g, ' ').trim();
        if (text.length < 3) continue;
        seen.add(href);
        output.push({ title: text.slice(0, 240), url: href, snippet: snippet.slice(0, 500) });
      }
      return output;
    });

    return results.slice(0, Math.min(Math.max(limit, 1), 10)).map(item => ({
      ...item,
      title: clean(item.title),
      snippet: clean(item.snippet),
      source: new URL(item.url).hostname,
    }));
  } finally {
    await page.close().catch(() => undefined);
  }
}

export async function chromeWebSearch(query: string, limit = 8) {
  const results = await searchGoogle(query, limit);
  if (!results.length) throw new Error('Chrome Google search returned no usable results');
  return {
    query,
    provider: 'Chrome + Google Search',
    browser: 'Chromium (Puppeteer)',
    results,
  };
}

export async function closeChromeBrowser() {
  if (!browserPromise) return;
  const browser = await browserPromise.catch(() => null);
  browserPromise = null;
  await browser?.close().catch(() => undefined);
}
