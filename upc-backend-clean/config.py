"""
Configuration Module for UPC Backend
Centralizes environment variables and configuration
"""
import os


class Config:
    """Configuration class with environment variables"""

    # API Keys
    GEMINI_API_KEY = os.environ.get('GEMINI_KEY') or os.environ.get('GEMINI_API_KEY', '')
    OXYLABS_USERNAME = os.environ.get('OXYLABS_USERNAME', '')
    OXYLABS_PASSWORD = os.environ.get('OXYLABS_PASSWORD', '')

    # Server Configuration
    PORT = int(os.environ.get('PORT', 5000))
    DEBUG = os.environ.get('DEBUG', 'False').lower() == 'true'
    HOST = '0.0.0.0'

    # Timeouts (seconds)
    OXYLABS_TIMEOUT = 60
    GEMINI_TIMEOUT = 30

    # Application
    VERSION = "5.0.0"
    PLATFORM = "Railway"

    @classmethod
    def validate(cls):
        """
        Validate configuration at startup

        Returns:
            list: List of warning messages (empty if all OK)
        """
        warnings = []

        if not cls.GEMINI_API_KEY:
            warnings.append("⚠️ GEMINI_API_KEY not set - AI analysis will be disabled")

        if not cls.OXYLABS_USERNAME or not cls.OXYLABS_PASSWORD:
            warnings.append("⚠️ Oxylabs credentials not set - price search will fail")

        return warnings

    @classmethod
    def get_info(cls):
        """
        Get configuration info for debugging

        Returns:
            dict: Configuration status (without exposing secrets)
        """
        return {
            "GEMINI_API_KEY": "SET ({} chars)".format(len(cls.GEMINI_API_KEY)) if cls.GEMINI_API_KEY else "NOT SET",
            "OXYLABS_USERNAME": "SET ({} chars)".format(len(cls.OXYLABS_USERNAME)) if cls.OXYLABS_USERNAME else "NOT SET",
            "OXYLABS_PASSWORD": "SET ({} chars)".format(len(cls.OXYLABS_PASSWORD)) if cls.OXYLABS_PASSWORD else "NOT SET",
            "PORT": cls.PORT,
            "DEBUG": cls.DEBUG,
            "VERSION": cls.VERSION,
            "PLATFORM": cls.PLATFORM
        }
