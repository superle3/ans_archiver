import { HrefResponse } from "./types";
import { FileInfo, get_answers } from "./submissions";
import { downloadZip } from "client-zip";

declare global {
    var logger: {
        debug: (...msg: string[]) => void;
        info: (...msg: string[]) => void;
        verbose: (...msg: string[]) => void;
        error: (...msg: string[]) => void;
        warn: (...msg: string[]) => void;
    };
    var BASE_URL: URL;
}
window.logger = {
    debug: console.debug,
    info: console.info,
    verbose: console.log,
    error: console.error,
    warn: console.warn,
};
window.BASE_URL = new URL("https://ans.app/");
function isHrefLocation(obj: unknown): obj is HrefResponse {
    if (
        typeof obj === "object" &&
        obj !== null &&
        "href" in obj &&
        typeof obj.href === "string"
    )
        return true;
    return false;
}
function main(href: string) {
    setTimeout(() => {
        try {
            main_timeout(href);
        } catch (e) {
            console.log(e);
        }
    }, 100);
}
function main_timeout(href: string) {
    if (
        href.includes("results") ||
        href.includes("grading/view") ||
        href.includes("grading/go_to") ||
        /\/assignments\/\d+(?!\/grading)/.test(href) ||
        /\/assignments(?!\/\d+)/.test(href) ||
        /\/courses\??/.test(href)
    ) {
        let downloadButton = document.getElementById("download_button");
        if (!downloadButton) {
            const toolbar = document.querySelector('section[role="toolbar"]')!;
            downloadButton = document.createElement("button");
            downloadButton.setAttribute(
                "class",
                "mdc-top-app-bar__action-item mdc-button mdc-button--white ml-2 ",
            );
            downloadButton.setAttribute("id", "download_button");
            downloadButton.appendChild(document.createTextNode("Download"));
            toolbar.appendChild(downloadButton);
        }
        downloadButton.addEventListener("click", async (event) => {
            const files = await download_current_results(href);
            const zipfile = await downloadZip(
                files
                    .filter((file) => !!file)
                    .map((file) => ({
                        name: joinPath(file.directory, file.filename),
                        input: file.content,
                    })),
            ).blob();
            const link = document.createElement("a");
            const link_href = URL.createObjectURL(zipfile);
            link.href = link_href;
            link.download = "archive.zip";
            link.click();
            link.remove();
            URL.revokeObjectURL(link_href);
        });
    }
}
async function fetch_html(url: URL) {
    const response = await fetch(url);
    const content = await response.text();
    const parser = new DOMParser();
    return parser.parseFromString(content, "text/html");
}

async function download_grading(doc: Document = document) {
    const results_href = doc.querySelector('a[href*="/results/"]')?.getAttribute("href");
    if (!results_href) {
        return [];
    }
    const url = new URL(results_href, BASE_URL);
    const html = await fetch_html(url);
    return await download_results(html);
}
function joinPath(...paths: string[]): string {
    return paths.map((path) => path.replace(/^\/|\/?$/, "")).join("/");
}
async function download_results(doc: Document = document): Promise<FileInfo[]> {
    const el = doc.querySelector('a[href*="/grading/"]');
    if (!el) return [];
    const url = new URL(el.getAttribute("href")!, BASE_URL);
    const files = await download_answer(url);
    const dir = parse_title_from_results(doc);
    return files.map((file) => ({
        ...file,
        directory: joinPath(file.directory, dir),
    }));
}
async function download_current_results(
    href: string,
    doc: Document = document,
): Promise<(FileInfo | void)[]> {
    href = new URL(href).pathname;
    if (href.startsWith("/results")) {
        return download_results(doc);
    } else if (href.startsWith("/digital_test/results")) {
        return download_from_description(doc);
    } else if (/assignments\/\d+(?!\/grading)/.test(href)) {
        return await download_from_description(doc);
    } else if (/assignments(?!\/\d+)/.test(href)) {
        return await download_from_assignments(doc);
    } else if (href.includes("grading/")) {
        return await download_grading(doc);
    } else if (href.endsWith("courses")) {
        return await download_from_courses(doc);
    } else if (href.startsWith("/digital_test/subsets")) {
        // not implemented
        return [];
    } else {
        console.error(`url not implemented href=${href}`);
        return [];
    }
}

function safe_parse_int(int: string): number | null {
    try {
        return parseInt(int, 10);
    } catch {
        return null;
    }
}
async function download_from_courses(doc: Document = document): Promise<FileInfo[]> {
    const courses: string[] = [];
    let new_doc: Document = doc;
    while (true) {
        new_doc.querySelectorAll('a[href^="/routing/courses/"]').forEach((el) => {
            const href = el.getAttribute("href");
            if (href) {
                courses.push(new URL(href, BASE_URL).href);
            }
        });
        const more_pages_href = new_doc
            .querySelector("*[data-js-pagy-load-more]")
            ?.querySelector('a[href*="courses"]')
            ?.getAttribute("href");
        if (!more_pages_href) {
            break;
        }
        const url = new URL(more_pages_href, BASE_URL);
        new_doc = await fetch_html(url);
    }
    const files = await Promise.all(
        Array.from(new Set(courses)).map(async (course) => {
            const html = await fetch_html(new URL(course));
            return await download_from_assignments(html);
        }),
    );
    return files.flat().filter((file) => !!file);
}

function parse_title_from_results(doc: Document): string {
    const breadcrumbs = doc.querySelectorAll("li.breadcrumb-item-wrapper");
    if (!breadcrumbs || breadcrumbs.length < 3) {
        return "no_title_found";
    }
    const course = breadcrumbs.item(1).querySelector(".breadcrumb-item")?.textContent;
    const assignment_name = breadcrumbs
        .item(2)
        .querySelector(".breadcrumb-item")?.textContent;
    if (!course || !assignment_name) {
        return "no_title_found";
    }
    return "/" + sanitize_directories([course, assignment_name]).join("/");
}

function sanitize_directory(dir: string): string {
    return dir.replace(/[\\\/:\?\*\"\<\>\|]/g, "_");
}
function sanitize_directories(dirs: string[]): string[] {
    return dirs.map((dir) => sanitize_directory(dir));
}

async function download_from_assignments(doc: Document) {
    const files: Promise<(FileInfo | void)[]>[] = [];
    doc.querySelectorAll('a[href*="/go_to"').forEach((el) =>
        files.push(
            (async () => {
                const href = el.getAttribute("href")!;
                const url = new URL(href, BASE_URL);
                const response = await fetch(url);
                const content = await response.text();
                const parser = new DOMParser();
                const new_doc = parser.parseFromString(content, "text/html");
                console.log(response.url);
                return await download_current_results(response.url, new_doc);
            })(),
        ),
    );
    const await_files = await Promise.all(files);
    return await_files.flat().filter((file) => {
        return file;
    });
}

async function download_from_description(doc: Document = document) {
    const el = doc.querySelector('a[href*="/results/"');
    const href = el?.getAttribute("href");
    if (!href) {
        return [];
    }
    const results_href = new URL(href, BASE_URL);
    const response = await fetch(results_href);
    const content = await response.text();
    const parser = new DOMParser();
    const new_doc = parser.parseFromString(content, "text/html");
    return await download_current_results(results_href.href, new_doc);
}
// console.log(answers[0]);
async function download_answer(url: URL) {
    return await get_answers(
        new URL(url.href),
        async (arg1: URL | RequestInfo, arg2?: RequestInit) => {
            return await fetch(arg1, arg2);
        },
    );
}

console.log(2);
window.addEventListener("popstate", (event) => {
    const href = window.location.href;
    logger.info(href);
    main(href);
});
function watchHistoryEvents() {
    const { pushState, replaceState } = window.history;

    window.history.pushState = function (...args) {
        pushState.apply(window.history, args);
        window.dispatchEvent(new Event("pushState1"));
    };

    window.history.replaceState = function (...args) {
        replaceState.apply(window.history, args);
        window.dispatchEvent(new Event("replaceState1"));
    };

    window.addEventListener("popstate", () => console.log("popstate event"));
    window.addEventListener("replaceState1", () => console.log("replaceState event"));
    window.addEventListener("pushState1", () => console.log("pushState event"));
}
watchHistoryEvents();
let oldHref = window.location.href;
window.addEventListener("pushState1", (event) => {
    const href = window.location.href;
    if (oldHref === href) return;
    oldHref = href;
    logger.info(href);
    main(href);
});
window.addEventListener("replaceState1", (event) => {
    const href = window.location.href;
    if (oldHref === href) return;
    oldHref = href;
    logger.info(href);
    main(href);
});

window.addEventListener("DOMContentLoaded", (event) => {
    console.log("load");
    const href = window.location.href;
    if (oldHref === href) return;
    oldHref = href;
    logger.info(href);
});
main(window.location.href);
