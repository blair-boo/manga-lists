"""
Migração pontual das capas do Google Drive para o Supabase Storage.

Roda localmente (não faz parte do cron do scraper) porque exige acesso à
pasta local sincronizada/baixada do Google Drive.

Uso:
    pip install -r scripts/requirements.txt
    python scripts/migrate_capas.py /caminho/para/pasta/do/drive

Requer scripts/.env com SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY
(veja scripts/.env.example). A service role key ignora RLS — nunca usar
essa chave no app, só neste script local.

Convenção de nome de arquivo esperada: slug do título (minúsculas, sem
acentos, espaços/pontuação viram '-'), extensão .jpg/.jpeg/.png. Ex:
"Why Are You Obsessed With Your Fake Wife" -> why-are-you-obsessed-with-your-fake-wife.jpg
"""

import csv
import mimetypes
import os
import re
import sys
import unicodedata
from pathlib import Path

from supabase import create_client

BUCKET = "capas"
EXTENSOES = [".jpg", ".jpeg", ".png"]


def carregar_env_local():
    env_path = Path(__file__).parent / ".env"
    if not env_path.exists():
        return
    for linha in env_path.read_text().splitlines():
        linha = linha.strip()
        if not linha or linha.startswith("#") or "=" not in linha:
            continue
        chave, _, valor = linha.partition("=")
        chave = chave.strip()
        valor = valor.strip().strip('"').strip("'")
        os.environ.setdefault(chave, valor)


def slugify(titulo: str) -> str:
    t = unicodedata.normalize("NFKD", titulo).encode("ascii", "ignore").decode()
    t = t.lower()
    t = re.sub(r"[^a-z0-9]+", "-", t)
    return t.strip("-")


def encontrar_arquivo_capa(pasta: Path, slug: str) -> Path | None:
    for ext in EXTENSOES:
        candidato = pasta / f"{slug}{ext}"
        if candidato.exists():
            return candidato
    return None


def ja_migrada(capa_url: str | None) -> bool:
    return bool(capa_url) and f"/storage/v1/object/public/{BUCKET}/" in capa_url


def main():
    if len(sys.argv) != 2:
        print("Uso: python scripts/migrate_capas.py /caminho/para/pasta/do/drive")
        sys.exit(1)

    pasta_drive = Path(sys.argv[1]).expanduser()
    if not pasta_drive.is_dir():
        print(f"Pasta não encontrada: {pasta_drive}")
        sys.exit(1)

    carregar_env_local()
    url = os.environ.get("SUPABASE_URL")
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not service_key:
        print("Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY em scripts/.env")
        sys.exit(1)

    supabase = create_client(url, service_key)

    obras = supabase.table("obras").select("id, titulo, capa_url").execute().data
    print(f"{len(obras)} obras encontradas no banco.")

    sem_match = []
    migradas = 0
    puladas = 0

    for obra in obras:
        if ja_migrada(obra.get("capa_url")):
            puladas += 1
            continue

        slug = slugify(obra["titulo"])
        arquivo = encontrar_arquivo_capa(pasta_drive, slug)
        if not arquivo:
            sem_match.append({"titulo": obra["titulo"], "slug_esperado": slug})
            continue

        conteudo = arquivo.read_bytes()
        content_type = mimetypes.guess_type(arquivo.name)[0] or "image/jpeg"
        destino = f"{slug}{arquivo.suffix.lower()}"

        supabase.storage.from_(BUCKET).upload(
            destino,
            conteudo,
            {"content-type": content_type, "upsert": "true"},
        )
        capa_url = supabase.storage.from_(BUCKET).get_public_url(destino)

        supabase.table("obras").update({"capa_url": capa_url}).eq("id", obra["id"]).execute()
        migradas += 1
        print(f"  ok: {obra['titulo']} -> {destino}")

    print(f"\nMigradas: {migradas} | já tinham capa: {puladas} | sem correspondência: {len(sem_match)}")

    if sem_match:
        relatorio = Path(__file__).parent.parent / "capas_sem_match.csv"
        with relatorio.open("w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=["titulo", "slug_esperado"])
            writer.writeheader()
            writer.writerows(sem_match)
        print(f"Relatório de títulos sem capa encontrada: {relatorio}")


if __name__ == "__main__":
    main()
