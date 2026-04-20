"use client";

import { useEffect, useRef, useState } from "react";

type AutoFitMetricValueProps = {
  className?: string;
  maxSizeRem?: number;
  minSizeRem?: number;
  value: string;
};

export function AutoFitMetricValue({
  className = "",
  maxSizeRem = 3,
  minSizeRem = 0.74,
  value,
}: AutoFitMetricValueProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLParagraphElement>(null);
  const [fontSizeRem, setFontSizeRem] = useState(maxSizeRem);

  useEffect(() => {
    const container = containerRef.current;
    const text = textRef.current;

    if (!container || !text) {
      return;
    }

    let frame = 0;

    const fitText = () => {
      const rootFontSize =
        Number.parseFloat(
          getComputedStyle(document.documentElement).fontSize,
        ) || 16;
      const minFontSizePx = minSizeRem * rootFontSize;
      const stepPx = Math.max(0.5, rootFontSize * 0.045);
      let nextFontSizePx = maxSizeRem * rootFontSize;

      text.style.fontSize = `${nextFontSizePx}px`;
      const availableWidth = container.clientWidth;

      if (availableWidth <= 0) {
        setFontSizeRem(maxSizeRem);
        return;
      }

      let contentWidth = text.scrollWidth;
      let guard = 0;

      while (
        contentWidth > availableWidth &&
        nextFontSizePx > minFontSizePx &&
        guard < 60
      ) {
        nextFontSizePx = Math.max(minFontSizePx, nextFontSizePx - stepPx);
        text.style.fontSize = `${nextFontSizePx}px`;
        contentWidth = text.scrollWidth;
        guard += 1;
      }

      setFontSizeRem(Number((nextFontSizePx / rootFontSize).toFixed(3)));
    };

    const scheduleFit = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(fitText);
    };

    scheduleFit();
    void document.fonts?.ready.then(scheduleFit);

    const resizeObserver = new ResizeObserver(scheduleFit);
    resizeObserver.observe(container);

    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
    };
  }, [maxSizeRem, minSizeRem, value]);

  return (
    <div ref={containerRef} className="mt-3 w-full overflow-hidden">
      <p
        ref={textRef}
        className={className}
        style={{ fontSize: `${fontSizeRem}rem` }}
      >
        {value}
      </p>
    </div>
  );
}
