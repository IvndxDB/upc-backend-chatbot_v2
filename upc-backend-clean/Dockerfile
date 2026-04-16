#git test
# UPC Backend - ECS Deployment
FROM python:3.11-slim

WORKDIR /app

# Install dependencies first (layer caching)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Environment
ENV PORT=80
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1

EXPOSE 80

CMD ["gunicorn", "app:app", \
     "--bind", "0.0.0.0:80", \
     "--workers", "2", \
     "--threads", "2", \
     "--timeout", "90", \
     "--keep-alive", "5", \
     "--access-logfile", "-", \
     "--error-logfile", "-", \
     "--log-level", "info", \
     "--preload"]