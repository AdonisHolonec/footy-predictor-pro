import { Link } from "react-router-dom";
import BrandArtboard from "../components/BrandArtboard";
import { BRAND_IMAGES } from "../constants/brandAssets";

export default function Privacy() {
  return (
    <div className="lab-page min-h-screen">
      <div className="lab-bg" aria-hidden />
      <div
        className="pointer-events-none absolute inset-0 z-[1] opacity-[0.03]"
        style={{
          backgroundImage: `url(${BRAND_IMAGES.heroPlatform})`,
          backgroundSize: "cover",
          backgroundPosition: "center top"
        }}
        aria-hidden
      />
      <div className="relative z-10 mx-auto max-w-6xl px-4 py-10 lg:py-14">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,320px)] lg:items-start lg:gap-12">
          <div className="mx-auto max-w-2xl space-y-6 text-sm leading-relaxed text-signal-inkMuted lg:mx-0">
            <header className="space-y-3 border-b border-white/[0.08] pb-8">
              <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-signal-petrol/85">Footy predictor</p>
              <h1 className="font-display text-2xl font-semibold tracking-tight text-signal-ink sm:text-3xl">
                Politica de confidențialitate și informare GDPR
              </h1>
              <p className="text-xs text-signal-inkMuted/90">
                Ultima actualizare: document informativ pentru utilizatori. Nu înlocuiește sfat juridic personalizat.
              </p>
            </header>

            <section className="space-y-2">
              <h2 className="font-display text-base font-semibold text-signal-ink">1. Operator și contact</h2>
              <p>
                Aplicația este operată de deținătorul proiectului Footy Predictor (contul și infrastructura pe care le
                configurezi: Vercel, Supabase, furnizori de e-mail etc.). Pentru solicitări legate de date personale
                (acces, rectificare, ștergere, restricționare, portabilitate, opoziție), folosește canalul de contact pe
                care îl comunici utilizatorilor sau suportul asociat contului tău de producție.
              </p>
            </section>

            <section className="space-y-2">
              <h2 className="font-display text-base font-semibold text-signal-ink">2. Ce date prelucrăm</h2>
              <ul className="list-inside list-disc space-y-1">
                <li>Date de cont: adresă de e-mail, identificator utilizator, parolă (stocată de furnizorul de autentificare Supabase).</li>
                <li>Profil aplicație: rol, ligi favorite, preferințe de notificare, stare onboarding, eventual marcaj de consimțământ pentru e-mail.</li>
                <li>Jurnal notificări (dacă e activ): înregistrări tehnice despre trimiterea alertelor pe e-mail.</li>
                <li>Date tehnice: jurnale server, consum API, limite zilnice Warm/Predict asociate contului.</li>
                <li>În browser: preferințe și predicții pot fi reținute în localStorage pe dispozitivul tău.</li>
              </ul>
            </section>

            <section className="space-y-2">
              <h2 className="font-display text-base font-semibold text-signal-ink">3. Scopuri și temeiuri</h2>
              <p>
                Autentificare și securitate (executarea contractului / interes legitim), funcționarea predicțiilor și a
                istoricului, respectarea limitelor de utilizare, notificări opționale pe e-mail cu acord explicit pentru
                canalul de e-mail, conformitate și apărare în caz de litigii.
              </p>
            </section>

            <section className="space-y-2">
              <h2 className="font-display text-base font-semibold text-signal-ink">4. Notificări prin e-mail</h2>
              <p>
                Dacă activezi livrarea pe e-mail, îți vom cere să confirmi că ai citit această informare. Poți dezactiva
                oricând preferința din panoul de notificări; retragerea consimțământului pentru marketing (dacă ar exista)
                nu afectează mesajele strict necesare contului (ex. reset parolă), trimise în baza executării serviciului.
              </p>
            </section>

            <section className="space-y-2">
              <h2 className="font-display text-base font-semibold text-signal-ink">5. Destinatari și transferuri</h2>
              <p>
                Furnizori tipici: Supabase (baze de date și autentificare), Vercel (găzduire), furnizor de e-mail (ex.
                Resend), furnizori de date sportive / API. Transferurile către acești operatori sunt necesare pentru a
                rula aplicația; verifică politicile și DPA-urile lor pentru regiunea în care operezi.
              </p>
            </section>

            <section className="space-y-2">
              <h2 className="font-display text-base font-semibold text-signal-ink">6. Durata stocării</h2>
              <p>
                Păstrăm datele atât timp cât este necesar pentru scopurile de mai sus și conform politicilor de retenție
                ale infrastructurii (jurnale, backup-uri). Poți solicita ștergerea contului conform procedurilor
                furnizorului de autentificare și ale operatorului aplicației.
              </p>
            </section>

            <section className="space-y-2">
              <h2 className="font-display text-base font-semibold text-signal-ink">7. Drepturile tale</h2>
              <p>
                Ai dreptul de acces, rectificare, ștergere, restricționare, opoziție, portabilitate acolo unde se aplică,
                precum și dreptul de a depune plângere la autoritatea de supraveghere. În aplicație poți descărca un export
                JSON cu datele tale disponibile pe server după autentificare (secțiunea din dashboard utilizator).
              </p>
            </section>

            <section className="space-y-2">
              <h2 className="font-display text-base font-semibold text-signal-ink">8. Securitate</h2>
              <p>
                Folosim conexiuni criptate (HTTPS), controale de acces pe server și reguli de securitate la nivel de bază
                de date (RLS) acolo unde este configurat. Nicio măsură nu garantează securitatea absolută.
              </p>
            </section>

            <footer className="border-t border-white/[0.08] pt-8">
              <div className="flex flex-wrap gap-4">
                <Link to="/" className="font-mono text-xs font-semibold uppercase tracking-wider text-signal-inkMuted transition hover:text-signal-petrol">
                  ← Acasă
                </Link>
                <Link to="/login" className="font-mono text-xs font-semibold uppercase tracking-wider text-signal-petrol transition hover:text-signal-mint">
                  Autentificare
                </Link>
              </div>
            </footer>
          </div>

          <aside className="mx-auto w-full max-w-sm lg:sticky lg:top-10">
            <BrandArtboard
              src={BRAND_IMAGES.heroPlatform}
              alt="Footy Predictor — confidențialitate și transparență în design de produs"
              frameClassName="aspect-[3/4] max-h-[420px]"
            />
            <p className="mt-3 text-center font-mono text-[10px] leading-relaxed text-signal-inkMuted lg:text-left">
              Artă de referință pentru direcția vizuală a produsului — datele tale sunt tratate cu aceeași rigoare ca un
              semnal de predicție.
            </p>
          </aside>
        </div>
      </div>
    </div>
  );
}
