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
      text.style.fontSize = `${maxSizeRem}rem`;
      const availableWidth = container.clientWidth;
      const contentWidth = text.scrollWidth;

      if (availableWidth <= 0 || contentWidth <= 0) {
        setFontSizeRem(maxSizeRem);
        return;
      }

      const nextFontSize =
        contentWidth > availableWidth
          ? Math.max(
              minSizeRem,
              Number(((maxSizeRem * availableWidth) / contentWidth).toFixed(3)),
            )
          : maxSizeRem;

      setFontSizeRem(nextFontSize);
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
