import argparse
from enum import Enum
import logging
import sys
from pathlib import Path
from typing import Literal, get_args
import dotenv
from yarl import URL
from .utils import URLSession

config = dotenv.dotenv_values()


parser = argparse.ArgumentParser(description="Archive submissions from ANS platform.")
parser.add_argument(
    "--year",
    type=str,
    help="Year of the courses to archive (e.g., '2023', 'latest', 'all'). Defaults to 'latest'.",
    default=config.get("YEAR", "latest"),
)
parser.add_argument(
    "--base-path",
    type=str,
    help="Base path to save the archived submissions. Defaults to './archive'.",
    default=str(Path.cwd() / "archive"),
)
parser.add_argument(
    "--ans-token",
    type=str,
    help="ANS session token for authentication.",
    default=config.get("ANS_TOKEN", ""),
)

parser.add_argument(
    "--grading-scheme",
    type=str,
    choices=["old", "new", "current"],
    help="Grading scheme to use when archiving (e.g., 'old', 'new', 'current'). Defaults to 'current'.",
    default=config.get("GRADING_SCHEME", "current"),
)

type GradingScheme = Literal["old", "new", "current"]
grading_schemes = get_args(GradingScheme.__value__)


class Arguments:
    base_path: str
    ans_token: str
    year: str | Literal["latest", "all"]
    grading_scheme: GradingScheme = "current"


def parse_ans_token(token: str) -> str:
    if token.find("__Host-ans_session=") != -1:
        start = token.find("__Host-ans_session=") + len("__Host-ans_session=")
        end = token.find(";", start)
        return token[start:end]
    else:
        return token.split(";")[0]


args = parser.parse_args(namespace=Arguments())
if args.ans_token:
    ANS_TOKEN = parse_ans_token(args.ans_token)
else:
    raise ValueError("ANS_TOKEN not found in environment variables")
BASE_PATH = Path(args.base_path)
if args.year not in ["latest", "all"] and not args.year.isdigit():
    raise ValueError("Year must be 'latest', 'all' or a specific year like '2023'.")
YEAR = args.year
if args.grading_scheme not in grading_schemes:
    raise ValueError(
        f"Invalid grading scheme '{args.grading_scheme}'. Must be one of {grading_schemes}."
    )
GRADING_SCHEME = args.grading_scheme


SESSION = URLSession()

BASE_URL = URL("https://ans.app/")
# Add the authorization cookie
SESSION.cookies.set("__Host-ans_session", ANS_TOKEN, domain="ans.app")

logger = logging.getLogger("ans_archiver")
stream_handler = logging.StreamHandler(sys.stdout)
stream_handler.setFormatter(logging.Formatter("%(levelname)s:%(message)s"))
logger.addHandler(stream_handler)
logger.setLevel(logging.DEBUG)
