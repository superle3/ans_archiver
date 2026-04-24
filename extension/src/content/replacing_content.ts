import browserT from "webextension-polyfill";
import * as v from "valibot";

const RequestContent = v.object({
    type: v.literal("print_pdf"),
    detail: v.string(),
});
console.log(RequestContent, "RequestContent");
const browser = (window.chrome ?? window.browser) as typeof browserT;
const id = +new URL(window.location.href).searchParams.get("print_id")!;
async function load_html() {
    // Listen for the background script to send the HTML
    const html = await browser.runtime.sendMessage({
        type: "ready_to_load_html",
    });
    if (!v.is(v.string(), html)) {
        throw new Error("not a string" + html);
    }

    const parser = new DOMParser();
    const parsed_html = parser.parseFromString(html, "text/html");
    const html_tag = parsed_html.documentElement;
    document.documentElement.replaceChildren(...html_tag.children);
    console.log("loaded_html");
    browser.runtime.sendMessage({ type: "loaded_html" });
}

load_html();
