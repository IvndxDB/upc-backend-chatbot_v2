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
  },
  {
    id: 'lacomer',
    name: 'La Comer',
    domain: 'lacomer.com.mx',
    url: 'https://www.lacomer.com.mx/',
    logo: '🛒',
    color: '#E31837'
  },
  {
    id: 'yza',
    name: 'Yza',
    domain: 'yza.mx',
    url: 'https://www.yza.mx/',
    logo: '💊',
    color: '#00529B'
  },
  {
    id: 'heb',
    name: 'HEB',
    domain: 'heb.com.mx',
    url: 'https://www.heb.com.mx/',
    logo: '🏪',
    color: '#C8102E'
  },
  {
    id: 'liverpool',
    name: 'Liverpool',
    domain: 'liverpool.com.mx',
    url: 'https://www.liverpool.com.mx/',
    logo: '🛍️',
    color: '#E31E24'
  },
  {
    id: 'sanborns',
    name: 'Sanborns',
    domain: 'sanborns.com.mx',
    url: 'https://www.sanborns.com.mx/',
    logo: '🏬',
    color: '#F15A22'
  },
  {
    id: 'sephora',
    name: 'Sephora',
    domain: 'sephora.com.mx',
    url: 'https://www.sephora.com.mx/',
    logo: '💄',
    color: '#000000'
  },
  {
    id: 'dermaexpress',
    name: 'Derma Express',
    domain: 'dermaexpress.com.mx',
    url: 'https://www.dermaexpress.com.mx/',
    logo: '🧴',
    color: '#E91E8C'
  },
  {
    id: 'prixz',
    name: 'Prixz',
    domain: 'prixz.com',
    url: 'https://www.prixz.com/',
    logo: '💊',
    color: '#FF6B35'
  },
  {
    id: 'farmaciaalicia',
    name: 'Farmacia Alicia',
    domain: 'farmaciaalicia.com.mx',
    url: 'https://www.farmaciaalicia.com.mx/',
    logo: '💊',
    color: '#E31E24'
  },
  {
    id: 'mercadolibre',
    name: 'Mercado Libre',
    domain: 'mercadolibre.com.mx',
    url: 'https://www.mercadolibre.com.mx/',
    logo: '🛒',
    color: '#FFE600'
  },
  {
    id: 'fesa',
    name: 'Farmacias Esp.',
    domain: 'farmaciasespecializadas.com',
    url: 'https://www.farmaciasespecializadas.com/',
    logo: '💊',
    color: '#2E86AB'
  },
  {
    id: 'farmaciacoyoacan',
    name: 'Fcia. Coyoacán',
    domain: 'farmaciacoyoacan.com',
    url: 'https://farmaciacoyoacan.com/',
    logo: '💊',
    color: '#4CAF50'
  },
  {
    id: 'curitek',
    name: 'Curitek',
    domain: 'curitek.com',
    url: 'https://curitek.com/',
    logo: '💊',
    color: '#1A6B8A'
  },
  {
    id: 'probemedic',
    name: 'Probemedic',
    domain: 'probemedic.mx',
    url: 'https://www.probemedic.mx/',
    logo: '💊',
    color: '#2E7D32'
  },
  {
    id: 'wecare',
    name: 'WeCare',
    domain: 'wecarepharma.mx',
    url: 'https://wecarepharma.mx/',
    logo: '💊',
    color: '#00897B'
  },
  {
    id: 'farmaleal',
    name: 'Farma Leal',
    domain: 'farmaleal.com.mx',
    url: 'https://www.farmaleal.com.mx/',
    logo: '💊',
    color: '#5C6BC0'
  },
  {
    id: 'farmasmart',
    name: 'FarmaSmart',
    domain: 'farmasmart.com',
    url: 'https://farmasmart.com/',
    logo: '💊',
    color: '#43A047'
  },
  {
    id: 'vidafarmacias',
    name: 'Vida Farmacias',
    domain: 'vidafarmacias.com',
    url: 'https://vidafarmacias.com/',
    logo: '💊',
    color: '#00ACC1'
  }
];

// Store index map (fixed — position in AVAILABLE_STORES = index stored in Supabase)
// 0:amazon  1:walmart  2:soriana  3:chedraui  4:fahorro  5:farmaciasanpablo
// 6:benavides  7:farmaciasguadalajara  8:lacomer  9:yza  10:heb  11:liverpool
// 12:sanborns  13:sephora  14:dermaexpress  15:prixz  16:farmaciaalicia
// 17:mercadolibre  18:fesa  19:farmaciacoyoacan  20:curitek  21:probemedic
// 22:wecare  23:farmaleal  24:farmasmart  25:vidafarmacias

// --- Dictionary (single unified file) ---

let _dictCache = null;

function _normStr(str) {
  return str.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function _getUserDictionaries() {
  if (_dictCache) return _dictCache;
  try {
    const url = chrome.runtime.getURL('diccionario_unificado.json');
    const res = await fetch(url);
    if (!res.ok) { console.error('Dictionary fetch failed:', res.status, url); _dictCache = []; return []; }
    const buffer = await res.arrayBuffer();
    const text = new TextDecoder('utf-8').decode(buffer);
    _dictCache = JSON.parse(text);
    console.log('Dictionary "unificado" loaded:', _dictCache.length, 'items');
  } catch (e) {
    console.error('Failed to load dictionary:', e);
    _dictCache = [];
  }
  return _dictCache;
}
async function dictionaryLookupByUPC(upc) {
  const items = await _getUserDictionaries();
  const matches = items.filter(item => item.UPC === upc);
  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0];
  // Merge entries from multiple dictionaries: combine all URLs
  const merged = { ...matches[0] };
  merged.urls = [...new Set(matches.flatMap(m => m.urls || []))];
  return merged;
}

async function fuzzySearch(query, maxResults = 15) {
  const items = await _getUserDictionaries();
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
      const fuzzy   = matchCount / queryWords.length;
      const urlBoost = Math.log1p(item.urls?.length || 0) * 0.2;
      scored.push({ ...item, _score: fuzzy + urlBoost });
    }
  }

  // Sort: combined (fuzzy + url count boost) descending
  scored.sort((a, b) => b._score - a._score || a.Item.length - b.Item.length);
  return scored.slice(0, maxResults);
}

// ----------------------------------------

/**
 * Build a {domain: url} map from a dictionary entry's urls array.
 * Matches each URL's hostname against known store domains.
 */
// URL patterns that indicate a search/listing page rather than a product page
const SEARCH_URL_PATTERNS = [
  '/catalogsearch/', '/search?', '/buscar?', '/result/index/',
  '/s?', '/?q=', '/query/', '/find?', 'search_query=', '/keyword/'
];

function isSearchUrl(url) {
  return SEARCH_URL_PATTERNS.some(p => url.includes(p));
}

function buildStoreUrlsFromEntry(entry) {
  const storeUrls = {};
  if (!entry || !Array.isArray(entry.urls)) return storeUrls;
  const allDomains = AVAILABLE_STORES.map(s => s.domain);
  for (const url of entry.urls) {
    try {
      const hostname = new URL(url).hostname.replace('www.', '').toLowerCase();
      const domain = allDomains.find(d => hostname === d || hostname.endsWith('.' + d));
      if (!domain) continue;
      // Prefer direct product pages over search/listing pages
      if (!storeUrls[domain] || isSearchUrl(storeUrls[domain])) {
        storeUrls[domain] = url;
      }
    } catch (e) { /* skip invalid URLs */ }
  }
  return storeUrls;
}

// ----------------------------------------

class DataBunkerAPI {
  constructor() {
    this.backendUrl = DEFAULT_BACKEND_URL;
    this._allowedStoresCache = undefined; // undefined=not fetched, []=no access, [...]=stores
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

  async _authHeaders() {
    const headers = { 'Content-Type': 'application/json' };
    try {
      const session = await cognitoService.getSession();
      if (session?.idToken) headers['Authorization'] = `Bearer ${session.idToken}`;
    } catch (_) {}
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
   * Get stores available to the current user.
   * Reads allowed_stores (int[]) from the /api/usage response and maps
   * each index to the corresponding entry in AVAILABLE_STORES.
   * Returns [] when no stores are assigned in Supabase.
   */
  async getAvailableStores() {
    if (this._allowedStoresCache !== undefined) return this._allowedStoresCache;
    const usage = await this.getUsage();
    const indices = usage?.allowed_stores;
    if (!indices || !Array.isArray(indices) || indices.length === 0) {
      this._allowedStoresCache = [];
    } else {
      this._allowedStoresCache = indices
        .filter(i => Number.isInteger(i) && i >= 0 && i < AVAILABLE_STORES.length)
        .map(i => AVAILABLE_STORES[i]);
    }
    console.log('👤 Allowed stores:', this._allowedStoresCache.map(s => s.id));
    return this._allowedStoresCache;
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

  async getUsage() {
    try {
      const res = await fetch(`${this.backendUrl}/api/usage`, {
        headers: await this._authHeaders(),
      });
      if (!res.ok) return null;
      const data = await res.json(); // {count, limit, remaining, allowed_stores}
      // Populate store cache on first successful fetch
      if (this._allowedStoresCache === undefined && data?.allowed_stores !== undefined) {
        const indices = data.allowed_stores;
        if (!indices || !Array.isArray(indices) || indices.length === 0) {
          this._allowedStoresCache = [];
        } else {
          this._allowedStoresCache = indices
            .filter(i => Number.isInteger(i) && i >= 0 && i < AVAILABLE_STORES.length)
            .map(i => AVAILABLE_STORES[i]);
        }
      }
      return data;
    } catch (e) {
      return null;
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
      forceRefresh = false,
      selectedStores = null,
      productImage = null,
      storeUrls = {},       // {domain: url} from local dictionary for Zyte
      wholeWeb = false,     // true = no domain filter, search all of Google Shopping
      skipUsage = false,    // true = skip usage increment (per-store calls after first)
      noCache = false       // true = skip cache read AND write (per-store progressive calls)
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

      // Whole web mode: no domain filter, no Zyte URLs
      if (wholeWeb) {
        onStatus('Consultando precios en toda la web...');
        console.log('🌐 Whole web search — no domain filter');

        const response = await fetch(`${this.backendUrl}/api/check_price`, {
          method: 'POST',
          headers: await this._authHeaders(),
          body: JSON.stringify({
            query,
            upc,
            search_type: 'shopping',
            domains: null,
            store_urls: {}
          })
        });

        if (response.status === 401) throw new Error('Sesión expirada. Por favor cierra sesión y vuelve a iniciarla.');
        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Error del servidor: ${response.status} - ${errorText}`);
        }

        const data = await response.json();
        const result = this._transformResponse(data, query, upc, productImage);
        onComplete(result);
        return;
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

      // Check cache first (skip if forceRefresh or noCache)
      if (!forceRefresh && !noCache) {
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
          domains: domains.length > 0 ? domains : null,
          store_urls: storeUrls,
          skip_usage: skipUsage
        })
      });

      if (response.status === 401) {
        throw new Error('Sesión expirada. Por favor cierra sesión y vuelve a iniciarla.');
      }
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Error del servidor: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      const result = this._transformResponse(data, query, upc, productImage);

      // Save to cache (skip for per-store calls to avoid partial results polluting cache)
      if (!noCache) {
        await this.setCachedResults(query, upc, result);
      }

      // Call onComplete with transformed result
      onComplete(result);

    } catch (error) {
      console.error('Error in streamPriceCheck:', error);
      onError(error.message || 'Error desconocido');
    }
  }

  _transformResponse(data, query, upc, productImage) {
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

    if (data.offers && Array.isArray(data.offers)) {
      result.stores = data.offers.map(offer => ({
        store: offer.seller || offer.store || 'Tienda desconocida',
        price: offer.price != null ? offer.price : null,
        regular_price: offer.regular_price != null ? offer.regular_price : null,
        url: offer.link || offer.url || '',
        image: offer.image || offer.thumb || productImage || null,
        source_api: offer.source || 'oxylabs',
        estimated: offer.estimated || false
      }));

      result.count = result.stores.length;

      const priced = result.stores.filter(s => s.price != null && !s.estimated);
      if (priced.length > 0) {
        result.lowest = priced.reduce((min, store) =>
          store.price < min.price ? store : min
        );
      }
    }

    return result;
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
