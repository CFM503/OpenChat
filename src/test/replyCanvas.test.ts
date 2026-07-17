import { describe, it, expect } from 'vitest';
import { parseContentSegments, normalizeWeather, weatherVisual } from '../lib/replyCanvas';

describe('normalizeWeather', () => {
  it('parses Chinese-ish weather json', () => {
    const w = normalizeWeather({
      city: '上海',
      temp: 18,
      condition: '多云',
      humidity: 62,
      forecast: [
        { day: '今天', high: 20, low: 14, condition: '多云' },
        { day: '明天', high: 22, low: 15, condition: '晴' },
      ],
    });
    expect(w?.kind).toBe('weather');
    expect(w?.city).toBe('上海');
    expect(w?.temp).toBe(18);
    expect(w?.forecast).toHaveLength(2);
  });
});

describe('parseContentSegments', () => {
  it('extracts canvas weather fence', () => {
    const text = `下面是预报：\n\n\`\`\`canvas weather\n{"city":"北京","temp":22,"condition":"晴"}\n\`\`\`\n\n出门记得防晒。`;
    const segs = parseContentSegments(text);
    expect(segs.some(s => s.type === 'canvas' && s.block.kind === 'weather')).toBe(true);
    expect(segs.some(s => s.type === 'markdown' && s.text.includes('出门'))).toBe(true);
  });

  it('lifts markdown images into gallery', () => {
    const text = `见图：\n\n![a](https://example.com/a.png)\n![b](https://example.com/b.jpg)`;
    const segs = parseContentSegments(text);
    const gal = segs.find(s => s.type === 'canvas' && s.block.kind === 'gallery');
    expect(gal).toBeTruthy();
    if (gal && gal.type === 'canvas' && gal.block.kind === 'gallery') {
      expect(gal.block.images).toHaveLength(2);
    }
  });

  it('detects weather-like json fence', () => {
    const text = '```json\n{"location":"Tokyo","temperature":12,"weather":"Rain"}\n```';
    const segs = parseContentSegments(text);
    expect(segs.some(s => s.type === 'canvas' && s.block.kind === 'weather')).toBe(true);
  });
});

describe('weatherVisual', () => {
  it('maps rain', () => {
    expect(weatherVisual('小雨').emoji).toBe('🌧️');
  });
});
