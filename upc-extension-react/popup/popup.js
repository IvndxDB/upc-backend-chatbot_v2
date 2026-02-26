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
    this.pendingSearchQuery = null; // NEW: store query for store selection
    this.selectedStores = []; // NEW: currently selected stores

    this.init();
  }

  async init() {
    await this.loadSettings();
    this.bindEvents();
    this.checkBackendHealth();
    this.showGreeting();
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

    // Settings
    document.getElementById('settingsBtn').addEventListener('click', () => this.openSettings());
    document.getElementById('closeSettingsBtn').addEventListener('click', () => this.closeSettings());
    document.getElementById('saveSettingsBtn').addEventListener('click', () => this.saveSettings());
    document.getElementById('clearCacheBtn').addEventListener('click', () => this.clearCache());

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

  showGreeting() {
    // Add greeting messages with slight delay for natural feel
    setTimeout(() => {
      this.addMessage('bot', '¡Hola! 👋 Soy tu asistente de precios.');
    }, 300);

    setTimeout(() => {
      this.addMessage('bot', '¿Qué producto te gustaría buscar hoy?');
    }, 800);

    setTimeout(() => {
      this.addMessage('bot', 'Solo escribe el nombre del producto y te mostraré los mejores precios en tus tiendas favoritas. 🛒');
    }, 1300);
  }

  async sendMessage() {
    const userInput = document.getElementById('userInput');
    const message = userInput.value.trim();

    if (!message && !this.currentScrapedData && !this.currentScreenshot) return;
    if (this.isProcessing) return;

    // Add user message
    if (message) {
      this.addMessage('user', message);
    }

    // Clear input
    userInput.value = '';
    userInput.style.height = 'auto';
    this.updateSendButton();

    // Store query and show store selector inline in chat
    this.pendingSearchQuery = message;
    await this.showStoreSelectorInChat();
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
          sources,
          selectedStores: this.selectedStores.length > 0 ? this.selectedStores : null
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
            this.displayPriceResult(result, input);
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

  displayPriceResult(result, query = '') {
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
      const displayName = product.name || (product.upc ? `Código: ${product.upc}` : 'Producto');
      resultEl.innerHTML = `
        <div class="price-result-header">
          <div class="product-info">
            <h4>${displayName}</h4>
            ${product.upc && product.name ? `<span class="upc">UPC: ${product.upc}</span>` : ''}
          </div>
        </div>
        <div class="no-prices-message">
          <p>No se encontraron precios en las tiendas seleccionadas.</p>
          <p class="hint">Intenta buscar por nombre del producto o selecciona mas tiendas.</p>
        </div>
      `;
    } else {
      // Generar HTML para precios reales
      const realStoresHtml = realPrices.map((store) => {
        const isLowest = lowest && store.store === lowest.store && !lowest.estimated;
        const priceFormatted = store.price != null
          ? `$${typeof store.price === 'number' ? store.price.toFixed(2) : store.price} MXN`
          : '<span class="no-price-label">Ver precio →</span>';

        // Make entire card clickable if URL exists (use data-url, no inline onclick for CSP)
        const cardClass = `store-price-item ${isLowest ? 'lowest' : ''} ${store.url ? 'clickable' : ''}`;
        const dataUrl = store.url ? `data-url="${store.url}"` : '';

        return `
          <div class="${cardClass}" ${dataUrl} style="${store.url ? 'cursor: pointer;' : ''}">
            <div class="store-info">
              <span class="store-name">${store.store}</span>
              ${isLowest ? '<span class="lowest-badge">Mejor precio</span>' : ''}
            </div>
            <div class="store-price-value">
              ${priceFormatted}
              ${store.url ? '<span class="store-link" title="Clic para abrir">🔗</span>' : ''}
            </div>
          </div>
        `;
      }).join('');

      // Generar HTML para precios estimados (o sin precio disponible)
      const estimatedStoresHtml = estimatedPrices.map((store) => {
        const hasPrice = store.price != null;
        const priceFormatted = hasPrice
          ? `~$${typeof store.price === 'number' ? store.price.toFixed(2) : store.price} MXN`
          : '<span class="no-price-label">Ver precio →</span>';

        return `
          <div class="store-price-item estimated ${store.url ? 'clickable' : ''}" ${store.url ? `data-url="${store.url}"` : ''} style="${store.url ? 'cursor:pointer;' : ''}">
            <div class="store-info">
              <span class="store-name">${store.store}</span>
              <span class="estimated-badge">${hasPrice ? 'Estimado' : 'Precio no disponible'}</span>
            </div>
            <div class="store-price-value estimated-price">
              ${priceFormatted}
              ${store.url ? '<span class="store-link">🔗</span>' : ''}
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

    // Open store links via chrome.tabs.create (window.open blocked by CSP in extensions)
    resultEl.addEventListener('click', (e) => {
      const card = e.target.closest('.store-price-item.clickable');
      if (card && card.dataset.url) {
        chrome.tabs.create({ url: card.dataset.url });
      }
    });

    // Add refresh button at the bottom
    const refreshBtn = document.createElement('button');
    refreshBtn.className = 'refresh-prices-btn';
    refreshBtn.innerHTML = '🔄 Actualizar precios';
    refreshBtn.addEventListener('click', async () => {
      refreshBtn.disabled = true;
      refreshBtn.innerHTML = '⏳ Actualizando...';
      await this.refreshSearch(query);
    });
    resultEl.appendChild(refreshBtn);

    messagesContainer.appendChild(resultEl);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  async refreshSearch(query) {
    // Clear cache for this query then show store selector again
    await dataBunkerAPI.clearCache();
    this.addMessage('bot', '🗑️ Cache limpiado. ¿En qué tiendas buscamos ahora?');
    this.pendingSearchQuery = query;
    await this.showStoreSelectorInChat();
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

  async showStoreSelectorInChat() {
    const availableStores = dataBunkerAPI.getAvailableStores();
    const savedStoreIds = await dataBunkerAPI.getSelectedStores();
    this.selectedStores = [...savedStoreIds];

    const messagesContainer = document.getElementById('messages');

    // Create bot message bubble with store toggles
    const selectorEl = document.createElement('div');
    selectorEl.className = 'message bot store-selector-message';

    // Build the store toggle buttons
    const storeButtonsHtml = availableStores.map(store => {
      const isSelected = this.selectedStores.includes(store.id);
      return `
        <button class="store-toggle-btn ${isSelected ? 'selected' : ''}" data-store-id="${store.id}">
          <span class="store-toggle-logo">${store.logo}</span>
          <span class="store-toggle-name">${store.name}</span>
        </button>
      `;
    }).join('');

    selectorEl.innerHTML = `
      <div class="store-selector-label">¿En qué tiendas busco?</div>
      <div class="store-toggle-grid">${storeButtonsHtml}</div>
      <button class="search-stores-btn">
        🔍 Buscar en <span class="store-count">${this.selectedStores.length}</span> tiendas
      </button>
    `;

    messagesContainer.appendChild(selectorEl);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;

    // Use direct references to elements WITHIN this specific selectorEl
    const searchBtn = selectorEl.querySelector('.search-stores-btn');
    const countEl = selectorEl.querySelector('.store-count');

    // Attach toggle handlers
    selectorEl.querySelectorAll('.store-toggle-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const storeId = btn.dataset.storeId;
        if (this.selectedStores.includes(storeId)) {
          this.selectedStores = this.selectedStores.filter(id => id !== storeId);
          btn.classList.remove('selected');
        } else {
          this.selectedStores.push(storeId);
          btn.classList.add('selected');
        }
        countEl.textContent = this.selectedStores.length;
        searchBtn.disabled = this.selectedStores.length === 0;
      });
    });

    // Search button handler - uses direct reference, not getElementById
    searchBtn.addEventListener('click', async () => {
      if (this.selectedStores.length === 0) return;
      // Freeze this specific selector bubble
      selectorEl.querySelectorAll('button').forEach(b => b.disabled = true);
      selectorEl.style.opacity = '0.7';
      await this.confirmStoreSelectorInChat();
    });
  }

  async confirmStoreSelectorInChat() {
    if (this.selectedStores.length === 0) {
      this.addMessage('bot', 'Por favor selecciona al menos una tienda.', true);
      return;
    }

    await dataBunkerAPI.saveSelectedStores(this.selectedStores);

    const availableStores = dataBunkerAPI.getAvailableStores();
    const selectedNames = this.selectedStores
      .map(id => availableStores.find(s => s.id === id)?.name)
      .filter(Boolean)
      .join(', ');

    this.addMessage('bot', `🏪 Buscando en: ${selectedNames}`);
    await this.processPriceCheck(this.pendingSearchQuery);
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

  async clearCache() {
    try {
      await dataBunkerAPI.clearCache();
      this.addMessage('bot', '🗑️ Cache limpiado correctamente. Los proximos resultados seran actualizados.');
    } catch (error) {
      this.addMessage('bot', `Error al limpiar cache: ${error.message}`, true);
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
