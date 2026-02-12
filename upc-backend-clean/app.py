"""
UPC Backend v5.0 - Railway Deployment
Flask application for price checking with Oxylabs and Gemini
Optimized for Railway healthchecks with lazy loading
"""
from flask import Flask, request, jsonify
from flask_cors import CORS
import re
from logger_config import setup_logger
from health import get_health_status
from config import Config

# ===================== Setup =====================
app = Flask(__name__)
CORS(app)  # Enable CORS for Chrome Extension
logger = setup_logger(__name__)

# ===================== Lazy Loading de Servicios =====================
_gemini_service = None
_oxylabs_service = None


def get_gemini_service():
    """
    Lazy load Gemini service
    Solo se importa y carga al primer uso (no en startup)
    """
    global _gemini_service
    if _gemini_service is None:
        from services.gemini_service import GeminiService
        _gemini_service = GeminiService()
    return _gemini_service


def get_oxylabs_service():
    """
    Lazy load Oxylabs service
    Solo se importa y carga al primer uso (no en startup)
    """
    global _oxylabs_service
    if _oxylabs_service is None:
        from services.oxylabs_service import OxylabsService
        _oxylabs_service = OxylabsService()
    return _oxylabs_service


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
        }
    }

    return jsonify({
        'status': 'ok',
        'version': Config.VERSION,
        'environment': config_info,
        'services': services_info,
        'platform': Config.PLATFORM
    }), 200


@app.route('/check_price', methods=['POST', 'OPTIONS'])
@app.route('/api/check_price', methods=['POST', 'OPTIONS'])
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

        # Validate input
        if not query and not upc:
            return jsonify({'error': 'query or upc required'}), 400

        # Build search query
        if upc:
            search_query = f"{query} UPC {upc}" if query else f"UPC {upc}"
        else:
            search_query = query

        logger.info(f"🔎 Processing: {search_query} (type: {search_type})")

        # Search with Oxylabs (lazy loads service on first use)
        if search_type == 'shopping':
            oxylabs = get_oxylabs_service()
            oxylabs_data = oxylabs.search_shopping(search_query)
        else:
            return jsonify({'error': 'Only shopping search supported'}), 400

        # Check for Oxylabs errors
        if 'error' in oxylabs_data and oxylabs_data['error']:
            return jsonify({
                'error': oxylabs_data['error'],
                'offers': [],
                'total_offers': 0
            }), 500

        results = oxylabs_data.get('results', [])

        if not results:
            return jsonify({
                'offers': [],
                'summary': 'No results found',
                'total_offers': 0,
                'powered_by': 'oxylabs'
            }), 200

        # Analyze with Gemini (lazy loads service on first use)
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
