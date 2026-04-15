// src/components/Spinner.tsx
import React from "react";

export default function Spinner({ label = "Se încarcă..." }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 text-gray-600">
      <div className="animate-spin h-5 w-5 rounded-full border-2 border-current border-t-transparent" />
      <span className="text-sm">{label}</span>
    </div>
  );
}
