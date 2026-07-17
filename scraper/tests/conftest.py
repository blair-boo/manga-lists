"""Coloca o diretório scraper/ no sys.path: os módulos do scraper se importam
de forma plana (`from common import ...`), então os testes precisam enxergá-los
como top-level, igual aos scripts em produção."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
