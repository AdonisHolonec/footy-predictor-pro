type BrandArtboardProps = {
  src: string;
  alt: string;
  className?: string;
  /** e.g. "aspect-[4/3] max-h-[420px]" */
  frameClassName?: string;
};

/** Framed reference art — editorial glass frame over mockup PNGs in /public/brand. */
export default function BrandArtboard({ src, alt, className = "", frameClassName = "" }: BrandArtboardProps) {
  return (
    <figure className={`group relative ${className}`}>
      <div
        className={`relative overflow-hidden rounded-2xl border border-white/[0.1] bg-signal-void/50 shadow-atelier backdrop-blur-sm sm:rounded-3xl ${frameClassName}`}
      >
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-signal-void/80 via-transparent to-signal-void/20" />
        <img
          src={src}
          alt={alt}
          className="h-full w-full object-cover object-left-top opacity-[0.97] transition duration-500 group-hover:opacity-100"
          loading="lazy"
          decoding="async"
        />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-signal-petrol/35 to-transparent" />
      </div>
    </figure>
  );
}
