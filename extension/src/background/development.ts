import browser2 from "webextension-polyfill";
const browser = (globalThis.browser || globalThis.chrome) as typeof browser2;
export function reload_tabs() {
    browser.runtime.onInstalled.addListener(async (details) => {
        if (details.reason === "update" || details.reason === "install") {
            const tabs = await browser.tabs.query({
                url: ["http://ans.app/*", "https://ans.app/*"],
            });
            for (const tab of tabs) {
                browser.tabs.reload(tab.id);
            }
            console.log(`Reloaded ${tabs.length} tabs.`);
        }
    });
}
export default [reload_tabs];
