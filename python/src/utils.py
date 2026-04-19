import logging
from colorama import Fore
import requests
from yarl._url import URL


class URLSession(requests.Session):
    def get(self, url: str | URL, *args, **kwargs) -> requests.Response:
        return super().get(str(url), *args, **kwargs)

    def post(self, url: str | URL, *args, **kwargs) -> requests.Response:
        return super().post(str(url), *args, **kwargs)


def sanitize_filename(name: str) -> str:
    invalid_chars = ' <>:"/\\|?*'
    for char in invalid_chars:
        name = name.replace(char, "_")
    return name.strip()


class ColoredFormatter(logging.Formatter):
    COLORS = {
        # logging.DEBUG: Fore.WHITE,
        logging.INFO: Fore.GREEN,
        logging.WARNING: Fore.YELLOW,
        logging.ERROR: Fore.RED,
        logging.CRITICAL: Fore.MAGENTA,
    }

    def format(self, record: logging.LogRecord) -> str:
        color = self.COLORS.get(record.levelno)
        reset = "" if color is None else Fore.RESET
        formatted_record = super().format(record)
        return f"{color}{formatted_record}{reset}"
