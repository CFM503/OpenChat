// ============================================================================
// ReplyCanvas — rich visual cards for weather, image galleries, info cards
// ============================================================================

import React, { memo, useState } from 'react';
import type { CanvasBlock, WeatherCanvas, GalleryCanvas, CardCanvas } from '../lib/replyCanvas';
import { weatherVisual } from '../lib/replyCanvas';

function WeatherCard({ data }: { data: WeatherCanvas }) {
  const { emoji, gradient } = weatherVisual(data.condition);
  const unit = data.unit?.includes('°') ? data.unit : data.unit === 'F' || data.unit === '°F' ? '°F' : '°C';

  return (
    <div className="reply-canvas weather-canvas" style={{ background: gradient }}>
      <div className="weather-canvas-glow" aria-hidden />
      <div className="weather-canvas-top">
        <div className="weather-canvas-place">
          <span className="weather-canvas-pin">📍</span>
          <span className="weather-canvas-city">{data.city}</span>
          {data.updated && <span className="weather-canvas-updated">{data.updated}</span>}
        </div>
        <span className="weather-canvas-emoji" role="img" aria-label={data.condition || 'weather'}>
          {emoji}
        </span>
      </div>

      <div className="weather-canvas-main">
        {data.temp != null && (
          <div className="weather-canvas-temp">
            <span className="weather-canvas-temp-num">{Math.round(data.temp)}</span>
            <span className="weather-canvas-temp-unit">{unit}</span>
          </div>
        )}
        <div className="weather-canvas-cond">
          {data.condition && <div className="weather-canvas-cond-text">{data.condition}</div>}
          {data.feelsLike != null && (
            <div className="weather-canvas-feels">体感 {Math.round(data.feelsLike)}{unit}</div>
          )}
        </div>
      </div>

      <div className="weather-canvas-meta">
        {data.humidity != null && data.humidity !== '' && (
          <div className="weather-chip">
            <span className="weather-chip-icon">💧</span>
            <span>湿度 {String(data.humidity).includes('%') ? data.humidity : `${data.humidity}%`}</span>
          </div>
        )}
        {data.wind && (
          <div className="weather-chip">
            <span className="weather-chip-icon">🌬️</span>
            <span>{data.wind}</span>
          </div>
        )}
        {data.aqi != null && data.aqi !== '' && (
          <div className="weather-chip">
            <span className="weather-chip-icon">🍃</span>
            <span>AQI {data.aqi}</span>
          </div>
        )}
      </div>

      {data.forecast && data.forecast.length > 0 && (
        <div className="weather-forecast">
          {data.forecast.map((d, i) => {
            const v = weatherVisual(d.condition);
            return (
              <div key={i} className="weather-forecast-day">
                <div className="weather-forecast-label">{d.day}</div>
                <div className="weather-forecast-emoji">{v.emoji}</div>
                <div className="weather-forecast-range">
                  {d.high != null && <span className="hi">{Math.round(d.high)}°</span>}
                  {d.low != null && <span className="lo">{Math.round(d.low)}°</span>}
                </div>
                {d.condition && <div className="weather-forecast-cond">{d.condition}</div>}
              </div>
            );
          })}
        </div>
      )}

      {data.notes && <div className="weather-canvas-notes">{data.notes}</div>}
    </div>
  );
}

function GalleryCard({ data }: { data: GalleryCanvas }) {
  const [lightbox, setLightbox] = useState<string | null>(null);
  const cols = data.images.length === 1 ? 1 : data.images.length === 2 ? 2 : 3;

  return (
    <div className="reply-canvas gallery-canvas">
      {data.title && <div className="gallery-canvas-title">{data.title}</div>}
      <div className={`gallery-grid cols-${cols}`}>
        {data.images.map((img, i) => (
          <button
            key={i}
            type="button"
            className="gallery-item"
            onClick={() => setLightbox(img.url)}
            title={img.alt || 'Open image'}
          >
            <img src={img.url} alt={img.alt || `Image ${i + 1}`} loading="lazy" />
          </button>
        ))}
      </div>
      {lightbox && (
        <div className="gallery-lightbox" onClick={() => setLightbox(null)} role="dialog">
          <img src={lightbox} alt="" />
          <button type="button" className="gallery-lightbox-close" onClick={() => setLightbox(null)}>
            ✕
          </button>
        </div>
      )}
    </div>
  );
}

function InfoCard({ data }: { data: CardCanvas }) {
  return (
    <div className={`reply-canvas info-canvas accent-${data.accent || 'indigo'}`}>
      <div className="info-canvas-title">{data.title}</div>
      {data.body && <div className="info-canvas-body">{data.body}</div>}
      {data.items && data.items.length > 0 && (
        <div className="info-canvas-items">
          {data.items.map((it, i) => (
            <div key={i} className="info-canvas-row">
              <span className="info-canvas-label">{it.label}</span>
              <span className="info-canvas-value">{it.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export const ReplyCanvas = memo(function ReplyCanvas({ block }: { block: CanvasBlock }) {
  switch (block.kind) {
    case 'weather':
      return <WeatherCard data={block} />;
    case 'gallery':
      return <GalleryCard data={block} />;
    case 'card':
      return <InfoCard data={block} />;
    default:
      return null;
  }
});
