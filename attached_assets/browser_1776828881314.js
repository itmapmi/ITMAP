import puppeteer from 'puppeteer-core';

function getChromiumPath() {
    const paths = [
        process.env.CHROMIUM_PATH,
        '/nix/store/qa9cnw4v5xkxyip6mb9kxqfq1z4x2dx1-chromium-138.0.7204.100/bin/chromium',
    ];
    for (const p of paths) {
        if (p) return p;
    }
    return 'chromium';
}

let browserLock = false;
async function waitForBrowserSlot() {
    const maxWait = 30000;
    const start = Date.now();
    while (browserLock) {
        if (Date.now() - start > maxWait) {
            throw new Error('Browser slot timeout — another browser session is taking too long');
        }
        await new Promise(r => setTimeout(r, 500));
    }
    browserLock = true;
}

function releaseBrowserSlot() {
    browserLock = false;
}

export async function fetchRenderedHtml(url, options = {}) {
    const { timeout = 30000, waitAfterLoad = 2000 } = options;

    if (!url || !url.startsWith('http')) {
        throw new Error(`Invalid URL: ${url}`);
    }

    await waitForBrowserSlot();
    let browser;
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
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        await page.setViewport({ width: 1280, height: 800 });

        await page.goto(url, {
            waitUntil: 'networkidle2',
            timeout,
        });

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

export async function fetchPageHtml(url) {
    try {
        console.log(`[Scraper] Fetching ${url}`);
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
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
        console.log(`[Scraper] Fetch returned little content (${html?.length || 0} chars), trying browser render`);
    } catch (err) {
        console.log(`[Scraper] Fetch failed for ${url}: ${err.message}, trying browser render`);
    }

    try {
        const html = await fetchRenderedHtml(url, { timeout: 20000 });
        if (html && html.length > 500) {
            console.log(`[Scraper] Browser render successful (${html.length} chars)`);
            return html;
        }
    } catch (err) {
        console.log(`[Scraper] Browser render also failed: ${err.message}`);
    }

    throw new Error(`Could not fetch content from ${url}`);
}
