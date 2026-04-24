// import { PyMuPDF } from "@bentopdf/pymupdf-wasm";
import { AnnotationFactory } from "annotpdf";
import * as v from "valibot";
import { Session } from "./session";
import { progresElement, progress_callback } from "./world";
import { download_attempt } from "./submission_attempt";

export type ProgressTypes = "add" | "complete";
export async function get_submission(url: URL, session: Session) {
    //
    const response = await session.get(url);
    const content = await response.text();
    const parser = new DOMParser();
    const html = parser.parseFromString(content, "text/html");
    const href = html.querySelector('a[href*="/grading/view"]')?.getAttribute("href");
    if (!href) {
        logger.debug("error");
        return null;
    }
    const assignment_link = new URL(href, BASE_URL);
    return await get_answers(assignment_link, session);
}
export type HTMLFileInfo = {
    filename: `${string}.html`;
    content: string;
    directory: string;
};
export type FileInfo = HTMLFileInfo | PdfFileInfo;
export type PdfFileInfo = {
    filename: `${string}.pdf`;
    content: Blob;
    directory: string;
};
export const upgrade_types = {
    attempt_pdf: "Attemps as pdfs",
    attempt_html: "Attemps as html",
    questions: "Questions",
    courses: "Courses",
    assignments: "Assignments",
} as const;

export async function push_progress<T extends unknown>(
    identifier: keyof typeof upgrade_types,
    promise: Promise<T>,
) {
    update_progress_bar("add", identifier);
    const result = await promise;
    update_progress_bar("complete", identifier);
    return result;
}

export function update_progress_bar(
    type: ProgressTypes,
    identifier: keyof typeof upgrade_types,
) {
    progress_callback(type, progresElement)({ detail: upgrade_types[identifier] });
}

export async function get_answers(url: URL, session: Session) {
    const url_no_query = new URL(url.pathname, url.origin);
    const response = await session.get(url_no_query);
    const parser = new DOMParser();
    const content = await response.text();
    const html = parser.parseFromString(content, "text/html");
    const html2 = parser.parseFromString(content, "text/html");
    const tasks: Promise<FileInfo[] | FileInfo>[] = [];
    tasks.push(
        push_progress("questions", download_questions(html, url_no_query, session)),
    );
    tasks.push(download_attempt(html2, url_no_query, session));
    const files = (await Promise.all(tasks)).flat().filter((file) => !!file);
    return files;
}

export function parseColor(input: string) {
    const div = document.createElement("div");
    div.style.color = input;
    const m = div.style.color.match(/^rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i);
    if (m) return [+m[1], +m[2], +m[3]];
    else throw new Error("Colour " + input + " could not be parsed." + m);
}

export const AnnotationSchema = v.object({
    upload_id: v.number(),
    content: v.array(
        v.variant("type", [
            v.object({
                class: v.literal("Annotation"),
                uuid: v.string(),
                page: v.number(),
                can_edit: v.boolean(),
                can_comment: v.boolean(),
                type: v.literal("drawing"),
                width: v.number(),
                color: v.string(),
                lines: v.array(v.tuple([v.number(), v.number()])),
            }),
            v.object({
                class: v.literal("Annotation"),
                uuid: v.string(),
                page: v.number(),
                can_edit: v.boolean(),
                can_comment: v.boolean(),
                type: v.literal("point"),
                x: v.number(),
                y: v.number(),
            }),
        ]),
    ),
});
export type Annotation = v.InferOutput<typeof AnnotationSchema>;
async function download_questions(
    html: Document,
    url: URL,
    session: Session,
): Promise<FileInfo> {
    const current_id = url.pathname.match(/\/(\d+)\/?$/)![1];
    const url_no_id = new URL(url.pathname.replace(/\/\d+\/?$/, "/"), url.origin);
    const questions = html.querySelectorAll('div[data-cy="submission-button"]');
    const { page, main } = createAnswerHtml(html);
    const question_links: string[] = [];
    questions.forEach((element) => {
        const link = element
            .querySelector("a[data-submission-id]")
            ?.getAttribute("data-submission-id") as string;
        question_links.push(link);
    });
    const parser = new DOMParser();
    const results = await Promise.all(
        question_links.map(async (link) => {
            if (link === current_id) {
                return html;
            } else {
                const url = new URL(link, url_no_id);
                const response = await session.get(url);
                return parser.parseFromString(await response.text(), "text/html");
            }
        }),
    );
    const schemes = {
        "data-js-grading-panel": grading_scheme_v1,
        "data-js-review-panel": grading_scheme_v2,
    } as const;
    results.map((question_html) => {
        for (const [query, callback] of Object.entries(schemes)) {
            const grading_panel = question_html.querySelector(`div[${query}]`);
            if (!grading_panel) {
                continue;
            }
            callback(main, grading_panel, question_html);
            break;
        }
    });
    return {
        filename: "grading_panel.html",
        content: page.documentElement.outerHTML,
        directory: "",
    };
}

export function createAnswerHtml(htmlDoc: Document) {
    // Create new document structure
    const htmlPage = document.implementation.createHTMLDocument();
    const htmlTag = htmlPage.documentElement;
    const headTag = htmlPage.head;
    const bodyTag = htmlPage.body;
    const mainTag = htmlPage.createElement("main");

    bodyTag.appendChild(mainTag);

    // Copy original head contents
    const originalHeadTag = htmlDoc.querySelector("head");
    if (!originalHeadTag) {
        logger.warn(
            "Javascript and css assets not found, page may not render correctly.",
        );
    } else {
        headTag.replaceChildren(...Array.from(originalHeadTag.childNodes));
    }
    const utf8_encode = document.createElement("meta");
    utf8_encode.setAttribute("charset", "utf-8");
    headTag.appendChild(utf8_encode);

    // Append inline styles
    const styleTag = htmlPage.createElement("style");
    styleTag.textContent = `
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
    `;
    headTag.appendChild(styleTag);

    // Copy original body attributes
    const originalBodyTag = htmlDoc.querySelector("body");
    if (!originalBodyTag) {
        logger.warn(
            "body tag not found, attributes may be missing and page may not render correctly.",
        );
    } else {
        for (const attr of originalBodyTag.attributes) {
            bodyTag.setAttribute(attr.name, attr.value);
        }
    }
    const i18n_temp_div = document.createElement("div");
    i18n_temp_div.setAttribute("data-js-i18n", "");
    i18n_temp_div.setAttribute("data-default-locale", "nl");
    i18n_temp_div.setAttribute("data-locale", "nl");
    const i18n = htmlDoc.querySelector("div[data-js-i18n]") ?? i18n_temp_div;
    bodyTag.append(i18n);

    // Return object matching AnswerHtml structure
    return {
        html: htmlTag,
        body: bodyTag,
        main: mainTag,
        head: headTag,
        page: htmlPage,
    };
}
function grading_scheme_v1(main: HTMLElement, grading_panel: Element, html: Document) {
    main.append(grading_panel);
}
function grading_scheme_v2(main: HTMLElement, grading_panel: Element, html: Document) {
    main.append(grading_panel);
}
