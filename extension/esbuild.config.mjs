/// <reference types="node" />
import esbuild from "esbuild";
import pkg from "@sprout2000/esbuild-copy-plugin";
const { copyPlugin } = pkg;

const prod = process.argv[2] === "production";

/** @type {import('esbuild').BuildOptions[]} */
const build_ctx = [
    {
        target: "ES2022",
        format: "iife",
        bundle: true,
        outdir: "./dist",
        entryPoints: [
            "./src/background.ts",
            "./src/content/content.ts",
            "./src/content/replacing_content.ts",
            "./src/world.ts",
        ],
        external: ["rangy/lib/rangy-classapplier", "rangy/lib/rangy-core"],
        logLevel: "info",
        treeShaking: true,
        plugins: [
            copyPlugin({
                src: "./styles.css",
                dest: "./dist/styles.css",
            }),
        ],
    },
    {
        target: "ES2022",
        format: "esm",
        bundle: true,
        outdir: "./dist",
        entryPoints: ["./src/content/print_content_script.ts"],
        logLevel: "info",
        treeShaking: true,
        plugins: [
            copyPlugin({
                src: "./page.html",
                dest: "./dist/page.html",
            }),
        ],
    },
];

if (!prod) {
    const ctxs = await Promise.all(build_ctx.map((ctx) => esbuild.context(ctx)));
    ctxs.forEach((ctx) => ctx.watch().catch(() => process.exit(1)));
} else {
    build_ctx.forEach((ctx) => esbuild.build(ctx).catch(() => process.exit(1)));
}
