"""
Zyte Service — direct product page extraction.
Always uses browserHtml + geolocation MX for maximum extraction quality.
Retries up to MAX_RETRIES times on timeout or server errors.
"""
import re
import time
import requests
from concurrent.futures import ThreadPoolExecutor, as_completed
from logger_config import setup_logger
from config import Config

logger = setup_logger(__name__)

MAX_RETRIES = 5


def _fix_mexican_price(price_str):
    """
    Fix Mexican thousand-separator format: '1.215' → '1215', '1.215,50' → '1215.50'
    Leaves normal decimals untouched: '14.50' → '14.50'
    """
    if not price_str:
        return price_str
    s = str(price_str).strip()
    # Pattern: digits, period, exactly 3 digits, optionally comma+cents → thousands sep
    if re.match(r'^\d{1,4}\.\d{3}(,\d{1,2})?$', s):
        s = s.replace('.', '').replace(',', '.')
    return s
RETRY_DELAY = 2  # seconds between retries


class ZyteService:

    def __init__(self):
        self.api_key = Config.ZYTE_API_KEY
        self.api_url = 'https://api.zyte.com/v1/extract'
        self.timeout = 90
        self.max_workers = 10

    def is_configured(self):
        return bool(self.api_key)

    def extract_products(self, store_urls):
        """
        Extract product data from multiple store URLs in parallel.

        Args:
            store_urls: dict {domain: url}, e.g. {"walmart.com.mx": "https://..."}

        Returns:
            (results: list, failed_domains: list)
        """
        results = []
        failed_domains = []

        with ThreadPoolExecutor(max_workers=self.max_workers) as executor:
            future_to_domain = {
                executor.submit(self._extract_single, domain, url): domain
                for domain, url in store_urls.items()
            }

            for future in as_completed(future_to_domain):
                domain = future_to_domain[future]
                try:
                    result = future.result()
                    if result:
                        results.append(result)
                        logger.info(f"✅ Zyte {domain}: price={result.get('price') or 'N/A'}")
                    else:
                        failed_domains.append(domain)
                        logger.info(f"⚠️ Zyte {domain}: no product extracted")
                except Exception as e:
                    failed_domains.append(domain)
                    logger.warning(f"⚠️ Zyte {domain}: {e}")

        logger.info(f"✅ Zyte total: {len(results)} results, {len(failed_domains)} failed")
        return results, failed_domains

    def _extract_single(self, domain, url):
        """Extract product data from one URL via Zyte AI, with retries."""
        if domain == 'farmaciasanpablo.com.mx':
            return self._extract_sanpablo(domain, url)

        payload = {
            "url": url,
            "browserHtml": True,                              # render JS (covers all sites)
            "product": True,                                  # AI-powered product extraction
            "productOptions": {"extractFrom": "browserHtml"}, # use rendered HTML for AI
            "geolocation": "MX",                             # render as Mexican visitor
        }

        response = None
        for attempt in range(1, MAX_RETRIES + 1):
            logger.info(f"🔵 Zyte [{attempt}/{MAX_RETRIES}] {domain}: {url[:70]}")
            try:
                response = requests.post(
                    self.api_url,
                    auth=(self.api_key, ""),
                    json=payload,
                    timeout=self.timeout,
                )
            except requests.Timeout:
                logger.warning(f"⏱️ Zyte timeout attempt {attempt}/{MAX_RETRIES} for {domain}")
                if attempt < MAX_RETRIES:
                    time.sleep(RETRY_DELAY)
                    continue
                logger.error(f"❌ Zyte: all retries exhausted (timeout) for {domain}")
                return None
            except Exception as e:
                logger.error(f"❌ Zyte request error for {domain}: {e}")
                return None

            if response.status_code == 200:
                break

            # Retry on rate-limit or server errors
            if response.status_code in (429, 500, 502, 503, 504) and attempt < MAX_RETRIES:
                logger.warning(f"⏱️ Zyte HTTP {response.status_code} attempt {attempt}/{MAX_RETRIES} for {domain}")
                time.sleep(RETRY_DELAY * attempt)
                continue

            logger.error(f"❌ Zyte HTTP {response.status_code} for {domain}: {response.text[:100]}")
            return None

        if response is None or response.status_code != 200:
            return None

        data = response.json()
        product = data.get('product')

        if not product or not isinstance(product, dict):
            logger.info(f"⚠️ Zyte {domain}: empty product response")
            return None

        name = product.get('name', '')
        currency = product.get('currency', 'MXN') or 'MXN'

        price_str = _fix_mexican_price(product.get('price') or '')
        regular_price_str = _fix_mexican_price(product.get('regularPrice') or '')

        # If both prices exist and differ → discounted price vs original
        if price_str and regular_price_str and price_str != regular_price_str:
            price = price_str
            regular_price = regular_price_str
        elif price_str:
            price = price_str
            regular_price = None
        else:
            price = regular_price_str
            regular_price = None

        # Extract image URL
        image = None
        main_image = product.get('mainImage')
        if isinstance(main_image, dict):
            image = main_image.get('url')
        elif isinstance(main_image, str):
            image = main_image

        # Use canonical URL from Zyte if available, fallback to input URL
        canonical_url = product.get('url') or url

        return {
            'url': canonical_url,
            'title': name,
            'price': price,
            'regular_price': regular_price,
            'currency': currency,
            'thumb': image,
            '_domain': domain,
            '_source': 'zyte',
        }

    def _extract_sanpablo(self, domain, url):
        """
        San Pablo: standard Zyte AI product extraction.
        Prices come from product.price / product.regularPrice (AI extraction).
        """
        payload = {
            "url": url,
            "browserHtml": True,
            "product": True,
            "productOptions": {"extractFrom": "browserHtml", "ai": True},
            "geolocation": "MX",
        }

        response = None
        for attempt in range(1, MAX_RETRIES + 1):
            logger.info(f"🔵 Zyte SanPablo [{attempt}/{MAX_RETRIES}]: {url[:70]}")
            try:
                response = requests.post(
                    self.api_url,
                    auth=(self.api_key, ""),
                    json=payload,
                    timeout=self.timeout,
                )
            except requests.Timeout:
                logger.warning(f"⏱️ Zyte SanPablo timeout attempt {attempt}/{MAX_RETRIES}")
                if attempt < MAX_RETRIES:
                    time.sleep(RETRY_DELAY)
                    continue
                return None
            except Exception as e:
                logger.error(f"❌ Zyte SanPablo error: {e}")
                return None

            if response.status_code == 200:
                break
            if response.status_code in (429, 500, 502, 503, 504) and attempt < MAX_RETRIES:
                time.sleep(RETRY_DELAY * attempt)
                continue
            logger.error(f"❌ Zyte SanPablo HTTP {response.status_code}")
            return None

        if response is None or response.status_code != 200:
            return None

        data = response.json()
        product = data.get('product') or {}

        if not product:
            logger.warning("⚠️ Zyte SanPablo: empty product object in response")
            return None

        def _clean(value):
            if value is None:
                return None
            value = str(value).strip()
            return value or None

        price = _fix_mexican_price(_clean(product.get('price')))
        regular_price = _fix_mexican_price(_clean(product.get('regularPrice')))
        currency = product.get('currency') or 'MXN'
        name = product.get('name') or ''

        image = None
        main_image = product.get('mainImage')
        if isinstance(main_image, dict):
            image = main_image.get('url')
        elif isinstance(main_image, str):
            image = main_image

        canonical_url = product.get('canonicalUrl') or product.get('url') or url

        logger.info(f"✅ SanPablo: {name!r} price={price} regular={regular_price} {currency}")

        if not price and not name:
            logger.warning("⚠️ Zyte SanPablo: no price and no name — check raw response")
            return None

        return {
            'url': canonical_url,
            'title': name,
            'price': price,
            'regular_price': regular_price,
            'currency': currency,
            'thumb': image,
            '_domain': domain,
            '_source': 'zyte',
        }
