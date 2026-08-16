import type { HTMLAttributes, ReactNode } from "react";

type Props = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
  padding?: "sm" | "md" | "lg";
};

const pad = { sm: "p-3", md: "p-4", lg: "p-6" };

export default function Card({ children, padding = "md", className = "", ...rest }: Props) {
  return (
    <div
      className={`rounded-[var(--fp-radius)] border border-[var(--fp-border)] bg-[var(--fp-bg-card)] shadow-fp-sm transition-[border-color,box-shadow,background-color] duration-[var(--fp-ease)] ${pad[padding]} ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}
