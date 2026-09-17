"use client";

import Image from "next/image";

const LOGO_SRC = "/docpad-logo.png";

type DocPadLogoMarkProps = {
  className?: string;
};

/** Blue mark + cross; size via Tailwind (`h-10 w-10`). Clipped to a circle. */
export function DocPadLogoMark({ className }: DocPadLogoMarkProps) {
  const sizeClass =
    className != null && String(className).trim() !== "" ? className.trim() : "h-10 w-10";

  return (
    <span
      className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden !rounded-full ${sizeClass}`}
    >
      <Image
        src={LOGO_SRC}
        alt=""
        width={128}
        height={128}
        className="h-full w-full object-contain"
        priority
      />
    </span>
  );
}
