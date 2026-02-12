# DataBunker Price Checker - Chrome Extension

Extension de Chrome para buscar precios de productos en tiempo real usando IA.

## Caracteristicas

- **Escaneo de pagina**: Extrae automaticamente informacion del producto de la pagina que estas visitando
- **Captura de pantalla**: Analiza screenshots con IA para identificar productos
- **Busqueda manual**: Pega el nombre del producto para buscarlo
- **Multiples fuentes de precios**: Busca en paralelo usando Gemini, Oxylabs y Perplexity
- **Base de datos DataBunker**: Busca UPCs en la base de datos historica de S3

## Instalacion

### 1. Instalar la extension en Chrome

1. Abre Chrome y ve a `chrome://extensions/`
2. Activa "Modo de desarrollador" (esquina superior derecha)
3. Click en "Cargar extension sin empaquetar"
4. Selecciona la carpeta `chrome-extension`

### 2. Generar iconos

1. Abre el archivo `icons/create-icons.html` en Chrome
2. Descarga cada icono haciendo click en los botones
3. Guarda los iconos en la carpeta `icons/`

### 3. Configurar el backend

1. Instala las dependencias:

```bash
cd backend
pip install -r requirements.txt
```

2. Configura las variables de entorno (crea un archivo `.env`):

```env
# Anthropic (Claude) - Requerido
ANTHROPIC_API_KEY=tu_api_key

# Gemini - Opcional pero recomendado
GEMINI_API_KEY=tu_api_key

# Perplexity - Opcional
PERPLEXITY_API_KEY=tu_api_key

# Oxylabs - Opcional
OXYLABS_USERNAME=tu_username
OXYLABS_PASSWORD=tu_password

# AWS (para base de datos DataBunker)
AWS_ACCESS_KEY_ID=tu_access_key
AWS_SECRET_ACCESS_KEY=tu_secret_key
AWS_REGION=us-east-2
```

3. Inicia el servidor:

```bash
python price-checker-api.py
```

El servidor estara disponible en `http://localhost:5000`

## Uso

1. Haz click en el icono de DataBunker Price Checker en la barra de Chrome
2. Opciones:
   - **Escanear Pagina**: Si estas en una pagina de producto, extrae automaticamente la informacion
   - **Capturar Pantalla**: Toma un screenshot y lo analiza con IA
   - **Escribir manualmente**: Pega o escribe el nombre del producto

3. La extension buscara:
   - El UPC en la base de datos DataBunker
   - Precios actuales en Amazon, Walmart, Mercado Libre, farmacias, etc.

4. Los resultados se muestran organizados por fuente (Gemini, Oxylabs, Perplexity)

## Estructura del proyecto

```
chrome-extension/
├── manifest.json          # Configuracion de la extension
├── popup/
│   ├── popup.html        # UI del popup
│   ├── popup.css         # Estilos
│   └── popup.js          # Logica del popup
├── background/
│   └── background.js     # Service worker
├── content/
│   ├── content.js        # Script de contenido (scraping)
│   └── content.css       # Estilos inyectados
├── utils/
│   └── api.js            # Cliente API
└── icons/
    ├── icon16.png
    ├── icon32.png
    ├── icon48.png
    └── icon128.png

backend/
├── price-checker-api.py  # API principal
└── requirements.txt      # Dependencias Python
```

## Configuracion

Haz click en el icono de configuracion en el popup para:

- Cambiar la URL del backend
- Activar/desactivar fuentes de precios (Gemini, Oxylabs, Perplexity)

## APIs utilizadas

1. **Claude (Anthropic)**: Analisis de imagenes, identificacion de productos, busqueda web
2. **Gemini (Google)**: Busqueda de precios con grounding
3. **Oxylabs**: Web scraping de tiendas (Amazon, Walmart)
4. **Perplexity**: Busqueda web en tiempo real
5. **AWS Athena**: Consultas a base de datos DataBunker

## Notas de seguridad

- Las API keys se almacenan en el backend, no en la extension
- El backend usa HTTPS en produccion
- Las consultas SQL estan validadas y limitadas
