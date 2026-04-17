import { useEffect, useState } from "react";

export function normalizeSelectedDates(dates: string[]): string[] {
  const uniq = Array.from(new Set(dates.filter(Boolean)));
  return uniq.sort().slice(0, 3);
}

export function isoToday(): string {
  return new Date().toISOString().split("T")[0];
}

export function inferSeason(dateISO: string): number {
  const [y, m] = dateISO.split("-").map(Number);
  if (!y || !m) return new Date().getFullYear() - 1;
  return m >= 7 ? y : y - 1;
}

export function useLocalStorageState<T>(key: string, initial: T) {
  const [v, setV] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(v));
    } catch {
      // ignore storage errors
    }
  }, [key, v]);

  return [v, setV] as const;
}

export function hashColor(seed: string): string {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  const r = (h >>> 16) & 255;
  const g = (h >>> 8) & 255;
  const b = h & 255;
  return `rgb(${Math.floor(80 + (r / 255) * 150)}, ${Math.floor(80 + (g / 255) * 150)}, ${Math.floor(80 + (b / 255) * 150)})`;
}

export async function dominantColorFromImage(url: string): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        if (!ctx) return resolve(null);
        ctx.drawImage(img, 0, 0, 32, 32);
        const data = ctx.getImageData(0, 0, 32, 32).data;
        let r = 0;
        let g = 0;
        let b = 0;
        let n = 0;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] < 200) continue;
          r += data[i];
          g += data[i + 1];
          b += data[i + 2];
          n++;
        }
        if (n < 10) return resolve(null);
        resolve(`rgb(${Math.round(r / n)}, ${Math.round(g / n)}, ${Math.round(b / n)})`);
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}
