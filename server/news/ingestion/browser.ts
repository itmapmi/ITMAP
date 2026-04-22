import puppeteer, { type Browser } from 'puppeteer';

function getChromiumPath(): string {
  const candidates = [
    process.env.CHROMIUM_PATH,
    '/nix/store/zi4f80l169xlmivz8vja8wlphq74qqk0-chromium-125.0.6422.141/bin/chromium',
  ];
  for (const p of candidates) {
    if (p) return p;
  }
  return 'chromium';
}

let browserLock = false;

async function waitForBrowserSlot(): Promise<void> {
  const maxWait = 30000;
  const start = Date.now();
  while (browserLock) {
    if (Date.now() - start > maxWait) {
      throw new Error('Browser slot timeout — another session is taking too long');
    }
    await new Promise(r => setTimeout(r, 500));
  }
  browserLock = true;
}

function releaseBrowserSlot(): void {
  browserLock = false;
}

export async function fetchRenderedHtml(
  url: string,
  options: { timeout?: number; waitAfterLoad?: number } = {}
): Promise<string> {
  const { timeout = 30000, waitAfterLoad = 2000 } = options;

  if (!url || !url.startsWith('http')) {
    throw new Error(`Invalid URL: ${url}`);
  }

  await waitForBrowserSlot();
  let browser: Browser | undefined;
  try {
    browser = await puppeteer.launch({
      executablePath: getChromiumPath(),
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
      ],
    });

    const page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );
    await page.setViewport({ width: 1280, height: 800 });

    await page.goto(url, { waitUntil: 'networkidle2', timeout });

    if (waitAfterLoad > 0) {
      await new Promise(r => setTimeout(r, waitAfterLoad));
    }

    return await page.content();
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
    releaseBrowserSlot();
  }
}

export async function fetchPageHtml(url: string): Promise<string> {
  try {
    console.log(`[Browser] Fetching ${url}`);
    const response = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      signal: AbortSignal.timeout(20000),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const html = await response.text();
    if (html && html.length > 1000) {
      return html;
    }
    console.log(`[Browser] Fetch returned little content (${html?.length || 0} chars), trying browser render`);
  } catch (err: any) {
    console.log(`[Browser] Fetch failed for ${url}: ${err.message}, trying browser render`);
  }

  try {
    const html = await fetchRenderedHtml(url, { timeout: 20000 });
    if (html && html.length > 500) {
      console.log(`[Browser] Browser render successful (${html.length} chars)`);
      return html;
    }
  } catch (err: any) {
    console.log(`[Browser] Browser render also failed: ${err.message}`);
  }

  throw new Error(`Could not fetch content from ${url}`);
}
