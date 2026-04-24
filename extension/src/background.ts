import browser2 from "webextension-polyfill";
import { hasKeys, isObject } from "./types";
import * as v from "valibot";
import development from "./background/development";
development.forEach((fn) => fn());
const browser = (globalThis.browser || globalThis.chrome) as typeof browser2;
type PrintPdfRequest = {
    type: "print_pdf";
    detail: string;
};
function isPrintPdfRequest(obj: unknown): obj is PrintPdfRequest {
    if (
        typeof obj === "object" &&
        obj !== null &&
        "type" in obj &&
        "type" in obj &&
        obj.type === "print_pdf"
    ) {
        return true;
    }
    return false;
}
async function getBase64(html: string) {
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            // reader.result will be the full "data:text/html;charset=utf-8;base64,..." string
            resolve(reader.result);
        };
        reader.readAsDataURL(blob);
    });
}
async function getRootFrame(tabId: number) {
    return new Promise((resolve) => {
        chrome.debugger.sendCommand({ tabId }, "Page.getFrameTree", {}, (result) => {
            resolve(result.frameTree.frame.id);
        });
    });
}
browser.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (!isPrintPdfRequest(request)) return true;
    (async () => {
        let html_data;
        // const encoder = new TextEncoder();
        // const data = encoder.encode(request.detail);
        // html_data = "data:text/html;base64," + btoa(String.fromCharCode(...data));
        // html_data = await getBase64(request.detail);
        // html_data = "data:text/html;base64," + btoa(request.detail);
        const tab = await browser.tabs.create({
            active: false,
            url: "https://ans.app?print_pdf=true",
        });
        const targetTabId = tab.id;
        console.log("created tab", targetTabId);
        await chrome.debugger.attach({ tabId: targetTabId }, "1.3");
        await chrome.debugger.sendCommand({ tabId: targetTabId }, "Page.enable");
        await load_html(targetTabId, request);
        if (chrome.runtime.lastError) {
            console.error("Attach failed:", chrome.runtime.lastError.message);
            chrome.debugger.detach({ tabId: targetTabId });
            sendResponse({ error: chrome.runtime.lastError.message });
            return;
        }

        await new Promise((resolve) => {
            setTimeout(resolve, 2000);
        });
        // 2. Now you can send the command
        const result = await chrome.debugger.sendCommand(
            { tabId: targetTabId },
            "Page.printToPDF",
            {
                printBackground: true,
                displayHeaderFooter: false,
            },
        );

        if (chrome.runtime.lastError) {
            console.error("PDF Failed:", chrome.runtime.lastError.message);
            sendResponse({ error: chrome.runtime.lastError.message });
        } else {
            console.log("received pdf", result);
            sendResponse({ val: result.data });
        }

        // 3. IMPORTANT: Detach when finished
        chrome.debugger.detach({ tabId: targetTabId });
        await browser.tabs.remove(targetTabId as number);
    })().catch((e) => console.trace(e));
    return true;
});
const readyToLoadHtmlRequest = v.object({
    type: v.literal("ready_to_load_html"),
});
const loadedHtmlRequest = v.object({
    type: v.literal("loaded_html"),
});
type onMessageCallback = browser.Runtime.OnMessageListenerCallback;
async function load_html(targetTabId: number, request: PrintPdfRequest) {
    const promise1 = new Promise((resolve) => {
        const callback: onMessageCallback = (message, sender, sendResponse) => {
            if (!v.is(readyToLoadHtmlRequest, message)) return true;
            if (sender.tab?.id !== targetTabId) return true;
            console.log("callback", targetTabId, message);

            console.log("ready_to_load_html", targetTabId);
            sendResponse(request.detail);
            resolve(0);
            browser.runtime.onMessage.removeListener(callback);
            return true;
        };
        browser.runtime.onMessage.addListener(callback);
    });
    const promise2 = new Promise((resolve) => {
        const callback: onMessageCallback = (message, sender, sendResponse) => {
            if (!v.is(loadedHtmlRequest, message)) return true;
            if (sender.tab?.id !== targetTabId) return true;
            sendResponse({ detail: "loaded" });
            resolve(0);
            browser.runtime.onMessage.removeListener(callback);
            return true;
        };
        browser.runtime.onMessage.addListener(callback);
    });
    await promise1;
    await promise2;
}
