import type { ReactNode } from "react";
import BrandArtboard from "../BrandArtboard";
import { ModelPulseStrip, ModelPulseWave } from "../SignalLab";
import { BRAND_IMAGES } from "../../constants/brandAssets";
import { inferSeason, localCalendarDateKey } from "../../utils/appUtils";
import type { ModelPulse } from "../../types/index";

type HeaderProps = {
  date: string;
  modelPulse: ModelPulse;
  /** Left column content below ModelPulseStrip (tracker, KPIs, etc.). */
  children?: ReactNode;
  /** Right column content (API counter, auth, date controls). */
  childrenRight?: ReactNode;
};

export default function Header({ date, modelPulse, children, childrenRight }: HeaderProps) {
  return (
    <header className="mb-6 border-b border-white/[0.06] pb-5 sm:mb-8 sm:pb-6">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between lg:gap-8">
        <div className="min-w-0 max-w-3xl">
          <p className="lab-section-eyebrow">
            {localCalendarDateKey()} · SEZON {inferSeason(date)} · INTELIGENȚĂ PREDICTIVĂ
          </p>
          <h1 className="font-display mt-2 flex items-center gap-3 text-3xl font-bold tracking-tight text-signal-ink sm:text-4xl md:text-[2.75rem] md:leading-[1.08]">
            <img
              src={BRAND_IMAGES.logoPrimary}
              alt="Footy Predictor"
              className="h-14 w-14 rounded-card border border-signal-petrol/40 object-contain p-1 shadow-card sm:h-16 sm:w-16 lg:h-[4.5rem] lg:w-[4.5rem]"
            />
            <span>
              Observator de semnale <span className="text-signal-petrol">fotbal</span>
            </span>
          </h1>
          <p className="mt-2.5 max-w-2xl text-sm leading-relaxed text-signal-inkMuted">
            Strat analitic editorial: modele calibrate, context xG și edge-uri de valoare — fără hype de cote.
          </p>
          <ModelPulseWave status="OPTIMAL CALIBRATION" className="mt-4 max-w-3xl" />
          <div className="mt-2.5 flex flex-wrap gap-2">
            <ModelPulseStrip status={modelPulse.status} tone={modelPulse.tone} />
          </div>
          <div className="mt-4 hidden max-w-md lg:block">
            <BrandArtboard
              src={BRAND_IMAGES.refDossier}
              alt="Referință vizuală — prediction dossier (admin workspace)"
              frameClassName="max-h-[140px] rounded-card"
            />
          </div>
          {children}
        </div>
        <div className="flex flex-col gap-2.5 lg:flex-row lg:items-end lg:gap-3">
          {childrenRight}
        </div>
      </div>
    </header>
  );
}
