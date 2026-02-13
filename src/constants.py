import logging
from pathlib import Path
from yarl._url import URL
from utils import URLSession


BASE_URL: URL
BASE_PATH: Path
YEAR: str
ANS_TOKEN: str
SESSION: URLSession

logger = logging.basicConfig()
