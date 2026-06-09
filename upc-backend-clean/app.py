"""
UPC Backend v5.0 - Railway Deployment
Flask application for price checking with Oxylabs and Gemini
Optimized for Railway healthchecks with lazy loading
Upc o descricion
"""
from flask import Flask, request, jsonify
from flask_cors import CORS
from functools import wraps, lru_cache
import re
import jwt
from jwt import PyJWKClient
from logger_config import setup_logger
from health import get_health_status
from config import Config


@lru_cache(maxsize=1)
def _get_jwks_client():
    url = (f'https://cognito-idp.{Config.COGNITO_REGION}.amazonaws.com'
           f'/{Config.COGNITO_USER_POOL_ID}/.well-known/jwks.json')
    return PyJWKClient(url, cache_keys=True)


def _validate_cognito_token(token):
    try:
        client = _get_jwks_client()
        signing_key = client.get_signing_key_from_jwt(token)
        payload = jwt.decode(
            token,
            signing_key.key,
            algorithms=['RS256'],
            audience=Config.COGNITO_CLIENT_ID,
            issuer=(f'https://cognito-idp.{Config.COGNITO_REGION}.amazonaws.com'
                    f'/{Config.COGNITO_USER_POOL_ID}'),
        )
        groups = payload.get('cognito:groups') or []
        if Config.COGNITO_REQUIRED_GROUP not in groups:
            return None, 'Usuario no pertenece al grupo requerido'
        return payload, None
    except jwt.ExpiredSignatureError:
        return None, 'Token expirado'
    except Exception as e:
        return None, str(e)


def require_cognito_token(f):
    """Decorator that validates the Cognito Bearer token on protected endpoints."""
    @wraps(f)
    def decorated(*args, **kwargs):
        if request.method == 'OPTIONS':
            return f(*args, **kwargs)
        if not Config.COGNITO_AUTH_ENABLED:
            return f(*args, **kwargs)
        auth = request.headers.get('Authorization', '')
        if not auth.startswith('Bearer '):
            return jsonify({'error': 'Token de autenticación requerido'}), 401
        token = auth[7:]
        payload, error = _validate_cognito_token(token)
        if payload is None:
            logger_ref = setup_logger(__name__)
            logger_ref.warning(f'⚠️ Token inválido: {error}')
            return jsonify({'error': f'No autorizado: {error}'}), 401
        return f(*args, **kwargs)
    return decorated

# ===================== Setup =====================
app = Flask(__name__)
CORS(app)  # Enable CORS for Chrome Extension
logger = setup_logger(__name__)

# ===================== Lazy Loading de Servicios =====================
_gemini_service = None
_oxylabs_service = None
_zyte_service = None


def get_gemini_service():
    global _gemini_service
    if _gemini_service is None:
        from services.gemini_service import GeminiService
        _gemini_service = GeminiService()
    return _gemini_service


def get_oxylabs_service():
    global _oxylabs_service
    if _oxylabs_service is None:
        from services.oxylabs_service import OxylabsService
        _oxylabs_service = OxylabsService()
    return _oxylabs_service


def get_zyte_service():
    global _zyte_service
    if _zyte_service is None:
        from services.zyte_service import ZyteService
        _zyte_service = ZyteService()
    return _zyte_service


# ===================== Startup Validation =====================
@app.before_request
def log_request():
    """Log incoming requests"""
    if request.endpoint not in ['health', 'api_health']:
        logger.info(f"{request.method} {request.path}")


# ===================== Routes =====================

@app.route('/health', methods=['GET'])
@app.route('/api/health', methods=['GET'])
def health():
    """
    Ultra-fast healthcheck for Railway
    Response time objetivo: <50ms
    """
    return jsonify(get_health_status()), 200


@app.route('/debug', methods=['GET'])
@app.route('/api/debug', methods=['GET'])
def debug():
    """
    Debug endpoint to check environment variables
    Validates configuration without loading heavy services
    """
    # Get basic config info
    config_info = Config.get_info()

    # Check services (without loading them if not needed)
    services_info = {
        "gemini": {
            "available": bool(Config.GEMINI_API_KEY),
            "loaded": _gemini_service is not None
        },
        "zyte": {
            "configured": bool(Config.ZYTE_API_KEY),
            "loaded": _zyte_service is not None,
            "key_chars": len(Config.ZYTE_API_KEY) if Config.ZYTE_API_KEY else 0
        },
        "oxylabs": {
            "configured": bool(Config.OXYLABS_USERNAME and Config.OXYLABS_PASSWORD),
            "loaded": _oxylabs_service is not None
        },
    }

    return jsonify({
        'status': 'ok',
        'version': Config.VERSION,
        'environment': config_info,
        'services': services_info,
        'platform': Config.PLATFORM
    }), 200


@app.route('/api/validate-key', methods=['POST'])
def validate_key():
    """
    Validate an API key without requiring authentication.
    Used by the extension to check if a key is valid before saving it.
    """
    if not Config.API_KEY_REQUIRED:
        return jsonify({'valid': True, 'mode': 'open'})
    data = request.get_json() or {}
    key = data.get('key', '')
    return jsonify({'valid': bool(key and key in Config.API_KEYS)})


@app.route('/check_price', methods=['POST', 'OPTIONS'])
@app.route('/api/check_price', methods=['POST', 'OPTIONS'])
@require_cognito_token
def check_price():
    """
    Two-path search:
      • store_urls present → Zyte (dictionary URLs) → Gemini
      • store_urls absent  → Oxylabs (manual query or whole-web) → Gemini
    """
    if request.method == 'OPTIONS':
        return '', 204

    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'No data provided'}), 400

        query      = data.get('query', '').strip()
        upc        = _clean_upc(data.get('upc', ''))
        domains    = data.get('domains', None)
        store_urls = data.get('store_urls', {})

        if not query and not upc:
            return jsonify({'error': 'query or upc required'}), 400

        display      = query if query else f"UPC {upc}"
        search_query = f"{query} {upc}".strip() if (query and upc) else (query or upc)

        logger.info(f"🔎 {display}" + (f" [{len(domains)} tiendas]" if domains else " [toda la web]"))

        results    = []
        powered_by = ''

        if store_urls:
            # ── PATH A: Zyte — direct extraction from dictionary URLs ──────────
            urls_to_extract = (
                {d: store_urls[d] for d in domains if d in store_urls}
                if domains else store_urls
            )
            if not urls_to_extract:
                logger.info("ℹ️ No dictionary URLs match selected stores")
            else:
                zyte = get_zyte_service()
                if zyte.is_configured():
                    logger.info(f"🔵 Zyte: {len(urls_to_extract)} URL(s)")
                    zyte_results, failed = zyte.extract_products(urls_to_extract)
                    results.extend(zyte_results)
                    if failed:
                        logger.info(f"⚠️ Zyte failed for: {failed}")
                else:
                    logger.warning("⚠️ Zyte not configured")
            powered_by = 'zyte'

        else:
            # ── PATH B: Oxylabs — manual search or whole-web ──────────────────
            logger.info(f"🟣 Oxylabs {'broad' if not domains else f'{len(domains)} domain(s)'}")
            oxylabs      = get_oxylabs_service()
            oxylabs_data = oxylabs.search_shopping(search_query, domains=domains)

            if oxylabs_data.get('error'):
                err = oxylabs_data['error']
                return jsonify({'error': err, 'offers': [], 'total_offers': 0}), 500

            results.extend(oxylabs_data.get('results', []))
            powered_by = 'oxylabs'

        if not results:
            return jsonify({
                'offers': [],
                'summary': 'No se encontraron resultados para este producto',
                'total_offers': 0,
                'powered_by': powered_by,
            }), 200

        # ── Gemini — validate and clean results ───────────────────────────────
        gemini   = get_gemini_service()
        analyzed = gemini.analyze_results(results, display)
        offers   = analyzed.get('offers', [])

        if offers:
            prices = [o['price'] for o in offers if isinstance(o.get('price'), (int, float))]
            if prices:
                analyzed['price_range'] = {'min': min(prices), 'max': max(prices)}

        analyzed['powered_by'] = f"{powered_by} + gemini" if gemini.available else powered_by

        logger.info(f"✅ Returned {len(offers)} offers ({analyzed['powered_by']})")
        for o in offers:
            price_str = f"${o['price']}" if o.get('price') is not None else "sin precio"
            reg_str   = f" (regular ${o['regular_price']})" if o.get('regular_price') else ""
            logger.info(f"   [{o.get('source','?')}] {o.get('seller','?')} — {price_str}{reg_str} — {o.get('link','')[:60]}")
        return jsonify(analyzed), 200

    except Exception as e:
        logger.error(f"❌ Error: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


# ===================== Helper Functions =====================

def _clean_upc(s):
    """Clean UPC by removing non-numeric characters"""
    return re.sub(r"\D+", "", s or "")


# ===================== Startup =====================

if __name__ == '__main__':
    # Log startup
    logger.info(f"🚀 UPC Backend v{Config.VERSION} starting...")

    # Validate configuration (but don't fail if warnings)
    warnings = Config.validate()
    for warning in warnings:
        logger.warning(warning)

    # Log configuration
    logger.info(f"✅ GEMINI_API_KEY: {'configured' if Config.GEMINI_API_KEY else 'NOT SET'}")
    logger.info(f"✅ OXYLABS credentials: {'configured' if Config.OXYLABS_USERNAME and Config.OXYLABS_PASSWORD else 'NOT SET'}")

    # Run server
    logger.info(f"🌐 Starting server on {Config.HOST}:{Config.PORT}")
    app.run(
        host=Config.HOST,
        port=Config.PORT,
        debug=Config.DEBUG
    )
