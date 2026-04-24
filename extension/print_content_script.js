async function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
async function load_html() {
    // Listen for the background script to send the HTML
    const browser = window.browser ?? window.chrome;
    const current_tab = await browser.tabs.getCurrent();
    console.log("ready_to_load_html", current_tab.id);
    const html = await browser.runtime.sendMessage({
        type: "ready_to_load_html",
        id: current_tab.id,
    });
    window.addEventListener("load", () => {
        console.log("loaded");
        browser.runtime.sendMessage({ type: "loaded_html", id: current_tab.id });
    });
    // const parser = new DOMParser();
    // const parsed_html = parser.parseFromString(html, "text/html");
    // const html_tag = parsed_html.documentElement;
    // document.documentElement.replaceChildren(...html_tag.children);
}
load_html();
