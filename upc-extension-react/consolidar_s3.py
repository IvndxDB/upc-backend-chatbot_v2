#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
consolidar_s3.py
----------------
Descarga los CSVs de S3 para los canales indicados, los consolida por UPC
y genera diccionario_ext.json con la estructura:

    [
        {
            "UPC":   "<codigo>",
            "Item":  "<titulo>",
            "image": "<url imagen>",
            "urls":  ["<url1>", "<url2>", ...]
        },
        ...
    ]

Reglas:
  * Para canal=walmart, si su columna UPC viene vacia o muy corta, se busca
    su 'UPC WM' en el mapa construido a partir de los demas canales
    (priorizando farmaciasSanPablo como fuente mas limpia) para obtener
    el UPC canonico. La URL de Walmart queda asociada a ese UPC.
  * Para el resto de canales, se usa la columna UPC tal cual.
  * URLs se acumulan deduplicadas. Item e image toman el primer valor no
    vacio encontrado (San Pablo se procesa antes que el resto).
  * Sin filtros: se incluyen todas las filas.

Uso (PowerShell):
    $env:AWS_PROFILE = "databunker"
    pip install boto3 pandas tqdm
    python consolidar_s3.py
    # Opciones:
    #   --output  <ruta>         Ruta del JSON de salida (por defecto el de la extension)
    #   --month   05             Mes (por defecto 05)
    #   --year    2026           Anio (por defecto 2026)
    #   --limit-files-per-channel N   Prueba rapida con N CSVs por canal
    #   --dry-run                Solo lista los archivos sin descargar
"""

from __future__ import annotations

import argparse
import io
import json
import os
import sys
from pathlib import Path
from typing import Iterable

import boto3
import pandas as pd
from botocore.config import Config
from tqdm import tqdm

# -------------------------- Configuracion -----------------------------------

BUCKET = "data-bunker-prod-env"

CHANNELS = [
    "amazon",
    "chedraui",
    "farmaciasBenavides",
    "farmaciasGDL",
    "farmaciasSanPablo",
    "farmaciasdelahorro",
    "laComer",
    "soriana",
    "walmart",
]

# Canal preferido para construir el mapa UPC_WM -> UPC canonico
PRIMARY_MAP_CHANNEL = "farmaciasSanPablo"

# Columnas que nos interesan (los nombres son los reales del CSV)
COL_CANAL = "Canal"
COL_UPC = "UPC"
COL_UPC_WM = "UPC WM"
COL_ITEM = "Item"
COL_IMAGE = "Image"
COL_URL = "URL SKU"

NEEDED_COLS = [COL_CANAL, COL_UPC, COL_UPC_WM, COL_ITEM, COL_IMAGE, COL_URL]

# Ruta por defecto del JSON final (junto al script)
DEFAULT_OUTPUT = Path(__file__).with_name("diccionario_ext.json")

# Encodings a probar en orden
ENCODINGS = ("utf-8", "utf-8-sig", "latin-1", "cp1252")

# Heuristica: cuantos digitos minimos consideramos un UPC valido
MIN_UPC_LEN = 8


# -------------------------- S3 helpers --------------------------------------

def make_s3_client(profile: str | None):
    session = boto3.Session(profile_name=profile) if profile else boto3.Session()
    cfg = Config(retries={"max_attempts": 10, "mode": "standard"})
    return session.client("s3", config=cfg)


def list_csv_keys(s3, bucket: str, prefix: str) -> list[str]:
    keys: list[str] = []
    paginator = s3.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
        for obj in page.get("Contents", []) or []:
            k = obj["Key"]
            if k.lower().endswith(".csv"):
                keys.append(k)
    return keys


def fetch_csv_dataframe(s3, bucket: str, key: str) -> pd.DataFrame | None:
    """Descarga el objeto y devuelve un DataFrame de pandas con strings."""
    obj = s3.get_object(Bucket=bucket, Key=key)
    raw = obj["Body"].read()
    last_err: Exception | None = None
    for enc in ENCODINGS:
        try:
            df = pd.read_csv(
                io.BytesIO(raw),
                dtype=str,
                encoding=enc,
                low_memory=False,
                on_bad_lines="skip",
            )
            return df
        except UnicodeDecodeError as e:
            last_err = e
            continue
        except Exception as e:
            last_err = e
            break
    print(f"  ! No se pudo parsear {key}: {last_err}", file=sys.stderr)
    return None


# -------------------------- Limpieza ----------------------------------------

def clean(value) -> str:
    if value is None:
        return ""
    s = str(value).strip()
    if not s or s.lower() in {"nan", "none", "null", "<na>"}:
        return ""
    # quita zero-width / LRM / BOM si vienen del CSV
    s = s.replace("‎", "").replace("‏", "").replace("﻿", "")
    return s.strip()


def is_valid_upc(upc: str) -> bool:
    if not upc:
        return False
    if len(upc) < MIN_UPC_LEN:
        return False
    return True


# -------------------------- Logica de consolidacion -------------------------

class Consolidator:
    def __init__(self) -> None:
        # canonical UPC -> dict con Item, image, urls (set)
        self.data: dict[str, dict] = {}
        # mapa UPC WM -> UPC canonico (construido desde no-walmart)
        self.wm_to_upc: dict[str, str] = {}

    def upsert(self, upc: str, item: str, image: str, url: str) -> None:
        if not upc:
            return
        entry = self.data.get(upc)
        if entry is None:
            entry = {
                "UPC": upc,
                "Item": item,
                "image": image,
                "urls": [],
                "_urls_set": set(),
            }
            self.data[upc] = entry
        if not entry["Item"] and item:
            entry["Item"] = item
        if not entry["image"] and image:
            entry["image"] = image
        if url and url not in entry["_urls_set"]:
            entry["_urls_set"].add(url)
            entry["urls"].append(url)

    def register_wm_mapping(self, upc: str, upc_wm: str, force: bool) -> None:
        if not upc or not upc_wm:
            return
        if not is_valid_upc(upc):
            return
        if force or upc_wm not in self.wm_to_upc:
            self.wm_to_upc[upc_wm] = upc

    def resolve_walmart_upc(self, row_upc: str, row_upc_wm: str) -> str:
        # 1) si su UPC WM tiene match en el mapa de los otros canales -> usar el real
        if row_upc_wm and row_upc_wm in self.wm_to_upc:
            return self.wm_to_upc[row_upc_wm]
        # 2) si su propio UPC parece valido, usarlo
        if is_valid_upc(row_upc):
            return row_upc
        # 3) ultimo recurso: usar el UPC WM como clave (asi no se pierde la fila)
        if row_upc_wm:
            return row_upc_wm
        # 4) o el UPC tal cual (aunque sea corto)
        return row_upc

    def finalize(self) -> list[dict]:
        out: list[dict] = []
        for entry in self.data.values():
            entry.pop("_urls_set", None)
            out.append(entry)
        return out


# -------------------------- Procesamiento -----------------------------------

def process_channel(
    s3,
    bucket: str,
    channel: str,
    keys: list[str],
    consolidator: Consolidator,
) -> dict:
    stats = {"files": 0, "rows": 0, "rows_kept": 0, "errors": 0}
    is_walmart = channel == "walmart"
    is_primary = channel == PRIMARY_MAP_CHANNEL

    for key in tqdm(keys, desc=f"channel={channel}", unit="csv", leave=False):
        df = fetch_csv_dataframe(s3, bucket, key)
        stats["files"] += 1
        if df is None:
            stats["errors"] += 1
            continue

        # Asegura que todas las columnas existan
        for c in NEEDED_COLS:
            if c not in df.columns:
                df[c] = ""

        df = df[NEEDED_COLS].fillna("")
        stats["rows"] += len(df)

        for rec in df.itertuples(index=False, name=None):
            canal, upc, upc_wm, item, image, url = [clean(x) for x in rec]

            if is_walmart:
                canonical = consolidator.resolve_walmart_upc(upc, upc_wm)
            else:
                # registrar mapping UPC_WM -> UPC (San Pablo se procesa primero
                # y por eso siempre gana; aqui no forzamos sobrescritura)
                consolidator.register_wm_mapping(upc, upc_wm, force=is_primary)
                canonical = upc if upc else upc_wm  # fallback si UPC viene vacio

            if not canonical:
                continue

            consolidator.upsert(canonical, item, image, url)
            stats["rows_kept"] += 1

    return stats


def main() -> int:
    parser = argparse.ArgumentParser(description="Consolida CSVs de S3 a diccionario_ext.json")
    parser.add_argument("--profile", default=os.environ.get("AWS_PROFILE", "databunker"),
                        help="Perfil AWS (default: $env:AWS_PROFILE o 'databunker')")
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT),
                        help=f"Ruta del JSON de salida (default: {DEFAULT_OUTPUT})")
    parser.add_argument("--year", default="2026")
    parser.add_argument("--month", default="05")
    parser.add_argument("--limit-files-per-channel", type=int, default=0,
                        help="Procesa solo los primeros N CSVs por canal (0 = todos)")
    parser.add_argument("--dry-run", action="store_true",
                        help="Solo lista archivos sin descargar/procesar")
    args = parser.parse_args()

    print(f"Perfil AWS: {args.profile}")
    print(f"Bucket: {BUCKET}")
    print(f"Prefijo base: raw_data/year={args.year}/month={args.month}/")
    print(f"Salida: {args.output}\n")

    s3 = make_s3_client(args.profile)

    # 1) Listar CSVs por canal
    channel_keys: dict[str, list[str]] = {}
    print("Listando archivos en S3...")
    for ch in CHANNELS:
        prefix = f"raw_data/year={args.year}/month={args.month}/channel={ch}/"
        keys = list_csv_keys(s3, BUCKET, prefix)
        if args.limit_files_per_channel > 0:
            keys = keys[: args.limit_files_per_channel]
        channel_keys[ch] = keys
        print(f"  channel={ch:<22} -> {len(keys):>5} CSVs")

    total = sum(len(v) for v in channel_keys.values())
    print(f"\nTotal: {total} archivos CSV")

    if args.dry_run:
        print("\n[--dry-run] no se descarga nada.")
        return 0

    # 2) Procesar (San Pablo primero, otros no-walmart despues, walmart al final)
    order = (
        [PRIMARY_MAP_CHANNEL]
        + [c for c in CHANNELS if c not in (PRIMARY_MAP_CHANNEL, "walmart")]
        + ["walmart"]
    )

    consolidator = Consolidator()
    all_stats: dict[str, dict] = {}
    for ch in order:
        keys = channel_keys.get(ch, [])
        if not keys:
            print(f"\n(saltando channel={ch}: 0 archivos)")
            continue
        print(f"\n=== Procesando channel={ch} ({len(keys)} archivos) ===")
        all_stats[ch] = process_channel(s3, BUCKET, ch, keys, consolidator)

    # 3) Resumen y escritura
    print("\n----- Resumen por canal -----")
    for ch, s in all_stats.items():
        print(f"  {ch:<22}  files={s['files']:>4}  rows={s['rows']:>8}  "
              f"kept={s['rows_kept']:>8}  errors={s['errors']}")

    out_path = Path(args.output)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    result = consolidator.finalize()
    n_urls = sum(len(e["urls"]) for e in result)
    print(f"\nUPCs unicos: {len(result):,}")
    print(f"URLs totales acumuladas: {n_urls:,}")
    print(f"Mapeos UPC_WM -> UPC registrados: {len(consolidator.wm_to_upc):,}")
    print(f"\nEscribiendo {out_path} ...")

    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    size_mb = out_path.stat().st_size / 1024 / 1024
    print(f"Listo. Tamano: {size_mb:.1f} MB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
