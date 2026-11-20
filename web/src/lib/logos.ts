// Team logos: URLs come from the API (`lockout logos`, Leaguepedia); images load from the CDN at runtime.
import { createContext, useContext } from "react";

/** Lower-cased team name -> logo URL. Empty in demo mode (the demo teams are fictional). */
export type LogoMap = ReadonlyMap<string, string>;

export const LogoContext = createContext<LogoMap>(new Map());

export const toLogoMap = (byName: Record<string, string>): LogoMap =>
  new Map(Object.entries(byName).map(([name, url]) => [name.trim().toLowerCase(), url]));

export const useLogo = (name: string): string | undefined => useContext(LogoContext).get(name.trim().toLowerCase());

/** Mean luminance (0..1) of the opaque pixels of RGBA data; null when nothing is opaque. */
export function opaqueLuminance(rgba: ArrayLike<number>): number | null {
  let sum = 0;
  let n = 0;
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    if ((rgba[i + 3] as number) < 128) continue;
    sum += (0.2126 * (rgba[i] as number) + 0.7152 * (rgba[i + 1] as number) + 0.0722 * (rgba[i + 2] as number)) / 255;
    n++;
  }
  return n ? sum / n : null;
}

const darkCache = new Map<string, boolean>();

/** True for a mostly dark crest (it would vanish on our dark UI), so it gets a light plate. */
export function isDarkLogo(img: HTMLImageElement): boolean {
  const cached = darkCache.get(img.src);
  if (cached !== undefined) return cached;
  let dark = false;
  try {
    const c = document.createElement("canvas");
    c.width = c.height = 24;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    if (ctx) {
      ctx.drawImage(img, 0, 0, 24, 24);
      const lum = opaqueLuminance(ctx.getImageData(0, 0, 24, 24).data);
      dark = lum !== null && lum < 0.3;
    }
  } catch {
    dark = false; // tainted canvas: keep the default plate
  }
  darkCache.set(img.src, dark);
  return dark;
}
