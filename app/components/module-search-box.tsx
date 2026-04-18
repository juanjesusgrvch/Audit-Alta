"use client";

import { useId, useMemo } from "react";

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function ModuleSearchBox({
  className = "w-full min-w-0 sm:w-80",
  onChange,
  placeholder,
  suggestions,
  value
}: {
  className?: string;
  onChange: (value: string) => void;
  placeholder: string;
  suggestions: string[];
  value: string;
}) {
  const datalistId = useId().replace(/:/g, "");
  const visibleSuggestions = useMemo(() => {
    const normalizedValue = normalize(value.trim());

    if (!normalizedValue) {
      return suggestions.slice(0, 12);
    }

    return suggestions
      .filter((suggestion) => normalize(suggestion).includes(normalizedValue))
      .slice(0, 12);
  }, [suggestions, value]);

  return (
    <>
      <input
        className={`aether-field h-11 ${className}`}
        list={datalistId}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        value={value}
      />
      <datalist id={datalistId}>
        {visibleSuggestions.map((suggestion) => (
          <option key={suggestion} value={suggestion} />
        ))}
      </datalist>
    </>
  );
}
