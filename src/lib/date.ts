export function formatRO(iso: string) {
  try {
    const d = new Date(iso);
    return d.toLocaleString("ro-RO", {
      day:"2-digit", month:"2-digit", year:"numeric",
      hour:"2-digit", minute:"2-digit"
    });
  } catch { return iso; }
}
export function todayISO() {
  return new Date().toISOString().slice(0,10);
}
export function addDays(dateISO: string, k: number) {
  const d = new Date(dateISO); d.setDate(d.getDate()+k);
  return d.toISOString().slice(0,10);
}
