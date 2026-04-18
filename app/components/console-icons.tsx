import type { SVGProps } from "react";

function BaseIcon({
  children,
  ...props
}: SVGProps<SVGSVGElement>) {
  return (
    <svg
      aria-hidden
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
      {...props}
    >
      {children}
    </svg>
  );
}

export function EyeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <BaseIcon {...props}>
      <path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6Z" />
      <circle cx="12" cy="12" r="3" />
    </BaseIcon>
  );
}

export function PencilIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <BaseIcon {...props}>
      <path d="M12 20h9" />
      <path d="m16.5 3.5 4 4L8 20l-4 1 1-4 11.5-13.5Z" />
    </BaseIcon>
  );
}

export function TrashIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <BaseIcon {...props}>
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="m6 6 1 14h10l1-14" />
      <path d="M10 10v6" />
      <path d="M14 10v6" />
    </BaseIcon>
  );
}

export function LoaderIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      aria-hidden
      className="module-spinner"
      fill="none"
      viewBox="0 0 24 24"
      {...props}
    >
      <circle
        cx="12"
        cy="12"
        opacity="0.18"
        r="9"
        stroke="currentColor"
        strokeWidth="2.2"
      />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="2.2"
      />
    </svg>
  );
}

export function RefreshIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <BaseIcon {...props}>
      <path d="M21 12a9 9 0 1 1-3.2-6.9" />
      <path d="M21 3v6h-6" />
    </BaseIcon>
  );
}
