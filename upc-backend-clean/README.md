# UPC Backend v5.0 - Railway Deployment

Backend optimizado para Railway con healthchecks ultra-rápidos.

## 🚀 Features

- ✅ **Healthcheck ultra-rápido** (<100ms response time)
- ✅ **Lazy loading** de Gemini (no bloquea startup)
- ✅ **Logging estructurado** para Railway
- ✅ **Graceful degradation** (funciona sin Gemini)
- ✅ **Arquitectura modular** (health, config, services)

## 📂 Estructura

```
upc-backend-clean/
├── app.py                      # Flask app principal
├── health.py                   # Healthcheck aislado
├── config.py                   # Configuración centralizada
├── logger_config.py            # Logging estructurado
├── services/
│   ├── gemini_service.py       # Gemini con lazy loading
│   └── oxylabs_service.py      # Oxylabs service
├── requirements.txt
├── Procfile
├── railway.toml
└── runtime.txt
```

## 🔧 Deployment en Railway

### 1. Crear Proyecto en Railway

1. Ve a [railway.app](https://railway.app/)
2. Login con GitHub
3. "New Project" → "Deploy from GitHub repo"
4. Selecciona tu repo

### 2. Configurar en Railway Dashboard

**Settings → General:**
- Root Directory: `upc-backend-clean`

**Settings → Variables:**
```bash
GEMINI_API_KEY=tu_gemini_api_key
OXYLABS_USERNAME=tu_username
OXYLABS_PASSWORD=tu_password
```

### 3. Deploy

Railway hará deploy automáticamente. Espera 2-3 minutos.

### 4. Verificar

```bash
# Healthcheck
curl https://tu-app.railway.app/health

# Debug
curl https://tu-app.railway.app/api/debug

# Price check
curl -X POST https://tu-app.railway.app/api/check_price \
  -H "Content-Type: application/json" \
  -d '{"query":"Coca Cola 600ml","search_type":"shopping"}'
```

## 📡 Endpoints

### `GET /health`
Healthcheck para Railway (response time <100ms)

### `GET /api/debug`
Validación de configuración y estado de servicios

### `POST /api/check_price`
Búsqueda de precios con Oxylabs + Gemini

**Request:**
```json
{
  "query": "Coca Cola 600ml",
  "upc": "7501055300000",
  "search_type": "shopping"
}
```

**Response:**
```json
{
  "offers": [
    {
      "title": "Coca Cola 600ml",
      "price": 15.50,
      "currency": "MXN",
      "seller": "Walmart",
      "link": "https://...",
      "source": "oxylabs_shopping"
    }
  ],
  "total_offers": 5,
  "price_range": {"min": 13.00, "max": 18.50},
  "powered_by": "oxylabs + gemini"
}
```

## 🧪 Testing Local

```bash
# Instalar dependencias
pip install -r requirements.txt

# Configurar variables de entorno
export GEMINI_API_KEY=tu_key
export OXYLABS_USERNAME=tu_username
export OXYLABS_PASSWORD=tu_password

# Ejecutar servidor
python app.py

# Probar (en otra terminal)
curl http://localhost:5000/health
curl http://localhost:5000/api/debug
```

## 🐛 Troubleshooting

### Healthcheck Failing

**Síntoma:** Railway marca app como "Unhealthy"

**Solución:**
1. Verificar logs en Railway dashboard
2. Verificar `healthcheckPath = "/health"` en railway.toml
3. Probar healthcheck local: `curl http://localhost:5000/health`

### Oxylabs Timeout

**Síntoma:** "Oxylabs timeout after 60s" en logs

**Solución:**
1. Verificar credenciales en `/api/debug`
2. Verificar saldo de cuenta Oxylabs
3. Probar query más genérico

### Gemini Not Loading

**Síntoma:** "Gemini not available" en `/api/debug`

**Solución:**
1. Verificar GEMINI_API_KEY en Railway variables
2. App funciona sin Gemini (fallback a raw results)

## 📊 Logs en Railway

Formato estructurado:
```
[2026-02-12 10:00:01] INFO [app] 🚀 UPC Backend v5.0.0 starting...
[2026-02-12 10:00:01] INFO [config] ✅ GEMINI_API_KEY configured
[2026-02-12 10:00:05] INFO [app] GET /health - 200 OK (12ms)
[2026-02-12 10:05:10] INFO [oxylabs] 🔍 Searching: Coca Cola 600ml
[2026-02-12 10:05:15] INFO [gemini] ✅ Analyzed 5 offers
```

## 💡 Diferencias vs v4

| Aspecto | v4 | v5 |
|---------|----|----|
| Healthcheck time | ~300ms | <50ms |
| Startup time | ~3.8s | ~360ms |
| Gemini loading | Al inicio | Lazy load |
| Config Railway | Sin healthcheckPath | Explícito |
| Workers | 1 | 2 + threads |

## 📝 License

MIT
