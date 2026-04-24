import { Session } from "./session";
import { download_pdf } from "./submission_pdf";
import { FileInfo, PdfFileInfo, createAnswerHtml, push_progress } from "./submissions";
import * as v from "valibot";

export async function download_attempt(
    html: Document,
    url: URL,
    session: Session,
): Promise<FileInfo[]> {
    const files: Promise<PdfFileInfo | FileInfo>[] = [];
    html.querySelectorAll(
        'button[data-url][data-file-extension=".pdf"][data-file-type="pdf"]',
    ).forEach((element) => {
        const file = download_pdf(element, html, session);
        files.push(push_progress("attempt_pdf", file));
    });

    html_attempt: {
        break html_attempt;
        const file = {
            content: "",
            directory: "" as const,
            filename: "attempt.html" as const,
        };
        try {
            const html_clone = html.cloneNode(true) as Document;
            await extract_attempt_html_breakable(html_clone);
            file.content = html_clone.documentElement.outerHTML;
            // Force a reflow by reading a layout property
            document.body.innerHTML = html_clone.body.innerHTML;
            // Then manually copy attributes from the clone's body to the real body
            for (const attr of html_clone.body.attributes) {
                document.body.setAttribute(attr.name, attr.value);
            }
            files.push(
                push_progress("attempt_html", new Promise((resolve) => resolve(file))),
            );
            break html_attempt;
        } catch (e) {
            console.error("fancy html extraction failed", e);
        }
        const attempt_el = html.querySelector(
            "div[data-current-user-id][data-assignment-id]",
        );
        if (!(attempt_el instanceof HTMLElement)) break html_attempt;
        const { main, page } = createAnswerHtml(html);
        attempt_el.style.cssText = "";
        main.append(attempt_el);
        const content_ids = html.querySelector("div[data-js-review-ids]");
        if (content_ids instanceof HTMLElement) {
            main.append(content_ids);
        }
        file.content = page.documentElement.outerHTML;
        files.push(
            push_progress("attempt_html", new Promise((resolve) => resolve(file))),
        );
    }
    const fullfilled_pdfs = await Promise.all(files);
    return fullfilled_pdfs;
}

async function extract_attempt_html_breakable(html: Document) {
    const main = html.querySelector("main")!;
    const attempt_container = main.querySelector("div.split-screen__panel")!;
    const annot = main.querySelector("div.handle")!;
    attempt_container.parentElement!.replaceChildren(annot, attempt_container);
    const html_attempt = attempt_container.querySelector(
        "div > div[data-assignment-id][data-current-user-id]",
    )!;
    const annot_panel = attempt_container.querySelector("#annotations-panel")!;
    function parents(node: Node | null) {
        var nodes = [node];
        for (; node; node = node.parentNode) {
            nodes.unshift(node);
        }
        return nodes;
    }

    function commonAncestor(node1: Node, node2: Node) {
        var parents1 = parents(node1);
        var parents2 = parents(node2);

        if (parents1[0] != parents2[0]) throw "No common ancestor!";

        for (var i = 0; i < parents1.length; i++) {
            if (parents1[i] != parents2[i]) return parents1[i - 1];
        }
    }
    attempt_container.replaceChildren(commonAncestor(annot_panel, html_attempt)!);
    const header = main.querySelector("header")!;
    const title = header.querySelector("h1")!;
    let parentElement: HTMLElement = title;
    while (parentElement !== header) {
        parentElement.parentElement!.replaceChildren(parentElement);
        parentElement = parentElement.parentElement!;
    }
    const attempt = attempt_container.querySelector(
        "div[data-current-user-id][data-assignment-id]",
    )!;
    attempt.parentElement!.replaceChildren(attempt);
    await applyHighlights(html);
}

const a = [
    {
        identifier: "7483d305-2722-4e7f-8387-c15bb71815d1",
        can_delete: false,
        comments_user_ids: [1982453],
        content: "Ln=n31",
        backward: false,
        start_offset: 13,
        end_offset: 20,
        common_ancestor_identifier: "152f93bd",
        color: "yellow",
        common_ancestor_node_type: "DIV",
        user_id: 1982453,
        id: null,
    },
];
const HighlightIdsSchema = v.pipe(v.string(), v.parseJson(), v.array(v.number()));
const HighlightResponseSchema = v.array(
    v.object({
        identifier: v.string(),
        can_delete: v.boolean(),
        comments_user_ids: v.array(v.union([v.number(), v.null()])),
        content: v.string(),
        backward: v.boolean(),
        start_offset: v.number(),
        end_offset: v.number(),
        common_ancestor_identifier: v.string(),
        color: v.string(),
        common_ancestor_node_type: v.string(),
        user_id: v.number(),
        id: v.union([v.number(), v.null()]),
    }),
);

async function applyHighlights(doc: Document) {
    const tracker = doc.querySelector("[data-js-responses-with-highlights]");
    const ids = v.parse(
        HighlightIdsSchema,
        tracker?.getAttribute("data-js-responses-with-highlights") || "[]",
    );
    const highlights = await Promise.all(
        ids.map(async (id) => {
            const response = await fetch(`https://ans.app/responses/${id}/highlights`);
            const content = await response.json();
            console.log(content);
            return v.parse(HighlightResponseSchema, content);
        }),
    );
    const user_id = document
        .querySelector("[data-current-user-id]")
        ?.getAttribute("data-current-user-id");
    const injected_script = (
        highlights: v.InferOutput<typeof HighlightResponseSchema>[],
        ids: v.InferOutput<typeof HighlightIdsSchema>,
        user_id: string,
    ) => {
        const addDataAttributesToElements = (
            anyElements: { dataset: unknown }[],
            dataAttributesArray: string[][],
        ) => {
            if (dataAttributesArray.length > 0) {
                for (let iter = 0; iter < anyElements.length; iter += 1) {
                    for (let iter1 = 0; iter1 < dataAttributesArray.length; iter1 += 1) {
                        if (anyElements[iter].dataset) {
                            anyElements[iter].dataset[dataAttributesArray[iter1][0]] =
                                dataAttributesArray[iter1][1];
                        }
                    }
                }
            }
        };
        async function getRangy() {
            const [rangy] = await Promise.all([
                //@ts-ignore
                import("rangy/lib/rangy-core"),
                //@ts-ignore
                import("rangy/lib/rangy-classapplier"),
            ]);
            return rangy.default;
        }
        getRangy().then((rangy) => {
            const selection = rangy.getSelection();
            let classApplier;
            let elementSet;
            for (let i = 0; i < ids.length; i++) {
                const id = ids[i];
                const highlight = highlights[i];
                const container = document.querySelector(
                    `[data-highlightable-id="${id}"]`,
                );

                if (!container) {
                    console.warn(`No container for highlightable id ${id}`);
                    continue;
                }

                highlight.forEach((hl) => {
                    const className = "highlight-identifier-" + hl.identifier;
                    const containerNode = container.querySelector(
                        `${hl.common_ancestor_node_type}[data-chnode='${hl.common_ancestor_identifier}']`,
                    ); // eslint-disable-line max-len
                    const commentable =
                        hl.comments_user_ids.includes(null) ||
                        hl.comments_user_ids.includes(Number(user_id)); // eslint-disable-line max-len
                    const clickAction = hl.can_delete
                        ? "click->highlights#openHighlightToolTip"
                        : "";
                    if (containerNode !== undefined) {
                        const bookmarkObject = {
                            backward: hl.backward,
                            rangeBookmarks: [
                                {
                                    start: hl.start_offset,
                                    end: hl.end_offset,
                                    containerNode,
                                },
                            ],
                        };
                        classApplier = rangy.createClassApplier(
                            "highlight-identifier-" + hl.identifier,
                            {
                                // eslint-disable-line max-len
                                elementProperties: {
                                    className: `highlight-color-${hl.color}`,
                                },
                            },
                        );
                        selection.moveToBookmark(bookmarkObject);
                        classApplier.applyToSelection();
                        elementSet = container.getElementsByClassName(className);
                        addDataAttributesToElements(elementSet, [
                            ["highlightId", hl.identifier],
                            ["removable", hl.can_delete],
                            ["commentable", commentable],
                            ["highlightsTarget", "highlight"],
                            ["action", clickAction],
                            ["highlightsIdParam", hl.identifier],
                            ["color", hl.color],
                        ]);
                    }
                });
                //     const range = document.createRange();

                //     // "The Readable Way": Get all text nodes as a flat array
                //     const textNodes = [];
                //     const walker = document.createTreeWalker(
                //         container,
                //         NodeFilter.SHOW_TEXT,
                //     );
                //     while (walker.nextNode()) textNodes.push(walker.currentNode);

                //     // Find start and end positions by mapping lengths
                //     let charCount = 0;
                //     let startNode, endNode, startOffset, endOffset;

                //     for (const node of textNodes) {
                //         const nodeLength = node.textContent.length;

                //         // Logical "checkpoints" for Start
                //         if (!startNode && charCount + nodeLength >= hl.start_offset) {
                //             startNode = node;
                //             startOffset = hl.start_offset - charCount;
                //         }

                //         // Logical "checkpoints" for End
                //         if (!endNode && charCount + nodeLength >= hl.end_offset) {
                //             endNode = node;
                //             endOffset = hl.end_offset - charCount;
                //             break; // We found both, stop looking
                //         }

                //         charCount += nodeLength;
                //     }

                //     if (startNode && endNode) {
                //         range.setStart(startNode, startOffset);
                //         range.setEnd(endNode, endOffset);

                //         const mark = document.createElement("mark");
                //         mark.className = `highlight-color-${hl.color}`;
                //         // Instead of surroundContents
                //         mark.appendChild(range.extractContents());
                //         range.insertNode(mark);
                //         // range.surroundContents(mark);
                //     }
                // });
            }
        });
    };
    const script = doc.createElement("script");
    const raw_script = `(${injected_script.toString()})(${JSON.stringify(highlights)}, ${JSON.stringify(ids)})`;
    console.log(raw_script);
    tracker?.appendChild(script);
}
