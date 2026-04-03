/// <reference types="node" />
import esbuild from "esbuild";
import pkg from "@sprout2000/esbuild-copy-plugin";
const { copyPlugin } = pkg;

const prod = process.argv[2] === "production";

/** @type {import('esbuild').BuildOptions} */
const build_ctx = {
    target: "ES2022",
    format: "iife",
    bundle: true,
    outdir: "./dist",
    entryPoints: ["./src/background.ts", "./src/content.ts", "./src/world.ts"],
    logLevel: "info",
    treeShaking: true,
    plugins: [
        copyPlugin({
            src: "./styles.css",
            dest: "./dist/styles.css",
        }),
    ],
};

if (!prod) {
    const ctx = await esbuild.context(build_ctx);
    ctx.watch().catch(() => process.exit(1));
} else {
    esbuild.build(build_ctx).catch(() => process.exit(1));
}
