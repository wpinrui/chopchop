/**
 * WaveformCanvas Component
 *
 * Renders audio waveform data to a canvas element.
 * Displays the portion of the waveform visible in the clip's in/out range.
 * Uses thin vertical lines for detailed visualization that scales with zoom.
 */

import React, { useRef, useEffect } from 'react';

interface WaveformCanvasProps {
  waveformData: number[];
  mediaDuration: number;
  mediaIn: number;
  mediaOut: number;
  width: number;
  height: number;
}

const WaveformCanvas: React.FC<WaveformCanvasProps> = ({
  waveformData,
  mediaDuration,
  mediaIn,
  mediaOut,
  width,
  height,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || waveformData.length === 0 || mediaDuration <= 0 || width <= 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set actual canvas dimensions (for crisp rendering)
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    // Calculate which portion of waveform data to display
    const startRatio = mediaIn / mediaDuration;
    const endRatio = mediaOut / mediaDuration;

    const startIndex = Math.floor(startRatio * waveformData.length);
    const endIndex = Math.ceil(endRatio * waveformData.length);
    const dataLength = endIndex - startIndex;

    if (dataLength <= 0) return;

    const centerY = height / 2;
    const maxBarHeight = height * 0.85; // Leave margin top and bottom

    // Bright green waveform for good contrast against dark green clip background
    ctx.fillStyle = 'rgba(160, 230, 180, 0.95)';

    // Draw one vertical line per pixel (or per 2 pixels for performance at very high zoom)
    const pixelStep = width > 2000 ? 2 : 1;
    for (let x = 0; x < width; x += pixelStep) {
      // Calculate which samples this pixel represents
      const sampleStart = startIndex + (x / width) * dataLength;
      const sampleEnd = startIndex + ((x + pixelStep) / width) * dataLength;

      // Find max peak in this range (for sharp transients)
      let maxPeak = 0;
      const iStart = Math.floor(sampleStart);
      const iEnd = Math.min(Math.ceil(sampleEnd), waveformData.length);

      for (let i = iStart; i < iEnd; i++) {
        if (waveformData[i] > maxPeak) {
          maxPeak = waveformData[i];
        }
      }

      // If we don't have enough samples, interpolate
      if (iStart >= iEnd && iStart < waveformData.length) {
        maxPeak = waveformData[iStart];
      }

      const barHeight = maxPeak * maxBarHeight;

      // Draw thin vertical line centered on the centerline
      if (barHeight > 0.5) {
        ctx.fillRect(
          x,
          centerY - barHeight / 2,
          pixelStep,
          barHeight
        );
      }
    }

    // Draw center line (subtle)
    ctx.strokeStyle = 'rgba(70, 130, 90, 0.3)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, centerY);
    ctx.lineTo(width, centerY);
    ctx.stroke();

  }, [waveformData, mediaDuration, mediaIn, mediaOut, width, height]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: `${width}px`,
        height: `${height}px`,
        display: 'block',
      }}
    />
  );
};

export default WaveformCanvas;
