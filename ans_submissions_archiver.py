import asyncio
from collections.abc import Coroutine
import logging
from pathlib import Path
import random
from typing import NamedTuple, cast
import aiohttp
import bs4
from colorama import Fore, init
from yarl import URL
from src.parser import ANS_TOKEN, BASE_PATH, BASE_URL, SESSION, YEAR
from src.submissions import get_submission
from src.throttledclientsession import RateLimitMiddleware
from src.utils import sanitize_filename

init(autoreset=True)

logger = logging.getLogger("ans_archiver")


def main():
    try:
        url = get_navigation()
    except ValueError as e:
        logger.error(
            Fore.RED
            + f"Your ANS_TOKEN probably expired, please update it, for the actual error see: {str(e)}"
            + Fore.RESET
        )
        return
    if YEAR != "latest" and YEAR != "all":
        url = url.with_query({"q": f"year:{YEAR}"})
    elif YEAR == "all":
        url = url.with_query({})
    logger.info(f"Using courses URL: {url}")
    courses_url = url.relative().with_query({})
    # course_urls = get_list_of_courses(url, courses_url)
    course_urls = [
        CourseInfo(name="2mbc30", url=URL("https://ans.app/routing/courses/569252"))
    ]
    if not course_urls:
        logger.error("No courses found.")
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


type Tags = list[bs4.Tag]


class CourseInfo(NamedTuple):
    name: str
    url: URL


type CourseInfos = list[CourseInfo]


class AssignmentInfo(NamedTuple):
    assignment_name: str
    course_name: str
    url: URL


async def get_assignments_from_course(
    course_info: CourseInfo,
    async_session: aiohttp.ClientSession,
    courses_url: URL,
    base_path: Path,
) -> None:
    logger.debug(
        f"Getting assignments for course {course_info.name} from {course_info.url}."
    )
    results = await async_session.get(course_info.url)
    content = await results.text()
    html_soup = bs4.BeautifulSoup(content, "html.parser")
    assignment_infos: list[AssignmentInfo] = [
        AssignmentInfo(
            assignment_name=a.text.strip(), course_name=course_info.name, url=URL(href)
        )
        for a in html_soup.find_all("a")
        if isinstance(href := a.get("href"), str)
        and href.startswith(str(courses_url))
        and href.endswith("go_to")
    ]

    assignments = await asyncio.gather(
        *[async_session.get(BASE_URL.join(info.url)) for info in assignment_infos]
    )
    assignment_texts = await asyncio.gather(*[a.text() for a in assignments])
    submission_tasks: list[None | Coroutine] = [None] * len(assignment_texts)
    logger.debug(
        f"Found {len(assignment_infos)} assignments for course {course_info.name}."
    )

    for i, (content, info) in enumerate(zip(assignment_texts, assignment_infos)):
        assignment_soup = bs4.BeautifulSoup(content, "html.parser")
        assignment_results = [
            URL(href)
            for a in assignment_soup.find_all("a")
            if isinstance(href := a.get("href"), str) and href.startswith("/results/")
        ]
        if not assignment_results:
            logger.warning(
                f"No assignment links found for {info.course_name}:{info.assignment_name} and url was: {info.url}. Skipping."
            )
            with open("no_submission_link.html", "w", encoding="utf-8") as f:
                f.write(str(assignment_soup.prettify()))
            continue

        assignment_result = assignment_results[0]
        logger.debug(BASE_URL.join(assignment_result))
        course_path = base_path / sanitize_filename(info.course_name)
        submission_path = course_path / sanitize_filename(info.assignment_name)
        submission_tasks[i] = get_submission(
            BASE_URL.join(assignment_result), submission_path, async_session
        )
    await asyncio.gather(*[task for task in submission_tasks if task is not None])


def get_list_of_courses(url: URL, courses_url: URL) -> CourseInfos:
    courses_list: CourseInfos = []
    while True:
        result = SESSION.get(url)
        content = result.text

        html_soup = bs4.BeautifulSoup(content, "html.parser")
        courses: CourseInfos = [
            CourseInfo(name=a.text.strip(), url=BASE_URL.join(URL(href)))
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
        logger.info(f"Found {len(courses)} courses on page {url}.")
        courses_list += courses
        if not next_page:
            break
        url = URL(next_page[0])
    logger.debug(f"Total courses found: {len(courses_list)}: {courses_list}")
    return courses_list


def get_navigation() -> URL:
    result = SESSION.get(BASE_URL)
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
        logger.warning(
            Fore.YELLOW
            + "Multiple navigation links found, taking the first one."
            + Fore.RESET
        )
    navigation_url = navigation_link[0]
    # .with_query({})
    # navigation_url = navigation_link[0]
    return navigation_url


if __name__ == "__main__":
    main()
