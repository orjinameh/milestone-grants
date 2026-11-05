import fs from "node:fs";
fs.rmSync("dist-web", { recursive: true, force: true });
fs.mkdirSync("dist-web/web", { recursive: true });
for (const f of ["index.html", "style.css", "config.json"]) fs.copyFileSync(`web/${f}`, `dist-web/${f}`);
fs.copyFileSync("dist/web/app.js", "dist-web/web/app.js");
fs.cpSync("dist/src", "dist-web/src", { recursive: true });
console.log("dist-web ready");
