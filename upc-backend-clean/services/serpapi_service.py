"""
SerpAPI Service — fallback search for stores Oxylabs missed
Uses Google Search via SerpAPI to find prices for empty domains.
"""
import requests
from concurrent.futures import ThreadPoolExecutor, as_completed
from logger_config import setup_logger
from config import Config

logger = setup_logger(__name__)

DOMAIN_TO_STORE_NAME = {
    'walmart.com.mx':               'walmart',
    'amazon.com.mx':                'amazon',
    'fahorro.com':                  'fahorro',
    'farmaciasanpablo.com.mx':      'san pablo farmacia',
    'benavides.com.mx':             'benavides farmacia',
    'farmaciasguadalajara.com.mx':  'farmacias guadalajara',
    'chedraui.com.mx':              'chedraui',
    'soriana.com.mx':               'soriana',
    'heb.com.mx':                   'heb',
    'costco.com.mx':                'costco',
    'liverpool.com.mx':             'liverpool',
    'mercadolibre.com.mx':          'mercado libre',
    'bodegaaurrera.com.mx':         'bodega aurrera',
    'samsclub.com.mx':              'sams club',
    'coppel.com':                   'coppel',
    'elektra.com.mx':               'elektra',
    'sanborns.com.mx':              'sanborns',
}


class SerpAPIService:
    """Fallback price search via SerpAPI Google Search"""

    def __init__(self):
        self.api_key = Config.SERPAPI_KEY
        self.api_url = 'https://serpapi.com/search.json'
        self.timeout = 30

    def is_configured(self):
        return bool(self.api_key)

    def search_missing_stores(self, upc, description, domains):
        """
        Search given domains in parallel using SerpAPI.

        Args:
            upc: Product UPC/barcode (str or None)
            description: Product description (str or None)
            domains: List of domain strings that had no Oxylabs results

        Returns:
            list: Combined results from all domains
        """
        if not self.is_configured():
            logger.warning("⚠️ SerpAPI not configured, skipping fallback")
            return []

        all_results = []

        with ThreadPoolExecutor(max_workers=4) as executor:
            future_to_domain = {
                executor.submit(self._search_for_store, upc, description, domain): domain
                for domain in domains
            }

            for future in as_completed(future_to_domain):
                domain = future_to_domain[future]
                try:
                    store_results = future.result()
                    if store_results:
                        all_results.extend(store_results)
                        logger.info(f"✅ SerpAPI {domain}: {len(store_results)} result(s)")
                    else:
                        logger.info(f"⚠️ SerpAPI {domain}: no results")
                except Exception as e:
                    logger.warning(f"⚠️ SerpAPI {domain}: failed — {e}")

        logger.info(f"✅ SerpAPI fallback total: {len(all_results)} results from {len(domains)} stores")
        return all_results

    def _search_for_store(self, upc, description, domain):
        """Search one store: UPC first, then description fallback"""
        store_name = DOMAIN_TO_STORE_NAME.get(domain, domain.split('.')[0])

        if upc:
            results = self._single_search(f"{upc} {store_name}", domain)
            if results:
                return results
            logger.info(f"ℹ️ SerpAPI UPC gave no results for {domain}, trying description")

        if description:
            return self._single_search(f"{description} {store_name}", domain)

        return []

    def _single_search(self, query, domain):
        """Execute one SerpAPI request and return matching results"""
        logger.info(f"🔍 SerpAPI searching: {query!r}")

        params = {
            'engine': 'google',
            'q': f"{query} site:{domain}",
            'gl': 'mx',
            'hl': 'es',
            'num': 5,
            'api_key': self.api_key,
        }

        try:
            response = requests.get(self.api_url, params=params, timeout=self.timeout)

            if response.status_code != 200:
                logger.error(f"❌ SerpAPI HTTP {response.status_code}: {response.text[:120]}")
                return []

            data = response.json()
            organic = data.get('organic_results', [])

            # Filter to target domain only
            on_domain = [r for r in organic if domain in r.get('link', '')]
            if on_domain:
                return [self._normalize_result(r, domain) for r in on_domain[:2]]

            # Accept any .mx or known Mexican retailer as fallback
            top = next(
                (r for r in organic
                 if '.mx' in r.get('link', '').lower()
                 or any(d in r.get('link', '').lower() for d in DOMAIN_TO_STORE_NAME)),
                None
            )
            if top:
                return [self._normalize_result(top, domain)]

            return []

        except requests.Timeout:
            logger.error(f"⏱️ SerpAPI timeout for {domain}")
            return []
        except Exception as e:
            logger.error(f"❌ SerpAPI error for {domain}: {e}")
            return []

    @staticmethod
    def _normalize_result(item, domain):
        """Map SerpAPI organic result to the same shape as Oxylabs results"""
        return {
            'url': item.get('link', ''),
            'title': item.get('title', ''),
            'price': item.get('price', ''),
            'description': item.get('snippet', ''),
            'thumb': item.get('thumbnail', '') or '',
            '_source': 'serpapi',
            '_domain': domain,
        }
