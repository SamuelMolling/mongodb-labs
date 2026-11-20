"""Loads the lab's single .env (model-serving/.env) for every Python entrypoint."""
from pathlib import Path

from dotenv import load_dotenv

LAB_ROOT = Path(__file__).resolve().parents[2]
load_dotenv(LAB_ROOT / ".env")
