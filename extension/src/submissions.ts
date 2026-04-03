// import { PyMuPDF } from "@bentopdf/pymupdf-wasm";
import { AnnotationFactory } from "annotpdf";
import * as v from "valibot";
import { loadPyMuPDF } from "./bentopdf/pymupdf-loader";
import { PyMuPDFDocument } from "@bentopdf/pymupdf-wasm";

export async function get_submission(url: URL, session: typeof fetch) {
    //
    const response = await session(url, { method: "GET" });
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
export type FileInfo = {
    filename: string;
    content: string | Blob;
    directory: string;
};
export type PdfFileInfo = {
    filename: string;
    content: Blob;
    directory: string;
};
export async function get_answers(url: URL, session: typeof fetch) {
    const url_no_query = new URL(url.pathname, url.origin);
    const response = await session(url_no_query);
    const parser = new DOMParser();
    const html = parser.parseFromString(await response.text(), "text/html");
    const tasks: Promise<FileInfo[] | FileInfo>[] = [];
    tasks.push(download_questions(html, url_no_query, session));
    tasks.push(download_attempt(html, url_no_query, session));
    const files = (await Promise.all(tasks)).flat().filter((file) => !!file);
    return files;
}

async function download_attempt(
    html: Document,
    url: URL,
    session: typeof fetch,
): Promise<FileInfo[]> {
    const files: Promise<(PdfFileInfo & { url: URL }) | void>[] = [];
    html.querySelectorAll(
        'button[data-url][data-file-extension=".pdf"][data-file-type="pdf"]',
    ).forEach((element) =>
        files.push(
            (async () => {
                const pdf_href = element.getAttribute("data-url")!;
                const pdf_url = new URL(pdf_href);
                const filename = pdf_url.searchParams.get("filename") ?? "attempt.pdf";
                const response = await session(pdf_url);
                const content = await response.blob();
                return {
                    content,
                    filename,
                    directory: ".",
                    url: pdf_url,
                };
            })(),
        ),
    );
    const pdf_files = (await Promise.all(files)).filter((file) => !!file);
    const annotated_pdf_files = pdf_files.map(async (file): Promise<PdfFileInfo> => {
        const PyMuPDF = await loadPyMuPDF();
        const pdf_doc = await PyMuPDF.open(file.content);
        const annotations = await get_annotations_from_html(html, file.url, session);
        const annotated_pdf = annotate_pdf_pymudf(pdf_doc, annotations, html);
        const content = annotated_pdf.saveAsBlob();
        annotated_pdf.close();
        const { filename, directory } = file;
        return {
            filename,
            directory,
            content,
        };
    });
    const fullfilled_pdfs = await Promise.all(annotated_pdf_files);
    return fullfilled_pdfs;
}

function parseColor(input: string) {
    const div = document.createElement("div");
    div.style.color = input;
    const m = div.style.color.match(/^rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i);
    if (m) return [+m[1], +m[2], +m[3]];
    else throw new Error("Colour " + input + " could not be parsed." + m);
}

type Rectangle = [number, number, number, number];
function annotate_pdf_pymudf(
    doc: PyMuPDFDocument,
    annotation_data: Annotation,
    html: Document,
) {
    const content = annotation_data.content;
    const point_comments = content.filter((annotation) => annotation.type === "point");
    const drawings = content.filter((annotation) => annotation.type === "drawing");
    const page_numbers = new Set(content.map((comment) => comment.page).filter((t) => t));
    const pages = Object.fromEntries(
        Array.from(page_numbers).map((page) => [page, doc.getPage(page - 1)]),
    );

    for (const comment of point_comments) {
        const turbo_frame = html.querySelector(
            `turbo-frame[id="annotation_${comment.uuid}"]`,
        );
        if (!turbo_frame) {
            console.error(`turbo-frame not found for`, comment);
            continue;
        }
        const article = turbo_frame.querySelector("article");
        if (!article) {
            console.error(`article not found for`, comment);
            continue;
        }
        const page_count = comment.page;
        const { x, y } = comment;
        const page = pages[page_count];
        const text = article.textContent.trim().replace(/(["\\])/g, "\\$1");
        console.log(text);
        page.addTextAnnotation({ x, y }, text);
    }
    for (const drawing of drawings) {
        console.log(1);
        const page_count = drawing.page;
        const width = drawing.width / 2;

        const parsed_color = parseColor(drawing.color);
        const color_rec = {
            r: parsed_color[0] / 255,
            g: parsed_color[1] / 255,
            b: parsed_color[2] / 255,
        };
        const page = pages[page_count];
        const lines = drawing.lines;
        for (let i = 0; i < lines.length - 1; i++) {
            const point1 = { x: lines[i][0], y: lines[i][1] };
            const point2 = { x: lines[i + 1][0], y: lines[i + 1][1] };
            page.drawLine(point1, point2, color_rec, drawing.width);
        }
    }
    return doc;
}
// failed attempt of trying to use javascript native
function annotate_pdf(
    doc: AnnotationFactory,
    annotation_data: Annotation,
    html: Document,
) {
    const content = annotation_data.content;
    const point_comments = content.filter((annotation) => annotation.type === "point");
    const drawings = content.filter((annotation) => annotation.type === "drawing");

    for (const comment of point_comments) {
        const turbo_frame = html.querySelector(
            `turbo-frame[id="annotation_${comment.uuid}"]`,
        );
        if (!turbo_frame) {
            console.error(`turbo-frame not found for`, comment);
            continue;
        }
        const article = turbo_frame.querySelector("article");
        if (!article) {
            console.error(`article not found for`, comment);
            continue;
        }
        const page_count = comment.page;
        const { x, y } = comment;
        const rect = [x, y, x, y];
        doc.createTextAnnotation(
            page_count - 1,
            rect,
            article.textContent.trim(),
            "Annotation from ANS",
        );
    }
    for (const drawing of drawings) {
        console.log(1);
        const page_count = drawing.page;
        const width = drawing.width / 2;
        const rectangles = drawing.lines.map(
            (line): Rectangle => [
                line[0] - width,
                line[1] - width,
                line[0] + width,
                line[1] + width,
            ],
        );
        // const xs = rectangles.map((rectangle) => [rectangle[0], rectangle[2]]).flat();
        // const ys = rectangles.map((rectangle) => [rectangle[1], rectangle[3]]).flat();
        const xs = drawing.lines.map((line) => line[0]).flat();
        const ys = drawing.lines.map((line) => line[1] + 200).flat();
        const max_x = Math.max(...xs);
        const min_x = Math.min(...xs);
        const max_y = Math.max(...ys);
        const min_y = Math.min(...ys);

        const parsed_color = parseColor(drawing.color);
        const color_rec = { r: parsed_color[0], g: parsed_color[1], b: parsed_color[2] };
        const rec = [max_x, max_y, min_x, min_y];

        let lines: number[] = [];
        for (let i = 0; i < xs.length; i++) {
            lines.push(xs[i], ys[i]);
        }
        if (page_count === 13) {
            console.log(lines);
        }
        doc.createPolyLineAnnotation(
            page_count - 1,
            rec,
            "",
            "Annotations from ANS",
            lines,
            color_rec,
        );
    }
    const rect = [0, 0, 1000, 2000];
    doc.createPolyLineAnnotation(
        0,
        rect,
        "",
        "",
        [1, 1, 99, 99, 88, 88, 55, 10, 997, 1460],
        {
            r: 0,
            g: 255,
            b: 0,
        },
    );
    return doc;
}

const AnnotationSchema = v.object({
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
type Annotation = v.InferOutput<typeof AnnotationSchema>;
async function get_annotations_from_html(
    doc: Document,
    url: URL,
    session: typeof fetch,
): Promise<Annotation> {
    /*
     <button type="button" class="mdc-tab mdc-tab--active" role="tab" aria-selected="true" tabindex="0" data-js-file-tab="" data-upload-id="24869267" data-url="https://d7e0acfd15964dc2a2412dbfcdebc202.objectstore.eu/ans/15-339077-794232%2Fexams%2F2004739-10225767.pdf?temp_url_sig=9b3b8be4c80ce35e668373c9e9c9cd8d8a5323fe&amp;temp_url_expires=1775255399&amp;filename=2004739-10225767-c5e496a8.pdf" data-file-type="pdf" data-file-extension=".pdf" data-downloadable="false" data-pages-with-annotations="[3,12,13,15,18,22,25,26]" data-rotation="0" data-mdc-auto-init="MDCTab" data-action="click-&gt;annotations-panel#clearPanel click-&gt;annotations-panel#showButton click-&gt;annotations#refreshPanel" data-page="[12,13,14]" data-position-start="26.3683"><span class="mdc-tab__content"><h2 class="f6 mdc-tab__text-label--truncate">Result</h2></span><span class="mdc-tab-indicator"><span class="mdc-tab-indicator__content mdc-tab-indicator__content--underline"></span></span><span class="mdc-tab__ripple"></span></button>

        */
    const annotation_html = doc.querySelector(
        `button[data-pages-with-annotations][data-url="${url.href}"][data-upload-id]`,
    );
    const empty = { content: [], upload_id: -1 };
    if (!annotation_html) {
        console.error("empty");
        return empty;
    }
    const pages_with_annotations: number[] = JSON.parse(
        annotation_html.getAttribute("data-pages-with-annotations")!,
    );
    if (!pages_with_annotations.length) {
        return empty;
    }
    const data_upload_id = annotation_html.getAttribute("data-upload-id")!;
    const request_url = new URL(`uploads/${data_upload_id}/annotations`, BASE_URL);
    const response = await session(request_url);
    try {
        const annotation_data = v.safeParse(AnnotationSchema, await response.json());
        if (annotation_data.success) {
            return annotation_data.output;
        } else {
            console.error("validating failed", annotation_data.issues);
            return empty;
        }
    } catch (e) {
        logger.error(
            `Failed to get annotations JSON for url=${request_url}, ${pages_with_annotations}, fromUrl=${url}`,
        );
        console.error(e);
        return empty;
    }
}

async function download_questions(
    html: Document,
    url: URL,
    session: typeof fetch,
): Promise<FileInfo> {
    const current_id = url.pathname.match(/\/(\d+)\/?$/)![1];
    const url_no_id = new URL(url.pathname.replace(/\/\d+\/?$/, "/"), url.origin);
    const questions = html.querySelectorAll('div[data-cy="submission-button"]');
    const { page, body, head, main, html: html_tag } = createAnswerHtml(html);
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
                const response = await session(url, { method: "GET" });
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
    // body.append(main);
    const i18n_temp_div = document.createElement("div");
    i18n_temp_div.setAttribute("data-js-i18n", "");
    i18n_temp_div.setAttribute("data-default-locale", "nl");
    i18n_temp_div.setAttribute("data-locale", "nl");
    const i18n = html.querySelector("div[data-js-i18n]") ?? i18n_temp_div;
    body.append(i18n);
    // page.append(body);
    return {
        filename: "grading_panel.html",
        content: page.documentElement.outerHTML,
        directory: ".",
    };
}

function createAnswerHtml(htmlDoc: Document) {
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

async function download_submission(content: Document) {
    //
}
