/**
 * DataBunker Price Checker - Background Service Worker
 * Handles background tasks and message passing
 */

// Log service worker initialization
console.log('🚀 DataBunker Service Worker starting...');

// Default backend URL (deployed on Railway)
const DEFAULT_BACKEND_URL = 'https://upc-backend-chatbotv2-production.up.railway.app';

// Keep service worker alive
self.addEventListener('activate', () => {
  console.log('✅ Service Worker activated');
});

// Log when service worker is ready
console.log('✨ Service Worker loaded successfully');

// Initialize extension on install
chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('DataBunker Price Checker installed:', details.reason);

  // Set default settings
  const currentSettings = await chrome.storage.local.get(['backendUrl']);
  if (!currentSettings.backendUrl) {
    await chrome.storage.local.set({
      backendUrl: DEFAULT_BACKEND_URL,
      useGemini: true,
      useOxylabs: true,
      usePerplexity: true
    });
  }

  // Create context menu
  chrome.contextMenus.create({
    id: 'dbPriceCheck',
    title: 'Buscar precio con DataBunker',
    contexts: ['selection']
  });
});

// Handle messages from popup or content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.action) {
    case 'captureTab':
      handleCaptureTab(sendResponse);
      return true; // Indicates async response

    case 'scrapeCurrentPage':
      handleScrapePage(sender.tab?.id, sendResponse);
      return true;

    case 'checkBackendHealth':
      handleHealthCheck(sendResponse);
      return true;

    case 'getSettings':
      handleGetSettings(sendResponse);
      return true;

    case 'saveSettings':
      handleSaveSettings(request.settings, sendResponse);
      return true;

    default:
      console.log('Unknown action:', request.action);
      sendResponse({ error: 'Unknown action' });
  }
});

// Capture visible tab as screenshot
async function handleCaptureTab(sendResponse) {
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'png' });
    sendResponse({ success: true, dataUrl });
  } catch (error) {
    console.error('Error capturing tab:', error);
    sendResponse({ success: false, error: error.message });
  }
}

// Scrape product info from page
async function handleScrapePage(tabId, sendResponse) {
  if (!tabId) {
    sendResponse({ success: false, error: 'No active tab' });
    return;
  }

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      function: scrapeProductFromPage
    });

    if (results && results[0]) {
      sendResponse({ success: true, data: results[0].result });
    } else {
      sendResponse({ success: false, error: 'No results from scraping' });
    }
  } catch (error) {
    console.error('Error scraping page:', error);
    sendResponse({ success: false, error: error.message });
  }
}

// Check backend health
async function handleHealthCheck(sendResponse) {
  try {
    const settings = await chrome.storage.local.get(['backendUrl']);
    const backendUrl = settings.backendUrl || DEFAULT_BACKEND_URL;

    const response = await fetch(`${backendUrl}/api/health`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });

    sendResponse({ success: response.ok, status: response.status });
  } catch (error) {
    console.error('Backend health check failed:', error);
    sendResponse({ success: false, error: error.message });
  }
}

// Get settings
async function handleGetSettings(sendResponse) {
  try {
    const settings = await chrome.storage.local.get([
      'backendUrl',
      'useGemini',
      'useOxylabs',
      'usePerplexity'
    ]);

    sendResponse({
      success: true,
      settings: {
        backendUrl: settings.backendUrl || DEFAULT_BACKEND_URL,
        useGemini: settings.useGemini !== false,
        useOxylabs: settings.useOxylabs !== false,
        usePerplexity: settings.usePerplexity !== false
      }
    });
  } catch (error) {
    console.error('Error getting settings:', error);
    sendResponse({ success: false, error: error.message });
  }
}

// Save settings
async function handleSaveSettings(settings, sendResponse) {
  try {
    await chrome.storage.local.set(settings);
    sendResponse({ success: true });
  } catch (error) {
    console.error('Error saving settings:', error);
    sendResponse({ success: false, error: error.message });
  }
}

// Scraping function that runs in page context
function scrapeProductFromPage() {
  const result = {
    productName: null,
    upc: null,
    ean: null,
    price: null,
    brand: null,
    url: window.location.href,
    domain: window.location.hostname
  };

  // Common selectors for product information
  const nameSelectors = [
    'h1[itemprop="name"]',
    '[data-testid="product-title"]',
    '.product-title',
    '.product-name',
    '#productTitle',
    'h1.title',
    'h1',
    '[class*="product"][class*="name"]',
    '[class*="product"][class*="title"]'
  ];

  const priceSelectors = [
    '[itemprop="price"]',
    '[data-testid="price"]',
    '.price',
    '.product-price',
    '#priceblock_ourprice',
    '#priceblock_dealprice',
    '[class*="price"]:not([class*="old"]):not([class*="was"])',
    'span[class*="Price"]'
  ];

  // Find product name
  for (const selector of nameSelectors) {
    const element = document.querySelector(selector);
    if (element && element.textContent.trim()) {
      result.productName = element.textContent.trim().substring(0, 200);
      break;
    }
  }

  // Find price
  for (const selector of priceSelectors) {
    const element = document.querySelector(selector);
    if (element) {
      const priceText = element.textContent.trim();
      const priceMatch = priceText.match(/[\$\u20ac\u00a3]?\s*[\d,]+\.?\d*/);
      if (priceMatch) {
        result.price = priceMatch[0];
        break;
      }
    }
  }

  // Look for UPC/EAN in structured data
  const ldJsonScripts = document.querySelectorAll('script[type="application/ld+json"]');
  for (const script of ldJsonScripts) {
    try {
      const data = JSON.parse(script.textContent);
      const product = data['@type'] === 'Product' ? data : (data['@graph']?.find(item => item['@type'] === 'Product'));

      if (product) {
        if (!result.productName && product.name) result.productName = product.name;
        if (product.gtin13) result.upc = product.gtin13;
        if (product.gtin12) result.upc = product.gtin12;
        if (product.sku) result.sku = product.sku;
        if (product.brand?.name) result.brand = product.brand.name;
        if (!result.price && product.offers?.price) result.price = '$' + product.offers.price;
      }
    } catch (e) {
      // Ignore JSON parse errors
    }
  }

  // Look for UPC/EAN in page text
  if (!result.upc) {
    const pageText = document.body.innerText;
    const upcPatterns = [
      /UPC[:\s]*(\d{12})/i,
      /EAN[:\s]*(\d{13})/i,
      /GTIN[:\s]*(\d{12,14})/i
    ];

    for (const pattern of upcPatterns) {
      const match = pageText.match(pattern);
      if (match) {
        result.upc = match[1];
        break;
      }
    }
  }

  return result;
}

// Context menu for quick price check
chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === 'dbPriceCheck' && info.selectionText) {
    // Send selected text to popup when it opens
    chrome.storage.local.set({ pendingSearch: info.selectionText });
  }
});
