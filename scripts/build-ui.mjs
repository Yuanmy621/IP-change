import { build } from "esbuild";
import { mkdir, writeFile, copyFile, stat } from "node:fs/promises";
import { X, ChevronRight, ChevronDown, ChevronLeft, Check } from "lucide";

await mkdir("web/vendor/ui-icons", { recursive: true });
await build({
  entryPoints: ["ui/components.js"],
  outfile: "web/vendor/components.js",
  bundle: true,
  minify: true,
  format: "iife",
  target: ["chrome111"],
  legalComments: "eof",
});
const icons = {
  xmark: X,
  "chevron-right": ChevronRight,
  "chevron-down": ChevronDown,
  "chevron-left": ChevronLeft,
  "angle-right": ChevronRight,
  "angle-down": ChevronDown,
  check: Check,
};
for (const [name, nodes] of Object.entries(icons)) {
  const shapes = nodes
    .map(
      ([tag, attrs]) =>
        `<${tag} ${Object.entries(attrs)
          .filter(([key]) => key !== "key")
          .map(([key, value]) => `${key}="${value}"`)
          .join(" ")}/>`,
    )
    .join("");
  await writeFile(
    `web/vendor/ui-icons/${name}.svg`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${shapes}</svg>\n`,
  );
}
await copyFile(
  "node_modules/@awesome.me/webawesome/LICENSE.md",
  "web/vendor/WebAwesome-LICENSE",
);
await copyFile("node_modules/lucide/LICENSE", "web/vendor/Lucide-LICENSE");
const bytes = (await stat("web/vendor/components.js")).size;
console.log(`UI components bundled locally: ${(bytes / 1024).toFixed(1)} KiB`);
