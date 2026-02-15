# ANS Archiver

A web scraper for downloading assignment submissions and corrections from the ANS (ans.app) platform. This tool allows students to archive their exam attempts, including PDFs and grading details, since they don't always open their api to student...

## Installation

All commands are executed in the root of the project and all files are created in the root of the project. (root of the project=same folder as the file `pyproject.toml` is in.)

1. Clone the repository or download the zip file and .
2. Install the packages with [uv](https://docs.astral.sh/uv/) and run `uv sync`.
3. Set up environment variables in a `.env` file.

## Configuration

Create a `.env` file with or pass them into the cli options as:

- `ANS_TOKEN`/`--ans-token`: Your ANS session token.
 When you're logged into `ans.app`, open up developer tools with `Ctrl+Shift+I` or `Ctrl+Shift+C` and window like the following below should pop up:
 ![open up developer tools](images/developer_tools.png)
 Then you select the network tab, if its not there like in the image above, click on the arrow and click on `Network` to get like below:
 ![go to the network tab](images/deverloper_tools_network.png)

 1. Filter the output to only `ans.app`
 2. select the top one, below select `Headers`
 3. Scroll all the way down beyond `Request Headers`
 4. Copy everything in `set-cookie` from the response headers.
 ![get cookie](images/get_cookie.png)

- `BASE_PATH`/`--base-path`: Directory to save archives (optional, defaults to "archive" in this directory).
- `YEAR`/`--year`: The year(s) which will be downloaded. `all` will download all available years, `2023` will download all assignments from study year `2023` and `latest` will download the current year. This defaults to `latest`.
- `GRADING_SCHEME`/`--grading-scheme`: Whether to use the old grading scheme or the new one, defaults to the current one. Options are `old`, `new` and `current`.
- `LOG_LEVEL`/`--log-level`: How detailed the logs will be.

So an example `.env` would look like:

```env
ANS_TOKEN="sso_name=<insert-institution-name>; sso_method=get; __Host-ans_session=apefowjfwefwajpfwjfawf<further-giberish>%3D%3D"
BASE_PATH="C:/Users/username/Documents/school/ans_archive"
```

And you could run it with: `uv run ./ans_submissions_archiver.py --year 2025 --grading-scheme old`.

>[!NOTE]
> Command line options will take priority over the variables in the `.env` file.

## Usage

The tool will:

- Fetch the course names and assignment names.
- Download submissions as PDFs and HTML files with grading panels into their respective `course_name/assignment_name` folder.

The html files will still depend on `ans.app` assets such as css files (styling), javascript files (math rendering) and images.
To fully archive the html file, its recommended to save them as pdf through either a browser of your choosing or through the steps below.

1. Download a headless chrome browser for your os through `npx @puppeteer/browsers install chrome-headless-shell@stable` (npm/npx required to be in PATH)
2. Run `uv run ./printing_html_files.py`.

The following options can be passed or put in the `.env` file:

- `BASE_PATH`/`--base-path`: Directory in which to search html files and print them.
- `CHROME_EXECUTABLE`/`--chrome-executable`: Path to **headless** chrome executable, defaults to installation path of `npx @puppeteer/browsers install chrome-headess-shell@stable` in this directory.

>[!NOTE]
> Other python virtual environment managers that adhere to the `pyproject.toml` spec should work too, but uv is recommended for its ease of use.

## Troubleshooting

- ANS_TOKEN is expired: try only copying `__Host-ans_session=....;` (begins with `__Host-ans_session` and ends with `;`), enclose it with qoutes in your `.env` file or in the cli and check if its correct. If that doesn't help, try reloading and copy the cookie again either from the response headers or the request headers.
- 0 courses were found when the year was specified: `ans.app` might change how their website works, verify that you have courses in that year and verify that url of that year is the same as the year this program uses.
- other errors/warnings: ans might have changed their ui, causing the webscraping to break, create an issue of the url where the problem arises with the error message.
- This program shouldn't change because of language settings in ans, but its only tested on English. As a last resort try changing it to English.
- Set the `LOG_LEVEL` to `debug` to get more detail of where it went wrong.

## Contributing

All contributions are welcome. If the webscraper is broken for a particular page, you can either save that page in the code or open the url in the browser, go to `Networks`, inspect the broken url and check the response tab for the initial html of that url and finally you can inspect that html in a code editor to see what possible changes need to be made.

If you like this project, consider leaving a star.
