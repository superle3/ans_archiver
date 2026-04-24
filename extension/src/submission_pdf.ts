import { PyMuPDFDocument } from "@bentopdf/pymupdf-wasm";
import { Annotation, AnnotationSchema, parseColor, PdfFileInfo } from "./submissions";
import { loadPyMuPDF } from "./bentopdf/pymupdf-loader";
import { Session } from "./session";
import * as v from "valibot";

export function annotate_pdf_pymudf(
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
        page.addTextAnnotation({ x, y }, text);
    }
    for (const drawing of drawings) {
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
export async function download_pdf(
    element: Element,
    html: Document,
    session: Session,
): Promise<PdfFileInfo> {
    const pdf_href = element.getAttribute("data-url")!;
    const pdf_url = new URL(pdf_href);
    const filename =
        (pdf_url.searchParams.get("filename") as `${string}.pdf`) ?? "attempt_scan.pdf";
    const response = await session.get(pdf_url);
    const raw_pdf_content = await response.blob();
    const PyMuPDF = await loadPyMuPDF();
    const pdf_doc = await PyMuPDF.open(raw_pdf_content);
    const annotations = await get_annotations_from_html(html, pdf_url, session);
    const annotated_pdf = annotate_pdf_pymudf(pdf_doc, annotations, html);
    const content = annotated_pdf.saveAsBlob();
    annotated_pdf.close();
    return {
        filename,
        directory: "",
        content,
    };
}
export async function get_annotations_from_html(
    doc: Document,
    url: URL,
    session: Session,
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
    const response = await session.get(request_url);
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
