import { execSync } from "child_process";
import { existsSync } from "fs";
import puppeteer from "puppeteer";

// Build LD_LIBRARY_PATH by locating each declared lib package in the nix store.
const pkgs = [
  "glib-2","nss-3","nspr-","at-spi2-atk-","at-spi2-core-","atk-2","cups-","dbus-1","dbus-",
  "libdrm-","gtk+3-","pango-","cairo-","expat-","libxkbcommon-","mesa-","alsa-lib-",
  "fontconfig-","freetype-","libX11-","libx11-","libXcomposite-","libxcomposite-",
  "libXdamage-","libxdamage-","libXext-","libxext-","libXfixes-","libxfixes-",
  "libXrandr-","libxrandr-","libxcb-","libXrender-","libxrender-","libXtst-","libxtst-",
  "libXi-","libxi-","libxshmfence-","nss-","gdk-pixbuf-","harfbuzz-","libepoxy-",
];
const dirs = new Set();
for (const pat of pkgs) {
  try {
    const out = execSync(`ls -d /nix/store/*-${pat}*/lib 2>/dev/null | sort -V | tail -3`, { encoding: "utf8" }).trim();
    out.split("\n").filter(Boolean).forEach((d) => dirs.add(d));
  } catch {}
}
const ldPath = [...dirs].join(":");
console.log("LD dirs found:", dirs.size);
const chromePath = puppeteer.executablePath();
console.log("chrome:", chromePath, "exists:", existsSync(chromePath));
(async () => {
  try {
    const browser = await puppeteer.launch({
      headless: true,
      executablePath: chromePath,
      args: ["--no-sandbox","--disable-setuid-sandbox","--disable-dev-shm-usage","--disable-gpu"],
      env: { ...process.env, LD_LIBRARY_PATH: ldPath + (process.env.LD_LIBRARY_PATH ? ":" + process.env.LD_LIBRARY_PATH : "") },
    });
    const v = await browser.version();
    console.log("LAUNCH_OK version:", v);
    await browser.close();
  } catch (e) {
    console.error("LAUNCH_FAIL:", e.message.split("\n").slice(0,4).join(" | "));
  }
})();
