"""
UPC Backend v5.0 - Railway Deployment
Flask application for price checking with Oxylabs and Gemini
Optimized for Railway healthchecks with lazy loading
Upc o descricion
"""
from flask import Flask, request, jsonify
from flask_cors import CORS
from functools import wraps
import re
from logger_config import setup_logger
from health import get_health_status
from config import Config


def require_api_key(f):
    """Decorator that validates X-API-Key header on protected endpoints"""
    @wraps(f)
    def decorated(*args, **kwargs):
        # Allow CORS preflight through without key
        if request.method == 'OPTIONS':
            return f(*args, **kwargs)
        # Dev mode: no validation if API_KEYS not configured
        if not Config.API_KEY_REQUIRED:
            return f(*args, **kwargs)
        key = request.headers.get('X-API-Key', '')
        if not key or key not in Config.API_KEYS:
            return jsonify({'error': 'API key inválida o faltante'}), 401
        return f(*args, **kwargs)
    return decorated

# ===================== Setup =====================
app = Flask(__name__)
CORS(app)  # Enable CORS for Chrome Extension
logger = setup_logger(__name__)

# ===================== Lazy Loading de Servicios =====================
_gemini_service = None
_oxylabs_service = None
_serpapi_service = None


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


def get_serpapi_service():
    global _serpapi_service
    if _serpapi_service is None:
        from services.serpapi_service import SerpAPIService
        _serpapi_service = SerpAPIService()
    return _serpapi_service


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
        "oxylabs": {
            "configured": bool(Config.OXYLABS_USERNAME and Config.OXYLABS_PASSWORD),
            "loaded": _oxylabs_service is not None
        },
        "serpapi": {
            "configured": bool(Config.SERPAPI_KEY),
            "loaded": _serpapi_service is not None,
            "key_chars": len(Config.SERPAPI_KEY) if Config.SERPAPI_KEY else 0
        }
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
@require_api_key
def check_price():
    """
    Main price checking endpoint
    Uses lazy loading for Gemini (only loads on first use)
    """
    # Handle CORS preflight
    if request.method == 'OPTIONS':
        return '', 204

    try:
        data = request.get_json()

        if not data:
            return jsonify({'error': 'No data provided'}), 400

        query = data.get('query', '').strip()
        upc = _clean_upc(data.get('upc', ''))
        search_type = data.get('search_type', 'shopping')
        domains = data.get('domains', None)  # NEW: optional list of domains

        # Validate input
        if not query and not upc:
            return jsonify({'error': 'query or upc required'}), 400

        # Build search query
        # When UPC is available, use it as primary search (more precise for Google)
        # Product name (query) is kept for display only
        if upc:
            search_query = f"UPC {upc}"
        else:
            search_query = query

        display = query if query else f"UPC {upc}"
        if domains:
            logger.info(f"🔎 Processing: {display} → oxylabs: {search_query} (domains: {len(domains)})")
        else:
            logger.info(f"🔎 Processing: {display} → oxylabs: {search_query}")

        # Step 1: Search with Oxylabs
        if search_type != 'shopping':
            return jsonify({'error': 'Only shopping search supported'}), 400

        oxylabs = get_oxylabs_service()
        oxylabs_data = oxylabs.search_shopping(search_query, domains=domains)

        # Hard failure (config / HTTP error)
        if 'error' in oxylabs_data and oxylabs_data['error']:
            error_msg = oxylabs_data['error']
            if 'not configured' in error_msg.lower() or 'timeout' in error_msg.lower() or 'http' in error_msg.lower():
                return jsonify({'error': error_msg, 'offers': [], 'total_offers': 0}), 500

        results = oxylabs_data.get('results', [])
        empty_domains = oxylabs_data.get('empty_domains', [])
        upc_parsed = oxylabs_data.get('upc')
        desc_parsed = oxylabs_data.get('description')

        # Step 2: SerpAPI fallback for stores Oxylabs missed
        if empty_domains:
            serpapi = get_serpapi_service()
            if serpapi.is_configured():
                logger.info(f"🔄 SerpAPI fallback for {len(empty_domains)} empty domain(s): {empty_domains}")
                serpapi_results = serpapi.search_missing_stores(upc_parsed, desc_parsed, empty_domains)
                if serpapi_results:
                    results.extend(serpapi_results)
                    logger.info(f"✅ SerpAPI added {len(serpapi_results)} result(s)")
            else:
                logger.info("ℹ️ SerpAPI not configured, skipping fallback")

        if not results:
            return jsonify({
                'offers': [],
                'summary': 'No se encontraron resultados para este producto',
                'total_offers': 0,
                'powered_by': 'oxylabs'
            }), 200

        # Step 3: Validate and structure results with Gemini
        gemini = get_gemini_service()
        analyzed = gemini.analyze_results(results, search_query)

        # Add metadata
        offers = analyzed.get('offers', [])
        if offers:
            prices = [o['price'] for o in offers if isinstance(o.get('price'), (int, float))]
            if prices:
                analyzed['price_range'] = {
                    'min': min(prices),
                    'max': max(prices)
                }
        # Set powered_by based on what was used
        if gemini.available:
            analyzed['powered_by'] = 'oxylabs + gemini'
        else:
            analyzed['powered_by'] = 'oxylabs'

        logger.info(f"✅ Returned {len(offers)} offers")
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
