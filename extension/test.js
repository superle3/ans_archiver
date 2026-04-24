// Listen for the background script to send the HTML
const browser = browser ?? chrome;
const current_tab = browser.tabs.getCurrent();
const html = await browser.runtime.sendMessage({
    type: "ready_to_load_html",
    id: current_tab.id,
});

window.addEventListener("load", () => {
    browser.runtime.sendMessage({ type: "loaded_html", id: current_tab.id });
});
const parser = new DOMParser();
const parsed_html = parser.parseFromString(html, "text/html");
const html_tag = parsed_html.querySelector("html");
document.documentElement.innerHTML = html_tag.innerHTML;
c;
