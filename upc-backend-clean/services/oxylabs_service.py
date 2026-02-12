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

        # Simplified payload - remove problematic context params
        payload = {
            'source': 'google_shopping_search',
            'domain': 'com.mx',
            'query': query,
            'parse': True
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
                # Content is a JSON string - parse it first!
                logger.info(f"🔍 Content is string, parsing as JSON...")
                try:
                    import json
                    parsed_content = json.loads(content)

                    if isinstance(parsed_content, dict):
                        logger.info(f"🔍 Parsed content keys: {list(parsed_content.keys())}")

                        # Log nested structure
                        if 'results' in parsed_content:
                            results_data = parsed_content['results']
                            logger.info(f"🔍 'results' type: {type(results_data)}")
                            if isinstance(results_data, dict):
                                logger.info(f"🔍 'results' keys: {list(results_data.keys())}")

                        # Path 1: parsed -> results -> organic
                        results_data = parsed_content.get('results', {})
                        if isinstance(results_data, dict):
                            organic = results_data.get('organic', [])
                            if organic:
                                logger.info(f"🔍 Found organic via path: parsed_content->results->organic ({len(organic)} items)")

                        # Path 2: parsed -> organic (direct)
                        if not organic:
                            organic = parsed_content.get('organic', [])
                            if organic:
                                logger.info(f"🔍 Found organic via path: parsed_content->organic ({len(organic)} items)")

                        # Path 3: Check if results is a list directly
                        if not organic and isinstance(parsed_content.get('results'), list):
                            organic = parsed_content.get('results', [])
                            logger.info(f"🔍 Found results as list: parsed_content->results ({len(organic)} items)")
                    else:
                        logger.warning(f"🔍 Parsed content is not a dict: {type(parsed_content)}")

                except json.JSONDecodeError as e:
                    logger.error(f"❌ Failed to parse content as JSON: {str(e)}")
                    logger.error(f"❌ Content preview: {content[:200]}...")

            elif isinstance(content, dict):
                # Path 3: content is already a dict -> results -> organic
                results_data = content.get('results', {})
                if isinstance(results_data, dict):
                    organic = results_data.get('organic', [])
                    logger.info(f"🔍 Found organic via path: content->results->organic ({len(organic)} items)")

                # Path 4: content -> organic (direct)
                if not organic:
                    organic = content.get('organic', [])
                    logger.info(f"🔍 Found organic via path: content->organic ({len(organic)} items)")

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
