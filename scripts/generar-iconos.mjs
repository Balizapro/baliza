import sharp from "sharp";
import { mkdirSync } from "fs";
import path from "path";

const publicDir = "public";
const iconsDir = path.join(publicDir, "icons");
mkdirSync(iconsDir, { recursive: true });

const svgRegular = path.join(publicDir, "baliza-logo-icono.svg");
const svgMaskable = path.join(publicDir, "baliza-logo-icono-maskable.svg");

async function render(src, out, size) {
  const info = await sharp(src)
    .resize(size, size, { fit: "contain", background: "#0E4749" })
    .flatten({ background: "#0E4749" })
    .png()
    .toFile(out);
  console.log(out, info.width + "x" + info.height);
}

await render(svgRegular, path.join(iconsDir, "icon-192.png"), 192);
await render(svgRegular, path.join(iconsDir, "icon-512.png"), 512);
await render(svgMaskable, path.join(iconsDir, "icon-512-maskable.png"), 512);
await render(svgRegular, path.join(iconsDir, "apple-touch-icon-180.png"), 180);
