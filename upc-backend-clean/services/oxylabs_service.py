"""
Oxylabs Service
Per-retailer parallel searches.
Strategy: UPC + store first (exact), fallback to description + store if no results.
"""
import re
import requests
from concurrent.futures import ThreadPoolExecutor, as_completed
from logger_config import setup_logger
from config import Config

logger = setup_logger(__name__)

# Map domain → search term appended to query
DOMAIN_TO_STORE_NAME = {
    'walmart.com.mx':               'walmart',
    'amazon.com.mx':                'amazon',
    'fahorro.com':                  'fahorro',
    'farmaciasanpablo.com.mx':      'san pablo farmacia',
    'benavides.com.mx':             'benavides farmacia',
    'farmaciasguadalajara.com.mx':  'farmacias guadalajara',
    'chedraui.com.mx':              'chedraui',
    'soriana.com.mx':               'soriana',
    'lacomer.com.mx':               'la comer',
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


class OxylabsService:
    """Service for Oxylabs Google Search API — per-retailer searches"""

    def __init__(self):
        self.username = Config.OXYLABS_USERNAME
        self.password = Config.OXYLABS_PASSWORD
        self.timeout = Config.OXYLABS_TIMEOUT
        self.api_url = 'https://realtime.oxylabs.io/v1/queries'

    def is_configured(self):
        return bool(self.username and self.password)

    # ------------------------------------------------------------------
    # Public entry point
    # ------------------------------------------------------------------

    def search_shopping(self, query, domains=None):
        """
        Extracts UPC and description from query, then searches per retailer.

        Args:
            query: Product name, UPC, or both
            domains: Selected store domains e.g. ['walmart.com.mx', 'fahorro.com']

        Returns:
            dict: {'results': [...]}
        """
        if not self.is_configured():
            logger.error("❌ Oxylabs credentials not configured")
            return {'error': 'Oxylabs not configured', 'results': []}

        upc, description = self._extract_upc_and_description(query)
        logger.info(f"🔍 Query: {query!r} → upc={upc!r}, description={description!r}")

        if domains and len(domains) > 0:
            results = self._search_per_retailer(upc, description, domains)
        else:
            results = self._search_broad(upc or description)

        return {'results': results}

    # ------------------------------------------------------------------
    # Query parsing
    # ------------------------------------------------------------------

    def _extract_upc_and_description(self, query):
        """
        Separate UPC digits from text description.

        Returns:
            (upc: str|None, description: str|None)
        """
        upc_match = re.search(r'\b(\d{8,14})\b', query)
        upc = upc_match.group(1) if upc_match else None

        # Description = query without the UPC digits, simplified
        if upc:
            text_part = query.replace(upc, '').strip()
            description = self._simplify_query(text_part) if text_part else None
        else:
            description = self._simplify_query(query)

        return upc, description

    def _simplify_query(self, query):
        """Strip filler words, keep up to 5 meaningful words"""
        cleaned = query.replace('–', ' ').replace('—', ' ')
        cleaned = re.sub(r'[^\w\s\.]', ' ', cleaned)

        filler_words = [
            'con', 'de', 'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas',
            'bebida', 'producto', 'articulo', 'pack', 'paquete',
        ]

        words = cleaned.lower().split()
        important = [w for w in words if w not in filler_words and len(w) > 2]
        simplified = ' '.join(important[:5])

        return simplified if simplified else query

    # ------------------------------------------------------------------
    # Per-retailer parallel search
    # ------------------------------------------------------------------

    def _search_per_retailer(self, upc, description, domains):
        """Run one search per domain in parallel, return combined results"""
        all_results = []

        with ThreadPoolExecutor(max_workers=6) as executor:
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
                        logger.info(f"✅ {domain}: {len(store_results)} result(s)")
                    else:
                        logger.info(f"⚠️ {domain}: no results")
                except Exception as e:
                    logger.warning(f"⚠️ {domain}: search failed — {e}")

        logger.info(f"✅ Total: {len(all_results)} results from {len(domains)} retailers")
        return all_results

    def _search_for_store(self, upc, description, domain):
        """
        One store search with UPC-first strategy:
        1. If UPC available → try '{upc} {store}'
        2. If no results    → try '{description} {store}'
        3. If no UPC        → search by description only
        """
        store_name = DOMAIN_TO_STORE_NAME.get(domain, domain.split('.')[0])

        # 1. UPC search (most exact)
        if upc:
            results = self._single_search(f"{upc} {store_name}", domain)
            if results:
                return results
            logger.info(f"ℹ️ UPC gave no results for {domain}, trying description")

        # 2. Description fallback
        if description:
            return self._single_search(f"{description} {store_name}", domain)

        return []

    def _single_search(self, query, domain):
        """Execute one Oxylabs request, return top results for domain"""
        logger.info(f"🔍 Searching: {query!r}")

        payload = {
            'source': 'google_search',
            'geo_location': 'Mexico',
            'query': query,
            'parse': True,
            'context': [{'key': 'filter', 'value': 1}]
        }

        try:
            response = requests.post(
                self.api_url,
                auth=(self.username, self.password),
                json=payload,
                timeout=self.timeout
            )

            if response.status_code != 200:
                logger.error(f"❌ HTTP {response.status_code}: {response.text[:100]}")
                return []

            organic = self._extract_organic(response.json())
            if not organic:
                return []

            # Prefer results from the target domain
            on_domain = [r for r in organic if domain in r.get('url', '')]
            if on_domain:
                return on_domain[:2]

            # Fallback: top organic result (attach store hint for Gemini)
            top = organic[0].copy()
            top['_store_hint'] = DOMAIN_TO_STORE_NAME.get(domain, domain)
            return [top]

        except requests.Timeout:
            logger.error(f"⏱️ Timeout for {domain}")
            return []
        except Exception as e:
            logger.error(f"❌ Error for {domain}: {e}")
            return []

    # ------------------------------------------------------------------
    # Broad search (no domains selected)
    # ------------------------------------------------------------------

    def _search_broad(self, query):
        """Single broad search, filtered to Mexican stores"""
        payload = {
            'source': 'google_search',
            'geo_location': 'Mexico',
            'query': query,
            'parse': True,
            'context': [{'key': 'filter', 'value': 1}]
        }

        try:
            response = requests.post(
                self.api_url,
                auth=(self.username, self.password),
                json=payload,
                timeout=self.timeout
            )

            if response.status_code != 200:
                logger.error(f"❌ Broad search HTTP {response.status_code}")
                return []

            organic = self._extract_organic(response.json())
            filtered = self._filter_mexican_stores(organic)
            logger.info(f"✅ Broad search: {len(filtered)}/{len(organic)} Mexican results")
            return filtered

        except requests.Timeout:
            logger.error("⏱️ Broad search timeout")
            return []
        except Exception as e:
            logger.error(f"❌ Broad search error: {e}")
            return []

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _extract_organic(self, data):
        """Extract organic (or paid) results from Oxylabs parsed response"""
        if 'results' not in data or not data['results']:
            return []

        content = data['results'][0].get('content', {})
        if not isinstance(content, dict):
            return []

        results_section = content.get('results', {})
        if not isinstance(results_section, dict):
            return []

        organic = results_section.get('organic', [])
        if not organic:
            organic = results_section.get('paid', [])

        return organic or []

    def _filter_mexican_stores(self, results):
        """Keep only results from .mx domains or known Mexican retailers"""
        blocked = ['.es', '.fr', '.de', '.uk', '.eu', 'parafarmacia', 'farmacia-']
        mx_keywords = [
            'walmart', 'soriana', 'chedraui', 'lacomer', 'heb', 'costco',
            'mercadolibre', 'liverpool', 'coppel', 'elektra', 'sanborns',
            'fahorro', 'benavides', 'guadalajara', 'bodegaaurrera', 'samsclub',
        ]

        kept = []
        for item in results:
            if not isinstance(item, dict):
                continue
            url = item.get('url', '').lower()
            if any(p in url for p in blocked):
                continue
            if '.com.mx' in url or url.endswith('.mx') or any(k in url for k in mx_keywords):
                kept.append(item)

        return kept
