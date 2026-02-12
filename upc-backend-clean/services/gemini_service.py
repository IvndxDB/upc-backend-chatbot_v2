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

            # Try multiple model names in order of preference
            model_names = [
                'gemini-1.5-pro',
                'gemini-1.5-flash',
                'gemini-pro',
                'models/gemini-1.5-pro',
                'models/gemini-1.5-flash',
                'models/gemini-pro'
            ]

            for model_name in model_names:
                try:
                    logger.info(f"🤖 Trying Gemini model: {model_name}")
                    self.model = genai.GenerativeModel(model_name)
                    # Test with a simple prompt to verify it works
                    test_response = self.model.generate_content("Say 'OK'")
                    logger.info(f"✅ Gemini initialized successfully with model: {model_name}")
                    self.available = True
                    return
                except Exception as model_error:
                    logger.warning(f"⚠️ Model {model_name} failed: {str(model_error)}")
                    continue

            # If we get here, no model worked
            logger.error("❌ No Gemini model worked")
            self.available = False

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
            prompt = f"""Analiza estos resultados de Google Shopping México para "{query}".

Resultados:
{json.dumps(results[:10], indent=2, ensure_ascii=False)}

IMPORTANTE:
1. PRIORIZA tiendas mexicanas: Walmart, Soriana, Chedraui, HEB, La Comer, Bodega Aurrera, Liverpool, etc.
2. Solo incluye 1 resultado por tienda/dominio (deduplica por seller/domain)
3. Extrae: title, price (como número), currency, seller, link (URL completa del campo 'url')
4. Normaliza precios a formato numérico (ej: "127.00")
5. Verifica que los links sean válidos (no vacíos)
6. Marca el source como "oxylabs_shopping"
7. SOLO incluye resultados que tengan precio Y link válidos

Retorna SOLO JSON válido en este formato:
{{
  "offers": [
    {{
      "title": "Nombre producto",
      "price": 100.00,
      "currency": "MXN",
      "seller": "Tienda",
      "link": "URL completa",
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

        for item in results[:15]:  # Check more items
            # Validate item is a dictionary
            if not isinstance(item, dict):
                logger.warning(f"⚠️ Skipping non-dict item: {type(item)}")
                continue

            # Extract merchant/seller
            merchant = item.get('merchant', {})
            if isinstance(merchant, dict):
                seller = merchant.get('name', 'Unknown')
            elif isinstance(merchant, str):
                seller = merchant
            else:
                seller = 'Unknown'

            # Deduplicate by seller
            if seller in seen_sellers:
                continue

            # Extract price
            price = self._normalize_price(item.get('price', ''))
            if not price:
                logger.debug(f"⚠️ Skipping item with no valid price: {item.get('title', 'Unknown')}")
                continue

            # Extract link - try multiple fields
            link = item.get('url', '') or item.get('link', '') or item.get('product_url', '')
            if not link or not link.startswith('http'):
                logger.debug(f"⚠️ Skipping item with no valid link: {item.get('title', 'Unknown')}")
                continue

            seen_sellers.add(seller)

            offers.append({
                'title': item.get('title', 'Unknown Product'),
                'price': price,
                'currency': 'MXN',
                'seller': seller,
                'link': link,
                'source': 'oxylabs_shopping'
            })

        return {
            'offers': offers,
            'summary': f'Found {len(offers)} offers from Mexican stores (without AI analysis)',
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
