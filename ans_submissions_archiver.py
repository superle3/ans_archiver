import asyncio
from collections.abc import Callable, Coroutine
from pprint import pprint
import subprocess
from typing import cast
import aiohttp
from colorama import Fore, init
import requests
import dotenv
import bs4
from yarl import URL
from pathlib import Path

init(autoreset=True)
config = dotenv.dotenv_values()
if isinstance(temp := config.get("ANS_TOKEN"), str):
    ANS_TOKEN: str = temp.split(";")[0]
else:
    raise ValueError("ANS_TOKEN not found in environment variables")
if isinstance(temp := config.get("COURSES_URL"), str):
    COURSES_URL: str = temp
else:
    raise ValueError("COURSES_URL not found in environment variables")
if isinstance(temp := config.get("BASE_PATH"), str):
    BASE_PATH: Path = Path(temp)
else:
    BASE_PATH = Path.cwd() / "archive"


session = requests.Session()

BASE_URL = URL("https://ans.app/")
FULL_URL = BASE_URL / COURSES_URL
# Add the authorization cookie
session.cookies.set("__Host-ans_session", ANS_TOKEN, domain="ans.app")


def main():
    id = 302170978
    url = FULL_URL / "471949/assignments/1136832/grading/view"
    course_urls = get_list_of_courses(FULL_URL)
    if not course_urls:
        print("No courses found.")
        return

    async def gather_assignments():
        nonlocal course_urls
        print(f"Found {len(course_urls)} courses.")
        async with aiohttp.ClientSession() as async_session:
            async_session.cookie_jar.update_cookies(
                {"__Host-ans_session": ANS_TOKEN}, response_url=BASE_URL
            )
            await asyncio.gather(
                *[
                    get_assignments_from_course(course_url, async_session, BASE_PATH)
                    for course_url in course_urls
                ]
            )

    asyncio.run(gather_assignments())


async def get_assignments_from_course(
    url: URL,
    async_session: aiohttp.ClientSession,
    base_path: Path | None = None,
) -> None:
    if base_path is None:
        base_path = Path.cwd()
    results = await async_session.get(str(url))
    content = await results.text()
    html_soup = bs4.BeautifulSoup(content, "html.parser")
    hrefs = [
        a["href"]
        for a in html_soup.find_all("a")
        if isinstance(href := a.get("href", ""), str)
        and href.startswith("/" + COURSES_URL)
        and href.endswith("go_to")
    ]

    assignments = await asyncio.gather(
        *[async_session.get(BASE_URL.join(URL(href))) for href in hrefs]
    )
    assignment_texts = await asyncio.gather(*[a.text() for a in assignments])

    submission_tasks: list[None | Coroutine] = [None] * len(assignment_texts)
    for i, assignment_content in enumerate(assignment_texts):
        assignment_soup = bs4.BeautifulSoup(assignment_content, "html.parser")
        assignment_results = [
            a["href"]
            for a in assignment_soup.find_all("a")
            if isinstance(href := a.get("href", ""), str)
            and href.startswith("/results/")
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
            if isinstance(href := a.get("href", ""), str)
            and href.startswith("/" + url.path.removeprefix(BASE_URL.path).lstrip("/"))
        ]
        if not course_name_refs:
            print("No course name found.")
            continue
        elif len(course_name_refs) > 1:
            # print("Multiple course name references found, taking the first one.")
            pass
        course_name_ref: bs4.BeautifulSoup = course_name_refs[0]
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
            BASE_URL.join(URL(assignment_result)), submission_path, async_session
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
    # print(f"Getting submission from {url}")
    result = await async_session.get(str(url))
    content = await result.text()
    html_soup = bs4.BeautifulSoup(content, "html.parser")
    submission_links = [
        URL(a["href"])
        for a in html_soup.find_all("a")
        if (href := a.get("href"))
        and isinstance(href, str)
        and href.find("/grading/view") != -1
    ]
    if not submission_links:
        # There are no results so we don't have to download this one.
        print(Fore.YELLOW + f"No submission links found. {url = } {submission_path = }")
        return

    # Multiple liinks are expected, I think one for each question but not sure.
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


def get_list_of_courses(url: URL) -> list[URL]:
    courses_list: list[URL] = []
    while True:
        result = session.get(str(url))
        content = result.text

        html_soup = bs4.BeautifulSoup(content, "html.parser")
        courses: list[URL] = [
            BASE_URL / a["href"].lstrip("/")
            for a in html_soup.find_all("a")
            if isinstance(a.get("href", ""), str)
            and a.get("href", "").startswith("/routing/courses/")
        ]
        next_page = [
            BASE_URL.join(URL(a["href"]))
            for a in html_soup.find_all("a")
            if (href := a.get("href", ""))
            and href.startswith("/" + COURSES_URL.rstrip("/"))
            and cast(str, a.text).strip().lower().find("show more") != -1
        ]
        print(f"Found {len(courses)} courses on page {url}.")
        courses_list += courses
        if not next_page:
            break
        url = URL(next_page[0])

    return courses_list


def get_navigation(url: URL) -> None:
    raise NotImplementedError(
        "Function not implemented yet, don't know how to extract the courses navigation."
    )
    result = session.get(str(url))
    content = result.text

    html_soup = bs4.BeautifulSoup(content, "html.parser")
    with open("navigation.html", "w", encoding="utf-8") as f:
        f.write(html_soup.prettify())
    subprocess.run(["start", "navigation.html"], shell=True)


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

    async def download_pdf(url: URL, path: Path) -> None:
        pdf_file = await async_session.get(url)
        filename = sanitize_filename(url.query.get("filename", "faulty_name.pdf"))
        path.mkdir(parents=True, exist_ok=True)
        print(Fore.BLUE + f"Starting Downloading PDF: {filename} from {url}")
        with (path / filename).open("wb") as f:
            while True:
                chunk = await pdf_file.content.readany()
                if not chunk:
                    break
                f.write(chunk)
        print(Fore.GREEN + f"Downloaded PDF: {filename}")

    path.mkdir(parents=True, exist_ok=True)
    await asyncio.gather(
        *[download_pdf(BASE_URL.join(URL(pdf_url)), path) for pdf_url in pdf_buttons]
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
            if set(comments_list).isdisjoint(known_comments):
                print("Unknown comments found in grading panel:")
                pprint(comments_list)
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
