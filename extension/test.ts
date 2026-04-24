import fs from "fs";
import path from "path";

const file = fs.readFileSync(path.join(__dirname, "test2.html"), "utf8");
const parser = new DOMParser();
const html = parser.parseFromString(file, "text/html");
html.querySelectorAll("div[data-current-user-id][data-assignment-id]").forEach(
    (element) => {
        console.log(element.outerHTML);
    },
);
