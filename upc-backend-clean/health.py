"""
Health Check Module for Railway
Ultra-fast healthcheck without heavy imports
"""
import time


def get_health_status():
    """
    Healthcheck instantáneo sin dependencias pesadas

    Returns:
        dict: Health status with version and timestamp

    Response time objetivo: <50ms
    """
    return {
        "status": "healthy",
        "version": "5.0.0",
        "timestamp": int(time.time())
    }
