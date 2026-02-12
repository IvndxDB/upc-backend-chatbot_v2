/**
 * DataBunker Price Checker - Popup Script
 * Main logic for the Chrome extension popup
 */

class DataBunkerPriceChecker {
  constructor() {
    this.messages = [];
    this.currentScrapedData = null;
    this.currentScreenshot = null;
    this.isProcessing = false;

    this.init();
  }

  async init() {
    await this.loadSettings();
    this.bindEvents();
    this.checkBackendHealth();
  }

  async loadSettings() {
    const settings = await dataBunkerAPI.getSettings();
    document.getElementById('backendUrl').value = settings.backendUrl || '';
    document.getElementById('useGemini').checked = settings.useGemini !== false;
    document.getElementById('useOxylabs').checked = settings.useOxylabs !== false;
    document.getElementById('usePerplexity').checked = settings.usePerplexity !== false;
  }

  bindEvents() {
    // Send message
    const sendBtn = document.getElementById('sendBtn');
    const userInput = document.getElementById('userInput');

    sendBtn.addEventListener('click', () => this.sendMessage());
    userInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.sendMessage();
      }
    });
    userInput.addEventListener('input', () => this.updateSendButton());

    // Auto-resize textarea
    userInput.addEventListener('input', () => {
      userInput.style.height = 'auto';
      userInput.style.height = Math.min(userInput.scrollHeight, 100) + 'px';
    });

    // Paste button
    document.getElementById('pasteBtn').addEventListener('click', async () => {
      try {
        const text = await navigator.clipboard.readText();
        userInput.value = text;
        userInput.dispatchEvent(new Event('input'));
      } catch (err) {
        console.error('Failed to paste:', err);
      }
    });

    // Action buttons
    document.getElementById('scanPageBtn').addEventListener('click', () => this.scanCurrentPage());
    document.getElementById('screenshotBtn').addEventListener('click', () => this.captureScreenshot());

    // Settings
    document.getElementById('settingsBtn').addEventListener('click', () => this.openSettings());
    document.getElementById('closeSettingsBtn').addEventListener('click', () => this.closeSettings());
    document.getElementById('saveSettingsBtn').addEventListener('click', () => this.saveSettings());

    // Modal
    document.getElementById('closeModalBtn').addEventListener('click', () => this.closeProductModal());
  }

  updateSendButton() {
    const userInput = document.getElementById('userInput');
    const sendBtn = document.getElementById('sendBtn');
    sendBtn.disabled = !userInput.value.trim() && !this.currentScrapedData && !this.currentScreenshot;
  }

  async checkBackendHealth() {
    const isHealthy = await dataBunkerAPI.healthCheck();
    if (!isHealthy) {
      this.addMessage('bot', 'No se pudo conectar al backend. Verifica que el servidor este corriendo en la URL configurada.', true);
    }
  }

  async sendMessage() {
    const userInput = document.getElementById('userInput');
    const message = userInput.value.trim();

    if (!message && !this.currentScrapedData && !this.currentScreenshot) return;
    if (this.isProcessing) return;

    // Clear welcome message if present
    const welcomeMsg = document.querySelector('.welcome-message');
    if (welcomeMsg) welcomeMsg.remove();

    // Add user message
    if (message) {
      this.addMessage('user', message);
    }

    // Clear input
    userInput.value = '';
    userInput.style.height = 'auto';
    this.updateSendButton();

    // Process the request
    await this.processPriceCheck(message);
  }

  async processPriceCheck(input) {
    this.isProcessing = true;
    this.showLoading('Iniciando busqueda de precios...');

    const settings = await dataBunkerAPI.getSettings();
    const sources = {
      gemini: settings.useGemini,
      oxylabs: settings.useOxylabs,
      perplexity: settings.usePerplexity
    };

    // Add typing indicator
    const typingId = this.addTypingIndicator();

    try {
      await dataBunkerAPI.streamPriceCheck(
        input,
        {
          scrapedData: this.currentScrapedData,
          screenshot: this.currentScreenshot,
          sources
        },
        {
          onStatus: (message) => {
            this.updateLoading(message);
          },
          onProduct: (product) => {
            // If multiple products found, show selection modal
            if (Array.isArray(product) && product.length > 1) {
              this.removeTypingIndicator(typingId);
              this.hideLoading();
              this.showProductSelectionModal(product, input);
            }
          },
          onPrice: (source, priceInfo) => {
            // Update UI with partial price as they come in
            console.log(`Price from ${source}:`, priceInfo);
          },
          onComplete: (result) => {
            this.removeTypingIndicator(typingId);
            this.hideLoading();
            this.displayPriceResult(result);
            this.clearContextData();
          },
          onError: (error) => {
            this.removeTypingIndicator(typingId);
            this.hideLoading();
            this.addMessage('bot', `Error: ${error}`, true);
            this.clearContextData();
          }
        }
      );
    } catch (error) {
      this.removeTypingIndicator(typingId);
      this.hideLoading();
      this.addMessage('bot', `Error al procesar la solicitud: ${error.message}`, true);
      this.clearContextData();
    }

    this.isProcessing = false;
  }

  async scanCurrentPage() {
    this.showLoading('Escaneando pagina...');

    try {
      // Get current tab
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      // Execute content script to scrape the page
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        function: scrapeProductInfo
      });

      if (results && results[0] && results[0].result) {
        const scrapedData = results[0].result;
        this.currentScrapedData = scrapedData;

        // Clear welcome message
        const welcomeMsg = document.querySelector('.welcome-message');
        if (welcomeMsg) welcomeMsg.remove();

        // Show scraped data preview
        this.addScrapedDataPreview(scrapedData);
        this.updateSendButton();
        this.hideLoading();

        // Auto-process if we have good data
        if (scrapedData.productName || scrapedData.upc) {
          await this.processPriceCheck(scrapedData.productName || '');
        }
      } else {
        this.hideLoading();
        this.addMessage('bot', 'No se pudo encontrar informacion del producto en esta pagina.', true);
      }
    } catch (error) {
      this.hideLoading();
      this.addMessage('bot', `Error al escanear la pagina: ${error.message}`, true);
    }
  }

  async captureScreenshot() {
    this.showLoading('Capturando pantalla...');

    try {
      // Small delay to ensure popup doesn't interfere with capture
      await new Promise(resolve => setTimeout(resolve, 100));

      // Get current tab
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      if (!tab || !tab.id) {
        throw new Error('No se pudo encontrar la pestaña activa');
      }

      // Capture directly from popup (must be synchronous with user interaction)
      const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
        format: 'png'
      });

      if (!dataUrl) {
        throw new Error('La captura retornó vacía');
      }

      this.currentScreenshot = dataUrl;

      // Clear welcome message
      const welcomeMsg = document.querySelector('.welcome-message');
      if (welcomeMsg) welcomeMsg.remove();

      // Show screenshot preview
      this.addScreenshotPreview(dataUrl);
      this.updateSendButton();
      this.hideLoading();

      // Auto-process with image analysis
      await this.processPriceCheck('');
    } catch (error) {
      this.hideLoading();
      console.error('Screenshot error:', error);
      this.addMessage('bot', `Error al capturar pantalla: ${error.message}. Asegúrate de que la pestaña esté activa y visible.`, true);
    }
  }

  addMessage(type, content, isError = false) {
    const messagesContainer = document.getElementById('messages');
    const messageEl = document.createElement('div');
    messageEl.className = `message ${type}${isError ? ' error' : ''}`;
    messageEl.textContent = content;
    messagesContainer.appendChild(messageEl);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;

    this.messages.push({ type, content, timestamp: Date.now() });
    return messageEl;
  }

  addTypingIndicator() {
    const messagesContainer = document.getElementById('messages');
    const typingEl = document.createElement('div');
    typingEl.className = 'typing-indicator';
    typingEl.id = 'typing-' + Date.now();
    typingEl.innerHTML = '<span></span><span></span><span></span>';
    messagesContainer.appendChild(typingEl);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
    return typingEl.id;
  }

  removeTypingIndicator(id) {
    const typingEl = document.getElementById(id);
    if (typingEl) typingEl.remove();
  }

  addScrapedDataPreview(data) {
    const messagesContainer = document.getElementById('messages');
    const previewEl = document.createElement('div');
    previewEl.className = 'scraped-preview';
    previewEl.innerHTML = `
      <h5>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
          <polyline points="14 2 14 8 20 8"></polyline>
        </svg>
        Informacion detectada
      </h5>
      <p>
        ${data.productName ? `<span class="product-name">${data.productName}</span><br>` : ''}
        ${data.upc ? `UPC: ${data.upc}<br>` : ''}
        ${data.price ? `Precio actual: ${data.price}<br>` : ''}
        ${data.brand ? `Marca: ${data.brand}` : ''}
      </p>
    `;
    messagesContainer.appendChild(previewEl);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  addScreenshotPreview(dataUrl) {
    const messagesContainer = document.getElementById('messages');
    const previewEl = document.createElement('div');
    previewEl.className = 'screenshot-preview';
    previewEl.innerHTML = `
      <h5>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
          <circle cx="8.5" cy="8.5" r="1.5"></circle>
          <polyline points="21 15 16 10 5 21"></polyline>
        </svg>
        Captura de pantalla
      </h5>
      <img src="${dataUrl}" alt="Screenshot">
    `;
    messagesContainer.appendChild(previewEl);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  displayPriceResult(result) {
    const messagesContainer = document.getElementById('messages');
    const resultEl = document.createElement('div');
    resultEl.className = 'price-result';

    const product = result.product || {};
    const stores = result.stores || [];
    const lowest = result.lowest;
    const count = result.count || stores.length;

    // Separar precios reales de estimados
    const realPrices = stores.filter(s => !s.estimated);
    const estimatedPrices = stores.filter(s => s.estimated);
    const hasEstimated = estimatedPrices.length > 0;
    const hasReal = realPrices.length > 0;

    // Si no hay tiendas, mostrar mensaje
    if (stores.length === 0) {
      resultEl.innerHTML = `
        <div class="price-result-header">
          <div class="product-info">
            <h4>${product.name || 'Producto'}</h4>
            ${product.upc ? `<span class="upc">UPC: ${product.upc}</span>` : ''}
          </div>
        </div>
        <div class="no-prices-message">
          <p>No se encontraron precios para este producto.</p>
          <p class="hint">Intenta con otro nombre o verifica la conexion.</p>
        </div>
      `;
    } else {
      // Generar HTML para precios reales
      const realStoresHtml = realPrices.map((store) => {
        const isLowest = lowest && store.store === lowest.store && !lowest.estimated;
        const priceFormatted = typeof store.price === 'number'
          ? `$${store.price.toFixed(2)} MXN`
          : store.price;

        // Make entire card clickable if URL exists
        const cardClass = `store-price-item ${isLowest ? 'lowest' : ''} ${store.url ? 'clickable' : ''}`;
        const onClick = store.url ? `onclick="window.open('${store.url}', '_blank')"` : '';

        return `
          <div class="${cardClass}" ${onClick} style="${store.url ? 'cursor: pointer;' : ''}">
            <div class="store-info">
              <span class="store-name">${store.store}</span>
              ${isLowest ? '<span class="lowest-badge">Mejor precio</span>' : ''}
              ${store.source_api ? `<span class="api-source">${store.source_api}</span>` : ''}
            </div>
            <div class="store-price-value">
              ${priceFormatted}
              ${store.url ? '<span class="store-link" title="Clic para abrir">🔗</span>' : ''}
            </div>
          </div>
        `;
      }).join('');

      // Generar HTML para precios estimados
      const estimatedStoresHtml = estimatedPrices.map((store) => {
        const priceFormatted = typeof store.price === 'number'
          ? `$${store.price.toFixed(2)} MXN`
          : store.price;

        return `
          <div class="store-price-item estimated">
            <div class="store-info">
              <span class="store-name">${store.store}</span>
              <span class="estimated-badge">Estimado</span>
            </div>
            <div class="store-price-value estimated-price">
              ~${priceFormatted}
            </div>
          </div>
        `;
      }).join('');

      resultEl.innerHTML = `
        <div class="price-result-header">
          <div class="product-info">
            <h4>${product.name || 'Producto'}</h4>
            ${product.brand ? `<span class="brand">Marca: ${product.brand}</span>` : ''}
            ${product.upc ? `<span class="upc">UPC: ${product.upc}</span>` : ''}
          </div>
          <div class="price-summary">
            <span class="stores-count">${realPrices.length} precio${realPrices.length !== 1 ? 's' : ''} real${realPrices.length !== 1 ? 'es' : ''}</span>
            ${hasEstimated ? `<span class="estimated-count">${estimatedPrices.length} estimado${estimatedPrices.length !== 1 ? 's' : ''}</span>` : ''}
          </div>
        </div>
        ${hasReal ? `
          <div class="stores-list">
            <div class="section-label">Precios en tiempo real</div>
            ${realStoresHtml}
          </div>
        ` : ''}
        ${hasEstimated ? `
          <div class="stores-list estimated-section">
            <div class="section-label estimated-label">Precios estimados (pueden variar)</div>
            ${estimatedStoresHtml}
          </div>
        ` : ''}
        ${lowest && !lowest.estimated ? `
          <div class="best-price-summary">
            <span class="best-label">Mejor precio real:</span>
            <span class="best-store">${lowest.store}</span>
            <span class="best-price">$${typeof lowest.price === 'number' ? lowest.price.toFixed(2) : lowest.price} MXN</span>
          </div>
        ` : ''}
      `;
    }

    messagesContainer.appendChild(resultEl);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  // Mantener renderPriceSource para compatibilidad con formatos antiguos
  renderPriceSource(name, badgeClass, priceInfo) {
    if (!priceInfo) {
      return `
        <div class="price-source">
          <span class="source-name">${name} <span class="badge ${badgeClass}">${badgeClass.toUpperCase()}</span></span>
          <span class="source-price no-data">No disponible</span>
        </div>
      `;
    }

    const price = typeof priceInfo === 'object' ? priceInfo.price : priceInfo;
    const store = typeof priceInfo === 'object' && priceInfo.store ? ` (${priceInfo.store})` : '';

    return `
      <div class="price-source">
        <span class="source-name">${name}${store} <span class="badge ${badgeClass}">${badgeClass.toUpperCase()}</span></span>
        <span class="source-price">${price}</span>
      </div>
    `;
  }

  showProductSelectionModal(products, originalInput) {
    const modal = document.getElementById('productModal');
    const productList = document.getElementById('productList');

    productList.innerHTML = products.map((product, index) => `
      <div class="product-item" data-index="${index}">
        <div class="product-item-info">
          <div class="product-item-name">${product.name || product.sku_des}</div>
          <div class="product-item-details">
            ${product.upc ? `UPC: ${product.upc}` : ''}
            ${product.brand ? ` | Marca: ${product.brand}` : ''}
          </div>
        </div>
        <div class="product-item-arrow">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="9 18 15 12 9 6"></polyline>
          </svg>
        </div>
      </div>
    `).join('');

    // Add click handlers
    productList.querySelectorAll('.product-item').forEach((item, index) => {
      item.addEventListener('click', () => {
        this.selectProduct(products[index], originalInput);
      });
    });

    modal.classList.remove('hidden');
  }

  async selectProduct(product, originalInput) {
    this.closeProductModal();
    this.currentScrapedData = {
      productName: product.name || product.sku_des,
      upc: product.upc,
      brand: product.brand
    };
    await this.processPriceCheck(originalInput);
  }

  closeProductModal() {
    document.getElementById('productModal').classList.add('hidden');
  }

  clearContextData() {
    this.currentScrapedData = null;
    this.currentScreenshot = null;
  }

  showLoading(text = 'Procesando...') {
    document.getElementById('loadingText').textContent = text;
    document.getElementById('loadingOverlay').classList.remove('hidden');
  }

  updateLoading(text) {
    document.getElementById('loadingText').textContent = text;
  }

  hideLoading() {
    document.getElementById('loadingOverlay').classList.add('hidden');
  }

  openSettings() {
    document.getElementById('settingsPanel').classList.remove('hidden');
  }

  closeSettings() {
    document.getElementById('settingsPanel').classList.add('hidden');
  }

  async saveSettings() {
    const settings = {
      backendUrl: document.getElementById('backendUrl').value || DEFAULT_BACKEND_URL,
      useGemini: document.getElementById('useGemini').checked,
      useOxylabs: document.getElementById('useOxylabs').checked,
      usePerplexity: document.getElementById('usePerplexity').checked
    };

    await dataBunkerAPI.saveSettings(settings);
    this.closeSettings();

    // Check connection with new URL
    const isHealthy = await dataBunkerAPI.healthCheck();
    if (!isHealthy) {
      this.addMessage('bot', 'No se pudo conectar al backend con la nueva URL.', true);
    } else {
      this.addMessage('bot', 'Configuracion guardada correctamente.');
    }
  }
}

/**
 * Content script function to scrape product info from the current page
 * This function runs in the context of the web page
 */
function scrapeProductInfo() {
  const result = {
    productName: null,
    upc: null,
    ean: null,
    price: null,
    brand: null,
    url: window.location.href
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

  const upcSelectors = [
    '[itemprop="gtin13"]',
    '[itemprop="gtin12"]',
    '[data-upc]',
    '[data-ean]'
  ];

  // Try to find product name
  for (const selector of nameSelectors) {
    const element = document.querySelector(selector);
    if (element && element.textContent.trim()) {
      result.productName = element.textContent.trim().substring(0, 200);
      break;
    }
  }

  // Try to find price
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

  // Try to find UPC/EAN
  for (const selector of upcSelectors) {
    const element = document.querySelector(selector);
    if (element) {
      result.upc = element.getAttribute('content') ||
        element.getAttribute('data-upc') ||
        element.getAttribute('data-ean') ||
        element.textContent.trim();
      break;
    }
  }

  // Look for UPC/EAN in page text
  if (!result.upc) {
    const pageText = document.body.innerText;
    const upcPatterns = [
      /UPC[:\s]*(\d{12})/i,
      /EAN[:\s]*(\d{13})/i,
      /GTIN[:\s]*(\d{12,14})/i,
      /Barcode[:\s]*(\d{12,14})/i
    ];

    for (const pattern of upcPatterns) {
      const match = pageText.match(pattern);
      if (match) {
        result.upc = match[1];
        break;
      }
    }
  }

  // Try to find brand
  const brandSelectors = [
    '[itemprop="brand"]',
    '.brand',
    '[class*="brand"]',
    'a[href*="/brand/"]'
  ];

  for (const selector of brandSelectors) {
    const element = document.querySelector(selector);
    if (element && element.textContent.trim()) {
      result.brand = element.textContent.trim();
      break;
    }
  }

  // Get structured data if available
  const ldJsonScripts = document.querySelectorAll('script[type="application/ld+json"]');
  for (const script of ldJsonScripts) {
    try {
      const data = JSON.parse(script.textContent);
      const product = data['@type'] === 'Product' ? data : (data['@graph']?.find(item => item['@type'] === 'Product'));

      if (product) {
        if (!result.productName && product.name) result.productName = product.name;
        if (!result.upc && product.gtin13) result.upc = product.gtin13;
        if (!result.upc && product.gtin12) result.upc = product.gtin12;
        if (!result.upc && product.sku) result.sku = product.sku;
        if (!result.brand && product.brand?.name) result.brand = product.brand.name;
        if (!result.price && product.offers?.price) result.price = '$' + product.offers.price;
      }
    } catch (e) {
      // Ignore JSON parse errors
    }
  }

  return result;
}

// Initialize the app
document.addEventListener('DOMContentLoaded', () => {
  new DataBunkerPriceChecker();
});
