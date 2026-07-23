"""
Zyte Service — direct product page extraction.
Always uses browserHtml + geolocation MX for maximum extraction quality.
Retries up to MAX_RETRIES times on timeout or server errors.
"""
import time
import requests
from concurrent.futures import ThreadPoolExecutor, as_completed
from urllib.parse import urlparse, parse_qs
from logger_config import setup_logger
from config import Config

logger = setup_logger(__name__)

MAX_RETRIES = 5
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

        price_str = product.get('price') or ''
        regular_price_str = product.get('regularPrice') or ''

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
        San Pablo special: uses networkCapture to intercept the Facebook pixel
        request (facebook.com/tr) which carries the real product price in
        cd[value] query param. Regular Zyte product extraction returns no price.
        """
        payload = {
            "url": url,
            "browserHtml": True,
            "product": True,
            "productOptions": {"extractFrom": "browserHtml"},
            "geolocation": "MX",
            "networkCapture": [
                {
                    "filterType": "url",
                    "value": "facebook.com/tr",
                    "matchType": "contains",
                }
            ],
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
        top_keys = [k for k in data.keys()]
        logger.info(f"🔍 SanPablo raw keys: {top_keys}")

        # ── Extract price from Facebook pixel network capture ──────────────
        price = None
        currency = 'MXN'
        captures = data.get('networkCapture', [])
        logger.info(f"🔍 SanPablo captures count: {len(captures)}")

        for capture in captures:
            call_url = capture.get('url', '')
            logger.info(f"🔍 SanPablo captured URL: {call_url[:120]}")
            if not call_url:
                continue
            query = parse_qs(urlparse(call_url).query)
            raw_value = query.get('cd[value]', [None])[0]
            if raw_value:
                try:
                    price = str(float(raw_value))
                    currency = query.get('cd[currency]', ['MXN'])[0] or 'MXN'
                    logger.info(f"✅ SanPablo pixel price: {price} {currency}")
                except (ValueError, TypeError):
                    pass
                break

        if not captures:
            logger.warning("⚠️ SanPablo: no Facebook pixel captured")

        # ── Product name and image from AI extraction (best-effort) ───────
        product = data.get('product') or {}
        logger.info(f"🔍 SanPablo product keys: {list(product.keys()) if product else 'empty'}")
        logger.info(f"🔍 SanPablo product name: {product.get('name')!r}, price: {product.get('price')!r}")
        name = product.get('name', '')
        image = None
        main_image = product.get('mainImage')
        if isinstance(main_image, dict):
            image = main_image.get('url')
        elif isinstance(main_image, str):
            image = main_image

        canonical_url = product.get('url') or url

        if not price and not name:
            logger.info("⚠️ Zyte SanPablo: no price from pixel and no product name")
            return None

        return {
            'url': canonical_url,
            'title': name,
            'price': price,
            'regular_price': None,
            'currency': currency,
            'thumb': image,
            '_domain': domain,
            '_source': 'zyte',
        }
