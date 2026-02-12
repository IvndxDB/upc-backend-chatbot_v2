"""
Gemini Service with Lazy Loading
Loads google.generativeai only when first needed (not at startup)
"""
import json
import re
from logger_config import setup_logger
from config import Config

logger = setup_logger(__name__)


class GeminiService:
    """Service for Gemini AI with lazy loading"""

    def __init__(self):
        self.model = None
        self.available = False
        self.loaded = False
        # No se inicializa aquí - lazy loading

    def _initialize(self):
        """
        Lazy initialization de Gemini
        Solo se llama al primer uso de analyze_results()
        """
        if self.loaded:
            return

        self.loaded = True

        try:
            # Import here, not at module level
            import google.generativeai as genai

            if not Config.GEMINI_API_KEY:
                logger.warning("⚠️ Gemini API key not configured")
                self.available = False
                return

            genai.configure(api_key=Config.GEMINI_API_KEY)
            self.model = genai.GenerativeModel('gemini-1.5-flash')
            self.available = True
            logger.info("✅ Gemini initialized successfully")

        except ImportError:
            logger.error("❌ google.generativeai not installed")
            self.available = False

        except Exception as e:
            logger.error(f"❌ Gemini initialization failed: {str(e)}")
            self.available = False

    def analyze_results(self, results, query):
        """
        Analyze Oxylabs results with Gemini AI

        Args:
            results: List of raw results from Oxylabs
            query: Original search query

        Returns:
            dict: Structured analysis or raw results if Gemini not available
        """
        # Lazy initialization on first use
        if not self.loaded:
            self._initialize()

        if not self.available:
            logger.warning("⚠️ Gemini not available, returning raw results")
            return self._format_raw_results(results)

        try:
            prompt = f"""Analiza estos resultados de Google Shopping para "{query}".

Resultados:
{json.dumps(results[:10], indent=2, ensure_ascii=False)}

IMPORTANTE:
1. Solo incluye 1 resultado por tienda/dominio (deduplica por seller/domain)
2. Extrae: title, price (como número), currency, seller, link
3. Normaliza precios a formato numérico (ej: "127.00")
4. Marca el source como "oxylabs_shopping"

Retorna SOLO JSON válido en este formato:
{{
  "offers": [
    {{
      "title": "Nombre producto",
      "price": 100.00,
      "currency": "MXN",
      "seller": "Tienda",
      "link": "URL",
      "source": "oxylabs_shopping"
    }}
  ],
  "summary": "Resumen breve",
  "total_offers": 5
}}"""

            logger.info("🤖 Analyzing with Gemini...")

            response = self.model.generate_content(prompt)
            result_text = response.text.strip()

            # Remove markdown code blocks if present
            if result_text.startswith('```'):
                result_text = re.sub(
                    r'^```(?:json)?\n|```$',
                    '',
                    result_text,
                    flags=re.MULTILINE
                )

            parsed = json.loads(result_text)
            logger.info(f"✅ Gemini analyzed {len(parsed.get('offers', []))} offers")
            return parsed

        except json.JSONDecodeError as e:
            logger.error(f"❌ Gemini returned invalid JSON: {str(e)}")
            return self._format_raw_results(results)

        except Exception as e:
            logger.error(f"❌ Gemini analysis error: {str(e)}")
            return self._format_raw_results(results)

    def _format_raw_results(self, results):
        """
        Format raw Oxylabs results without AI analysis
        Fallback when Gemini is not available or fails

        Args:
            results: List of raw Oxylabs results

        Returns:
            dict: Formatted results
        """
        offers = []
        seen_sellers = set()

        for item in results[:10]:
            # Validate item is a dictionary
            if not isinstance(item, dict):
                logger.warning(f"⚠️ Skipping non-dict item: {type(item)}")
                continue

            merchant = item.get('merchant', {})
            seller = merchant.get('name', 'Unknown') if isinstance(merchant, dict) else 'Unknown'

            # Deduplicate by seller
            if seller in seen_sellers:
                continue
            seen_sellers.add(seller)

            # Extract price
            price = self._normalize_price(item.get('price', ''))
            if not price:
                continue

            offers.append({
                'title': item.get('title', 'Unknown Product'),
                'price': price,
                'currency': 'MXN',
                'seller': seller,
                'link': item.get('url', ''),
                'source': 'oxylabs_shopping'
            })

        return {
            'offers': offers,
            'summary': f'Found {len(offers)} offers (without AI analysis)',
            'total_offers': len(offers),
            'powered_by': 'oxylabs (no AI)'
        }

    @staticmethod
    def _normalize_price(price_str):
        """
        Normalize price string to float

        Args:
            price_str: Price as string (e.g., "$15.50", "15,50 MXN")

        Returns:
            float or None: Normalized price
        """
        if not price_str:
            return None

        try:
            # Remove currency symbols and extra characters
            cleaned = re.sub(r'[^\d.,]', '', str(price_str))
            # Remove thousands separator (comma)
            cleaned = cleaned.replace(',', '')
            return float(cleaned)
        except (ValueError, TypeError):
            return None
