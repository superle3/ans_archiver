import asyncio
from collections.abc import Callable, Coroutine
import json
from logging import warning
from pprint import pprint
from typing import Literal, cast
import aiohttp
from color_parser_py import ColorParser
from colorama import Fore, init
import requests
import dotenv
import bs4
from yarl import URL
from pathlib import Path
import fitz
import argparse
from throttledclientsession import RateLimitMiddleware

init(autoreset=True)
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


class Arguments:
    base_path: str
    ans_token: str
    year: str | Literal["latest", "all"]


args = parser.parse_args(namespace=Arguments())
if args.ans_token:
    ANS_TOKEN: str = args.ans_token
else:
    raise ValueError("ANS_TOKEN not found in environment variables")
BASE_PATH: Path = Path(args.base_path)
if args.year not in ["latest", "all"] and not args.year.isdigit():
    raise ValueError("Year must be 'latest', 'all' or a specific year like '2023'.")
YEAR: str = args.year


class Session(requests.Session):
    def get(self, url: str | URL, *args, **kwargs) -> requests.Response:
        return super().get(str(url), *args, **kwargs)


session = Session()

BASE_URL = URL("https://ans.app/")
# Add the authorization cookie
session.cookies.set("__Host-ans_session", ANS_TOKEN, domain="ans.app")


def main():
    try:
        url = get_navigation()
        if YEAR != "latest" and YEAR != "all":
            url = url.with_query({"q": f"year:{YEAR}"})
        elif YEAR == "all":
            url = url.with_query({})
        print(f"Using courses URL: {url}")
    except ValueError as e:
        print(
            Fore.RED
            + f"Your ANS_TOKEN probably expired, please update it, for the actual error see: {str(e)}"
        )
        return
    courses_url = url.relative().with_query({})
    course_urls = get_list_of_courses(url, courses_url)
    if not course_urls:
        print("No courses found.")
        return

    async def gather_assignments():
        nonlocal course_urls
        nonlocal courses_url
        throttle_middleware = RateLimitMiddleware(rate_limit=10, jitter_factor=0)
        async with aiohttp.ClientSession(
            middlewares=[throttle_middleware]
        ) as async_session:
            async_session.cookie_jar.update_cookies(
                {"__Host-ans_session": ANS_TOKEN}, response_url=BASE_URL
            )
            await asyncio.gather(
                *[
                    get_assignments_from_course(
                        course_url, async_session, courses_url, BASE_PATH
                    )
                    for course_url in course_urls
                ]
            )
        print(throttle_middleware.get_stats())

    asyncio.run(gather_assignments())


async def get_assignments_from_course(
    url: URL,
    async_session: aiohttp.ClientSession,
    courses_url: URL,
    base_path: Path,
) -> None:
    results = await async_session.get(url)
    content = await results.text()
    html_soup = bs4.BeautifulSoup(content, "html.parser")
    hrefs: list[URL] = [
        URL(href)
        for a in html_soup.find_all("a")
        if isinstance(href := a.get("href"), str)
        and href.startswith(str(courses_url))
        and href.endswith("go_to")
    ]

    assignments = await asyncio.gather(
        *[async_session.get(BASE_URL.join(href)) for href in hrefs]
    )
    assignment_texts = await asyncio.gather(*[a.text() for a in assignments])

    submission_tasks: list[None | Coroutine] = [None] * len(assignment_texts)
    for i, assignment_content in enumerate(assignment_texts):
        assignment_soup = bs4.BeautifulSoup(assignment_content, "html.parser")
        assignment_results = [
            URL(href)
            for a in assignment_soup.find_all("a")
            if isinstance(href := a.get("href"), str) and href.startswith("/results/")
        ]
        if not assignment_results:
            print("No assignment links found.")
            with open("no_submission_link.html", "w", encoding="utf-8") as f:
                print(1)
                f.write(str(assignment_soup.prettify()))
            continue

        assignment_result = assignment_results[0]
        course_name_refs = [
            a
            for a in assignment_soup.find_all("a")
            if isinstance(href := a.get("href"), str)
            and href.startswith("/" + url.path.removeprefix(BASE_URL.path).lstrip("/"))
        ]
        if not course_name_refs:
            print("No course name found.")
            continue
        elif len(course_name_refs) > 1:
            # print("Multiple course name references found, taking the first one.")
            pass
        course_name_ref: bs4.element.Tag = course_name_refs[0]
        course_name_span: bs4.element.Tag | None = course_name_ref.find_next("span")
        if not isinstance(course_name_span, bs4.element.Tag):
            print("No course name span found.")
            continue
        course_name: str = course_name_span.text.strip().replace(" ", "_")
        submission_name_spans = course_name_ref.find_next_siblings("span")
        if len(submission_name_spans) < 2:
            print("No submission name found.", submission_name_spans)
            with open("no_submission_name.html", "w", encoding="utf-8") as f:
                f.write(str(assignment_soup.prettify()))
            continue

        submission_name = (
            cast(bs4.BeautifulSoup, submission_name_spans[1])
            .text.strip()
            .replace(" ", "_")
        )
        course_path = base_path / sanitize_filename(course_name)
        submission_path = course_path / sanitize_filename(submission_name)
        submission_tasks[i] = get_submission(
            BASE_URL.join(assignment_result), submission_path, async_session
        )
    await asyncio.gather(*[task for task in submission_tasks if task is not None])


# def get_assignment(url: URL) -> None:
#     result = session.get(str(url))
#     content = result.text
#     html_soup = bs4.BeautifulSoup(content, "html.parser")
#     assignment_result = [
#         a["href"]
#         for a in html_soup.find_all("a")
#         if (href := a.get("href"))
#         and isinstance(href, str)
#         and href.startswith("/results/")
#     ][0]
#     get_submission(BASE_URL / assignment_result.lstrip("/"), Path.cwd())


async def get_submission(
    url: URL, submission_path: Path, async_session: aiohttp.ClientSession
) -> None:
    result = await async_session.get(str(url))
    content = await result.text()
    html_soup = bs4.BeautifulSoup(content, "html.parser")
    submission_links = [
        URL(href)
        for a in html_soup.find_all("a")
        if isinstance(href := a.get("href"), str) and href.find("/grading/view") != -1
    ]
    if not submission_links:
        # There are no results so we don't have to download this one.
        print(
            Fore.YELLOW
            + f"No submission links found, url: {url} for assignment {submission_path.relative_to(BASE_PATH)}"
        )
        return

    # Multiple links are expected, I think one for each question but not sure.
    # elif len(submission_links) > 1:
    #     print("Multiple submission links found, taking the first one.")
    submission_link = submission_links[0]
    await get_answers(BASE_URL.join(submission_link), submission_path, async_session)


async def get_answers(
    url: URL, path: Path, async_session: aiohttp.ClientSession
) -> None:
    url_no_query = url.with_query({})
    id = int(url_no_query.parts[-1])
    url_with_no_id = url_no_query.parent
    await download_answers(url_with_no_id, id, path, async_session)


def get_list_of_courses(url: URL, courses_url: URL) -> list[URL]:
    courses_list: list[URL] = []
    while True:
        result = session.get(url)
        content = result.text

        html_soup = bs4.BeautifulSoup(content, "html.parser")
        courses: list[URL] = [
            BASE_URL / href.lstrip("/")
            for a in html_soup.find_all("a")
            if isinstance(href := a.get("href"), str)
            and href.startswith("/routing/courses/")
        ]
        next_page = [
            BASE_URL.join(URL(href))
            for a in html_soup.find_all("a")
            if isinstance(href := a.get("href"), str)
            and href.startswith(str(courses_url))
            and cast(str, a.text).strip().lower().find("show more") != -1
        ]
        print(f"Found {len(courses)} courses on page {url}.")
        courses_list += courses
        if not next_page:
            break
        url = URL(next_page[0])

    return courses_list


def get_navigation() -> URL:
    result = session.get(BASE_URL)
    content = result.text

    html_soup = bs4.BeautifulSoup(content, "html.parser")
    navigation_link = [
        BASE_URL.join(URL(href))
        for a in html_soup.find_all("a")
        if isinstance(href := a.get("href"), str)
        and href.find("courses") != -1
        and href.find("routing") == -1
        and not href.startswith("https://")
    ]
    if not navigation_link:
        raise ValueError("No navigation link found.")
    if len(navigation_link) > 1:
        warning(Fore.YELLOW + "Multiple navigation links found, taking the first one.")
    navigation_url = navigation_link[0]
    # .with_query({})
    # navigation_url = navigation_link[0]
    return navigation_url


async def download_submission(
    text: str, path: Path, async_session: aiohttp.ClientSession
) -> None:
    html_soup = bs4.BeautifulSoup(text, "html.parser")
    new_html = bs4.BeautifulSoup(
        """
<!DOCTYPE html>
<html lang="en">
<head>
</head>
<body>
<main></main>
</body>
</html>
    """,
        "html.parser",
    )
    head_tag = cast(bs4.element.Tag, new_html.find("head"))
    head_tag.clear()
    head_tag.extend(cast(bs4.element.Tag, html_soup.find("head")).contents)

    body_tag: bs4.element.Tag = cast(bs4.element.Tag, new_html.find("body"))
    main_tag: bs4.element.Tag = cast(bs4.element.Tag, new_html.find("main"))
    original_body_tag = cast(bs4.element.Tag, html_soup.find("body"))
    body_tag.attrs = original_body_tag.attrs
    attempt = html_soup.find(
        "div", attrs={"data-current-user-id": True, "data-assignment-id": True}
    )
    pdf_buttons = [
        button["data-url"]
        for button in html_soup.find_all("button")
        if button.get("data-file-type") == "pdf"
        and button.get("data-file-extension") == ".pdf"
        and button.get("data-url", "").find("pdf") != -1
    ]
    if not pdf_buttons and not isinstance(attempt, bs4.element.Tag):
        print("No PDF download links found and no submission attempt.")
        with (path / "no_attempt.html").open("w", encoding="utf-8") as f:
            f.write(str(html_soup.prettify()))
        return

    async def get_annotations_from_html(url: URL) -> dict:
        annotation_html = html_soup.find(
            "button", attrs={"data-pages-with-annotations": True, "data-url": str(url)}
        )
        if annotation_html is None:
            return {"content": []}

        pages_with_annotations = json.loads(
            cast(str, annotation_html["data-pages-with-annotations"])
        )
        if not pages_with_annotations:
            return {"content": []}
        data_upload_id = annotation_html["data-upload-id"]
        annotation_response = await async_session.get(
            BASE_URL / f"uploads/{data_upload_id}/annotations"
        )
        try:
            annotation_data = await annotation_response.json()
        except aiohttp.ContentTypeError as e:
            print(
                Fore.RED
                + f"Failed to get annotations JSON\n for Path: {path}\n for: upload ID {data_upload_id}:\n\n {str(e)}"
            )
            return {"content": []}
        return annotation_data

    async def download_pdf(url: URL, path: Path) -> None:
        pdf_file = await async_session.get(url)
        filename = sanitize_filename(url.query.get("filename", "faulty_name.pdf"))
        path.mkdir(parents=True, exist_ok=True)
        pdf_path = path / filename
        content = await pdf_file.read()
        pdf_document = fitz.Document(stream=content, filetype="pdf")
        annotation_data = await get_annotations_from_html(url)
        annotate_pdf(pdf_document, annotation_data, html_soup, pdf_path)
        print(Fore.GREEN + f"Downloaded PDF: {filename}: {pdf_path}")

    path.mkdir(parents=True, exist_ok=True)
    await asyncio.gather(
        *[
            download_pdf(BASE_URL.join(URL(pdf_url, encoded=True)), path)
            for pdf_url in pdf_buttons
        ]
    )
    if not isinstance(attempt, bs4.element.Tag):
        return

    main_tag.append(attempt)
    body_tag.append(main_tag)
    body_tag.append(
        bs4.BeautifulSoup(
            '<div data-js-i18n data-default-locale="nl" data-locale="nl"></div>',
            "html.parser",
        )
    )
    path.mkdir(parents=True, exist_ok=True)
    with (path / "attempt.html").open("w", encoding="utf-8") as f:
        f.write(str(new_html))


def annotate_pdf(
    doc: fitz.Document,
    annotations_data: dict,
    html_soup: bs4.BeautifulSoup,
    pdf_path: Path,
) -> None:
    annotation_content = annotations_data["content"]
    point_comments = [
        annotation for annotation in annotation_content if annotation["type"] == "point"
    ]
    drawings = [
        annotation
        for annotation in annotation_content
        if annotation["type"] == "drawing"
    ]
    the_rest = [
        annotation
        for annotation in annotation_content
        if annotation["type"] not in ("point", "drawing")
    ]
    if the_rest:
        print(
            "Some annotation types were not processed:",
            [ann["type"] for ann in the_rest],
        )
    for comment in point_comments:
        turbo_frame = html_soup.find(
            "turbo-frame", attrs={"id": f"annotation_{comment['uuid']}"}
        )
        if turbo_frame is None:
            print(
                Fore.RED
                + f"Turbo-frame not found for annotation {comment['uuid']} in {pdf_path}. Skipping annotation."
            )
            continue
        article = turbo_frame.find("article")
        if article is None:
            print(
                Fore.RED
                + f"Article not found in turbo-frame for annotation {comment['uuid']} in {pdf_path}. Skipping annotation."
            )
            continue
        page_count: int = comment["page"]
        if page_count > len(doc):
            print(
                Fore.RED
                + f"Annotation page {page_count} exceeds document page count {len(doc)}. Skipping annotation.\n {pdf_path}"
            )
            continue
        page = doc[page_count - 1]
        point = fitz.Point(comment["x"], comment["y"])
        annot = page.add_text_annot(point, article.text.strip())
        annot.set_name("Comment")
        info = annot.info
        info["title"] = "Annotation from ANS"
        annot.set_info(info)
        annot.update()

    # Process drawing annotations
    for drawing in drawings:
        page_num: int = drawing["page"]
        if page_num > len(doc):
            print(
                Fore.RED
                + f"Annotation page {page_num} exceeds document page count {len(doc)}. Skipping annotation.\n {pdf_path}"
            )
            continue
        page = doc[page_num - 1]
        lines: list[list[float]] = drawing["lines"]
        try:
            colors = ColorParser(drawing["color"]).rgba_float
            color = colors[0:3]
            opacity = colors[3] if len(colors) > 3 else 1.0
        except ValueError:
            print(f"Can't parse drawing color: {drawing['color']}")
            # Default to black if color parsing fails
            color = (0.0, 0.0, 0.9)
            opacity = 1.0
        width: int = drawing["width"]

        # Draw lines by connecting consecutive points
        for i in range(len(lines) - 1):
            point1 = fitz.Point(*lines[i])
            point2 = fitz.Point(*lines[i + 1])
            page.draw_line(
                point1, point2, color=color, width=width, stroke_opacity=opacity
            )

    doc.save(pdf_path)


async def download_answers(
    url: URL, id: int, path: Path, async_session: aiohttp.ClientSession
) -> None:
    new_url = url / str(id)
    result = await async_session.get(new_url)
    content = await result.text()
    tasks = []
    tasks.append(download_submission(content, path, async_session))

    html_soup = bs4.BeautifulSoup(content, "html.parser")
    questions = html_soup.find_all("div", attrs={"data-cy": "submission-button"})
    question_links = [q.find("a")["data-submission-id"] for q in questions]
    if len(question_links) == 0:
        print("No questions found.")
        await asyncio.gather(*tasks)
        return

    parsing_dict = {
        "CRITERIA": parse_criteria,
        "SUBQUESTION": parse_sub_question,
        "GRADING DESCRIPTION": parse_criteria,
    }
    new_html = bs4.BeautifulSoup(
        """
<!DOCTYPE html>
<html lang="en">
<head>
</head>
<body>
<main></main>
</body>
</html>
    """,
        "html.parser",
    )
    html_tag = cast(bs4.element.Tag, new_html.find("html"))
    head_tag = cast(bs4.element.Tag, new_html.find("head"))
    head_tag.clear()
    head_tag.extend(cast(bs4.element.Tag, html_soup.find("head")).contents)

    body_tag: bs4.element.Tag = cast(bs4.element.Tag, new_html.find("body"))
    main_tag = new_html.find("main")
    original_body_tag = html_soup.find("body")
    if isinstance(original_body_tag, bs4.element.Tag):
        body_tag.attrs = original_body_tag.attrs

    results = [async_session.get(str(url / str(qid))) for qid in question_links]
    responses = await asyncio.gather(*results)
    fetched_pages = await asyncio.gather(*[resp.text() for resp in responses])

    for page_content in fetched_pages:
        html_soup2 = bs4.BeautifulSoup(page_content, "html.parser")
        grading: bs4.ResultSet = html_soup2.find_all(
            "div", attrs={"data-js-grading-panel": True}
        )
        for grading_panel in grading:
            # grading_panel: bs4.BeautifulSoup = grading_panel
            comments = grading_panel.find_all(
                string=lambda text: isinstance(text, bs4.Comment)
            )
            comments_list = []
            for comment in comments:
                comments_list.append(comment.strip())
                comment_str: str = comment.strip()
                if comment_str not in parsing_dict:
                    continue
                parse_function: Callable[..., bs4.BeautifulSoup] = parsing_dict[
                    comment_str
                ]
                parsed_data: bs4.BeautifulSoup = parse_function(
                    comment.find_next_sibling()
                )
                main_tag.append(parsed_data)
            known_comments = [
                "QUESTION",
                "SUBQUESTION",
                "GRADING DESCRIPTION",
                "OBJECTIVES",
                "POINTS",
                "CRITERIA",
            ]
            unknown_comments = set(comments_list).difference(known_comments)
            if unknown_comments:
                print(f"Unknown comments found in grading panel, url: {new_url}")
                pprint(list(unknown_comments))
                with open("unknown_comments.html", "w", encoding="utf-8") as f:
                    f.write(grading_panel.prettify())

    body_tag.append(main_tag)
    body_tag.append(
        bs4.BeautifulSoup(
            '<div data-js-i18n data-default-locale="nl" data-locale="nl"></div>',
            "html.parser",
        )
    )
    html_tag.append(body_tag)
    path.mkdir(parents=True, exist_ok=True)
    with (path / "grading_panel.html").open("w", encoding="utf-8") as f:
        f.write(str(new_html.prettify()))
    await asyncio.gather(*tasks)


def parse_sub_question(grading_panel: bs4.BeautifulSoup) -> bs4.BeautifulSoup:
    # subquestions = grading_panel.find_all("div", attrs={"data-js-subquestion": True})
    # result = {}
    # for subq in subquestions:
    #     subq_id = subq["data-js-subquestion"]
    #     comments = subq.find_all(string=lambda text: isinstance(text, bs4.Comment))
    #     result[subq_id] = comments
    # return result
    # print("Parsing SUBQUESTION - function not yet implemented", grading_panel)
    # return grading_panel.find("article") or grading_panel
    return grading_panel


def parse_criteria(grading_panel: bs4.BeautifulSoup) -> bs4.BeautifulSoup:
    # criteria = grading_panel.find_all("div", attrs={"data-js-criterion": True})
    # result = {}
    # for criterion in criteria:
    #     criterion_id = criterion["data-js-criterion"]
    #     comments = criterion.find_all(string=lambda text: isinstance(text, bs4.Comment))
    #     result[criterion_id] = comments
    # return result
    # print("Parsing CRITERIA - function not yet implemented", grading_panel.prettify())
    # return grading_panel.find("article") or grading_panel
    return grading_panel


def sanitize_filename(name: str) -> str:
    invalid_chars = ' <>:"/\\|?*'
    for char in invalid_chars:
        name = name.replace(char, "_")
    return name.strip()


if __name__ == "__main__":
    main()
