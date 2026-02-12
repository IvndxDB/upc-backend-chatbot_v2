"""
Logger Configuration for Railway
Structured logging for easy debugging in Railway dashboard
"""
import logging
import sys


def setup_logger(name):
    """
    Setup structured logger for Railway

    Args:
        name: Logger name (typically __name__ from calling module)

    Returns:
        logging.Logger: Configured logger instance

    Format:
        [2026-02-12 10:30:15] INFO [module] Message
    """
    logger = logging.getLogger(name)
    logger.setLevel(logging.INFO)

    # Evitar múltiples handlers si se llama varias veces
    if logger.handlers:
        return logger

    # Handler para stdout (Railway captura esto)
    handler = logging.StreamHandler(sys.stdout)
    handler.setLevel(logging.INFO)

    # Formato estructurado
    formatter = logging.Formatter(
        '[%(asctime)s] %(levelname)s [%(name)s] %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S'
    )
    handler.setFormatter(formatter)

    logger.addHandler(handler)
    return logger
