/**
 * DataBunker Price Checker - API Client
 * Handles all communication with the backend
 */

// Backend deployado en Railway
const DEFAULT_BACKEND_URL = 'https://upc-backend-chatbotv2-production.up.railway.app';

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
      forceRefresh = false // NEW: option to bypass cache
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
      const query = input || scrapedData?.productName || scrapedData?.name || '';
      const upc = scrapedData?.upc || '';

      if (!query && !upc) {
        throw new Error('Se requiere nombre de producto o UPC');
      }

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

      onStatus('Consultando precios en tiempo real...');

      // Call the backend
      const response = await fetch(`${this.backendUrl}/api/check_price`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          query,
          upc,
          search_type: sources.oxylabs ? 'shopping' : 'organic'
        })
      });

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
          price: offer.price || 0,
          url: offer.link || offer.url || '',
          source_api: offer.source || 'oxylabs',
          estimated: false
        }));

        result.count = result.stores.length;

        // Find lowest price
        if (result.stores.length > 0) {
          result.lowest = result.stores.reduce((min, store) =>
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
      const response = await fetch(`${this.backendUrl}/api/health`);
      return response.ok;
    } catch (error) {
      return false;
    }
  }
}

// Create global instance
const dataBunkerAPI = new DataBunkerAPI();
