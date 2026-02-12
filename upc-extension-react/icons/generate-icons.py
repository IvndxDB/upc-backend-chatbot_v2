"""
Script para generar los iconos de la extension DataBunker Price Checker
Ejecutar: python generate-icons.py
"""

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    print("Instalando Pillow...")
    import subprocess
    subprocess.check_call(['pip', 'install', 'Pillow'])
    from PIL import Image, ImageDraw, ImageFont

import os

def create_gradient(size, color1, color2):
    """Crea un gradiente diagonal"""
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    for i in range(size):
        for j in range(size):
            # Calcular progreso del gradiente (diagonal)
            t = (i + j) / (2 * size)

            r = int(color1[0] + (color2[0] - color1[0]) * t)
            g = int(color1[1] + (color2[1] - color1[1]) * t)
            b = int(color1[2] + (color2[2] - color1[2]) * t)

            draw.point((i, j), fill=(r, g, b, 255))

    return img

def create_rounded_rect_mask(size, radius):
    """Crea una mascara con esquinas redondeadas"""
    mask = Image.new('L', (size, size), 0)
    draw = ImageDraw.Draw(mask)

    draw.rounded_rectangle([(0, 0), (size-1, size-1)], radius=radius, fill=255)

    return mask

def create_icon(size):
    """Crea un icono del tamano especificado"""

    # Colores del gradiente (purpura/azul)
    color1 = (102, 126, 234)  # #667eea
    color2 = (118, 75, 162)   # #764ba2

    # Crear gradiente
    img = create_gradient(size, color1, color2)

    # Aplicar esquinas redondeadas
    radius = int(size * 0.2)
    mask = create_rounded_rect_mask(size, radius)

    # Crear imagen final con transparencia
    final = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    final.paste(img, (0, 0), mask)

    # Dibujar el simbolo de dolar
    draw = ImageDraw.Draw(final)

    # Calcular tamano de la fuente
    font_size = int(size * 0.5)

    try:
        font = ImageFont.truetype("arial.ttf", font_size)
    except:
        try:
            font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", font_size)
        except:
            font = ImageFont.load_default()

    # Centrar el simbolo de dolar
    text = "$"
    bbox = draw.textbbox((0, 0), text, font=font)
    text_width = bbox[2] - bbox[0]
    text_height = bbox[3] - bbox[1]

    x = (size - text_width) // 2
    y = (size - text_height) // 2 - bbox[1]

    draw.text((x, y), text, fill=(255, 255, 255, 255), font=font)

    # Para iconos mas grandes, agregar lupa pequena
    if size >= 32:
        mg_size = int(size * 0.2)
        mg_x = size - mg_size - int(size * 0.1)
        mg_y = size - mg_size - int(size * 0.1)

        # Circulo de la lupa
        draw.ellipse(
            [mg_x - mg_size//2, mg_y - mg_size//2, mg_x + mg_size//2, mg_y + mg_size//2],
            outline=(255, 255, 255, 255),
            width=max(1, size // 16)
        )

        # Mango de la lupa
        draw.line(
            [mg_x + mg_size//3, mg_y + mg_size//3, mg_x + mg_size//2 + 2, mg_y + mg_size//2 + 2],
            fill=(255, 255, 255, 255),
            width=max(1, size // 16)
        )

    return final

def main():
    # Obtener directorio actual
    script_dir = os.path.dirname(os.path.abspath(__file__))

    sizes = [16, 32, 48, 128]

    for size in sizes:
        icon = create_icon(size)
        filename = os.path.join(script_dir, f'icon{size}.png')
        icon.save(filename, 'PNG')
        print(f"Creado: {filename}")

    print("\nIconos generados exitosamente!")

if __name__ == '__main__':
    main()
