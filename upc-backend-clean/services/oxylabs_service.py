"""
Oxylabs Service
Handles Google Shopping searches via Oxylabs Realtime API
"""
import requests
from logger_config import setup_logger
from config import Config

logger = setup_logger(__name__)


class OxylabsService:
    """Service for Oxylabs Google Shopping API"""

    def __init__(self):
        self.username = Config.OXYLABS_USERNAME
        self.password = Config.OXYLABS_PASSWORD
        self.timeout = Config.OXYLABS_TIMEOUT
        self.api_url = 'https://realtime.oxylabs.io/v1/queries'

    def is_configured(self):
        """Check if Oxylabs credentials are configured"""
        return bool(self.username and self.password)

    def _simplify_query(self, query):
        """
        Simplify search query for better Oxylabs results

        Args:
            query: Original search query

        Returns:
            str: Simplified query
        """
        import re

        # Remove special characters and normalize
        cleaned = query.replace('–', ' ').replace('—', ' ')
        cleaned = re.sub(r'[^\w\s\.]', ' ', cleaned)

        # Remove common filler words (Spanish)
        filler_words = [
            'con', 'de', 'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas',
            'bebida', 'producto', 'articulo', 'pack', 'paquete',
            'sabor', 'hidratante', 'electrolitos', 'vitamina',
            'tubo', 'tabletas', 'efervecentes', 'capsulas'
        ]

        # Split into words
        words = cleaned.lower().split()

        # Keep important words (not in filler list) and limit to 5 words
        important_words = [w for w in words if w not in filler_words and len(w) > 2]

        # Keep first 5 important words
        simplified = ' '.join(important_words[:5])

        return simplified if simplified else query

    def search_shopping(self, query):
        """
        Search Google Shopping via Oxylabs

        Args:
            query: Search query string

        Returns:
            dict: {
                'results': [...],  # List of shopping results
                'error': None      # Or error message if failed
            }
        """
        if not self.is_configured():
            logger.error("❌ Oxylabs credentials not configured")
            return {'error': 'Oxylabs not configured', 'results': []}

        # Simplify query for better results
        simplified_query = self._simplify_query(query)
        logger.info(f"🔍 Original query: {query}")
        logger.info(f"🔍 Simplified query: {simplified_query}")

        # Use Google Search (not Shopping) with site:.mx filter for Mexican stores
        # This includes specific details like flavor (uva) and size (625ml)
        search_query = f"{simplified_query} precio site:.mx"
        logger.info(f"🔍 Search query: {search_query}")

        # Use google_search with parse: True (works reliably)
        payload = {
            'source': 'google_search',  # Changed from google_shopping_search
            'domain': 'com.mx',
            'query': search_query,
            'parse': True,  # Parsing works well for google_search
            'limit': 20  # Get more results to filter
        }

        try:
            logger.info(f"🔍 Oxylabs Shopping query: {query}")

            response = requests.post(
                self.api_url,
                auth=(self.username, self.password),
                json=payload,
                timeout=self.timeout
            )

            if response.status_code != 200:
                logger.error(f"❌ Oxylabs HTTP error: {response.status_code}")
                return {
                    'error': f'Oxylabs HTTP {response.status_code}',
                    'results': []
                }

            data = response.json()

            # DEBUG: Log full response structure
            logger.info(f"🔍 DEBUG - Full Oxylabs response keys: {data.keys()}")
            if 'results' in data and data['results']:
                first_result = data['results'][0]
                logger.info(f"🔍 DEBUG - First result keys: {first_result.keys()}")
                logger.info(f"🔍 DEBUG - Status code: {first_result.get('status_code', 'NOT_FOUND')}")
                logger.info(f"🔍 DEBUG - Parser type: {first_result.get('parser_type', 'NOT_FOUND')}")
                logger.info(f"🔍 DEBUG - Content type: {type(first_result.get('content', 'NOT_FOUND'))}")
                content_preview = str(first_result.get('content', ''))[:300]
                logger.info(f"🔍 DEBUG - Content preview: {content_preview}")

            if 'results' not in data or not data['results']:
                logger.warning("⚠️ Oxylabs returned no results")
                return {'results': []}

            # Extract parsed results with validation
            first_result = data['results'][0]
            content = first_result.get('content', {})

            # Try multiple paths to get organic results
            organic = []

            if isinstance(content, str):
                # Content might be HTML (parse: False) or JSON (parse: True)
                logger.info(f"🔍 Content is string (length: {len(content)})")

                # Try parsing as JSON first
                if content.strip().startswith('{'):
                    logger.info(f"🔍 Content looks like JSON, parsing...")
                    try:
                        import json
                        parsed_content = json.loads(content)

                        if isinstance(parsed_content, dict):
                            logger.info(f"🔍 Parsed JSON keys: {list(parsed_content.keys())}")

                            # Try multiple paths for JSON
                            results_data = parsed_content.get('results', {})
                            if isinstance(results_data, dict):
                                organic = results_data.get('organic', [])
                                if organic:
                                    logger.info(f"🔍 Found organic via JSON: {len(organic)} items")

                            if not organic:
                                organic = parsed_content.get('organic', [])
                                if organic:
                                    logger.info(f"🔍 Found organic direct: {len(organic)} items")

                    except json.JSONDecodeError:
                        logger.warning("⚠️ Failed to parse as JSON, will try HTML")

                # If JSON parsing failed or no results, try HTML parsing
                if not organic and '<html' in content.lower():
                    logger.info("🔍 Content is HTML, parsing with regex...")
                    organic = self._parse_html_results(content)
                    if organic:
                        logger.info(f"🔍 Found {len(organic)} results from HTML")

                # If still empty and content exists, it might be empty HTML
                if not organic and len(content) > 0:
                    logger.error(f"❌ Content is string but couldn't extract results")
                    logger.error(f"❌ Content preview: {content[:500]}")

            elif isinstance(content, dict):
                # For google_search: content -> results -> organic
                results_data = content.get('results', {})
                if isinstance(results_data, dict):
                    organic = results_data.get('organic', [])
                    if organic:
                        logger.info(f"🔍 Found organic via google_search: {len(organic)} items")

                # Fallback: content -> organic (direct)
                if not organic:
                    organic = content.get('organic', [])
                    if organic:
                        logger.info(f"🔍 Found organic direct: {len(organic)} items")

                # Transform google_search results to shopping-like format
                if organic:
                    organic = self._transform_search_results(organic)
                    logger.info(f"🔍 Transformed {len(organic)} search results to product format")

            # If still no results, log structure and return error
            if not organic:
                logger.error(f"❌ No organic results found in any path")
                logger.error(f"❌ Available keys in first_result: {first_result.keys()}")
                if isinstance(content, dict):
                    logger.error(f"❌ Available keys in content: {content.keys()}")
                return {'error': 'No organic results found', 'results': []}

            logger.info(f"✅ Oxylabs returned {len(organic)} organic results")

            # Filter for Mexican stores
            filtered = self._filter_mexican_stores(organic)
            logger.info(f"✅ After filtering: {len(filtered)} Mexican store results")

            return {'results': filtered}

        except requests.Timeout:
            logger.error(f"⏱️ Oxylabs timeout after {self.timeout}s")
            return {'error': 'Timeout', 'results': []}

        except requests.RequestException as e:
            logger.error(f"❌ Oxylabs request exception: {str(e)}")
            return {'error': str(e), 'results': []}

        except Exception as e:
            logger.error(f"❌ Oxylabs unexpected error: {str(e)}")
            return {'error': str(e), 'results': []}

    def _transform_search_results(self, search_results):
        """
        Transform Google Search results into product format
        Extracts prices from snippets and domain from URLs

        Args:
            search_results: List of google_search organic results

        Returns:
            list: List of product dicts with price info
        """
        import re
        from urllib.parse import urlparse, parse_qs, unquote

        products = []
        logger.info("🔍 Transforming search results to product format...")

        for item in search_results:
            if not isinstance(item, dict):
                continue

            title = item.get('title', '')
            desc = item.get('desc', '')  # Snippet/description
            raw_url = item.get('url', '')

            if not raw_url:
                continue

            # Clean URL - handle Google redirect format
            url = self._clean_url(raw_url)
            if not url or not url.startswith('http'):
                logger.debug(f"⚠️ Invalid URL after cleaning: {raw_url[:80]}...")
                continue

            # Extract domain as merchant name
            try:
                domain = urlparse(url).netloc
                # Clean domain: www.walmart.com.mx -> Walmart
                merchant_name = domain.replace('www.', '').split('.')[0].title()
            except:
                merchant_name = 'Unknown'

            # Extract price from snippet using regex
            price = self._extract_price_from_text(desc + ' ' + title)

            # Log URL for debugging
            logger.debug(f"🔗 {merchant_name}: {url[:80]}...")

            # Create product dict
            product = {
                'title': title,
                'price': price if price else '',  # Keep as string for now
                'url': url,
                'desc': desc,  # Keep snippet for Gemini analysis
                'merchant': {'name': merchant_name}
            }

            products.append(product)

        logger.info(f"✅ Transformed {len(products)} search results")
        return products

    def _extract_price_from_text(self, text):
        """
        Extract price from text using regex patterns

        Args:
            text: Text containing potential price

        Returns:
            str: Extracted price or empty string
        """
        import re

        if not text:
            return ''

        # Common Mexican price patterns
        patterns = [
            r'\$\s*(\d+(?:,\d{3})*(?:\.\d{2})?)',  # $1,234.56 or $25.00
            r'(\d+(?:,\d{3})*(?:\.\d{2})?)\s*(?:MXN|pesos?|mx)',  # 1,234.56 MXN
            r'precio:?\s*\$?\s*(\d+(?:,\d{3})*(?:\.\d{2})?)',  # precio: $25.00
        ]

        for pattern in patterns:
            match = re.search(pattern, text, re.IGNORECASE)
            if match:
                # Return the captured price
                return match.group(1)

        return ''

    def _clean_url(self, url):
        """
        Clean URL - handle Google redirect format and extract actual URL

        Args:
            url: Raw URL from search result

        Returns:
            str: Cleaned URL or empty string if invalid
        """
        from urllib.parse import urlparse, parse_qs, unquote
        import re

        if not url:
            return ''

        # If URL already looks good (starts with http), return as-is
        if url.startswith('http://') or url.startswith('https://'):
            return url

        # Handle Google redirect format: /url?q=https://actual-url.com&...
        if url.startswith('/url?'):
            try:
                # Parse query string
                parsed = urlparse(url)
                params = parse_qs(parsed.query)
                # Extract 'q' parameter (the actual URL)
                if 'q' in params and params['q']:
                    actual_url = unquote(params['q'][0])
                    if actual_url.startswith('http'):
                        return actual_url
            except:
                pass

        # Handle relative URLs - try to construct full URL
        # (shouldn't happen with Oxylabs, but just in case)
        if url.startswith('/'):
            return ''  # Can't construct without domain

        return ''

    def _parse_html_results(self, html_content):
        """
        Parse Google Shopping HTML to extract product results
        Simple regex-based parser for when parse: False is used

        Args:
            html_content: Raw HTML string from Oxylabs

        Returns:
            list: List of product dicts
        """
        import re
        import json

        results = []
        logger.info("🔍 Parsing HTML content for product data...")

        try:
            # Google Shopping often embeds JSON-LD data in script tags
            # Look for product data in script tags
            script_pattern = r'<script[^>]*type=["\']application/ld\+json["\'][^>]*>(.*?)</script>'
            scripts = re.findall(script_pattern, html_content, re.DOTALL | re.IGNORECASE)

            for script in scripts:
                try:
                    data = json.loads(script)
                    if isinstance(data, dict) and data.get('@type') == 'Product':
                        # Extract product info
                        product = {
                            'title': data.get('name', ''),
                            'price': data.get('offers', {}).get('price', ''),
                            'url': data.get('url', ''),
                            'merchant': {'name': data.get('brand', {}).get('name', 'Unknown')}
                        }
                        if product['title'] and product['price']:
                            results.append(product)
                except:
                    continue

            logger.info(f"✅ Parsed {len(results)} products from HTML JSON-LD")
            return results

        except Exception as e:
            logger.error(f"❌ HTML parsing error: {str(e)}")
            return []

    def _filter_mexican_stores(self, results):
        """
        Filter results to ONLY show Mexican stores
        Blocks non-Mexican domains and stores

        Args:
            results: List of organic results

        Returns:
            list: Filtered results (ONLY Mexican stores)
        """
        # Major Mexican retailers
        mexican_stores = {
            'walmart', 'bodega aurrera', 'superama', 'sams club', 'sam\'s',
            'soriana', 'chedraui', 'la comer', 'city market',
            'heb', 'costco', 'mercado libre', 'amazon.com.mx',
            'liverpool', 'palacio de hierro', 'coppel',
            'elektra', 'sanborns', '7-eleven', 'oxxo',
            'farmacias guadalajara', 'farmacia del ahorro', 'benavides',
            'fresko', 'city club', 'smart', 'alsuper'
        }

        # Domains to block (European/non-Mexican)
        blocked_domains = [
            '.es', '.com.es', 'valencia', 'parafarmacia',
            'farmacia-', '.fr', '.de', '.uk', '.eu'
        ]

        mexican_results = []
        blocked_count = 0

        for item in results:
            if not isinstance(item, dict):
                continue

            # Get URL first
            url = item.get('url', '').lower()

            # Block non-Mexican domains
            is_blocked = any(domain in url for domain in blocked_domains)
            if is_blocked:
                blocked_count += 1
                logger.debug(f"🚫 Blocking non-Mexican domain: {url}")
                continue

            # Check if it's a Mexican store
            merchant = item.get('merchant', {})
            merchant_name = ''

            if isinstance(merchant, dict):
                merchant_name = merchant.get('name', '').lower()
            elif isinstance(merchant, str):
                merchant_name = merchant.lower()

            # Must be Mexican store OR .mx domain
            is_mexican_store = any(store in merchant_name for store in mexican_stores)
            is_mx_domain = '.com.mx' in url or url.endswith('.mx')

            if is_mexican_store or is_mx_domain:
                mexican_results.append(item)
            else:
                blocked_count += 1
                logger.debug(f"🚫 Blocking non-Mexican store: {merchant_name} ({url})")

        # ONLY return Mexican stores
        logger.info(f"🇲🇽 Keeping {len(mexican_results)} Mexican stores, blocked {blocked_count} non-Mexican")
        return mexican_results
