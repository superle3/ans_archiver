import asyncio
from collections.abc import Callable
import json
import logging
from pprint import pprint
from typing import NamedTuple, cast
import aiohttp
from color_parser_py import ColorParser
from colorama import Fore
import bs4
from yarl import URL
from pathlib import Path
import fitz

from .utils import sanitize_filename
from .parser import BASE_PATH, BASE_URL, GRADING_SCHEME

logger = logging.getLogger("ans_archiver")


async def get_submission(
    url: URL, submission_path: Path, async_session: aiohttp.ClientSession
) -> None:
    logger.debug(f"Getting submission for url: {url} and saving to {submission_path}")
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
        logger.warning(
            Fore.YELLOW
            + f"No submission links found, url: {url} for assignment {submission_path.relative_to(BASE_PATH)}"
        )
        return
    switch_to_old = GRADING_SCHEME == "old" and not html_soup.find(
        "div", attrs={"data-js-review-panel": True}
    )
    switch_to_new = GRADING_SCHEME == "new" and not html_soup.find(
        "div", attrs={"data-js-grading-panel": True}
    )
    if switch_to_old or switch_to_new:
        await switch_grading_schemes(async_session, html_soup, url)

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
    logger.debug(f"Getting answers for {url_with_no_id} with id {id}")
    await download_answers(url_with_no_id, id, path, async_session)


async def download_submission(
    text: str, path: Path, async_session: aiohttp.ClientSession
) -> None:
    html_soup = bs4.BeautifulSoup(text, "html.parser")
    new_html_page = create_answer_html(html_soup)
    main_tag = new_html_page.main
    body_tag = new_html_page.body
    new_html = new_html_page.page
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
            logger.error(
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
        logger.info(Fore.GREEN + f"Downloaded PDF: {filename}: {pdf_path}")

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


class AnswerHtml(NamedTuple):
    html: bs4.Tag
    body: bs4.Tag
    main: bs4.Tag
    head: bs4.Tag
    page: bs4.BeautifulSoup


def create_answer_html(html_soup: bs4.BeautifulSoup) -> AnswerHtml:
    html_page = bs4.BeautifulSoup("<!DOCTYPE html>", "html.parser")
    html_tag = html_page.new_tag("html", lang="en")
    head_tag = html_page.new_tag("head")
    body_tag = html_page.new_tag("body")
    main_tag = html_page.new_tag("main")

    html_page.append(html_tag)
    html_tag.append(head_tag)
    html_tag.append(body_tag)
    body_tag.append(main_tag)

    original_head_tag = html_soup.find("head")
    if not isinstance(original_head_tag, bs4.element.Tag):
        logger.warning(
            "Javascript and css assets not found, page may not render correctly."
        )
    else:
        head_tag.clear()
        head_tag.extend(original_head_tag.contents)
    head_tag.append(
        bs4.BeautifulSoup(
            """
                <style>
                     body { 
                         padding: 2rem; 
                    }
                    @media print {
                            body {
                                padding: 2cm;
                            }
                        }
                    @media (max-width: 420px) {
                        body {
                            padding: 0 2rem;
                        }
                    }
                </style>
            """,
            "html.parser",
        )
    )

    original_body_tag = html_soup.find("body")
    if isinstance(original_body_tag, bs4.element.Tag):
        body_tag.attrs = original_body_tag.attrs
    else:
        logger.warning(
            "body tag not found, attributes may be missing and page may not render correctly."
        )

    return AnswerHtml(
        html=html_page, body=body_tag, main=main_tag, head=head_tag, page=html_page
    )


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
        logger.warning("No questions found.")
        await asyncio.gather(*tasks)
        return

    new_html_page = create_answer_html(html_soup)
    body_tag = new_html_page.body
    main_tag = new_html_page.main
    html_tag = new_html_page.html

    results = [async_session.get(str(url / str(qid))) for qid in question_links]
    responses = await asyncio.gather(*results)
    fetched_pages = await asyncio.gather(*[resp.text() for resp in responses])

    for page_content in fetched_pages:
        html_soup2 = bs4.BeautifulSoup(page_content, "html.parser")
        grading = html_soup2.find_all("div", attrs={"data-js-grading-panel": True})
        is_v2 = False
        if not grading:
            grading = html_soup2.find_all("div", attrs={"data-js-review-panel": True})
            is_v2 = True
        for grading_panel in grading:
            if is_v2:
                logger.debug("Using grading scheme v2 for url: " + str(new_url))
                grading_scheme_v2(main_tag, grading_panel, html_soup2)
                continue

            grading_scheme_v1(main_tag, grading_panel, new_url)

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
        f.write(str(new_html_page.page.prettify()))
    await asyncio.gather(*tasks)


def grading_scheme_v1(main_tag: bs4.Tag, grading_panel: bs4.Tag, new_url: URL) -> None:
    parsing_dict = {
        "CRITERIA": parse_criteria,
        "SUBQUESTION": parse_sub_question,
        "GRADING DESCRIPTION": parse_criteria,
    }
    comments = grading_panel.find_all(string=lambda text: isinstance(text, bs4.Comment))
    comments_list = []
    for comment in comments:
        comments_list.append(comment.strip())
        comment_str: str = comment.strip()
        if comment_str not in parsing_dict:
            continue
        parse_function: Callable[..., bs4.BeautifulSoup] = parsing_dict[comment_str]
        parsed_data: bs4.BeautifulSoup = parse_function(comment.find_next_sibling())
        main_tag.append(parsed_data)

    adjustments = grading_panel.find(attrs={"data-js-adjustments-wrapper": True})
    if adjustments:
        main_tag.append(adjustments)
    known_comments = [
        "QUESTION",
        "SUBQUESTION",
        "GRADING DESCRIPTION",
        "OBJECTIVES",
        "SLIDER",
        "POINTS",
        "CRITERIA",
    ]
    unknown_comments = set(comments_list).difference(known_comments)
    if unknown_comments:
        logger.info(f"Unknown comments found in grading panel, url: {new_url}")
        pprint(list(unknown_comments))
        with open("unknown_comments.html", "w", encoding="utf-8") as f:
            f.write(grading_panel.prettify())


def grading_scheme_v2(
    main_tag: bs4.Tag, grading_panel: bs4.Tag, full_page: bs4.BeautifulSoup
) -> None:
    for element_id in ["question-header", "subquestion-header", "criteria"]:
        element = grading_panel.find(id=element_id)
        if not element:
            continue
        with open("test3.html", "w", encoding="utf-8") as f:
            f.write(str(grading_panel.prettify()))
        if element_id == "subquestion-header":
            current_question = full_page.find(
                "div", attrs={"class": "question-button-indicator"}
            )
            if current_question:
                question_number = current_question.next_sibling
                if question_number:
                    number = question_number.text.strip()
                    element.insert(
                        0,
                        bs4.BeautifulSoup(
                            f'<div class="text-semi-bold mr-3"> {number} </div>'
                        ),
                    )
        main_tag.append(element)

    none_above = grading_panel.find("div", attrs={"data-controller": "score"})
    if none_above:
        # Optional: Grab the separator too for visual consistency
        separator = none_above.find_previous_sibling("div", class_="border-top")
        if separator:
            main_tag.append(separator)
        main_tag.append(none_above)

    adjustment_frame = grading_panel.find(
        "turbo-frame", id=lambda x: isinstance(x, str) and x.startswith("adjustment_")
    )
    if adjustment_frame:
        main_tag.append(adjustment_frame)
    else:
        adjustments_attr = grading_panel.find(
            attrs={"data-js-adjustments-wrapper": True}
        )
        if adjustments_attr:
            main_tag.append(adjustments_attr)

    score_summary = grading_panel.find(class_="score-summary")
    if not score_summary:
        score_summary = grading_panel.find(
            "turbo-frame",
            id=lambda x: isinstance(x, str) and x.startswith("score_submission_"),
        )
    if score_summary:
        main_tag.append(score_summary)


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


async def switch_grading_schemes(
    async_session: aiohttp.ClientSession,
    html_soup: bs4.BeautifulSoup,
    question_url: URL,
) -> None:
    response = await async_session.get(question_url)
    text = await response.text()
    html_soup = bs4.BeautifulSoup(text, "html.parser")
    form = html_soup.find("form", attrs={"class": "button_to", "action": True})
    if form is None:
        logger.warning(
            Fore.RED
            + f"Grading scheme switch button not found on page: {question_url}. Cannot switch grading schemes."
        )
        return
    action = form["action"]
    input_el = form.find("input", attrs={"name": "authenticity_token"})
    if (
        input_el is None
        or not input_el.has_attr("value")
        or not isinstance(action, str)
    ):
        logger.warning(
            Fore.RED
            + f"Authenticity token input or action attribute not found in grading scheme switch button on page: {question_url}. Cannot switch grading schemes."
        )
        return
    raw_body = {"authenticity_token": input_el["value"]}
    await async_session.post(BASE_URL.join(URL(action)), data=raw_body)
