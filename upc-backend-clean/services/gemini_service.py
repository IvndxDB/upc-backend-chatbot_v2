"""
Gemini Service with Lazy Loading
Uses google.genai (new SDK) — google.generativeai is EOL.
"""
import json
import re
from urllib.parse import urlparse
from logger_config import setup_logger
from config import Config

logger = setup_logger(__name__)

# Known Mexican retailer domains (used to filter raw results without Gemini)
KNOWN_DOMAINS = {
    # Supermarkets / general
    'walmart.com.mx', 'super.walmart.com.mx', 'amazon.com.mx', 'chedraui.com.mx',
    'soriana.com', 'soriana.com.mx', 'lacomer.com.mx',
    'heb.com.mx', 'costco.com.mx', 'bodegaaurrera.com.mx', 'samsclub.com.mx',
    'yza.mx',
    # Pharmacies
    'fahorro.com', 'farmaciasanpablo.com.mx', 'benavides.com.mx',
    'farmaciasguadalajara.com', 'farmaciasguadalajara.com.mx',
    'prixz.com', 'farmaciaalicia.com.mx',
    'farmaciasespecializadas.com', 'farmaciacoyoacan.com',
    # Beauty / specialty
    'sephora.com.mx', 'dermaexpress.com.mx',
    # Other retailers
    'liverpool.com.mx', 'mercadolibre.com.mx', 'sanborns.com.mx',
    'coppel.com', 'elektra.com.mx',
}


def _url_domain(url):
    """Extract bare domain from URL, e.g. 'www.walmart.com.mx' → 'walmart.com.mx'"""
    try:
        return urlparse(url).netloc.lower().replace('www.', '')
    except Exception:
        return ''


class GeminiService:

    def __init__(self):
        self.client = None
        self.available = False
        self.loaded = False
        self._model_name = None

    def _initialize(self):
        if self.loaded:
            return
        self.loaded = True

        try:
            from google import genai

            if not Config.GEMINI_API_KEY:
                logger.warning("⚠️ Gemini API key not configured")
                return

            self.client = genai.Client(api_key=Config.GEMINI_API_KEY)

            self._model_candidates = [
                'gemini-2.5-flash',
                'gemini-2.5-flash-lite',
                'gemini-2.0-flash-lite',
                'gemini-1.5-flash',
            ]
            self._model_name = self._model_candidates[0]
            self.available = True
            logger.info(f"✅ Gemini ready, primary model: {self._model_name}")

        except ImportError:
            logger.error("❌ google-genai not installed")
            self.available = False
        except Exception as e:
            logger.error(f"❌ Gemini initialization failed: {e}")
            self.available = False
            
    def analyze_results(self, results, query):
        if not self.loaded:
            self._initialize()

        if not self.available:
            logger.warning("⚠️ Gemini not available, returning raw results")
            return self._format_raw_results(results)

        try:
            sources = {r.get('_source') for r in results}
            all_zyte   = sources == {'zyte'}
            all_organic = sources <= {'oxylabs_organic', None}

            if all_zyte:
                validation_rules = """═══ REGLAS DE VALIDACIÓN ═══
1. PRODUCTO CORRECTO: Los URLs vienen de un diccionario curado, confía en que son el producto.
   Descarta SOLO si el nombre extraído es completamente diferente al buscado (otro producto distinto).
2. TIPO DE SITIO: Descarta páginas de búsqueda/catálogo, PDFs, sellercentral. Solo páginas de producto.
3. MEDICAMENTOS CON DOSIS: Si el producto tiene mg/ml específicos (ej. Mounjaro 2.5mg), la dosis debe coincidir. Descarta variantes de dosis diferente o marcas genéricas no autorizadas.
4. PRECIO: Si "price" existe úsalo. Si es null y source es "zyte" → incluye con price: null (agotado). Copia "regular_price" si es distinto de "price"."""
            elif all_organic:
                validation_rules = """═══ REGLAS DE VALIDACIÓN (BÚSQUEDA WEB POR UPC) ═══
1. PRODUCTO CORRECTO: Se buscó por UPC en Google, los resultados son páginas de tiendas mexicanas.
   Descarta SOLO si el título indica claramente un producto distinto.
2. TIPO DE SITIO: Acepta solo páginas de producto de tiendas mexicanas. Descarta blogs, noticias, PDFs, sellercentral.
3. PRECIO: Los resultados de google_search no traen precio — pon price: null. El usuario verá el link directo.
4. TIENDAS: Extrae el nombre de la tienda del dominio (ej. walmart.com.mx → "Walmart")."""
            else:
                validation_rules = """═══ REGLAS DE VALIDACIÓN (ESTRICTAS) ═══
1. MARCA Y SUSTANCIA: Descarta marcas genéricas desconocidas, "fórmulas avanzadas" o "kits de apoyo" cuando el buscado es de patente. Solo acepta la marca original o genéricos con nombre de sustancia claro.
2. DOSIS EXACTA: El gramaje (mg) y volumen (ml) deben coincidir al 100%. Si buscas 2.5mg y el resultado dice 5mg → DESCARTA.
3. TIPO DE SITIO: Descarta blogs, noticias, PDFs, facturación, sellercentral. Solo páginas de producto final.
4. NO SUPLEMENTOS: Si el resultado es un suplemento/vitamina pero el buscado es un medicamento → DESCARTA.
5. PRECIO: Para "oxylabs_shopping" o "serpapi", omite resultados sin precio real. Copia "regular_price" si es distinto de "price"."""

            prompt = f"""Eres un validador de precios de productos para el mercado mexicano.

PRODUCTO BUSCADO: "{query}"

DATOS:
{json.dumps(self._slim_for_prompt(results[:20]), indent=2, ensure_ascii=False)}

{validation_rules}

═══ INSTRUCCIONES DE SALIDA ═══
- Deduplica: 1 oferta por tienda.
- Si no hay ningún resultado válido, "offers" debe ser [].
- Retorna SOLO este JSON sin texto adicional:
{{
  "offers": [
    {{
      "title": "Nombre completo",
      "price": 0.00,
      "regular_price": null,
      "currency": "MXN",
      "seller": "Nombre de la tienda",
      "link": "URL",
      "image": "URL o null",
      "source": "zyte, oxylabs_shopping, oxylabs_organic o serpapi (mismo que el input)"
    }}
  ],
  "summary": "Explicación breve",
  "total_offers": 0
}}"""

            logger.info("🤖 Analyzing with Gemini...")

            response = self._generate_with_fallback(prompt)
            result_text = response.text.strip()

            if result_text.startswith('```'):
                result_text = re.sub(r'^```(?:json)?\n|```$', '', result_text, flags=re.MULTILINE)

            parsed = json.loads(result_text)
            logger.info(f"✅ Gemini analyzed {len(parsed.get('offers', []))} offers")
            return parsed

        except json.JSONDecodeError as e:
            logger.error(f"❌ Gemini returned invalid JSON: {e}")
            return self._format_raw_results(results)
        except Exception as e:
            logger.error(f"❌ Gemini analysis error: {e}")
            return self._format_raw_results(results)

    def _generate_with_fallback(self, prompt, **kwargs):
        """Try each model candidate until one works (handles deprecated models)."""
        candidates = getattr(self, '_model_candidates', [self._model_name])
        last_error = None
        for model in candidates:
            try:
                response = self.client.models.generate_content(
                    model=model, contents=prompt, **kwargs
                )
                if model != self._model_name:
                    logger.info(f"🔄 Switched to model: {model}")
                    self._model_name = model
                return response
            except Exception as e:
                err_str = str(e)
                if 'NOT_FOUND' in err_str or 'no longer available' in err_str or '404' in err_str:
                    logger.warning(f"⚠️ Model {model} deprecated, trying next")
                    last_error = e
                    continue
                raise  # re-raise non-deprecation errors immediately
        raise last_error

    def search_missing_prices(self, product_query, missing_stores):
        """
        Third-pass: Gemini with Google Search grounding for stores still missing prices.
        Uses google.genai grounding tool (Gemini 2.0).
        """
        if not self.loaded:
            self._initialize()
        if not self.available or not self._model_name:
            return []

        offers = []

        for store_name, domain in missing_stores[:4]:
            try:
                from google.genai import types

                config = types.GenerateContentConfig(
                    tools=[types.Tool(google_search=types.GoogleSearch())]
                )

                prompt = (
                    f'Busca el precio actual de "{product_query}" en {store_name} México ({domain}). '
                    f'El producto debe coincidir EXACTAMENTE — no incluyas variantes distintas. '
                    f'Responde SOLO con este JSON sin texto adicional: '
                    f'{{"title":"nombre exacto","price":100.00,"url":"URL directa al producto"}} '
                    f'o {{"price":null,"url":null,"title":null}} si no lo encuentras o no coincide.'
                )

                response = self._generate_with_fallback(prompt, config=config)
                text = response.text.strip()
                if text.startswith('```'):
                    text = re.sub(r'^```(?:json)?\n|```$', '', text, flags=re.MULTILINE)

                parsed = json.loads(text)
                price = parsed.get('price')
                url = parsed.get('url', '') or ''

                if price and url.startswith('http') and domain in url.lower():
                    offers.append({
                        'title': parsed.get('title', product_query),
                        'price': float(price),
                        'currency': 'MXN',
                        'seller': store_name.capitalize(),
                        'link': url,
                        'image': None,
                        'source': 'gemini_search',
                    })
                    logger.info(f"✅ Gemini 3rd search {store_name}: ${price}")
                else:
                    logger.info(f"ℹ️ Gemini 3rd search: {domain} no encontrado")

            except Exception as e:
                logger.warning(f"⚠️ Gemini grounding {domain}: {e}")

        return offers

    @staticmethod
    def _slim_for_prompt(results):
        """Keep only fields Gemini needs — strips long snippet/desc fields that inflate the prompt."""
        keep = {'url', 'title', 'price', 'regular_price', '_source', '_seller', '_domain', 'currency', 'thumb'}
        return [{k: v for k, v in r.items() if k in keep and v not in (None, '', [])} for r in results]

    def _format_raw_results(self, results):
        """Fallback formatter when Gemini is unavailable or rate-limited."""
        offers = []
        seen_domains = set()

        for item in results[:15]:
            if not isinstance(item, dict):
                continue

            link = item.get('url', '') or item.get('link', '') or item.get('product_url', '')
            if not link or not link.startswith('http'):
                continue

            link_lower = link.lower()

            # Filter documents, Seller Central, and known junk patterns
            if (link_lower.endswith('.pdf')
                    or '/pnt/' in link_lower
                    or '/facturas/' in link_lower
                    or '/tyc/' in link_lower
                    or '/terminos' in link_lower
                    or 'sellercentral.amazon' in link_lower
                    or 'sell.amazon' in link_lower):
                logger.info(f"⚠️ Skipping filtered URL: {link[:60]}")
                continue

            domain = _url_domain(link)

            # Skip homepages (path is empty or just '/')
            parsed_url = urlparse(link)
            if not parsed_url.path or parsed_url.path in ('', '/'):
                logger.info(f"⚠️ Skipping homepage: {link[:60]}")
                continue

            # Deduplicate by domain (one result per store)
            if domain in seen_domains:
                logger.info(f"⚠️ Skipping duplicate domain: {domain}")
                continue

            raw_price = item.get('price', '')
            price = self._normalize_price(raw_price)
            has_price = bool(price)
            source     = item.get('_source', '')
            is_zyte    = source == 'zyte'
            is_organic = source == 'oxylabs_organic'

            # Organic (whole-web UPC search): skip KNOWN_DOMAINS check — any valid store is welcome
            if not is_organic and domain not in KNOWN_DOMAINS:
                logger.info(f"⚠️ Skipping unknown domain: {domain}")
                continue

            # Skip no-price results from shopping — product page wasn't found
            # Allow no-price for zyte (agotado) and organic (price visible on site)
            if not has_price and not is_zyte and not is_organic:
                logger.info(f"⚠️ No price for {domain} (shopping) - skipping")
                continue

            seen_domains.add(domain)
            seller = item.get('_seller') or domain.split('.')[0].capitalize()
            logger.info(f"✅ Added offer from {seller}: {'$' + str(price) if has_price else 'agotado (Zyte)'} - {link[:60]}...")

            image = item.get('thumb') or item.get('image') or item.get('thumbnail') or None

            # Carry through discount pricing from Zyte
            raw_regular = item.get('regular_price')
            regular_price = self._normalize_price(raw_regular) if raw_regular else None

            offers.append({
                'title': item.get('title', 'Unknown Product'),
                'price': price if has_price else None,
                'regular_price': regular_price,
                'currency': 'MXN',
                'seller': seller,
                'link': link,
                'image': image,
                'source': item.get('_source', 'oxylabs_shopping'),
                'estimated': not has_price,
            })

        return {
            'offers': offers,
            'summary': f'Found {len(offers)} offers from Mexican stores (without AI analysis)',
            'total_offers': len(offers),
            'powered_by': 'oxylabs (no AI)',
        }

    @staticmethod
    def _normalize_price(price_str):
        if not price_str:
            return None
        try:
            cleaned = re.sub(r'[^\d.,]', '', str(price_str))
            cleaned = cleaned.replace(',', '')
            return float(cleaned)
        except (ValueError, TypeError):
            return None
