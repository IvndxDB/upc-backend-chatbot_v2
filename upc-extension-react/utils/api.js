/**
 * DataBunker Price Checker - API Client
 * Handles all communication with the backend
 */

// Backend deployado en ECS (AWS)
const DEFAULT_BACKEND_URL = 'https://ad-31f94a5c9e704a6aa20e418f24a02b92.ecs.us-east-1.on.aws';

// Available stores for price checking
const AVAILABLE_STORES = [
  {
    id: 'amazon',
    name: 'Amazon',
    domain: 'amazon.com.mx',
    url: 'https://www.amazon.com.mx/',
    logo: '🛒',
    color: '#FF9900'
  },
  {
    id: 'walmart',
    name: 'Walmart',
    domain: 'walmart.com.mx',
    url: 'https://www.walmart.com.mx/',
    logo: '🏪',
    color: '#0071CE'
  },
  {
    id: 'soriana',
    name: 'Soriana',
    domain: 'soriana.com',
    url: 'https://www.soriana.com/',
    logo: '🏬',
    color: '#E31E24'
  },
  {
    id: 'chedraui',
    name: 'Chedraui',
    domain: 'chedraui.com.mx',
    url: 'https://www.chedraui.com.mx/',
    logo: '🛍️',
    color: '#ED1C24'
  },
  {
    id: 'lacomer',
    name: 'La Comer',
    domain: 'lacomer.com.mx',
    url: 'https://www.lacomer.com.mx/',
    logo: '🏪',
    color: '#00A859'
  },
  {
    id: 'fahorro',
    name: 'Fahorro',
    domain: 'fahorro.com',
    url: 'https://www.fahorro.com/',
    logo: '💊',
    color: '#0066CC'
  },
  {
    id: 'farmaciasanpablo',
    name: 'San Pablo',
    domain: 'farmaciasanpablo.com.mx',
    url: 'https://www.farmaciasanpablo.com.mx/',
    logo: '💊',
    color: '#E31E24'
  },
  {
    id: 'benavides',
    name: 'Benavides',
    domain: 'benavides.com.mx',
    url: 'https://www.benavides.com.mx/',
    logo: '💊',
    color: '#007DC5'
  },
  {
    id: 'farmaciasguadalajara',
    name: 'Gdl Farmacias',
    domain: 'farmaciasguadalajara.com',
    url: 'https://www.farmaciasguadalajara.com/',
    logo: '💊',
    color: '#C8102E'
  }
];

// --- Fuzzy Search (local dictionary) ---

let _dictionary = null;

function _normStr(str) {
  return str.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // remove accents
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function _loadDictionary() {
  if (_dictionary) return _dictionary;
  try {
    const url = chrome.runtime.getURL('diccionario_ext.json');
    const res = await fetch(url);
    if (!res.ok) {
      console.error('Dictionary fetch failed:', res.status, url);
      return [];
    }
    _dictionary = await res.json();
    console.log('📖 Dictionary loaded:', _dictionary.length, 'items');
    return _dictionary;
  } catch (e) {
    console.error('Failed to load dictionary:', e);
    return [];
  }
}

async function dictionaryLookupByUPC(upc) {
  const items = await _loadDictionary();
  return items.find(item => item.UPC === upc) || null;
}

async function fuzzySearch(query, maxResults = 5) {
  const items = await _loadDictionary();
  const normQuery = _normStr(query);
  const queryWords = normQuery.split(' ').filter(w => w.length > 2);
  if (queryWords.length === 0) return [];

  const scored = [];
  for (const item of items) {
    const normItem = _normStr(item.Item);
    let matchCount = 0;
    for (const word of queryWords) {
      if (normItem.includes(word)) matchCount++;
    }
    if (matchCount > 0) {
      scored.push({ ...item, _score: matchCount / queryWords.length });
    }
  }

  // Sort: highest score first, then shorter name (more specific)
  scored.sort((a, b) => b._score - a._score || a.Item.length - b.Item.length);
  return scored.slice(0, maxResults);
}

// ----------------------------------------

class DataBunkerAPI {
  constructor() {
    this.backendUrl = DEFAULT_BACKEND_URL;
    this.loadSettings();
  }

  async loadSettings() {
    try {
      const result = await chrome.storage.local.get(['backendUrl']);
      if (result.backendUrl) {
        this.backendUrl = result.backendUrl;
      }
    } catch (error) {
      console.log('Using default backend URL');
    }
  }

  // --- API Key Management ---

  async getApiKey() {
    try {
      const data = await chrome.storage.local.get(['apiKey']);
      return data.apiKey || null;
    } catch (e) {
      return null;
    }
  }

  async saveApiKey(key) {
    await chrome.storage.local.set({ apiKey: key });
  }

  async clearApiKey() {
    await chrome.storage.local.remove(['apiKey']);
  }

  async validateApiKey(key) {
    try {
      const response = await fetch(`${this.backendUrl}/api/validate-key`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key })
      });
      if (!response.ok) return false;
      const data = await response.json();
      return data.valid === true;
    } catch (e) {
      return false;
    }
  }

  async _authHeaders() {
    const key = await this.getApiKey();
    const headers = { 'Content-Type': 'application/json' };
    if (key) headers['X-API-Key'] = key;
    return headers;
  }

  async saveSettings(settings) {
    await chrome.storage.local.set(settings);
    if (settings.backendUrl) {
      this.backendUrl = settings.backendUrl;
    }
  }

  async getSettings() {
    const defaults = {
      backendUrl: DEFAULT_BACKEND_URL,
      useGemini: true,
      useOxylabs: true,
      usePerplexity: true
    };

    try {
      const result = await chrome.storage.local.get(Object.keys(defaults));
      return { ...defaults, ...result };
    } catch (error) {
      return defaults;
    }
  }

  /**
   * Get available stores for selection
   */
  getAvailableStores() {
    return AVAILABLE_STORES;
  }

  /**
   * Get selected stores from storage
   */
  async getSelectedStores() {
    try {
      const result = await chrome.storage.local.get(['selectedStores']);
      // Default: all stores selected
      if (!result.selectedStores || result.selectedStores.length === 0) {
        return AVAILABLE_STORES.map(s => s.id);
      }
      return result.selectedStores;
    } catch (error) {
      return AVAILABLE_STORES.map(s => s.id);
    }
  }

  /**
   * Save selected stores to storage
   */
  async saveSelectedStores(storeIds) {
    try {
      await chrome.storage.local.set({ selectedStores: storeIds });
      console.log('💾 Saved selected stores:', storeIds);
    } catch (error) {
      console.error('Error saving selected stores:', error);
    }
  }

  /**
   * Search for products by name in S3 database
   */
  async searchProducts(query) {
    const response = await fetch(`${this.backendUrl}/api/search-products`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ query })
    });

    if (!response.ok) {
      throw new Error(`Error searching products: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Get UPC from product name using S3 database
   */
  async getUPCFromName(productName) {
    const response = await fetch(`${this.backendUrl}/api/get-upc`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ productName })
    });

    if (!response.ok) {
      throw new Error(`Error getting UPC: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Get real-time prices using Oxylabs (v4)
   */
  async getRealTimePrices(productInfo, sources = { gemini: true, oxylabs: true, perplexity: true }) {
    // Nueva integración con endpoint check_price de Vercel
    const response = await fetch(`${this.backendUrl}/api/check_price`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        query: productInfo.name || productInfo.title || productInfo.query,
        upc: productInfo.upc || productInfo.barcode || '',
        search_type: sources.oxylabs ? 'shopping' : 'organic'
      })
    });

    if (!response.ok) {
      throw new Error(`Error getting prices: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Process a complete price check request
   * This uses Strands to orchestrate the full flow:
   * 1. Identify product
   * 2. Get UPC if needed
   * 3. Search prices from all sources
   * 4. Combine and return structured response
   */
  async processPriceCheck(input, options = {}) {
    const {
      scrapedData = null,
      screenshot = null,
      sources = { gemini: true, oxylabs: true, perplexity: true }
    } = options;

    const response = await fetch(`${this.backendUrl}/api/price-check`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        input,
        scrapedData,
        screenshot,
        sources
      })
    });

    if (!response.ok) {
      throw new Error(`Error processing price check: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Get cache key for a query
   */
  _getCacheKey(query, upc) {
    return `price_cache_${query || ''}_${upc || ''}`.toLowerCase().replace(/\s+/g, '_');
  }

  /**
   * Check if cache is valid (less than 12 hours old)
   */
  _isCacheValid(cacheData) {
    if (!cacheData || !cacheData.timestamp) return false;
    const TWELVE_HOURS = 12 * 60 * 60 * 1000; // 12 hours in ms
    const now = Date.now();
    return (now - cacheData.timestamp) < TWELVE_HOURS;
  }

  /**
   * Get cached results if valid
   */
  async getCachedResults(query, upc) {
    try {
      const cacheKey = this._getCacheKey(query, upc);
      const result = await chrome.storage.local.get([cacheKey]);
      const cacheData = result[cacheKey];

      if (this._isCacheValid(cacheData)) {
        console.log('✅ Using cached results (age:', Math.round((Date.now() - cacheData.timestamp) / 1000 / 60), 'minutes)');
        return cacheData.result;
      }

      console.log('⚠️ Cache expired or not found');
      return null;
    } catch (error) {
      console.error('Error reading cache:', error);
      return null;
    }
  }

  /**
   * Save results to cache
   */
  async setCachedResults(query, upc, result) {
    try {
      const cacheKey = this._getCacheKey(query, upc);
      const cacheData = {
        timestamp: Date.now(),
        result: result,
        query: query,
        upc: upc
      };

      await chrome.storage.local.set({ [cacheKey]: cacheData });
      console.log('💾 Results cached for 12 hours');
    } catch (error) {
      console.error('Error saving cache:', error);
    }
  }

  /**
   * Clear all cached results
   */
  async clearCache() {
    try {
      const allData = await chrome.storage.local.get(null);
      const cacheKeys = Object.keys(allData).filter(key => key.startsWith('price_cache_'));

      if (cacheKeys.length > 0) {
        await chrome.storage.local.remove(cacheKeys);
        console.log('🗑️ Cleared', cacheKeys.length, 'cached results');
      }
    } catch (error) {
      console.error('Error clearing cache:', error);
    }
  }

  /**
   * Stream price check with real-time updates
   * Adapted for v4 backend using /api/check_price
   * Now with 12-hour caching
   */
  async streamPriceCheck(input, options = {}, callbacks = {}) {
    const {
      scrapedData = null,
      screenshot = null,
      sources = { gemini: true, oxylabs: true, perplexity: true },
      forceRefresh = false, // option to bypass cache
      selectedStores = null // NEW: optional list of selected store IDs
    } = options;

    const {
      onStatus = () => {},
      onProduct = () => {},
      onPrice = () => {},
      onComplete = () => {},
      onError = () => {}
    } = callbacks;

    try {
      // Build query from input and scraped data
      const rawInput = input || scrapedData?.productName || scrapedData?.name || '';

      // Detect if input is a barcode: 8-14 digits (EAN-8, UPC-A, EAN-13, ITF-14)
      const isBarcode = /^\d{8,14}$/.test(rawInput.trim());

      const query = isBarcode ? '' : rawInput;
      const upc = isBarcode ? rawInput.trim() : (scrapedData?.upc || '');

      if (isBarcode) {
        console.log('🔢 Detected barcode input:', upc);
      }

      if (!query && !upc) {
        throw new Error('Se requiere nombre de producto o UPC');
      }

      // Get selected stores (from parameter or storage)
      let storeIds = selectedStores;
      if (!storeIds) {
        storeIds = await this.getSelectedStores();
      }

      // Convert store IDs to domains
      const domains = storeIds.map(id => {
        const store = AVAILABLE_STORES.find(s => s.id === id);
        return store ? store.domain : null;
      }).filter(d => d !== null);

      console.log('🏪 Searching in stores:', storeIds);
      console.log('🌐 Domains:', domains);

      // Check cache first (unless forceRefresh is true)
      if (!forceRefresh) {
        onStatus('Buscando en cache...');
        const cachedResult = await this.getCachedResults(query, upc);

        if (cachedResult) {
          onStatus('Usando resultados guardados ✅');
          setTimeout(() => onComplete(cachedResult), 100); // Small delay for UX
          return;
        }
      }

      // Status: Starting search
      onStatus(forceRefresh ? 'Actualizando precios...' : 'Buscando producto...');

      const storesText = storeIds.length === AVAILABLE_STORES.length
        ? 'todas las tiendas'
        : `${storeIds.length} tiendas`;
      onStatus(`Consultando precios en ${storesText}...`);

      // Call the backend
      const response = await fetch(`${this.backendUrl}/api/check_price`, {
        method: 'POST',
        headers: await this._authHeaders(),
        body: JSON.stringify({
          query,
          upc,
          search_type: sources.oxylabs ? 'shopping' : 'organic',
          domains: domains.length > 0 ? domains : null
        })
      });

      if (response.status === 401) {
        throw new Error('Clave de acceso inválida. Por favor recarga la extensión e ingresa tu clave.');
      }
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Error del servidor: ${response.status} - ${errorText}`);
      }

      const data = await response.json();

      // Transform the response to match expected format
      const result = {
        product: {
          name: query,
          upc: upc || data.upc || null,
          brand: data.brand || null
        },
        stores: [],
        lowest: null,
        count: 0
      };

      // Parse offers into stores format
      if (data.offers && Array.isArray(data.offers)) {
        result.stores = data.offers.map(offer => ({
          store: offer.seller || offer.store || 'Tienda desconocida',
          price: offer.price != null ? offer.price : null,
          url: offer.link || offer.url || '',
          image: offer.image || offer.thumb || null,
          source_api: offer.source || 'oxylabs',
          estimated: offer.estimated || false
        }));

        result.count = result.stores.length;

        // Find lowest price (only among stores with a real price)
        const priced = result.stores.filter(s => s.price != null && !s.estimated);
        if (priced.length > 0) {
          result.lowest = priced.reduce((min, store) =>
            store.price < min.price ? store : min
          );
        }
      }

      // Save to cache
      await this.setCachedResults(query, upc, result);

      // Call onComplete with transformed result
      onComplete(result);

    } catch (error) {
      console.error('Error in streamPriceCheck:', error);
      onError(error.message || 'Error desconocido');
    }
  }

  /**
   * Analyze an image (screenshot) to extract product information
   */
  async analyzeImage(imageBase64) {
    const response = await fetch(`${this.backendUrl}/api/analyze-image`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ image: imageBase64 })
    });

    if (!response.ok) {
      throw new Error(`Error analyzing image: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Check backend health
   */
  async healthCheck() {
    try {
      const response = await fetch(`${this.backendUrl}/health`);
      return response.ok;
    } catch (error) {
      return false;
    }
  }
}

// Create global instance
const dataBunkerAPI = new DataBunkerAPI();
