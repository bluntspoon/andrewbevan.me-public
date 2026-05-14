/**
 * Property listing scraper using Playwright.
 * Scrapes details and downloads up to 5 images per listing.
 *
 * Usage:  node script/scrape-listings.mjs
 *
 * Pre-requisites (run once):
 *   npm install playwright
 *   npx playwright install chromium
 */

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';
import { URL } from 'url';

const IMAGES_DIR = path.resolve('C:/Dev/house/scraped');

const LISTINGS = [
  {
    code: 'P24-116606881',
    label: '38 Impangele Rd, Kloof',
    url: 'https://www.property24.com/for-sale/kloof/kloof/kwazulu-natal/5754/116606881',
    site: 'p24',
  },
  {
    code: 'P24-116964996',
    label: 'Gillitts, Kloof',
    url: 'https://www.property24.com/for-sale/gillitts/kloof/kwazulu-natal/5728/116964996',
    site: 'p24',
  },
  {
    code: 'P24-116826455',
    label: 'Kloof Cottage + 4 Garages',
    url: 'https://www.property24.com/for-sale/kloof/kloof/kwazulu-natal/5754/116826455',
    site: 'p24',
  },
  {
    code: 'P24-116782685',
    label: '11 Uve Rd, Kloof',
    url: 'https://www.property24.com/for-sale/kloof/kloof/kwazulu-natal/5754/116782685',
    site: 'p24',
  },
  {
    code: 'P24-116967783',
    label: '69 Emolweni Rd, Kloof',
    url: 'https://www.property24.com/for-sale/kloof/kloof/kwazulu-natal/5754/116967783',
    site: 'p24',
  },
  {
    code: 'PP-T5352621',
    label: 'Hillcrest Central',
    url: 'https://www.privateproperty.co.za/for-sale/kwazulu-natal/durban-metro/hillcrest/hillcrest-central/T5352621',
    site: 'pp',
  },
];

// ── helpers ────────────────────────────────────────────────────────────────

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(dest);
    proto.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close();
        fs.unlinkSync(dest);
        return downloadFile(res.headers.location, dest).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        file.close();
        fs.unlinkSync(dest);
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
      file.on('error', reject);
    }).on('error', reject);
  });
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// ── P24 scraper ────────────────────────────────────────────────────────────

async function scrapeP24(page, listing) {
  console.log(`\n📍 [${listing.code}] ${listing.label}`);
  await page.goto(listing.url, { waitUntil: 'domcontentloaded', timeout: 30000 });

  // dismiss cookie banner if present
  try {
    await page.click('button:has-text("Accept")', { timeout: 3000 });
  } catch {}

  // Wait for price element
  await page.waitForSelector('h1, .p24_price, [class*="price"]', { timeout: 15000 }).catch(() => {});

  const data = await page.evaluate(() => {
    const text = s => document.querySelector(s)?.innerText?.trim() ?? null;
    const allText = s => [...document.querySelectorAll(s)].map(el => el.innerText.trim()).filter(Boolean);

    // Price — try multiple selectors
    const priceRaw =
      document.querySelector('[class*="Price"] strong')?.innerText ||
      document.querySelector('[class*="price"]')?.innerText ||
      document.querySelector('h1')?.innerText || '';
    const price = priceRaw.match(/R[\s\d,]+/)?.[0]?.trim() ?? priceRaw.slice(0, 30);

    // Overview table rows
    const overviewRows = {};
    document.querySelectorAll('.p24_propertyOverviewRow, [class*="Overview"] li, [class*="overview"] tr').forEach(row => {
      const label = row.querySelector('[class*="label"], th, td:first-child')?.innerText?.trim();
      const value = row.querySelector('[class*="value"], td:last-child')?.innerText?.trim();
      if (label && value) overviewRows[label] = value;
    });
    // Also scrape the visible text summary
    const overviewText = document.querySelector('[class*="Overview"], .p24_propertyOverview')?.innerText?.trim() ?? null;

    // Description
    const desc =
      document.querySelector('[class*="description"] p, [class*="Description"] p, .p24_description')?.innerText?.trim() ??
      null;

    // Icons (beds/baths/garages)
    const bedEl = document.querySelector('[aria-label*="bedroom"], [title*="Bedroom"], img[alt*="Bedrooms"] + *');
    const bathEl = document.querySelector('[aria-label*="bathroom"], [title*="Bathroom"], img[alt*="Bathrooms"] + *');
    const garEl = document.querySelector('[aria-label*="garage"], [title*="Garage"], img[alt*="Garages"] + *');
    const beds = bedEl?.innerText?.trim() ?? null;
    const baths = bathEl?.innerText?.trim() ?? null;
    const garages = garEl?.innerText?.trim() ?? null;

    // Title / address
    const title = document.title;
    const address = document.querySelector('[class*="Address"], [class*="address"]')?.innerText?.trim() ?? null;

    // Agent
    const agentName = document.querySelector('[class*="agentName"], [class*="agent-name"], .p24_agentName')?.innerText?.trim() ?? null;
    const agencyName = document.querySelector('[class*="agencyName"], [class*="agency-name"], .p24_agencyName')?.innerText?.trim() ?? null;

    // Images — collect all src from gallery/thumbnail elements
    const imgEls = [
      ...document.querySelectorAll('img[src*="images.prop24"], img[src*="prop.property24"], img[src*="mediaprod"]'),
    ];
    const imgUrls = [...new Set(imgEls.map(i => i.src).filter(s => !s.includes('NoImage') && !s.includes('grey_')))];

    // Also try data-src
    const lazyEls = document.querySelectorAll('[data-src*="images.prop24"], [data-src*="mediaprod"]');
    lazyEls.forEach(el => {
      const s = el.dataset.src;
      if (s && !s.includes('NoImage')) imgUrls.push(s);
    });

    return { price, overviewRows, overviewText, desc, beds, baths, garages, title, address, agentName, agencyName, imgUrls: [...new Set(imgUrls)].slice(0, 20) };
  });

  // Scroll to trigger lazy-load images
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(2000);

  // Try clicking the gallery / photo grid to trigger image loads
  try {
    await page.click('[class*="Gallery"], [class*="gallery"], .p24_galleryImage', { timeout: 3000 });
    await page.waitForTimeout(2000);
  } catch {}

  // Re-collect image URLs after interaction
  const imgUrls = await page.evaluate(() => {
    const srcs = [];
    document.querySelectorAll('img').forEach(img => {
      const s = img.src || img.dataset?.src || '';
      if (s && !s.includes('NoImage') && !s.includes('grey_') && !s.includes('icon') && !s.includes('Icon') && (s.includes('images.prop24') || s.includes('mediaprod') || s.includes('property24.com/Content/images/') === false)) {
        srcs.push(s);
      }
    });
    // Also check background images
    document.querySelectorAll('[style*="background-image"]').forEach(el => {
      const m = el.style.backgroundImage.match(/url\(["']?([^"')]+)["']?\)/);
      if (m && !m[1].includes('NoImage') && !m[1].includes('icon')) srcs.push(m[1]);
    });
    return [...new Set(srcs)];
  });

  data.imgUrls = [...new Set([...data.imgUrls, ...imgUrls])].filter(u =>
    !u.includes('NoImage') && !u.includes('grey_') && !u.includes('icon') && !u.includes('.svg')
  ).slice(0, 5);

  // Screenshot fallback if no images found
  const imgDir = path.join(IMAGES_DIR, listing.code);
  ensureDir(imgDir);

  let downloadedCount = 0;
  for (let i = 0; i < data.imgUrls.length; i++) {
    const url = data.imgUrls[i];
    const ext = path.extname(new URL(url).pathname) || '.jpg';
    const dest = path.join(imgDir, `photo-${String(i + 1).padStart(2, '0')}${ext}`);
    try {
      await downloadFile(url, dest);
      console.log(`  ✅ Image ${i + 1}: ${path.basename(dest)}`);
      downloadedCount++;
    } catch (e) {
      console.log(`  ⚠️  Image ${i + 1} failed: ${e.message}`);
    }
  }

  if (downloadedCount === 0) {
    // Take full-page screenshot as fallback
    const dest = path.join(imgDir, 'screenshot-01.png');
    await page.screenshot({ path: dest, fullPage: false });
    console.log(`  📸 Saved screenshot fallback: ${path.basename(dest)}`);
  }

  return data;
}

// ── Private Property scraper ───────────────────────────────────────────────

async function scrapePP(page, listing) {
  console.log(`\n📍 [${listing.code}] ${listing.label}`);

  await page.goto(listing.url, { waitUntil: 'domcontentloaded', timeout: 30000 });

  try {
    await page.click('button:has-text("Accept"), button:has-text("ACCEPT")', { timeout: 3000 });
  } catch {}
  await page.waitForTimeout(2000);

  const data = await page.evaluate(() => {
    const price = document.querySelector('[class*="price"], [class*="Price"], h1')?.innerText?.trim() ?? null;
    const desc = document.querySelector('[class*="description"], [class*="Description"]')?.innerText?.trim() ?? null;
    const overviewText = document.querySelector('[class*="overview"], [class*="Overview"], [class*="details"]')?.innerText?.trim() ?? null;
    const title = document.title;
    const address = document.querySelector('h1, [class*="address"]')?.innerText?.trim() ?? null;
    const agentName = document.querySelector('[class*="agent"]')?.innerText?.trim() ?? null;

    const imgUrls = [];
    document.querySelectorAll('img').forEach(img => {
      const s = img.src || img.dataset?.src || '';
      if (s && !s.includes('icon') && !s.includes('logo') && !s.includes('.svg') && (s.includes('/images/') || s.includes('media') || s.includes('property')) && s.startsWith('http')) {
        imgUrls.push(s);
      }
    });
    document.querySelectorAll('[style*="background-image"]').forEach(el => {
      const m = el.style.backgroundImage.match(/url\(["']?([^"')]+)["']?\)/);
      if (m && m[1].startsWith('http') && !m[1].includes('icon')) imgUrls.push(m[1]);
    });

    return { price, desc, overviewText, title, address, agentName, imgUrls: [...new Set(imgUrls)].slice(0, 20) };
  });

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(2000);

  // Collect any lazy-loaded images
  const extraImgs = await page.evaluate(() => {
    const srcs = [];
    document.querySelectorAll('img[data-src], img[data-lazy], [data-src]').forEach(el => {
      const s = el.dataset.src || el.dataset.lazy || '';
      if (s && s.startsWith('http') && !s.includes('icon')) srcs.push(s);
    });
    return srcs;
  });

  data.imgUrls = [...new Set([...data.imgUrls, ...extraImgs])].slice(0, 5);

  const imgDir = path.join(IMAGES_DIR, listing.code);
  ensureDir(imgDir);

  let downloadedCount = 0;
  for (let i = 0; i < data.imgUrls.length; i++) {
    const url = data.imgUrls[i];
    try {
      const ext = path.extname(new URL(url).pathname) || '.jpg';
      const dest = path.join(imgDir, `photo-${String(i + 1).padStart(2, '0')}${ext}`);
      await downloadFile(url, dest);
      console.log(`  ✅ Image ${i + 1}: ${path.basename(dest)}`);
      downloadedCount++;
    } catch (e) {
      console.log(`  ⚠️  Image ${i + 1} failed: ${e.message}`);
    }
  }

  if (downloadedCount === 0) {
    const dest = path.join(imgDir, 'screenshot-01.png');
    await page.screenshot({ path: dest, fullPage: false });
    console.log(`  📸 Saved screenshot fallback: ${path.basename(dest)}`);
  }

  return data;
}

// ── main ───────────────────────────────────────────────────────────────────

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 900 },
    extraHTTPHeaders: { 'Accept-Language': 'en-ZA,en;q=0.9' },
  });

  const results = {};

  for (const listing of LISTINGS) {
    const page = await context.newPage();
    try {
      const data = listing.site === 'pp'
        ? await scrapePP(page, listing)
        : await scrapeP24(page, listing);
      results[listing.code] = { listing, data };
      console.log(`\n  📋 Summary for ${listing.code}:`);
      console.log(`     Price:    ${data.price ?? 'n/a'}`);
      console.log(`     Beds:     ${data.beds ?? 'n/a'}`);
      console.log(`     Baths:    ${data.baths ?? 'n/a'}`);
      console.log(`     Garages:  ${data.garages ?? 'n/a'}`);
      if (data.overviewText) {
        console.log(`     Overview: ${data.overviewText.slice(0, 200).replace(/\n/g, ' ')}...`);
      }
      if (data.desc) {
        console.log(`     Desc:     ${data.desc.slice(0, 300).replace(/\n/g, ' ')}...`);
      }
    } catch (e) {
      console.error(`  ❌ Error scraping ${listing.code}: ${e.message}`);
      results[listing.code] = { listing, error: e.message };
    } finally {
      await page.close();
    }
  }

  await browser.close();

  // Write raw results to JSON for reference
  const outFile = path.resolve('C:/Dev/house/scrape-results.json');
  fs.writeFileSync(outFile, JSON.stringify(results, null, 2));
  console.log(`\n✅ Done. Full results saved to ${outFile}`);
})();
