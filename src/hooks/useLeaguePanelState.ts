import { useEffect, useState } from "react";

export function isDesktopViewport() {
  return typeof window !== "undefined" ? window.innerWidth >= 1024 : true;
}

export function isCompactViewport() {
  return typeof window !== "undefined" ? window.innerWidth < 768 : false;
}

export function useLeaguePanelState() {
  const [isLeaguesOpen, setIsLeaguesOpen] = useState(isDesktopViewport());

  useEffect(() => {
    const onResize = () => setIsLeaguesOpen(isDesktopViewport());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return { isLeaguesOpen, setIsLeaguesOpen };
}
