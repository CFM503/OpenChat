/**
 * Parse assistant markdown for rich "canvas" blocks and auto-detected visuals.
 *
 * Supported fenced blocks:
 *   ```canvas weather
 *   { "city": "北京", "temp": 22, ... }
 *   ```
 *   ```canvas gallery
 *   ![](url) or ["url1","url2"]
 *   ```
 *   ```canvas card
 *   { "title": "...", "body": "...", "accent": "blue" }
 *   ```
 *
 * Also auto-detects:
 *   - JSON fences that look like weather payloads
 *   - Markdown images (→ gallery when 1+ images present)
 */

export type CanvasKind = 'weather' | 'gallery' | 'card' | 'image';

export interface WeatherDay {
  day: string;
  high?: number;
  low?: number;
  condition?: string;
  icon?: string;
}

export interface WeatherCanvas {
  kind: 'weather';
  city: string;
  temp?: number;
  unit?: string;
  condition?: string;
  humidity?: number | string;
  wind?: string;
  feelsLike?: number;
  aqi?: string | number;
  updated?: string;
  forecast?: WeatherDay[];
  /** Free-form extra lines */
  notes?: string;
}

export interface GalleryCanvas {
  kind: 'gallery';
  images: Array<{ url: string; alt?: string }>;
  title?: string;
}

export interface CardCanvas {
  kind: 'card';
  title: string;
  body?: string;
  accent?: string;
  items?: Array<{ label: string; value: string }>;
}

export type CanvasBlock = WeatherCanvas | GalleryCanvas | CardCanvas;

export type ContentSegment =
  | { type: 'markdown'; text: string }
  | { type: 'canvas'; block: CanvasBlock };

const FENCE_RE =
  /```\s*(canvas(?:\s+\w+)?|openchat-canvas(?:\s+\w+)?|json)\s*\n([\s\S]*?)```/gi;

const MD_IMAGE_RE = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

function tryParseJson(raw: string): unknown | null {
  const t = raw.trim();
  if (!t) return null;
  try {
    return JSON.parse(t);
  } catch {
    // loose: allow trailing commas / single quotes lightly
    try {
      const fixed = t
        .replace(/,\s*([}\]])/g, '$1')
        .replace(/'/g, '"');
      return JSON.parse(fixed);
    } catch {
      return null;
    }
  }
}

function isWeatherLike(obj: any): boolean {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
  const keys = Object.keys(obj).map(k => k.toLowerCase());
  const hasCity = keys.some(k =>
    ['city', 'location', 'place', '地区', '城市', 'name'].includes(k),
  );
  const hasTemp = keys.some(k =>
    ['temp', 'temperature', '温度', 'current', 'now'].includes(k),
  );
  const hasCond = keys.some(k =>
    ['condition', 'weather', '天气', 'sky', 'desc', 'description', 'text'].includes(k),
  );
  const hasForecast = keys.some(k =>
    ['forecast', 'daily', 'days', '预报', 'hourly'].includes(k),
  );
  return (hasCity && (hasTemp || hasCond)) || (hasForecast && (hasCity || hasTemp));
}

function pick<T = any>(obj: any, ...names: string[]): T | undefined {
  if (!obj) return undefined;
  for (const n of names) {
    if (obj[n] !== undefined && obj[n] !== null && obj[n] !== '') return obj[n] as T;
    const lower = n.toLowerCase();
    for (const k of Object.keys(obj)) {
      if (k.toLowerCase() === lower) return obj[k] as T;
    }
  }
  return undefined;
}

export function normalizeWeather(obj: any): WeatherCanvas | null {
  if (!isWeatherLike(obj)) return null;
  const city =
    String(pick(obj, 'city', 'location', 'place', '地区', '城市', 'name') ?? 'Weather');
  let temp = pick<number | string>(obj, 'temp', 'temperature', '温度', 'current');
  if (temp != null && typeof temp === 'object') {
    temp = pick(temp as any, 'temp', 'temperature', 'value') as any;
  }
  const tempNum =
    typeof temp === 'number'
      ? temp
      : typeof temp === 'string'
        ? parseFloat(temp)
        : undefined;

  const forecastRaw = pick<any[]>(obj, 'forecast', 'daily', 'days', '预报');
  const forecast: WeatherDay[] | undefined = Array.isArray(forecastRaw)
    ? forecastRaw.slice(0, 8).map((d, i) => ({
        day: String(pick(d, 'day', 'date', 'name', '星期', 'label') ?? `Day ${i + 1}`),
        high:
          typeof pick(d, 'high', 'max', 'high_temp', '最高') === 'number'
            ? (pick(d, 'high', 'max', 'high_temp', '最高') as number)
            : parseFloat(String(pick(d, 'high', 'max', 'high_temp', '最高') ?? '')) || undefined,
        low:
          typeof pick(d, 'low', 'min', 'low_temp', '最低') === 'number'
            ? (pick(d, 'low', 'min', 'low_temp', '最低') as number)
            : parseFloat(String(pick(d, 'low', 'min', 'low_temp', '最低') ?? '')) || undefined,
        condition: pick(d, 'condition', 'weather', '天气', 'text', 'desc')
          ? String(pick(d, 'condition', 'weather', '天气', 'text', 'desc'))
          : undefined,
        icon: pick(d, 'icon') ? String(pick(d, 'icon')) : undefined,
      }))
    : undefined;

  return {
    kind: 'weather',
    city,
    temp: Number.isFinite(tempNum as number) ? (tempNum as number) : undefined,
    unit: String(pick(obj, 'unit', 'units') ?? '°C').replace(/celsius/i, '°C'),
    condition: pick(obj, 'condition', 'weather', '天气', 'sky', 'text', 'description')
      ? String(pick(obj, 'condition', 'weather', '天气', 'sky', 'text', 'description'))
      : undefined,
    humidity: pick(obj, 'humidity', '湿度'),
    wind: pick(obj, 'wind', 'wind_speed', '风速')
      ? String(pick(obj, 'wind', 'wind_speed', '风速'))
      : undefined,
    feelsLike:
      typeof pick(obj, 'feelsLike', 'feels_like', '体感') === 'number'
        ? (pick(obj, 'feelsLike', 'feels_like', '体感') as number)
        : undefined,
    aqi: pick(obj, 'aqi', 'air', '空气质量'),
    updated: pick(obj, 'updated', 'time', 'as_of')
      ? String(pick(obj, 'updated', 'time', 'as_of'))
      : undefined,
    forecast,
    notes: pick(obj, 'notes', 'summary', 'tip')
      ? String(pick(obj, 'notes', 'summary', 'tip'))
      : undefined,
  };
}

function parseCanvasLang(lang: string): string {
  const parts = lang.trim().toLowerCase().split(/\s+/);
  // canvas weather | openchat-canvas weather | json
  if (parts[0] === 'json') return 'json';
  return parts[1] || parts[0] || 'card';
}

function parseGalleryFromText(raw: string, title?: string): GalleryCanvas | null {
  const images: Array<{ url: string; alt?: string }> = [];
  const json = tryParseJson(raw);
  if (Array.isArray(json)) {
    for (const item of json) {
      if (typeof item === 'string') images.push({ url: item });
      else if (item && typeof item === 'object') {
        const url = pick(item, 'url', 'src', 'href');
        if (url) images.push({ url: String(url), alt: pick(item, 'alt', 'title') ? String(pick(item, 'alt', 'title')) : undefined });
      }
    }
  } else if (json && typeof json === 'object') {
    const arr = pick<any[]>(json, 'images', 'urls', 'items');
    if (Array.isArray(arr)) {
      for (const item of arr) {
        if (typeof item === 'string') images.push({ url: item });
        else if (item?.url || item?.src) images.push({ url: String(item.url || item.src), alt: item.alt });
      }
    }
  }
  let m: RegExpExecArray | null;
  const re = new RegExp(MD_IMAGE_RE.source, 'g');
  while ((m = re.exec(raw)) !== null) {
    images.push({ alt: m[1] || undefined, url: m[2] });
  }
  // bare urls
  const urlRe = /https?:\/\/[^\s)"']+\.(?:png|jpe?g|gif|webp|svg)(?:\?[^\s)"']*)?/gi;
  let um: RegExpExecArray | null;
  while ((um = urlRe.exec(raw)) !== null) {
    if (!images.some(i => i.url === um![0])) images.push({ url: um[0] });
  }
  if (images.length === 0) return null;
  return { kind: 'gallery', images, title };
}

function fenceToCanvas(lang: string, body: string): CanvasBlock | null {
  const kind = parseCanvasLang(lang);
  const json = tryParseJson(body);

  if (kind === 'weather' || (kind === 'json' && isWeatherLike(json))) {
    const w = normalizeWeather(json);
    if (w) return w;
  }
  if (kind === 'gallery' || kind === 'image') {
    return parseGalleryFromText(body);
  }
  if (kind === 'card' && json && typeof json === 'object') {
    const title = String(pick(json, 'title', 'name', 'heading') ?? 'Card');
    return {
      kind: 'card',
      title,
      body: pick(json, 'body', 'text', 'description', 'content')
        ? String(pick(json, 'body', 'text', 'description', 'content'))
        : undefined,
      accent: pick(json, 'accent', 'color') ? String(pick(json, 'accent', 'color')) : undefined,
      items: Array.isArray((json as any).items)
        ? (json as any).items.map((it: any) => ({
            label: String(it.label ?? it.key ?? ''),
            value: String(it.value ?? it.val ?? ''),
          }))
        : undefined,
    };
  }
  if (kind === 'json' && isWeatherLike(json)) {
    return normalizeWeather(json);
  }
  // canvas without subtype: try weather then gallery then card
  if (kind === 'canvas' || kind === 'openchat-canvas') {
    return normalizeWeather(json) || parseGalleryFromText(body) || null;
  }
  return null;
}

/**
 * Split assistant message into markdown segments + canvas blocks.
 * Removes consumed fences/images from markdown so they aren't double-rendered.
 */
export function parseContentSegments(content: string): ContentSegment[] {
  if (!content) return [];

  const segments: ContentSegment[] = [];
  let lastIndex = 0;
  const re = new RegExp(FENCE_RE.source, 'gi');
  let match: RegExpExecArray | null;
  const consumedImageUrls = new Set<string>();

  while ((match = re.exec(content)) !== null) {
    const before = content.slice(lastIndex, match.index);
    if (before.trim()) {
      segments.push({ type: 'markdown', text: before });
    }
    const lang = match[1] || '';
    const body = match[2] || '';
    const isCanvasFence = /^(canvas|openchat-canvas)/i.test(lang.trim());
    const isJson = /^json$/i.test(lang.trim());
    let block: CanvasBlock | null = null;
    if (isCanvasFence || isJson) {
      block = fenceToCanvas(lang, body);
    }
    if (block) {
      if (block.kind === 'gallery') {
        block.images.forEach(i => consumedImageUrls.add(i.url));
      }
      segments.push({ type: 'canvas', block });
    } else {
      // keep original fence in markdown
      segments.push({ type: 'markdown', text: match[0] });
    }
    lastIndex = match.index + match[0].length;
  }

  let rest = content.slice(lastIndex);
  if (rest) {
    // Auto-lift markdown images into a gallery (leave non-image markdown)
    const images: Array<{ url: string; alt?: string }> = [];
    const imgRe = new RegExp(MD_IMAGE_RE.source, 'g');
    let im: RegExpExecArray | null;
    while ((im = imgRe.exec(rest)) !== null) {
      if (!consumedImageUrls.has(im[2])) {
        images.push({ alt: im[1] || undefined, url: im[2] });
        consumedImageUrls.add(im[2]);
      }
    }
    if (images.length > 0) {
      // Strip image markdown from text so bubble doesn't show raw ![]()
      const textWithout = rest.replace(MD_IMAGE_RE, '').trim();
      if (textWithout) segments.push({ type: 'markdown', text: textWithout });
      segments.push({ type: 'canvas', block: { kind: 'gallery', images } });
    } else if (rest.trim()) {
      segments.push({ type: 'markdown', text: rest });
    }
  }

  // Merge adjacent markdown
  const merged: ContentSegment[] = [];
  for (const s of segments) {
    const last = merged[merged.length - 1];
    if (s.type === 'markdown' && last?.type === 'markdown') {
      last.text += s.text;
    } else {
      merged.push(s);
    }
  }
  return merged.length ? merged : [{ type: 'markdown', text: content }];
}

/** Emoji / gradient hint from weather condition text */
export function weatherVisual(condition?: string): { emoji: string; gradient: string } {
  const c = (condition || '').toLowerCase();
  if (/雷|thunder|storm/.test(c)) return { emoji: '⛈️', gradient: 'linear-gradient(145deg,#1e1b4b 0%,#312e81 40%,#0f172a 100%)' };
  if (/雨|rain|drizzle|shower/.test(c)) return { emoji: '🌧️', gradient: 'linear-gradient(145deg,#0c4a6e 0%,#164e63 45%,#0f172a 100%)' };
  if (/雪|snow|sleet/.test(c)) return { emoji: '❄️', gradient: 'linear-gradient(145deg,#1e3a5f 0%,#334155 50%,#0f172a 100%)' };
  if (/云|cloud|overcast|阴/.test(c)) return { emoji: '☁️', gradient: 'linear-gradient(145deg,#334155 0%,#475569 40%,#1e293b 100%)' };
  if (/雾|fog|haze|霾/.test(c)) return { emoji: '🌫️', gradient: 'linear-gradient(145deg,#3f3f46 0%,#52525b 50%,#18181b 100%)' };
  if (/风|wind/.test(c)) return { emoji: '🌬️', gradient: 'linear-gradient(145deg,#0e7490 0%,#155e75 50%,#0f172a 100%)' };
  if (/夜|night|moon/.test(c)) return { emoji: '🌙', gradient: 'linear-gradient(145deg,#0f172a 0%,#1e1b4b 50%,#020617 100%)' };
  // clear / sunny default
  return { emoji: '☀️', gradient: 'linear-gradient(145deg,#0369a1 0%,#0ea5e9 35%,#38bdf8 70%,#7dd3fc 100%)' };
}
