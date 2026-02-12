/**
 * DataBunker Price Checker - Content Script
 * Runs in the context of web pages to extract product information
 */

// Listen for messages from popup or background
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.action) {
    case 'scrapeProduct':
      const productData = scrapeProductInfo();
      sendResponse({ success: true, data: productData });
      break;

    case 'highlightProduct':
      highlightProductElements();
      sendResponse({ success: true });
      break;

    case 'getPageMetadata':
      const metadata = getPageMetadata();
      sendResponse({ success: true, data: metadata });
      break;

    default:
      sendResponse({ success: false, error: 'Unknown action' });
  }
  return true;
});

/**
 * Scrape product information from the current page
 */
function scrapeProductInfo() {
  const result = {
    productName: null,
    upc: null,
    ean: null,
    sku: null,
    price: null,
    brand: null,
    category: null,
    description: null,
    imageUrl: null,
    url: window.location.href,
    domain: window.location.hostname,
    timestamp: new Date().toISOString()
  };

  // Site-specific scrapers
  const domain = window.location.hostname.toLowerCase();

  if (domain.includes('amazon')) {
    return scrapeAmazon(result);
  } else if (domain.includes('walmart')) {
    return scrapeWalmart(result);
  } else if (domain.includes('target')) {
    return scrapeTarget(result);
  } else if (domain.includes('costco')) {
    return scrapeCostco(result);
  } else if (domain.includes('farmaciasbenavides')) {
    return scrapeFarmaciasBenavides(result);
  } else if (domain.includes('farmaciasgdl') || domain.includes('fahorro')) {
    return scrapeFahorroGDL(result);
  } else if (domain.includes('sams') || domain.includes('samsclub')) {
    return scrapeSamsClub(result);
  } else if (domain.includes('farmaciasanpablo') || domain.includes('sanpablo')) {
    return scrapeFarmaciaSanPablo(result);
  } else if (domain.includes('soriana')) {
    return scrapeSoriana(result);
  } else if (domain.includes('chedraui')) {
    return scrapeChedraui(result);
  } else if (domain.includes('lacomer')) {
    return scrapeLaComer(result);
  } else if (domain.includes('heb.com')) {
    return scrapeHEB(result);
  } else if (domain.includes('mercadolibre')) {
    return scrapeMercadoLibre(result);
  }

  // Generic scraper
  return scrapeGeneric(result);
}

/**
 * Generic product scraper
 */
function scrapeGeneric(result) {
  // Textos a ignorar como nombres de producto
  const ignorePatterns = [
    'comprados juntos',
    'frecuentemente',
    'también te puede',
    'productos relacionados',
    'agregar al carrito',
    'comprar ahora',
    'iniciar sesión',
    'crear cuenta',
    'mi cuenta',
    'carrito de compras',
    'envío gratis',
    'ofertas',
    'promociones'
  ];

  // Product name selectors (priority order)
  const nameSelectors = [
    'h1[itemprop="name"]',
    '[data-testid="product-title"]',
    '.product-title',
    '.product-name',
    '#productTitle',
    'h1.title',
    '[class*="ProductTitle"]',
    '[class*="productTitle"]',
    '[class*="product-title"]',
    '[class*="product-name"]',
    'h1'
  ];

  for (const selector of nameSelectors) {
    const elements = document.querySelectorAll(selector);
    for (const element of elements) {
      if (element && element.textContent.trim()) {
        const text = element.textContent.trim().toLowerCase();
        // Verificar que no sea un texto genérico
        const isGenericText = ignorePatterns.some(pattern => text.includes(pattern));
        if (!isGenericText && text.length > 3 && text.length < 300) {
          result.productName = cleanText(element.textContent);
          console.log('[DataBunker] Nombre genérico encontrado:', result.productName);
          break;
        }
      }
    }
    if (result.productName) break;
  }

  // Price selectors
  const priceSelectors = [
    '[itemprop="price"]',
    '[data-testid="price"]',
    '.price-current',
    '.product-price',
    '#priceblock_ourprice',
    '#priceblock_dealprice',
    '[class*="Price"]:not([class*="old"]):not([class*="was"]):not([class*="compare"])',
    '[class*="price"]:not([class*="old"]):not([class*="was"]):not([class*="compare"])'
  ];

  for (const selector of priceSelectors) {
    const element = document.querySelector(selector);
    if (element) {
      const priceText = element.textContent.trim();
      const price = extractPrice(priceText);
      if (price) {
        result.price = price;
        break;
      }
    }
  }

  // UPC/EAN from attributes
  const upcElements = document.querySelectorAll('[data-upc], [data-ean], [data-gtin], [itemprop="gtin13"], [itemprop="gtin12"], [itemprop="gtin"], [data-barcode]');
  for (const el of upcElements) {
    const upc = el.getAttribute('data-upc') ||
      el.getAttribute('data-ean') ||
      el.getAttribute('data-gtin') ||
      el.getAttribute('data-barcode') ||
      el.getAttribute('content') ||
      el.textContent.trim();
    if (upc && /^\d{12,14}$/.test(upc.replace(/\D/g, ''))) {
      result.upc = upc.replace(/\D/g, '');
      console.log('[DataBunker] UPC encontrado en atributo:', result.upc);
      break;
    }
  }

  // UPC/EAN from page text - buscar en tablas de especificaciones primero
  if (!result.upc) {
    // Buscar en tablas de especificaciones
    const specTables = document.querySelectorAll('table, .specifications, .product-details, .product-info, [class*="spec"], [class*="detail"]');
    for (const table of specTables) {
      const rows = table.querySelectorAll('tr, .row, [class*="row"]');
      for (const row of rows) {
        const text = row.textContent.toLowerCase();
        if (text.includes('upc') || text.includes('ean') || text.includes('gtin') || text.includes('codigo') || text.includes('barcode')) {
          const numbers = row.textContent.match(/\d{12,14}/);
          if (numbers) {
            result.upc = numbers[0];
            console.log('[DataBunker] UPC encontrado en tabla:', result.upc);
            break;
          }
        }
      }
      if (result.upc) break;
    }
  }

  // UPC/EAN from general page text
  if (!result.upc) {
    const pageText = document.body.innerText;
    // Preferir EAN (13 digitos) sobre UPC (12 digitos)
    const patterns = [
      /EAN[:\s#\-]*(\d{13})/gi,
      /GTIN[:\s#\-]*(\d{13,14})/gi,
      /C[oó]digo de Barras[:\s#\-]*(\d{12,14})/gi,
      /UPC[:\s#\-]*(\d{12,13})/gi,
      /Barcode[:\s#\-]*(\d{12,14})/gi
    ];

    for (const pattern of patterns) {
      const matches = pageText.matchAll(pattern);
      for (const match of matches) {
        const upcClean = match[1] || match[0].replace(/\D/g, '');
        if (upcClean.length >= 12 && upcClean.length <= 14) {
          result.upc = upcClean;
          console.log('[DataBunker] UPC encontrado en texto:', result.upc);
          break;
        }
      }
      if (result.upc) break;
    }
  }

  // Buscar códigos de barras aislados (preferir 13 dígitos)
  if (!result.upc) {
    const pageText = document.body.innerText;
    // Primero buscar EAN de 13 dígitos
    const ean13Match = pageText.match(/\b(\d{13})\b/);
    if (ean13Match) {
      result.upc = ean13Match[1];
      console.log('[DataBunker] EAN-13 encontrado:', result.upc);
    } else {
      // Si no hay 13 dígitos, buscar UPC de 12
      const upc12Match = pageText.match(/\b(\d{12})\b/);
      if (upc12Match) {
        result.upc = upc12Match[1];
        console.log('[DataBunker] UPC-12 encontrado:', result.upc);
      }
    }
  }

  // Buscar UPC en meta tags
  if (!result.upc) {
    const metaTags = document.querySelectorAll('meta[name*="upc"], meta[name*="ean"], meta[name*="gtin"], meta[property*="upc"], meta[property*="ean"]');
    for (const meta of metaTags) {
      const content = meta.getAttribute('content');
      if (content && /^\d{12,14}$/.test(content)) {
        result.upc = content;
        console.log('[DataBunker] UPC encontrado en meta:', result.upc);
        break;
      }
    }
  }

  // Brand
  const brandSelectors = [
    '[itemprop="brand"]',
    '.brand-name',
    '[class*="brand"]',
    'a[href*="/brand/"]',
    '[data-brand]'
  ];

  for (const selector of brandSelectors) {
    const element = document.querySelector(selector);
    if (element) {
      result.brand = cleanText(element.textContent);
      break;
    }
  }

  // Product image
  const imageSelectors = [
    '[itemprop="image"]',
    '#landingImage',
    '.product-image img',
    '[data-testid="product-image"]',
    '.product-photo img'
  ];

  for (const selector of imageSelectors) {
    const element = document.querySelector(selector);
    if (element) {
      result.imageUrl = element.src || element.getAttribute('data-src');
      break;
    }
  }

  // Structured data (JSON-LD)
  result = extractStructuredData(result);

  return result;
}

/**
 * Amazon-specific scraper
 */
function scrapeAmazon(result) {
  result.productName = document.querySelector('#productTitle')?.textContent.trim();
  result.price = extractPrice(document.querySelector('#priceblock_ourprice, #priceblock_dealprice, .a-price .a-offscreen')?.textContent);
  result.brand = document.querySelector('#bylineInfo')?.textContent.replace(/^(Marca:|Brand:|Visita la tienda de|Visit the)\s*/i, '').trim();

  // Amazon ASIN
  const asinMatch = window.location.href.match(/\/dp\/([A-Z0-9]+)/);
  if (asinMatch) result.sku = asinMatch[1];

  // Look for UPC in product details
  const detailsTable = document.querySelector('#productDetails_techSpec_section_1, #productDetails_detailBullets_sections1');
  if (detailsTable) {
    const rows = detailsTable.querySelectorAll('tr');
    for (const row of rows) {
      const header = row.querySelector('th')?.textContent.toLowerCase();
      const value = row.querySelector('td')?.textContent.trim();
      if (header?.includes('upc') || header?.includes('ean')) {
        result.upc = value.replace(/\D/g, '');
      }
    }
  }

  result.imageUrl = document.querySelector('#landingImage')?.src;
  return extractStructuredData(result);
}

/**
 * Walmart-specific scraper
 */
function scrapeWalmart(result) {
  result.productName = document.querySelector('[data-testid="product-title"], h1[itemprop="name"]')?.textContent.trim();
  result.price = extractPrice(document.querySelector('[data-testid="current-price"], [itemprop="price"]')?.textContent);
  result.brand = document.querySelector('[data-testid="brand-link"], [itemprop="brand"]')?.textContent.trim();

  // Walmart item number
  const itemNum = document.querySelector('[data-testid="item-number"]')?.textContent;
  if (itemNum) result.sku = itemNum.replace(/\D/g, '');

  // UPC from Walmart
  const specs = document.querySelectorAll('[class*="specifications"] tr, [class*="Specifications"] tr');
  for (const row of specs) {
    const cells = row.querySelectorAll('td');
    if (cells.length >= 2) {
      const label = cells[0].textContent.toLowerCase();
      if (label.includes('upc') || label.includes('gtin')) {
        result.upc = cells[1].textContent.trim().replace(/\D/g, '');
      }
    }
  }

  result.imageUrl = document.querySelector('[data-testid="hero-image"] img, [itemprop="image"]')?.src;
  return extractStructuredData(result);
}

/**
 * Target-specific scraper
 */
function scrapeTarget(result) {
  result.productName = document.querySelector('[data-test="product-title"], h1')?.textContent.trim();
  result.price = extractPrice(document.querySelector('[data-test="product-price"]')?.textContent);

  const breadcrumb = document.querySelector('[data-test="breadcrumb"]');
  if (breadcrumb) {
    const links = breadcrumb.querySelectorAll('a');
    if (links.length > 0) {
      result.brand = links[links.length - 1].textContent.trim();
    }
  }

  // TCIN (Target ID)
  const tcinMatch = window.location.href.match(/\/A-(\d+)/);
  if (tcinMatch) result.sku = tcinMatch[1];

  return extractStructuredData(result);
}

/**
 * Costco-specific scraper
 */
function scrapeCostco(result) {
  result.productName = document.querySelector('.product-title, h1[itemprop="name"]')?.textContent.trim();
  result.price = extractPrice(document.querySelector('.price, [itemprop="price"]')?.textContent);
  result.brand = document.querySelector('.product-brand, [itemprop="brand"]')?.textContent.trim();

  // Costco item number
  const itemNum = document.querySelector('.product-code')?.textContent;
  if (itemNum) result.sku = itemNum.replace(/\D/g, '');

  return extractStructuredData(result);
}

/**
 * Farmacias Benavides-specific scraper
 */
function scrapeFarmaciasBenavides(result) {
  result.productName = document.querySelector('.product-name h1, .product-title')?.textContent.trim();
  result.price = extractPrice(document.querySelector('.price-box .price, .special-price')?.textContent);
  result.brand = document.querySelector('.product-brand')?.textContent.trim();

  // SKU from URL
  const skuMatch = window.location.href.match(/\/(\d+)\.html/);
  if (skuMatch) result.sku = skuMatch[1];

  return extractStructuredData(result);
}

/**
 * Farmacias del Ahorro / GDL-specific scraper
 */
function scrapeFahorroGDL(result) {
  result.productName = document.querySelector('.product-view h1, .product-name')?.textContent.trim();
  result.price = extractPrice(document.querySelector('.price-box .price, .regular-price')?.textContent);
  result.brand = document.querySelector('.brand-name, [class*="marca"]')?.textContent.trim();

  return extractStructuredData(result);
}

/**
 * Sam's Club-specific scraper
 */
function scrapeSamsClub(result) {
  result.productName = document.querySelector('[class*="ProductTitle"], h1')?.textContent.trim();
  result.price = extractPrice(document.querySelector('[class*="Price"]:not([class*="was"])')?.textContent);
  result.brand = document.querySelector('[class*="brand"]')?.textContent.trim();

  // Item number
  const itemMatch = window.location.href.match(/\/(\d+)/);
  if (itemMatch) result.sku = itemMatch[1];

  return extractStructuredData(result);
}

/**
 * Farmacias San Pablo-specific scraper
 */
function scrapeFarmaciaSanPablo(result) {
  console.log('[DataBunker] Scraping Farmacias San Pablo...');

  // PRIORIDAD 1: Buscar en JSON-LD (fuente mas confiable)
  const ldJsonScripts = document.querySelectorAll('script[type="application/ld+json"]');
  for (const script of ldJsonScripts) {
    try {
      let data = JSON.parse(script.textContent);
      // Manejar arrays
      if (Array.isArray(data)) {
        data = data.find(d => d['@type'] === 'Product');
      }
      if (data && data['@type'] === 'Product' && data.name) {
        result.productName = data.name;
        console.log('[DataBunker] Nombre de JSON-LD:', result.productName);
        // Tambien extraer UPC y precio de JSON-LD
        if (data.gtin13) result.upc = data.gtin13;
        if (data.gtin12) result.upc = data.gtin12;
        if (data.gtin) result.upc = data.gtin;
        if (data.offers) {
          const offers = Array.isArray(data.offers) ? data.offers[0] : data.offers;
          if (offers.price) result.price = '$' + parseFloat(offers.price).toFixed(2);
        }
        break;
      }
    } catch (e) {
      console.log('[DataBunker] Error parseando JSON-LD:', e);
    }
  }

  // PRIORIDAD 2: Extraer nombre de la URL (farmaciasanpablo tiene URLs descriptivas)
  if (!result.productName) {
    const urlPath = window.location.pathname;
    // URL: /medicamentos/estomacal/sueros-orales/electrolit-coco/p/000000000041340005
    const productMatch = urlPath.match(/\/([^\/]+)\/p\/\d+/);
    if (productMatch) {
      // Convertir "electrolit-coco" a "Electrolit Coco"
      const nameFromUrl = productMatch[1]
        .replace(/-/g, ' ')
        .replace(/\b\w/g, c => c.toUpperCase());
      result.productName = nameFromUrl;
      console.log('[DataBunker] Nombre de URL:', result.productName);
    }
  }

  // PRIORIDAD 3: Selectores especificos de San Pablo
  if (!result.productName) {
    const nameSelectors = [
      '.product-detail-name',
      '.product-name h1',
      '[class*="productName"]',
      '.pdp-product-name',
      '[data-testid="product-name"]',
      'h1.name',
      '.product-info h1',
      // Selectores adicionales comunes en farmacias
      '.product-title',
      '[itemprop="name"]',
      '.nombre-producto',
      '.product-detail h1'
    ];

    for (const selector of nameSelectors) {
      const element = document.querySelector(selector);
      if (element && element.textContent.trim()) {
        const text = element.textContent.trim();
        // Evitar textos genericos
        if (!text.toLowerCase().includes('comprados') &&
            !text.toLowerCase().includes('frecuentemente') &&
            !text.toLowerCase().includes('también') &&
            !text.toLowerCase().includes('agregar') &&
            !text.toLowerCase().includes('carrito') &&
            text.length > 3 && text.length < 200) {
          result.productName = cleanText(text);
          console.log('[DataBunker] Nombre de selector:', result.productName);
          break;
        }
      }
    }
  }

  // PRIORIDAD 4: Buscar h1 pero filtrar estrictamente
  if (!result.productName) {
    const h1Elements = document.querySelectorAll('h1');
    for (const h1 of h1Elements) {
      const text = h1.textContent.trim();
      const lowerText = text.toLowerCase();
      // Lista de textos a ignorar
      const ignoreTexts = [
        'comprados', 'frecuentemente', 'también te puede', 'productos relacionados',
        'agregar al carrito', 'iniciar sesión', 'mi cuenta', 'envío', 'ofertas'
      ];
      const shouldIgnore = ignoreTexts.some(t => lowerText.includes(t));

      if (text.length > 5 && text.length < 200 && !shouldIgnore) {
        result.productName = cleanText(text);
        console.log('[DataBunker] Nombre de h1 filtrado:', result.productName);
        break;
      }
    }
  }

  // Precio
  const priceSelectors = [
    '.product-detail-price',
    '.price-box .price',
    '[class*="productPrice"]',
    '.pdp-price',
    '[data-testid="product-price"]',
    '.special-price .price',
    '.regular-price .price'
  ];

  for (const selector of priceSelectors) {
    const element = document.querySelector(selector);
    if (element) {
      result.price = extractPrice(element.textContent);
      if (result.price) {
        console.log('[DataBunker] Precio encontrado:', result.price);
        break;
      }
    }
  }

  // UPC - buscar en especificaciones
  const specSelectors = [
    '.product-specifications',
    '.product-details',
    '[class*="specification"]',
    'table.specs'
  ];

  for (const selector of specSelectors) {
    const container = document.querySelector(selector);
    if (container) {
      const text = container.textContent;
      const upcMatch = text.match(/(?:UPC|EAN|C[oó]digo)[:\s]*(\d{12,14})/i);
      if (upcMatch) {
        result.upc = upcMatch[1];
        console.log('[DataBunker] UPC encontrado:', result.upc);
        break;
      }
    }
  }

  // Marca
  result.brand = document.querySelector('.product-brand, [class*="marca"], [class*="brand"]')?.textContent.trim();

  return extractStructuredData(result);
}

/**
 * Soriana-specific scraper (VTEX)
 */
function scrapeSoriana(result) {
  console.log('[DataBunker] Scraping Soriana...');

  // Soriana usa VTEX, buscar en JSON-LD primero
  result = extractStructuredData(result);

  if (!result.productName) {
    result.productName = document.querySelector('.vtex-store-components-3-x-productNameContainer, .productNameContainer, h1.product-name')?.textContent.trim();
  }

  if (!result.price) {
    const priceEl = document.querySelector('.vtex-product-price-1-x-sellingPrice, .sellingPrice, [class*="sellingPrice"]');
    if (priceEl) result.price = extractPrice(priceEl.textContent);
  }

  // Buscar EAN en scripts de VTEX
  const scripts = document.querySelectorAll('script');
  for (const script of scripts) {
    if (script.textContent.includes('__STATE__') || script.textContent.includes('productId')) {
      const eanMatch = script.textContent.match(/"ean"\s*:\s*"(\d{12,14})"/);
      if (eanMatch) {
        result.upc = eanMatch[1];
        break;
      }
    }
  }

  return result;
}

/**
 * Chedraui-specific scraper (VTEX)
 */
function scrapeChedraui(result) {
  console.log('[DataBunker] Scraping Chedraui...');

  result = extractStructuredData(result);

  if (!result.productName) {
    result.productName = document.querySelector('.vtex-store-components-3-x-productNameContainer, h1[class*="productName"], .product-name')?.textContent.trim();
  }

  if (!result.price) {
    const priceEl = document.querySelector('.vtex-product-price-1-x-sellingPrice, [class*="sellingPrice"], .price');
    if (priceEl) result.price = extractPrice(priceEl.textContent);
  }

  // Buscar EAN
  const scripts = document.querySelectorAll('script');
  for (const script of scripts) {
    const eanMatch = script.textContent.match(/"ean"\s*:\s*"(\d{12,14})"/);
    if (eanMatch) {
      result.upc = eanMatch[1];
      break;
    }
  }

  return result;
}

/**
 * La Comer-specific scraper (VTEX)
 */
function scrapeLaComer(result) {
  console.log('[DataBunker] Scraping La Comer...');

  result = extractStructuredData(result);

  if (!result.productName) {
    result.productName = document.querySelector('.vtex-store-components-3-x-productNameContainer, h1[class*="productName"], .product-name')?.textContent.trim();
  }

  if (!result.price) {
    const priceEl = document.querySelector('.vtex-product-price-1-x-sellingPrice, [class*="sellingPrice"]');
    if (priceEl) result.price = extractPrice(priceEl.textContent);
  }

  return result;
}

/**
 * HEB Mexico-specific scraper
 */
function scrapeHEB(result) {
  console.log('[DataBunker] Scraping HEB...');

  result.productName = document.querySelector('.product-name h1, h1.product-title, [class*="productTitle"]')?.textContent.trim();

  const priceEl = document.querySelector('.product-price, [class*="priceValue"], .price-value');
  if (priceEl) result.price = extractPrice(priceEl.textContent);

  result.brand = document.querySelector('.product-brand, [class*="brand"]')?.textContent.trim();

  // Buscar UPC en detalles
  const details = document.querySelector('.product-details, [class*="specifications"]');
  if (details) {
    const upcMatch = details.textContent.match(/(?:UPC|EAN)[:\s]*(\d{12,14})/i);
    if (upcMatch) result.upc = upcMatch[1];
  }

  return extractStructuredData(result);
}

/**
 * Mercado Libre-specific scraper
 */
function scrapeMercadoLibre(result) {
  console.log('[DataBunker] Scraping Mercado Libre...');

  result.productName = document.querySelector('.ui-pdp-title, h1.ui-pdp-title')?.textContent.trim();

  const priceEl = document.querySelector('.andes-money-amount__fraction, [class*="price-tag-fraction"]');
  if (priceEl) {
    const cents = document.querySelector('.andes-money-amount__cents')?.textContent || '00';
    result.price = '$' + priceEl.textContent.replace(/\D/g, '') + '.' + cents;
  }

  result.brand = document.querySelector('[class*="brand"], .ui-pdp-brand')?.textContent.trim();

  // SKU from URL
  const skuMatch = window.location.href.match(/MLM-?(\d+)/);
  if (skuMatch) result.sku = 'MLM' + skuMatch[1];

  return extractStructuredData(result);
}

/**
 * Extract structured data (JSON-LD, microdata) from page
 */
function extractStructuredData(result) {
  const ldJsonScripts = document.querySelectorAll('script[type="application/ld+json"]');

  for (const script of ldJsonScripts) {
    try {
      let data = JSON.parse(script.textContent);

      // Handle @graph structure
      if (data['@graph']) {
        data = data['@graph'].find(item => item['@type'] === 'Product') || data;
      }

      if (data['@type'] === 'Product') {
        if (!result.productName && data.name) result.productName = data.name;
        if (!result.upc && data.gtin13) result.upc = data.gtin13;
        if (!result.upc && data.gtin12) result.upc = data.gtin12;
        if (!result.upc && data.gtin) result.upc = data.gtin;
        if (!result.sku && data.sku) result.sku = data.sku;
        if (!result.brand && data.brand?.name) result.brand = data.brand.name;
        if (!result.description && data.description) result.description = data.description.substring(0, 500);
        if (!result.imageUrl && data.image) {
          result.imageUrl = Array.isArray(data.image) ? data.image[0] : data.image;
        }
        if (!result.price && data.offers) {
          const offers = Array.isArray(data.offers) ? data.offers[0] : data.offers;
          if (offers.price) {
            const currency = offers.priceCurrency || 'MXN';
            result.price = formatPrice(offers.price, currency);
          }
        }
      }
    } catch (e) {
      // Ignore JSON parse errors
    }
  }

  return result;
}

/**
 * Get page metadata
 */
function getPageMetadata() {
  return {
    title: document.title,
    url: window.location.href,
    domain: window.location.hostname,
    canonical: document.querySelector('link[rel="canonical"]')?.href,
    ogTitle: document.querySelector('meta[property="og:title"]')?.content,
    ogDescription: document.querySelector('meta[property="og:description"]')?.content,
    ogImage: document.querySelector('meta[property="og:image"]')?.content
  };
}

/**
 * Highlight product elements on page (for debugging)
 */
function highlightProductElements() {
  const selectors = [
    'h1', '.product-title', '.product-name', '[itemprop="name"]',
    '.price', '[itemprop="price"]', '.product-price',
    '[itemprop="brand"]', '.brand'
  ];

  selectors.forEach(selector => {
    document.querySelectorAll(selector).forEach(el => {
      el.style.outline = '2px solid red';
      el.style.outlineOffset = '2px';
    });
  });
}

/**
 * Utility: Clean text
 */
function cleanText(text) {
  if (!text) return null;
  return text.trim().replace(/\s+/g, ' ').substring(0, 200);
}

/**
 * Utility: Extract price from text
 */
function extractPrice(text) {
  if (!text) return null;

  // Remove currency symbols and whitespace, extract number
  const match = text.match(/[\$\u20ac\u00a3]?\s*([\d,]+\.?\d*)/);
  if (match) {
    const value = parseFloat(match[1].replace(/,/g, ''));
    if (!isNaN(value) && value > 0) {
      return '$' + value.toFixed(2);
    }
  }
  return null;
}

/**
 * Utility: Format price with currency
 */
function formatPrice(value, currency = 'MXN') {
  const symbols = {
    'USD': '$',
    'MXN': '$',
    'EUR': '\u20ac',
    'GBP': '\u00a3'
  };
  const symbol = symbols[currency] || '$';
  return symbol + parseFloat(value).toFixed(2);
}

console.log('DataBunker Price Checker content script loaded');
