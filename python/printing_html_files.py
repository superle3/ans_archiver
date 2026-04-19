import argparse
import os
from pathlib import Path
import subprocess
import dotenv

config = dotenv.dotenv_values()


parser = argparse.ArgumentParser(description="Archive submissions from ANS platform.")
parser.add_argument(
    "--base-path",
    type=str,
    help="Base path to save the archived submissions. Defaults to './archive'.",
    default=config.get("BASE_PATH", str(Path.cwd() / "archive")),
)
parser.add_argument(
    "--chrome-executable",
    type=str,
    help="Path to theheadless Chrome executable. Defaults to `chrome-headless-shell/*/chrome-headless-shell*`.",
    default=config.get("CHROME_EXECUTABLE", None),
)


class Arguments:
    base_path: str
    chrome_executable: str | None


args = parser.parse_args(namespace=Arguments())

chrome_executable = args.chrome_executable
if chrome_executable is None:
    chrome_executables = Path.cwd().glob(
        "chrome-headless-shell/*/chrome-headless-shell*/chrome-headless-shell*"
    )
    chrome_executable = next(chrome_executables, None)
if chrome_executable is None or not Path(chrome_executable).is_file():
    raise FileNotFoundError(
        "No Chrome executable found. Please specify the path using --chrome-executable or ensure it is located in `chrome-headless-shell/*/chrome-headless-shell*`."
    )

base_path = Path(args.base_path)
if not base_path.exists() or not base_path.is_dir():
    print(base_path.is_dir)
    raise FileNotFoundError(f"Base path '{base_path}' does not exist.")

for html_file in base_path.glob("**/*.html"):
    print(f"Printing html file: {html_file}")
    os.system(
        f"{chrome_executable} --headless --no-pdf-header-footer --print-to-pdf={html_file.with_suffix('.pdf')} {html_file}"
    )
