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

        payload = {
            'source': 'google_shopping_search',
            'domain': 'com.mx',
            'query': query,
            'parse': True,
            'context': [
                {'key': 'filter', 'value': '1'},
                {'key': 'min_price', 'value': 1}
            ]
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
                logger.info(f"🔍 DEBUG - Content type: {type(first_result.get('content', 'NOT_FOUND'))}")

            if 'results' not in data or not data['results']:
                logger.warning("⚠️ Oxylabs returned no results")
                return {'results': []}

            # Extract parsed results with validation
            first_result = data['results'][0]
            content = first_result.get('content', {})

            # Try multiple paths to get organic results
            organic = []

            if isinstance(content, dict):
                # Path 1: content -> results -> organic
                results_data = content.get('results', {})
                if isinstance(results_data, dict):
                    organic = results_data.get('organic', [])
                    logger.info(f"🔍 Found organic via path: content->results->organic ({len(organic)} items)")

                # Path 2: content -> organic (direct)
                if not organic:
                    organic = content.get('organic', [])
                    logger.info(f"🔍 Found organic via path: content->organic ({len(organic)} items)")

            elif isinstance(content, str):
                # Content is a string - try other paths
                logger.warning(f"⚠️ Content is string, trying alternative paths")

                # Path 3: first_result -> organic (direct)
                organic = first_result.get('organic', [])
                logger.info(f"🔍 Found organic via path: first_result->organic ({len(organic)} items)")

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
        Filter results to prioritize Mexican stores

        Args:
            results: List of organic results

        Returns:
            list: Filtered results
        """
        # Major Mexican retailers to prioritize
        mexican_stores = {
            'walmart', 'bodega aurrera', 'superama', 'sams club',
            'soriana', 'chedraui', 'la comer', 'city market',
            'heb', 'costco', 'mercado libre', 'amazon',
            'liverpool', 'palacio de hierro', 'coppel',
            'elektra', 'sanborns', '7-eleven', 'oxxo',
            'farmacias guadalajara', 'farmacia del ahorro', 'benavides'
        }

        mexican_results = []
        other_results = []

        for item in results:
            if not isinstance(item, dict):
                continue

            # Check merchant name
            merchant = item.get('merchant', {})
            merchant_name = ''

            if isinstance(merchant, dict):
                merchant_name = merchant.get('name', '').lower()
            elif isinstance(merchant, str):
                merchant_name = merchant.lower()

            # Check if it's a Mexican store
            is_mexican = any(store in merchant_name for store in mexican_stores)

            # Also check URL for .mx domains
            url = item.get('url', '').lower()
            is_mx_domain = '.com.mx' in url or '.mx' in url

            if is_mexican or is_mx_domain:
                mexican_results.append(item)
            else:
                other_results.append(item)

        # Prioritize Mexican stores, then add others
        logger.info(f"🇲🇽 Found {len(mexican_results)} Mexican stores, {len(other_results)} others")
        return mexican_results + other_results
