# 🔍 UPC Price Finder v5

> Extensión de Chrome para buscar precios de productos en tiempo real usando Oxylabs + Gemini AI

[![Version](https://img.shields.io/badge/version-5.0.0-blue.svg)](https://github.com/yourusername/upc-price-finder)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Railway](https://img.shields.io/badge/deployed%20on-Railway-blueviolet.svg)](https://railway.app/)

---

## ✨ Features

- 🔍 **Búsqueda de precios en tiempo real** con Oxylabs Google Shopping API
- 🤖 **Análisis AI con Gemini** para estructurar y filtrar resultados
- 🖼️ **Captura de pantalla** para análisis de productos
- 📄 **Escaneo de páginas web** para extracción automática de datos
- 💬 **Interfaz chatbot** moderna y fácil de usar
- ⚡ **Backend ultra-rápido** en Railway con healthchecks optimizados

---

## 📦 Estructura del Proyecto

```
upc-price-finder_v5/
├── upc-backend-clean/        # Backend Flask optimizado para Railway
│   ├── app.py                # Aplicación principal
│   ├── health.py             # Healthcheck ultra-rápido (<50ms)
│   ├── services/             # Servicios modulares (Oxylabs, Gemini)
│   └── ...                   # Configuración Railway
│
├── upc-extension-react/      # Extensión de Chrome
│   ├── manifest.json         # Manifest v3
│   ├── popup/                # UI chatbot
│   ├── utils/                # API client
│   ├── background/           # Service worker
│   └── content/              # Content scripts
│
├── CLAUDE.md                 # Documentación técnica completa
└── README.md                 # Este archivo
```

---

## 🚀 Quick Start

### Backend (Railway)

1. **Crear proyecto en Railway**
   ```bash
   # Ve a https://railway.app/ y conecta tu repo
   ```

2. **Configurar variables de entorno**
   ```bash
   GEMINI_API_KEY=tu_gemini_api_key
   OXYLABS_USERNAME=tu_oxylabs_username
   OXYLABS_PASSWORD=tu_oxylabs_password
   ```

3. **Configurar Root Directory**
   ```
   Railway → Settings → General → Root Directory: upc-backend-clean
   ```

4. **Deploy**
   ```
   Railway hará deploy automáticamente
   Obtén tu URL: https://tu-app.up.railway.app
   ```

5. **Verificar**
   ```bash
   curl https://tu-app.up.railway.app/health
   curl https://tu-app.up.railway.app/api/debug
   ```

### Frontend (Chrome Extension)

1. **Actualizar URL del backend**
   ```javascript
   // upc-extension-react/utils/api.js (línea 7)
   const DEFAULT_BACKEND_URL = 'https://tu-app.up.railway.app';

   // upc-extension-react/background/background.js (línea 10)
   const DEFAULT_BACKEND_URL = 'https://tu-app.up.railway.app';
   ```

2. **Instalar extensión**
   ```
   1. Chrome → chrome://extensions/
   2. Enable "Developer mode"
   3. Click "Load unpacked"
   4. Seleccionar carpeta: upc-extension-react/
   ```

3. **Probar**
   ```
   1. Abrir popup
   2. Escribir "Coca Cola 600ml"
   3. Ver resultados de precios
   ```

---

## 📡 API Endpoints

### `GET /health`
Healthcheck para Railway (response time <100ms)

**Response:**
```json
{
  "status": "healthy",
  "version": "5.0.0",
  "timestamp": 1707748800
}
```

### `GET /api/debug`
Validación de configuración y estado de servicios

**Response:**
```json
{
  "status": "ok",
  "environment": {
    "GEMINI_API_KEY": "SET (32 chars)",
    "OXYLABS_USERNAME": "SET (12 chars)",
    "OXYLABS_PASSWORD": "SET (16 chars)"
  },
  "services": {
    "gemini": {"available": true, "loaded": false},
    "oxylabs": {"configured": true}
  }
}
```

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

---

## 🛠️ Tech Stack

### Backend
- **Framework**: Flask 3.0.1
- **Server**: Gunicorn 21.2.0
- **Deployment**: Railway
- **APIs**:
  - Oxylabs Realtime API (Google Shopping)
  - Gemini 1.5 Flash (AI analysis)

### Frontend
- **Type**: Chrome Extension (Manifest v3)
- **UI**: HTML + CSS + Vanilla JS
- **Design**: Chatbot interface
- **Colors**: #073C5C, #30A7B5

---

## 📊 Diferencias vs v4

| Aspecto | v4 | v5 | Mejora |
|---------|----|----|--------|
| Healthcheck time | ~300ms | <50ms | ✅ 6x más rápido |
| Startup time | ~3.8s | ~360ms | ✅ 10x más rápido |
| Gemini loading | Al inicio | Lazy load | ✅ No bloquea startup |
| Config Railway | Sin healthcheckPath | Explícito | ✅ Railway sabe dónde buscar |
| Logging | print() | Estructurado | ✅ Debugging fácil |
| Workers | 1 | 2 + threads | ✅ Mejor throughput |

**Problema resuelto de v4**: Backend no pasaba healthchecks en Railway

**Solución en v5**:
- ✅ Healthcheck ultra-rápido (<50ms) en módulo separado
- ✅ Lazy loading de Gemini (no bloquea startup)
- ✅ Configuración Railway explícita con `healthcheckPath`
- ✅ Logging estructurado para debugging

---

## 🧪 Testing Local

### Backend
```bash
cd upc-backend-clean

# Instalar dependencias
pip install -r requirements.txt

# Configurar env vars
export GEMINI_API_KEY=tu_key
export OXYLABS_USERNAME=tu_username
export OXYLABS_PASSWORD=tu_password

# Ejecutar servidor
python app.py

# Probar (en otra terminal)
curl http://localhost:5000/health
curl http://localhost:5000/api/debug
curl -X POST http://localhost:5000/api/check_price \
  -H "Content-Type: application/json" \
  -d '{"query":"Coca Cola 600ml","search_type":"shopping"}'
```

### Frontend
```
1. Actualizar URL en api.js y background.js a http://localhost:5000
2. Chrome → Extensions → Load unpacked → upc-extension-react/
3. Abrir popup
4. Probar búsqueda
```

---

## 🐛 Troubleshooting

### Healthcheck Failing en Railway
**Solución**: Verificar que `healthcheckPath = "/health"` está en railway.toml

### Oxylabs Timeout
**Solución**: Verificar credenciales en `/api/debug` y saldo en Oxylabs

### Gemini Not Available
**Solución**: Verificar GEMINI_API_KEY en Railway variables
(Nota: App funciona sin Gemini con fallback a raw results)

### CORS Errors
**Solución**: Verificar que flask-cors está instalado y CORS(app) en app.py

---

## 📚 Documentación

- [CLAUDE.md](CLAUDE.md) - Documentación técnica completa
- [Backend README](upc-backend-clean/README.md) - Guía de deployment Railway
- [Extension README](upc-extension-react/README.md) - Guía de instalación

---

## 💰 Costos Estimados

| Servicio | Plan | Costo Mensual |
|----------|------|---------------|
| Railway | Starter | ~$5-10/mes |
| Oxylabs | Pay-as-you-go | ~$50-100/mes (según uso) |
| Gemini | Free | $0 (60 req/min gratis) |
| **Total** | | **~$55-110/mes** |

---

## 🔮 Roadmap

### v5.1 (Próximo)
- [ ] Caché de resultados (Redis)
- [ ] Rate limiting
- [ ] Custom domain en Railway

### v5.2 (Futuro)
- [ ] Histórico de precios
- [ ] Alertas de precio
- [ ] Multi-país (USA, España)

### v6.0 (Largo plazo)
- [ ] Publicación en Chrome Web Store
- [ ] API pública
- [ ] Plan premium

---

## 🤝 Contribuir

Contributions are welcome! Por favor:

1. Fork el repositorio
2. Crear una rama (`git checkout -b feature/amazing-feature`)
3. Commit cambios (`git commit -m 'Add amazing feature'`)
4. Push a la rama (`git push origin feature/amazing-feature`)
5. Abrir Pull Request

---

## 📝 License

MIT License - ver [LICENSE](LICENSE) para detalles

---

## 👨‍💻 Desarrollado con

- Claude Code (Anthropic Sonnet 4.5)
- Ivan Minauro

---

## 📞 Contacto

Ivan Minauro - [@IvanMinauro](https://twitter.com/IvanMinauro)

Project Link: [https://github.com/yourusername/upc-price-finder](https://github.com/yourusername/upc-price-finder)

---

**⭐ Si este proyecto te fue útil, considera darle una estrella!**

---

**Última actualización**: Febrero 12, 2026
