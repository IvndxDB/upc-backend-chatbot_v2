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
    'yza.mx':                       'farmacias yza',
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
            dict: {'results': [...], 'empty_domains': [...], 'upc': ..., 'description': ...}
        """
        if not self.is_configured():
            logger.error("❌ Oxylabs credentials not configured")
            return {'error': 'Oxylabs not configured', 'results': [], 'empty_domains': []}

        upc, description = self._extract_upc_and_description(query)
        logger.info(f"🔍 Query: {query!r} → upc={upc!r}, description={description!r}")

        if domains and len(domains) > 0:
            results, empty_domains = self._search_per_retailer(upc, description, domains)
        else:
            # Whole-web: Google Search with UPC (exact product identifier, no store filter)
            broad_query = upc or description
            results = self._search_broad(broad_query)
            empty_domains = []

        return {
            'results': results,
            'empty_domains': empty_domains,
            'upc': upc,
            'description': description,
        }

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
        """Run one search per domain in parallel, return (results, empty_domains)"""
        all_results = []
        empty_domains = []

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
                        empty_domains.append(domain)
                        logger.info(f"⚠️ {domain}: no results")
                except Exception as e:
                    empty_domains.append(domain)
                    logger.warning(f"⚠️ {domain}: search failed — {e}")

        logger.info(f"✅ Total: {len(all_results)} results from {len(domains)} retailers ({len(empty_domains)} empty)")
        return all_results, empty_domains

    @staticmethod
    def _walmart_upc(upc):
        """Walmart uses GTIN-14: strip check digit, left-pad to 14 digits.
        e.g. 7501125104343 → 00750112510434"""
        return upc[:-1].zfill(14) if upc and len(upc) >= 2 else upc

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
            # Walmart requires GTIN-14 format and domain in query
            if domain == 'walmart.com.mx':
                walmart_upc = self._walmart_upc(upc)
                logger.info(f"🔄 Walmart UPC transform: {upc} → {walmart_upc}")
                results = self._single_search(f"{walmart_upc} walmart.com.mx", domain)
            else:
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
                return on_domain[:3]

            # Fallback: only accept results from an exact known retailer domain
            from urllib.parse import urlparse as _urlparse
            for candidate in organic:
                cand_domain = _urlparse(candidate.get('url', '')).netloc.lower().replace('www.', '')
                if cand_domain in DOMAIN_TO_STORE_NAME:
                    result = candidate.copy()
                    result['_store_hint'] = DOMAIN_TO_STORE_NAME.get(domain, domain)
                    return [result]

            return []

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
        """Whole-web Google Search by UPC — 2 pages in parallel.
        First 5 results from page 1 are always included (highest Google relevance).
        Remaining results are filtered to .com.mx / known Mexican stores.
        """
        with ThreadPoolExecutor(max_workers=2) as executor:
            f1 = executor.submit(self._search_broad_page, query, 1)
            f2 = executor.submit(self._search_broad_page, query, 2)
            page1 = f1.result() or []
            page2 = f2.result() or []

        logger.info(f"✅ Broad page 1: {len(page1)} items, page 2: {len(page2)} items")

        # Top 5 from page 1 always pass through (most relevant Google results)
        top5    = page1[:5]
        rest    = page1[5:] + page2
        mx_rest = self._filter_mexican_stores(rest)

        # Combine keeping order, deduplicate by URL
        seen_urls = set()
        unique = []
        for item in top5 + mx_rest:
            url = item.get('url', '')
            if url and url not in seen_urls:
                seen_urls.add(url)
                unique.append(item)

        logger.info(f"✅ Broad search: {len(unique)} results "
                    f"({len(top5)} top-5 unfiltered + {len(mx_rest)} Mexican filtered)")
        return unique

    def _search_broad_page(self, query, page=1):
        """Single page of Google Search (no domain filter) for whole-web UPC lookup"""
        payload = {
            'source': 'google_search',
            'geo_location': 'Mexico',
            'query': query,
            'parse': True,
            'pages': 1,
            'start_page': page,
            'context': [{'key': 'filter', 'value': 1}],
        }

        try:
            response = requests.post(
                self.api_url,
                auth=(self.username, self.password),
                json=payload,
                timeout=self.timeout
            )

            if response.status_code != 200:
                logger.error(f"❌ Broad page {page} HTTP {response.status_code}: {response.text[:120]}")
                return []

            return self._extract_organic(response.json())

        except requests.Timeout:
            logger.error(f"⏱️ Broad page {page} timeout")
            return []
        except Exception as e:
            logger.error(f"❌ Broad page {page} error: {e}")
            return []

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _extract_organic(self, data):
        """Extract organic (or paid) results from Oxylabs parsed response, with images attached."""
        if 'results' not in data or not data['results']:
            return []

        content = data['results'][0].get('content', {})
        if not isinstance(content, dict):
            return []

        results_section = content.get('results', {})
        if not isinstance(results_section, dict):
            return []

        organic = list(results_section.get('organic', []) or results_section.get('paid', []))

        # Attach images extracted via parsing_instructions (matched by position)
        product_images = content.get('product_images', [])
        if product_images and isinstance(product_images, list):
            for i, result in enumerate(organic):
                if i >= len(product_images):
                    break
                img_data = product_images[i]
                if not isinstance(img_data, dict):
                    continue
                thumb = img_data.get('thumb') or img_data.get('thumb_fallback') or ''
                if thumb and not thumb.startswith('data:') and thumb.startswith('http'):
                    result['thumb'] = thumb

        for r in organic:
            if '_source' not in r:
                r['_source'] = 'oxylabs_organic'
        return organic

    def _extract_shopping(self, data):
        """Extract items from a google_shopping_search parsed response."""
        if 'results' not in data or not data['results']:
            return []

        content = data['results'][0].get('content', {})
        if not isinstance(content, dict):
            return []

        results_section = content.get('results', {})
        if not isinstance(results_section, dict):
            return []

        items = (
            list(results_section.get('organic', []))
            or list(results_section.get('paid', []))
        )

        normalized = []
        for item in items:
            if not isinstance(item, dict):
                continue
            url = item.get('url', '')
            if not url:
                # Some shopping items expose merchant URL differently
                merchant = item.get('merchant', {}) or {}
                url = merchant.get('url', '') or item.get('product_url', '')
            if not url:
                continue

            # Map shopping-specific fields to our standard keys
            price_raw = item.get('price') or item.get('price_raw') or ''
            title = item.get('title', '') or item.get('name', '')
            thumb = item.get('thumbnail') or item.get('thumb') or item.get('image') or ''
            seller = item.get('merchant_name') or item.get('merchant', {}).get('name', '')

            normalized.append({
                'url': url,
                'title': title,
                'price': price_raw,
                'thumb': thumb if thumb.startswith('http') else '',
                '_seller': seller,
                '_source': 'oxylabs_shopping',
            })

        return normalized

    def _filter_mexican_stores(self, results):
        """Keep only results from .mx domains or known Mexican retailers"""
        blocked = ['.es', '.fr', '.de', '.uk', '.eu', 'parafarmacia', 'farmacia-']
        mx_keywords = [
            'walmart', 'soriana', 'chedraui', 'lacomer', 'heb', 'costco',
            'mercadolibre', 'liverpool', 'coppel', 'elektra', 'sanborns',
            'fahorro', 'benavides', 'guadalajara', 'bodegaaurrera', 'samsclub',
            'yza.mx',
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
