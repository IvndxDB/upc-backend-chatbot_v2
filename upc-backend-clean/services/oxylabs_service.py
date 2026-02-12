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

            if 'results' not in data or not data['results']:
                logger.warning("⚠️ Oxylabs returned no results")
                return {'results': []}

            # Extract parsed results with validation
            first_result = data['results'][0]
            parsed = first_result.get('content', {})

            # If content is a string, try to parse it or use raw results
            if isinstance(parsed, str):
                logger.warning(f"⚠️ Content is string, using raw results from 'organic'")
                # Try to get organic results directly from first_result
                organic = first_result.get('organic', [])
                if not organic:
                    # If no organic, return empty
                    logger.error(f"❌ No organic results found")
                    return {'error': 'No results found', 'results': []}
            elif isinstance(parsed, dict):
                # Normal flow: parsed is dict
                results_data = parsed.get('results', {})
                if not isinstance(results_data, dict):
                    logger.error(f"❌ Unexpected 'results' type: {type(results_data)}")
                    return {'error': 'Invalid response format', 'results': []}
                organic = results_data.get('organic', [])
            else:
                logger.error(f"❌ Unexpected 'content' type: {type(parsed)}")
                return {'error': 'Invalid response format', 'results': []}

            logger.info(f"✅ Oxylabs returned {len(organic)} results")
            return {'results': organic}

        except requests.Timeout:
            logger.error(f"⏱️ Oxylabs timeout after {self.timeout}s")
            return {'error': 'Timeout', 'results': []}

        except requests.RequestException as e:
            logger.error(f"❌ Oxylabs request exception: {str(e)}")
            return {'error': str(e), 'results': []}

        except Exception as e:
            logger.error(f"❌ Oxylabs unexpected error: {str(e)}")
            return {'error': str(e), 'results': []}
