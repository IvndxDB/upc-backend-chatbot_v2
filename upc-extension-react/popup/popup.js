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
    this.pendingSearchQuery = null;
    this.selectedStores = [];
    this.pendingStoreUrls = {}; // {domain: url} from dictionary for Zyte
    this.pendingWholeWeb = false; // true when "buscar en toda la web" is clicked

    // Multi-search state
    this.multiSearchMode = false;
    this.multiItems = []; // [{text, query, upc, image, storeUrls}] — after resolution
    this.multiSearchPending = null; // resolved items waiting for store selection

    this.init();
  }

  async init() {
    const loggedIn = await cognitoService.isLoggedIn();
    if (!loggedIn) {
      this.showCognitoLoginScreen();
      return;
    }

    this.bindEvents();
    this.showUserInHeader();
    this.checkBackendHealth();
    this.showGreeting();
  }

  showCognitoLoginScreen() {
    document.getElementById('cognitoLoginScreen').classList.remove('hidden');
    const emailInput = document.getElementById('cognitoEmail');
    const passwordInput = document.getElementById('cognitoPassword');
    const btn = document.getElementById('cognitoLoginBtn');
    const errorEl = document.getElementById('cognitoError');

    const updateBtn = () => {
      btn.disabled = !emailInput.value.trim() || !passwordInput.value.trim();
    };
    emailInput.addEventListener('input', updateBtn);
    passwordInput.addEventListener('input', updateBtn);

    // Eye button — show password while held down
    const toggleBtn = document.getElementById('togglePassword');
    toggleBtn.addEventListener('mousedown', () => { passwordInput.type = 'text'; });
    toggleBtn.addEventListener('mouseup',   () => { passwordInput.type = 'password'; });
    toggleBtn.addEventListener('mouseleave',() => { passwordInput.type = 'password'; });

    const doLogin = () => this.handleCognitoLogin(emailInput, passwordInput, btn, errorEl);
    btn.addEventListener('click', doLogin);
    passwordInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !btn.disabled) doLogin();
    });
  }

  async handleCognitoLogin(emailInput, passwordInput, btn, errorEl) {
    const email = emailInput.value.trim();
    const password = passwordInput.value;

    btn.disabled = true;
    btn.textContent = 'Iniciando sesión...';
    errorEl.classList.add('hidden');

    try {
      await cognitoService.signIn(email, password);
      document.getElementById('cognitoLoginScreen').classList.add('hidden');

      this.bindEvents();
      this.showUserInHeader();
      this.checkBackendHealth();
      this.showGreeting();
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.classList.remove('hidden');
      btn.disabled = false;
      btn.textContent = 'Iniciar sesión';
    }
  }

  async showUserInHeader() {
    const user = await cognitoService.getCurrentUser();
    const badge = document.getElementById('userBadge');
    const emailEl = document.getElementById('userEmail');
    if (!badge) return;
    emailEl.textContent = user?.email || user?.name || 'Usuario';
    badge.classList.remove('hidden');
    document.getElementById('logoutBtn').addEventListener('click', () => this.handleLogout());
    this._updateUsageCounter();
  }

  async _updateUsageCounter(usageData = null) {
    const el = document.getElementById('usageCounter');
    if (!el) return;
    const usage = usageData || await dataBunkerAPI.getUsage();
    // remaining===9999 means Supabase is unavailable — hide counter
    if (!usage || usage.remaining === 9999) { el.textContent = ''; return; }
    const { count, limit, remaining } = usage;
    el.textContent = `${count}/${limit}`;
    el.className = 'usage-counter';
    if (remaining <= 0)        el.classList.add('danger');
    else if (remaining <= 10)  el.classList.add('warning');
  }

  async handleLogout() {
    await cognitoService.signOut();
    window.location.reload();
  }

  bindEvents() {
    // Send message
    const sendBtn = document.getElementById('sendBtn');
    const userInput = document.getElementById('userInput');

    sendBtn.addEventListener('click', () => this.sendMessage());
    userInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (this.multiSearchMode) {
          this._commitMultiInputText(); // async — intentionally not awaited (fire-and-show)
        } else {
          this.sendMessage();
        }
      }
    });
    userInput.addEventListener('input', () => this.updateSendButton());

    // Auto-resize textarea
    userInput.addEventListener('input', () => {
      userInput.style.height = 'auto';
      userInput.style.height = Math.min(userInput.scrollHeight, 100) + 'px';
    });

    // Paste: in multi-mode, split comma-separated values into chips
    userInput.addEventListener('paste', (e) => {
      if (!this.multiSearchMode) return;
      const text = (e.clipboardData || window.clipboardData).getData('text');
      if (!text.includes(',')) return; // let normal paste handle single items
      e.preventDefault();
      const parts = text.split(',').map(s => s.trim()).filter(Boolean);
      parts.forEach(p => this._addMultiChip(p));
    });

    // Multi-search toggle
    document.getElementById('multiSearchBtn').addEventListener('click', () => {
      this.toggleMultiSearchMode();
    });

    // Close dropdown when clicking outside input area
    document.addEventListener('click', (e) => {
      const dd = document.getElementById('multiDropdown');
      if (!dd || dd.classList.contains('hidden')) return;
      if (!e.target.closest('.input-area')) this._hideMultiDropdown();
    });

    // Modal
    document.getElementById('closeModalBtn').addEventListener('click', () => this.closeProductModal());
  }

  updateSendButton() {
    const userInput = document.getElementById('userInput');
    const sendBtn = document.getElementById('sendBtn');
    if (this.multiSearchMode) {
      sendBtn.disabled = this.multiItems.length === 0 && !userInput.value.trim();
    } else {
      sendBtn.disabled = !userInput.value.trim() && !this.currentScrapedData && !this.currentScreenshot;
    }
  }

  toggleMultiSearchMode() {
    this.multiSearchMode = !this.multiSearchMode;
    const btn = document.getElementById('multiSearchBtn');
    const tagsArea = document.getElementById('multiTagsArea');
    const userInput = document.getElementById('userInput');

    if (this.multiSearchMode) {
      btn.classList.add('active');
      btn.title = 'Desactivar búsqueda múltiple';
      tagsArea.classList.remove('hidden');
      userInput.placeholder = 'Agrega un producto (Enter) o pega UPCs separados por coma...';
    } else {
      btn.classList.remove('active');
      btn.title = 'Búsqueda múltiple';
      tagsArea.classList.add('hidden');
      this.multiItems = [];
      userInput.placeholder = 'Escribe el nombre del producto o pega informacion...';
    }
    this.updateSendButton();
  }

  _addMultiChip(itemOrText) {
    let item;
    if (typeof itemOrText === 'string') {
      const text = itemOrText.trim();
      if (!text) return;
      item = { text, query: text, upc: null, image: null, storeUrls: {}, confirmed: false };
    } else {
      item = itemOrText;
    }
    if (!item.text) return;
    if (this.multiItems.some(i => i.text === item.text)) return;
    this.multiItems.push(item);
    this._renderMultiTags();
    this.updateSendButton();
  }

  async _commitMultiInputText() {
    const userInput = document.getElementById('userInput');
    const val = userInput.value.trim();
    if (!val) return;

    const isBarcode = /^\d{8,14}$/.test(val);

    if (isBarcode) {
      // Resolve UPC against dictionary immediately
      const found = await dictionaryLookupByUPC(val);
      if (found) {
        this._addMultiChip({
          text: found.Item,
          query: found.Item,
          upc: found.UPC,
          image: found.image || null,
          storeUrls: buildStoreUrlsFromEntry(found),
          confirmed: true,
        });
      } else {
        this._addMultiChip({ text: val, query: '', upc: val, image: null, storeUrls: {}, confirmed: false });
      }
      userInput.value = '';
      userInput.style.height = 'auto';
      return;
    }

    // Description: fuzzy search → show inline dropdown
    const matches = await fuzzySearch(val, 15);
    if (matches.length === 0) {
      // No matches → add raw
      this._addMultiChip(val);
      userInput.value = '';
      userInput.style.height = 'auto';
      return;
    }

    this._showMultiFuzzyDropdown(val, matches, userInput);
  }

  _showMultiFuzzyDropdown(rawText, matches, userInput) {
    const PAGE_SIZE = 5;
    const totalPages = Math.ceil(matches.length / PAGE_SIZE);
    let currentPage = 0;

    const dd = document.getElementById('multiDropdown');
    dd.innerHTML = '';

    // Header
    const header = document.createElement('div');
    header.className = 'multi-dropdown-header';
    header.textContent = `Elige el producto para "${rawText}"`;
    dd.appendChild(header);

    // Items container
    const itemsContainer = document.createElement('div');
    dd.appendChild(itemsContainer);

    // Pagination row (only if more than one page)
    const paginationRow = document.createElement('div');
    paginationRow.className = 'multi-dropdown-pagination';
    const prevBtn = document.createElement('button');
    prevBtn.className = 'multi-dd-page-btn';
    prevBtn.textContent = '←';
    const pageLabel = document.createElement('span');
    pageLabel.className = 'multi-dd-page-label';
    const nextBtn = document.createElement('button');
    nextBtn.className = 'multi-dd-page-btn';
    nextBtn.textContent = '→';
    paginationRow.appendChild(prevBtn);
    paginationRow.appendChild(pageLabel);
    paginationRow.appendChild(nextBtn);
    if (totalPages > 1) dd.appendChild(paginationRow);

    // "Search as-is" option
    const skip = document.createElement('div');
    skip.className = 'multi-dropdown-item multi-dropdown-skip';
    skip.textContent = `🔎 Buscar "${rawText}" tal como está`;
    skip.addEventListener('click', () => {
      this._addMultiChip(rawText);
      userInput.value = '';
      userInput.style.height = 'auto';
      this._hideMultiDropdown();
    });
    dd.appendChild(skip);

    const renderPage = () => {
      itemsContainer.innerHTML = '';
      const start = currentPage * PAGE_SIZE;
      const end = Math.min(start + PAGE_SIZE, matches.length);
      for (let i = start; i < end; i++) {
        const m = matches[i];
        const row = document.createElement('div');
        row.className = 'multi-dropdown-item';
        if (m.image) {
          const img = document.createElement('img');
          img.src = m.image;
          img.addEventListener('error', () => { img.style.display = 'none'; });
          row.appendChild(img);
        }
        const name = document.createElement('span');
        name.className = 'dd-name';
        name.textContent = m.Item;
        row.appendChild(name);
        if (m.UPC) {
          const upc = document.createElement('span');
          upc.className = 'dd-upc';
          upc.textContent = m.UPC;
          row.appendChild(upc);
        }
        row.addEventListener('click', () => {
          this._addMultiChip({
            text: m.Item,
            query: m.Item,
            upc: m.UPC || null,
            image: m.image || null,
            storeUrls: buildStoreUrlsFromEntry(m),
            confirmed: true,
          });
          userInput.value = '';
          userInput.style.height = 'auto';
          this._hideMultiDropdown();
        });
        itemsContainer.appendChild(row);
      }
      pageLabel.textContent = `${currentPage + 1} / ${totalPages}`;
      prevBtn.disabled = currentPage === 0;
      nextBtn.disabled = currentPage >= totalPages - 1;
    };

    prevBtn.addEventListener('click', () => {
      if (currentPage > 0) { currentPage--; renderPage(); }
    });
    nextBtn.addEventListener('click', () => {
      if (currentPage < totalPages - 1) { currentPage++; renderPage(); }
    });

    renderPage();
    dd.classList.remove('hidden');
  }

  _hideMultiDropdown() {
    document.getElementById('multiDropdown').classList.add('hidden');
  }

  _removeMultiChip(index) {
    this.multiItems.splice(index, 1);
    this._renderMultiTags();
    this.updateSendButton();
  }

  _renderMultiTags() {
    const tagsArea = document.getElementById('multiTagsArea');
    tagsArea.innerHTML = '';
    if (this.multiItems.length === 0) {
      tagsArea.classList.add('empty');
      return;
    }
    tagsArea.classList.remove('empty');
    this.multiItems.forEach((item, idx) => {
      const chip = document.createElement('span');
      chip.className = `multi-tag${item.confirmed ? '' : ' raw'}`;
      const textSpan = document.createElement('span');
      textSpan.className = 'multi-tag-text';
      textSpan.textContent = item.text;
      chip.appendChild(textSpan);
      const removeBtn = document.createElement('button');
      removeBtn.className = 'multi-tag-remove';
      removeBtn.textContent = '×';
      removeBtn.addEventListener('click', () => this._removeMultiChip(idx));
      chip.appendChild(removeBtn);
      tagsArea.appendChild(chip);
    });
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
    if (this.multiSearchMode) {
      // If dropdown is open, don't send yet (user is picking)
      const dd = document.getElementById('multiDropdown');
      if (dd && !dd.classList.contains('hidden')) return;
      // Commit any remaining typed text, then launch multi-search
      await this._commitMultiInputText();
      if (this.multiItems.length > 0) await this.sendMultiMessage();
      return;
    }

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

    const isBarcode = /^\d{8,14}$/.test(message.trim());

    if (isBarcode) {
      // Look up barcode in local dictionary
      const found = await dictionaryLookupByUPC(message.trim());
      if (found) {
        this.addMessage('bot', `📦 ${found.Item}`);
        this.pendingSearchQuery = found.Item;
        this.pendingUPC = found.UPC;
        this.pendingImage = found.image || null;
        this.pendingStoreUrls = buildStoreUrlsFromEntry(found);
      } else {
        this.pendingSearchQuery = '';
        this.pendingUPC = message.trim();
        this.pendingImage = null;
        this.pendingStoreUrls = {};
      }
      await this.showStoreSelectorInChat();
      return;
    }

    // Text query → fuzzy search in dictionary
    const matches = await fuzzySearch(message);
    if (matches.length > 0) {
      await this.showFuzzyResultsInChat(matches, message);
      return;
    }

    // No fuzzy matches → go straight to store selector with original input
    this.pendingSearchQuery = message;
    this.pendingImage = null;
    this.pendingStoreUrls = {};
    await this.showStoreSelectorInChat();
  }

  async showFuzzyResultsInChat(matches, originalInput) {
    const messagesContainer = document.getElementById('messages');
    this.addMessage('bot', '🔍 Encontré estos productos en el catálogo. ¿Cuál buscas?');

    const PAGE_SIZE = 5;
    const MAX_PAGES = 3;
    const totalPages = Math.min(MAX_PAGES, Math.ceil(matches.length / PAGE_SIZE));
    let currentPage = 0;
    let disabled = false;

    const selectorEl = document.createElement('div');
    selectorEl.className = 'fuzzy-results-message';

    // Results container — gets replaced on each page change
    const resultsDiv = document.createElement('div');
    resultsDiv.className = 'fuzzy-options';

    // Pagination row
    const paginationDiv = document.createElement('div');
    paginationDiv.className = 'fuzzy-pagination';

    const prevBtn = document.createElement('button');
    prevBtn.className = 'fuzzy-page-btn';
    prevBtn.textContent = '← Anterior';

    const pageLabel = document.createElement('span');
    pageLabel.className = 'fuzzy-page-label';

    const nextBtn = document.createElement('button');
    nextBtn.className = 'fuzzy-page-btn';
    nextBtn.textContent = 'Siguiente →';

    paginationDiv.appendChild(prevBtn);
    paginationDiv.appendChild(pageLabel);
    paginationDiv.appendChild(nextBtn);

    // Skip button
    const skipBtn = document.createElement('button');
    skipBtn.className = 'fuzzy-option-btn fuzzy-skip-btn';
    skipBtn.innerHTML = `🔎 Buscar "<em>${originalInput}</em>" tal como está`;
    skipBtn.addEventListener('click', async () => {
      if (disabled) return;
      disabled = true;
      selectorEl.querySelectorAll('button').forEach(b => b.disabled = true);
      this.addMessage('user', originalInput);
      this.pendingSearchQuery = originalInput;
      this.pendingUPC = null;
      this.pendingImage = null;
      this.pendingStoreUrls = {};
      await this.showStoreSelectorInChat();
    });

    selectorEl.appendChild(resultsDiv);
    if (totalPages > 1) selectorEl.appendChild(paginationDiv);
    selectorEl.appendChild(skipBtn);

    const renderPage = () => {
      resultsDiv.innerHTML = '';
      const start = currentPage * PAGE_SIZE;
      const end = Math.min(start + PAGE_SIZE, matches.length, MAX_PAGES * PAGE_SIZE);

      for (let i = start; i < end; i++) {
        const m = matches[i];
        const btn = document.createElement('button');
        btn.className = 'fuzzy-option-btn';
        btn.innerHTML = `
          ${m.image ? `<img class="fuzzy-item-img" src="${m.image}" alt="">` : ''}
          <span class="fuzzy-item-info">
            <span class="fuzzy-item-name">${m.Item}</span>
            ${m.UPC ? `<span class="fuzzy-item-upc">${m.UPC}</span>` : ''}
          </span>
        `;
        if (m.image) {
          const img = btn.querySelector('.fuzzy-item-img');
          if (img) img.addEventListener('error', () => { img.style.display = 'none'; });
        }
        btn.addEventListener('click', async () => {
          if (disabled) return;
          disabled = true;
          selectorEl.querySelectorAll('button').forEach(b => b.disabled = true);
          this.addMessage('user', m.Item);
          this.pendingSearchQuery = m.Item;
          this.pendingUPC = m.UPC || null;
          this.pendingImage = m.image || null;
          this.pendingStoreUrls = buildStoreUrlsFromEntry(m);
          await this.showStoreSelectorInChat();
        });
        resultsDiv.appendChild(btn);
      }

      pageLabel.textContent = `${currentPage + 1} / ${totalPages}`;
      prevBtn.disabled = currentPage === 0;
      nextBtn.disabled = currentPage >= totalPages - 1;
    };

    prevBtn.addEventListener('click', () => {
      if (disabled || currentPage === 0) return;
      currentPage--;
      renderPage();
    });

    nextBtn.addEventListener('click', () => {
      if (disabled || currentPage >= totalPages - 1) return;
      currentPage++;
      renderPage();
    });

    renderPage();
    messagesContainer.appendChild(selectorEl);
    this.scrollToBottom();
  }

  async sendMultiMessage() {
    const items = [...this.multiItems]; // already resolved at chip-add time
    this.addMessage('user', `🔍 Búsqueda múltiple: ${items.length} producto${items.length !== 1 ? 's' : ''}`);

    // Clear chips
    this.multiItems = [];
    this._renderMultiTags();
    this.updateSendButton();

    this.multiSearchPending = items.map(i => ({
      label: i.text,
      query: i.query,
      upc: i.upc,
      image: i.image || null,
      storeUrls: i.storeUrls || {},
    }));
    await this.showStoreSelectorInChat();
  }

  async runMultiSearchBatch(items) {
    const total = items.length;
    let done = 0;
    const allResults = []; // for download-all

    const messagesEl = document.getElementById('messages');

    const progressEl = document.createElement('div');
    progressEl.className = 'multi-progress-banner';
    const progressLeft = document.createElement('div');
    progressLeft.className = 'multi-progress-left';
    const progressSpinner = document.createElement('div');
    progressSpinner.className = 'multi-progress-spinner';
    const progressText = document.createElement('span');
    progressText.textContent = `Buscando ${total} producto${total !== 1 ? 's' : ''}...`;
    progressLeft.appendChild(progressSpinner);
    progressLeft.appendChild(progressText);
    progressEl.appendChild(progressLeft);
    messagesEl.appendChild(progressEl);
    this.scrollToBottom();

    const updateProgress = () => {
      const remaining = total - done;
      // Re-anchor banner below all results
      messagesEl.appendChild(progressEl);
      if (remaining === 0) {
        progressEl.classList.add('done');
        progressText.textContent = `✅ ${total} producto${total !== 1 ? 's' : ''} encontrado${total !== 1 ? 's' : ''}`;
      } else {
        progressText.textContent = `Buscando ${remaining} de ${total} producto${total !== 1 ? 's' : ''} restante${remaining !== 1 ? 's' : ''}...`;
      }
    };

    await Promise.all(items.map((item) => new Promise((resolve) => {
      dataBunkerAPI.streamPriceCheck(
        item.query,
        {
          scrapedData: item.upc ? { upc: item.upc } : null,
          selectedStores: this.selectedStores.length > 0 ? this.selectedStores : null,
          productImage: item.image || null,
          storeUrls: item.storeUrls || {},
          wholeWeb: item.wholeWeb || false,
        },
        {
          onStatus: () => {},
          onProduct: () => {},
          onPrice: () => {},
          onComplete: (result) => {
            if (!result.product.name && item.query) result.product.name = item.query;
            if (!result.product.upc && item.upc) result.product.upc = item.upc;
            done++;
            allResults.push({ product: result.product, stores: result.stores || [] });
            updateProgress();
            this.displayPriceResult(result, item.query || item.upc || '');
            messagesEl.appendChild(progressEl); // keep banner at bottom after result card
            this._updateUsageCounter();
            this.scrollToBottom();
            resolve();
          },
          onError: (error) => {
            done++;
            updateProgress();
            this.addMessage('bot', `❌ Error buscando "${item.label || item.query || item.upc}": ${error}`, true);
            messagesEl.appendChild(progressEl);
            this.scrollToBottom();
            resolve();
          }
        }
      );
    })));

    // Add download-all button when batch is complete
    const allStores = allResults.flatMap(r => r.stores);
    if (allStores.length > 0) {
      const downloadAllBtn = document.createElement('button');
      downloadAllBtn.className = 'download-all-btn';
      downloadAllBtn.textContent = '⬇️ Descargar todo';
      downloadAllBtn.addEventListener('click', () => {
        const blob = this._generateExcelMulti(allResults);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const dateStr = new Date().toISOString().slice(0, 10);
        a.download = `busqueda_multiple_${dateStr}.xlsx`;
        a.href = url;
        a.click();
        URL.revokeObjectURL(url);
      });
      progressEl.appendChild(downloadAllBtn);
    }
    this.scrollToBottom();
  }

  _generateExcelMulti(items) {
    const today = new Date().toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const rows = [['Fecha', 'Retailer', 'UPC', 'Item', 'Precio S/D', 'Precio C/D', 'URL', 'URL Imagen']];
    for (const { product, stores } of items) {
      for (const store of stores) {
        const hasDiscount = store.regular_price != null && store.regular_price !== store.price;
        rows.push([
          today,
          store.store || '',
          product.upc || '',
          product.name || '',
          hasDiscount ? store.regular_price : (store.price ?? ''),
          hasDiscount ? store.price : '',
          store.url || '',
          store.image || '',
        ]);
      }
    }
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [
      { wch: 12 }, { wch: 20 }, { wch: 16 }, { wch: 40 },
      { wch: 12 }, { wch: 12 }, { wch: 60 }, { wch: 60 },
    ];
    XLSX.utils.book_append_sheet(wb, ws, 'Precios');
    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    return new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
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
      // If fuzzy match provided a UPC, merge it into scrapedData
      const scrapedData = this.pendingUPC
        ? { ...(this.currentScrapedData || {}), upc: this.pendingUPC }
        : this.currentScrapedData;
      const productImage = this.pendingImage || null;
      const storeUrls = this.pendingStoreUrls || {};
      const wholeWeb = this.pendingWholeWeb || false;
      this.currentStoreUrls = storeUrls;
      this.pendingUPC = null;
      this.pendingImage = null;
      this.pendingStoreUrls = {};
      this.pendingWholeWeb = false;

      await dataBunkerAPI.streamPriceCheck(
        input,
        {
          scrapedData,
          screenshot: this.currentScreenshot,
          sources,
          selectedStores: this.selectedStores.length > 0 ? this.selectedStores : null,
          productImage,
          storeUrls,
          wholeWeb
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
            this._updateUsageCounter();
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

  async processPriceCheckProgressive(input) {
    const storeUrls   = this.pendingStoreUrls || {};
    const wholeWeb    = this.pendingWholeWeb  || false;
    const scrapedData = this.pendingUPC
      ? { ...(this.currentScrapedData || {}), upc: this.pendingUPC }
      : this.currentScrapedData;
    const productImage = this.pendingImage || null;

    this.currentStoreUrls  = storeUrls;
    this.pendingUPC        = null;
    this.pendingImage      = null;
    this.pendingStoreUrls  = {};
    this.pendingWholeWeb   = false;
    this.isProcessing      = true;

    const messagesEl = document.getElementById('messages');
    const typingId   = this.addTypingIndicator();

    // ── Whole-web: single non-progressive request ──────────────────────────
    if (wholeWeb) {
      this.showLoading('Consultando precios en toda la web...');
      try {
        await dataBunkerAPI.streamPriceCheck(input, {
          scrapedData, productImage, storeUrls: {}, wholeWeb: true, selectedStores: null,
        }, {
          onStatus:   msg => this.updateLoading(msg),
          onComplete: result => {
            this.removeTypingIndicator(typingId);
            this.hideLoading();
            this.displayPriceResult(result, input);
            this.clearContextData();
            this._updateUsageCounter();
          },
          onError: err => {
            this.removeTypingIndicator(typingId);
            this.hideLoading();
            this.addMessage('bot', `Error: ${err}`, true);
            this.clearContextData();
          },
        });
      } catch (e) {
        this.removeTypingIndicator(typingId);
        this.hideLoading();
        this.addMessage('bot', `Error: ${e.message}`, true);
      }
      this.isProcessing = false;
      return;
    }

    // ── Per-store progressive search ───────────────────────────────────────
    this.removeTypingIndicator(typingId);
    this.hideLoading();

    const availableStores = await dataBunkerAPI.getAvailableStores();
    const selectedIds     = this.selectedStores.length > 0
      ? this.selectedStores
      : await dataBunkerAPI.getSelectedStores();

    if (selectedIds.length === 0) {
      this.addMessage('bot', 'No hay tiendas seleccionadas.', true);
      this.isProcessing = false;
      return;
    }

    // If using dictionary URLs, only search stores that actually have a URL for this product
    const hasDictionary = Object.keys(storeUrls).length > 0;
    const storeIdsToSearch = hasDictionary
      ? selectedIds.filter(id => {
          const s = availableStores.find(s => s.id === id);
          return s?.domain && storeUrls[s.domain];
        })
      : selectedIds;

    if (storeIdsToSearch.length === 0) {
      this.addMessage('bot', 'Este producto no está disponible en las tiendas seleccionadas.', true);
      this.clearContextData();
      this.isProcessing = false;
      return;
    }

    // ── Cache key (same logic as streamPriceCheck) ────────────────────────
    const _rawInput = input || scrapedData?.productName || scrapedData?.name || '';
    const _isBarcode = /^\d{8,14}$/.test(_rawInput.trim());
    const _cacheQuery = _isBarcode ? '' : _rawInput;
    const _cacheUpc   = _isBarcode ? _rawInput.trim() : (scrapedData?.upc || '');

    // Check cache before starting progressive search
    const _cached = await dataBunkerAPI.getCachedResults(_cacheQuery, _cacheUpc);
    if (_cached) {
      this.displayPriceResult(_cached, input);
      this.clearContextData();
      this._updateUsageCounter();
      this.isProcessing = false;
      return;
    }

    // ── No dictionary: single Oxylabs call with all stores (1 usage count) ──
    if (!hasDictionary) {
      const t2 = this.addTypingIndicator();
      this.showLoading(`Buscando en ${storeIdsToSearch.length} tiendas...`);
      try {
        await dataBunkerAPI.streamPriceCheck(input, {
          scrapedData,
          selectedStores: storeIdsToSearch,
          productImage,
          storeUrls: {},
          wholeWeb: false,
        }, {
          onStatus:   msg => this.updateLoading(msg),
          onComplete: result => {
            this.removeTypingIndicator(t2);
            this.hideLoading();
            this.displayPriceResult(result, input);
            this.clearContextData();
            this._updateUsageCounter();
          },
          onError: err => {
            this.removeTypingIndicator(t2);
            this.hideLoading();
            this.addMessage('bot', `Error: ${err}`, true);
            this.clearContextData();
          },
        });
      } catch (e) {
        this.removeTypingIndicator(t2);
        this.hideLoading();
        this.addMessage('bot', `Error: ${e.message}`, true);
      }
      this.isProcessing = false;
      return;
    }

    const total    = storeIdsToSearch.length;
    let done       = 0;
    const allStores = [];
    let productInfo = null;
    let liveCardEl  = null;

    // Progress banner
    const progressEl    = document.createElement('div');
    progressEl.className = 'multi-progress-banner';
    const progressLeft  = document.createElement('div');
    progressLeft.className = 'multi-progress-left';
    const progressSpinner = document.createElement('div');
    progressSpinner.className = 'multi-progress-spinner';
    const progressText  = document.createElement('span');
    progressText.textContent = `Buscando en ${total} tienda${total !== 1 ? 's' : ''}...`;
    progressLeft.appendChild(progressSpinner);
    progressLeft.appendChild(progressText);
    progressEl.appendChild(progressLeft);
    messagesEl.appendChild(progressEl);
    this.scrollToBottom();

    const updateCard = () => {
      const pImg   = allStores.find(s => s.image)?.image || productImage;
      const newCard = this._buildResultCard(productInfo || {}, allStores, input, pImg, storeUrls);
      if (liveCardEl && liveCardEl.parentNode === messagesEl) {
        messagesEl.replaceChild(newCard, liveCardEl);
      } else {
        messagesEl.insertBefore(newCard, progressEl);
      }
      liveCardEl = newCard;
    };

    const updateProgress = () => {
      messagesEl.appendChild(progressEl);
      if (done >= total) {
        progressEl.classList.add('done');
        progressSpinner.style.display = 'none';
        const found = allStores.filter(s => !s.estimated && s.price != null).length;
        progressText.textContent = `✅ ${found} precio${found !== 1 ? 's' : ''} encontrado${found !== 1 ? 's' : ''} en ${total} tienda${total !== 1 ? 's' : ''}`;
      } else {
        progressText.textContent = `Buscando tienda ${done}/${total}...`;
      }
    };

    let firstCall = true;
    await Promise.all(storeIdsToSearch.map(storeId => new Promise(resolve => {
      const storeInfo       = availableStores.find(s => s.id === storeId);
      const domain          = storeInfo?.domain;
      const singleStoreUrls = domain && storeUrls[domain] ? { [domain]: storeUrls[domain] } : {};
      const skipUsage       = !firstCall;
      firstCall             = false;

      dataBunkerAPI.streamPriceCheck(input, {
        scrapedData,
        selectedStores: [storeId],
        productImage,
        storeUrls: singleStoreUrls,
        wholeWeb: false,
        skipUsage,
        noCache: true,
      }, {
        onStatus:   () => {},
        onComplete: result => {
          done++;
          if (!productInfo && result.product?.name) productInfo = result.product;
          (result.stores || []).forEach(s => allStores.push(s));
          if (allStores.length > 0 || productInfo) updateCard();
          updateProgress();
          this.scrollToBottom();
          resolve();
        },
        onError: () => {
          done++;
          updateProgress();
          this.scrollToBottom();
          resolve();
        },
      });
    })));

    // Save full accumulated result to cache
    if (allStores.length > 0) {
      const priced = allStores.filter(s => s.price != null && !s.estimated);
      const lowest = priced.length > 0
        ? priced.reduce((min, s) => s.price < min.price ? s : min)
        : null;
      const fullResult = {
        product: productInfo || { name: input },
        stores:  allStores,
        lowest,
        count:   allStores.length,
      };
      await dataBunkerAPI.setCachedResults(_cacheQuery, _cacheUpc, fullResult);
    }

    this._updateUsageCounter();
    this.clearContextData();
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
    this.scrollToBottom();

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
    this.scrollToBottom();
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
    this.scrollToBottom();
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
    this.scrollToBottom();
  }

  formatPrice(price) {
    if (price == null) return null;
    const num = typeof price === 'number' ? price : parseFloat(price);
    if (isNaN(num)) return null;
    return num % 1 === 0
      ? num.toLocaleString('en-US')
      : num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  displayPriceResult(result, query = '') {
    const messagesContainer = document.getElementById('messages');
    const product = result.product || {};
    const stores = result.stores || [];
    const productImage = stores.find(s => s.image)?.image || null;
    const card = this._buildResultCard(product, stores, query, productImage, this.currentStoreUrls);
    messagesContainer.appendChild(card);
    this.scrollToBottom();
  }

  _buildResultCard(product, stores, query, productImage, storeUrls) {
    const resultEl = document.createElement('div');
    resultEl.className = 'price-result';

    // Calculate lowest from stores
    const realWithPrice = stores.filter(s => !s.estimated && s.price != null);
    const lowest = realWithPrice.length > 0
      ? realWithPrice.reduce((min, s) => s.price < min.price ? s : min, realWithPrice[0])
      : null;

    // Color gradient helpers (cheapest=green → mid=yellow → expensive=red)
    const interpolateHex = (c1, c2, t) => {
      const r1 = parseInt(c1.slice(1,3),16), g1 = parseInt(c1.slice(3,5),16), b1 = parseInt(c1.slice(5,7),16);
      const r2 = parseInt(c2.slice(1,3),16), g2 = parseInt(c2.slice(3,5),16), b2 = parseInt(c2.slice(5,7),16);
      return `rgb(${Math.round(r1+(r2-r1)*t)},${Math.round(g1+(g2-g1)*t)},${Math.round(b1+(b2-b1)*t)})`;
    };
    const getPriceColor = (index, total) => {
      if (total <= 1) return '#99e3dd';
      const ratio = index / (total - 1);
      return ratio <= 0.5
        ? interpolateHex('#99e3dd', '#fae99f', ratio * 2)
        : interpolateHex('#fae99f', '#fec0bf', (ratio - 0.5) * 2);
    };

    // Separar precios reales de estimados y ordenar de menor a mayor precio
    const rawRealPrices = stores.filter(s => !s.estimated);
    const realPrices = [...rawRealPrices].sort((a, b) => {
      if (a.price == null && b.price == null) return 0;
      if (a.price == null) return 1;
      if (b.price == null) return -1;
      return a.price - b.price;
    });
    const estimatedPrices = stores.filter(s => s.estimated);
    const hasEstimated = estimatedPrices.length > 0;
    const hasReal = realPrices.length > 0;
    const pricedCount = realPrices.filter(s => s.price != null).length;

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
      // Generar HTML para precios reales (ordenados, con color gradiente)
      let priceRank = 0;
      const realStoresHtml = realPrices.map((store) => {
        const isLowest = lowest && store.price != null && store.price === lowest.price && !lowest.estimated;
        const hasDiscount = store.regular_price != null && store.regular_price !== store.price;

        let priceHtml;
        if (store.price != null) {
          const discountedStr = `$${this.formatPrice(store.price)} MXN`;
          priceHtml = hasDiscount
            ? `<span class="prices-group"><span class="price-regular-crossed">$${this.formatPrice(store.regular_price)} MXN</span><span class="price-discounted">${discountedStr}</span></span>`
            : discountedStr;
        } else {
          priceHtml = '<span class="no-price-label">Ver precio →</span>';
        }

        const bgColor = store.price != null ? getPriceColor(priceRank++, pricedCount) : null;
        const cardStyle = [
          bgColor ? `background:${bgColor}` : '',
          store.url ? 'cursor:pointer' : ''
        ].filter(Boolean).join(';');

        const cardClass = `store-price-item ${store.url ? 'clickable' : ''}`;
        const dataUrl = store.url ? `data-url="${store.url}"` : '';

        const thumbHtml = store.image
          ? `<img class="store-thumb" src="${store.image}" alt="">`
          : '';

        return `
          <div class="${cardClass}" ${dataUrl} style="${cardStyle}">
            ${thumbHtml}
            <div class="store-info">
              <span class="store-name">${store.store}</span>
              ${isLowest ? '<span class="lowest-badge">Mejor precio</span>' : ''}
              ${hasDiscount ? '<span class="discount-badge">Oferta</span>' : ''}
            </div>
            <div class="store-price-value">
              ${priceHtml}
              ${store.url ? '<span class="store-link" title="Clic para abrir">🔗</span>' : ''}
            </div>
          </div>
        `;
      }).join('');

      // Generar HTML para precios estimados (o sin precio disponible)
      const estimatedStoresHtml = estimatedPrices.map((store) => {
        const hasPrice = store.price != null;
        const priceFormatted = hasPrice
          ? `~$${this.formatPrice(store.price)} MXN`
          : '<span class="no-price-label">Ver precio →</span>';

        return `
          <div class="store-price-item estimated ${store.url ? 'clickable' : ''}" ${store.url ? `data-url="${store.url}"` : ''} style="${store.url ? 'cursor:pointer' : ''}">
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
          ${productImage ? `<img class="product-header-image" src="${productImage}" alt="">` : ''}
          <div class="product-info">
            <h4>${product.name || 'Producto'}</h4>
            ${product.brand ? `<span class="brand">Marca: ${product.brand}</span>` : ''}
            ${product.upc ? `<span class="upc">UPC: ${product.upc}</span>` : ''}
          </div>
        </div>
        ${hasReal ? `
          <div class="stores-list">
            <div class="section-label-row">
              <span class="section-label">Precios en tiempo real</span>
              <span class="price-counts">
                <span class="stores-count">${realPrices.length} precio${realPrices.length !== 1 ? 's' : ''} real${realPrices.length !== 1 ? 'es' : ''}</span>
                ${hasEstimated ? `<span class="estimated-count">${estimatedPrices.length} estimado${estimatedPrices.length !== 1 ? 's' : ''}</span>` : ''}
              </span>
            </div>
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
            <span class="best-price">$${this.formatPrice(lowest.price)} MXN</span>
          </div>
        ` : ''}
      `;
    }

    // Hide broken product header image
    const headerImg = resultEl.querySelector('.product-header-image');
    if (headerImg) headerImg.addEventListener('error', () => { headerImg.style.display = 'none'; });

    // Hide broken store thumbnails
    resultEl.querySelectorAll('.store-thumb').forEach(img => {
      img.addEventListener('error', () => { img.style.display = 'none'; });
    });

    // Open store links via chrome.tabs.create (window.open blocked by CSP in extensions)
    resultEl.addEventListener('click', (e) => {
      const card = e.target.closest('.store-price-item.clickable');
      if (card && card.dataset.url) {
        window.open(card.dataset.url, '_blank');
      }
    });

    // Action buttons row
    const actionsRow = document.createElement('div');
    actionsRow.className = 'result-actions';

    const refreshBtn = document.createElement('button');
    refreshBtn.className = 'refresh-prices-btn';
    refreshBtn.textContent = '🔄 Actualizar';
    refreshBtn.addEventListener('click', async () => {
      refreshBtn.disabled = true;
      refreshBtn.textContent = '⏳ Actualizando...';
      await this.refreshSearch(query, productImage, storeUrls || this.currentStoreUrls);
    });
    actionsRow.appendChild(refreshBtn);

    if (stores.length > 0) {
      const downloadBtn = document.createElement('button');
      downloadBtn.className = 'download-prices-btn';
      downloadBtn.textContent = '⬇️ Excel';
      downloadBtn.addEventListener('click', () => {
        const blob = this._generateExcel(product, stores);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const dateStr = new Date().toISOString().slice(0, 10);
        const name = (product.name || 'precios').replace(/[^a-z0-9]/gi, '_').slice(0, 30);
        a.download = `${name}_${dateStr}.xlsx`;
        a.href = url;
        a.click();
        URL.revokeObjectURL(url);
      });
      actionsRow.appendChild(downloadBtn);
    }

    resultEl.appendChild(actionsRow);
    return resultEl;
  }

  _generateExcel(product, stores) {
    const today = new Date().toLocaleDateString('es-MX', {
      day: '2-digit', month: '2-digit', year: 'numeric',
    });
    const upc = product.upc || '';
    const item = product.name || '';

    const rows = [
      ['Fecha', 'Retailer', 'UPC', 'Item', 'Precio S/D', 'Precio C/D', 'URL', 'URL Imagen'],
    ];

    for (const store of stores) {
      const hasDiscount = store.regular_price != null && store.regular_price !== store.price;
      const precioSD = hasDiscount ? store.regular_price : (store.price ?? '');
      const precioCD = hasDiscount ? store.price : '';
      rows.push([
        today,
        store.store || '',
        upc,
        item,
        precioSD,
        precioCD,
        store.url || '',
        store.image || '',
      ]);
    }

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [
      { wch: 12 }, { wch: 20 }, { wch: 16 }, { wch: 40 },
      { wch: 12 }, { wch: 12 }, { wch: 60 }, { wch: 60 },
    ];
    XLSX.utils.book_append_sheet(wb, ws, 'Precios');

    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    return new Blob([wbout], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
  }

  async refreshSearch(query, image = null, storeUrls = {}) {
    await dataBunkerAPI.clearCache();
    this.addMessage('bot', '🗑️ Cache limpiado. ¿En qué tiendas buscamos ahora?');
    this.pendingSearchQuery = query;
    this.pendingImage = image;
    this.pendingStoreUrls = storeUrls;
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
    const availableStores = await dataBunkerAPI.getAvailableStores();
    const savedStoreIds = await dataBunkerAPI.getSelectedStores();
    const availableIds = new Set(availableStores.map(s => s.id));
    this.selectedStores = savedStoreIds.filter(id => availableIds.has(id));

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
      <button class="search-web-btn">
        🌐 Buscar en toda la web
      </button>
    `;

    messagesContainer.appendChild(selectorEl);
    this.scrollToBottom();

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

    // Whole web search button
    const webBtn = selectorEl.querySelector('.search-web-btn');
    webBtn.addEventListener('click', async () => {
      selectorEl.querySelectorAll('button').forEach(b => b.disabled = true);
      selectorEl.style.opacity = '0.7';
      this.pendingWholeWeb = true;

      if (this.multiSearchPending) {
        const items = this.multiSearchPending.map(item => ({ ...item, wholeWeb: true }));
        this.multiSearchPending = null;
        this.addMessage('bot', `🌐 Buscando ${items.length} producto${items.length !== 1 ? 's' : ''} en toda la web...`);
        await this.runMultiSearchBatch(items);
      } else {
        this.addMessage('bot', '🌐 Buscando en toda la web...');
        await this.processPriceCheck(this.pendingSearchQuery);
      }
    });
  }

  async confirmStoreSelectorInChat() {
    if (this.selectedStores.length === 0) {
      this.addMessage('bot', 'Por favor selecciona al menos una tienda.', true);
      return;
    }

    await dataBunkerAPI.saveSelectedStores(this.selectedStores);

    const availableStores = await dataBunkerAPI.getAvailableStores();
    const selectedNames = this.selectedStores
      .map(id => availableStores.find(s => s.id === id)?.name)
      .filter(Boolean)
      .join(', ');

    this.addMessage('bot', `🏪 Buscando en: ${selectedNames}`);

    if (this.multiSearchPending) {
      const items = this.multiSearchPending;
      this.multiSearchPending = null;
      await this.runMultiSearchBatch(items);
    } else {
      await this.processPriceCheckProgressive(this.pendingSearchQuery);
    }
  }

  scrollToBottom() {
    const chatContainer = document.querySelector('.chat-container');
    if (chatContainer) chatContainer.scrollTop = chatContainer.scrollHeight;
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
