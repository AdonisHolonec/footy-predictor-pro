import Badge from "./Badge";
import StatusIcon, { normalizeStatus, statusA11yKey } from "../components/icons/StatusIcon";
import { useLocale } from "../context/LocaleContext";

type Tone = "neutral" | "accent" | "success" | "danger" | "warning";

type Props = {
  /** Raw status, exactly as the caller already had it. Not reinterpreted. */
  status?: string | null;
  /** Tone the caller already computes. Presentation only — unchanged by this component. */
  tone: Tone;
  /** The existing visible label. Still the only thing desktop renders. */
  label: string;
  className?: string;
};

/**
 * The outcome badge: an icon on mobile, the existing text on desktop.
 *
 * Both children are always rendered and one is switched off with `display:none`
 * at the `sm` breakpoint the project already uses everywhere. That matters for
 * more than layout — assistive tech skips `display:none` subtrees, so exactly one
 * of the two is announced at any width and the icon never doubles up with the
 * text it replaces.
 *
 * An unmodelled status keeps its text at every width rather than guessing at a
 * glyph, so a status this component has never heard of degrades to today's
 * behaviour instead of silently rendering the wrong outcome.
 */
export default function StatusBadge({ status, tone, label, className = "" }: Props) {
  const { t } = useLocale();
  const kind = normalizeStatus(status);

  if (!kind) {
    return (
      <Badge tone={tone} className={className}>
        {label}
      </Badge>
    );
  }

  return (
    <Badge tone={tone} className={className}>
      <StatusIcon kind={kind} label={t(statusA11yKey(kind))} className="sm:hidden" />
      <span className="hidden sm:inline">{label}</span>
    </Badge>
  );
}
