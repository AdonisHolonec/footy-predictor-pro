import { Link } from "react-router-dom";

export default function Privacy() {
  return (
    <div className="min-h-screen bg-slate-950 px-4 py-10 text-slate-200">
      <div className="mx-auto max-w-2xl space-y-6 text-sm leading-relaxed">
        <header className="space-y-2 border-b border-white/10 pb-6">
          <p className="text-[11px] font-black uppercase tracking-wide text-emerald-400">Footy Predictor</p>
          <h1 className="text-2xl font-black text-white">Politica de confidențialitate și informare GDPR</h1>
          <p className="text-xs text-slate-500">
            Ultima actualizare: document informativ pentru utilizatori. Nu inlocuieste sfat juridic personalizat.
          </p>
        </header>

        <section className="space-y-2">
          <h2 className="text-base font-black text-white">1. Operator și contact</h2>
          <p className="text-slate-300">
            Aplicația este operată de deținătorul proiectului Footy Predictor (contul și infrastructura pe care le
            configurezi: Vercel, Supabase, furnizori de e-mail etc.). Pentru solicitări legate de date personale
            (acces, rectificare, ștergere, restricționare, portabilitate, opoziție), folosește canalul de contact pe
            care îl comunici utilizatorilor sau suportul asociat contului tău de producție.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-black text-white">2. Ce date prelucrăm</h2>
          <ul className="list-inside list-disc space-y-1 text-slate-300">
            <li>Date de cont: adresă de e-mail, identificator utilizator, parolă (stocată de furnizorul de autentificare Supabase).</li>
            <li>Profil aplicație: rol, ligi favorite, preferințe de notificare, stare onboarding, eventual marcaj de consimțământ pentru e-mail.</li>
            <li>Jurnal notificări (dacă e activ): înregistrări tehnice despre trimiterea alertelor pe e-mail.</li>
            <li>Date tehnice: jurnale server, consum API, limite zilnice Warm/Predict asociate contului.</li>
            <li>În browser: preferințe și predicții pot fi reținute în localStorage pe dispozitivul tău.</li>
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-black text-white">3. Scopuri și temeiuri</h2>
          <p className="text-slate-300">
            Autentificare și securitate (executarea contractului / interes legitim), funcționarea predicțiilor și a
            istoricului, respectarea limitelor de utilizare, notificări opționale pe e-mail cu acord explicit pentru
            canalul de e-mail, conformitate și apărare în caz de litigii.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-black text-white">4. Notificări prin e-mail</h2>
          <p className="text-slate-300">
            Dacă activezi livrarea pe e-mail, îți vom cere să confirmi că ai citit această informare. Poți dezactiva
            oricând preferința din panoul de notificări; retragerea consimțământului pentru marketing (dacă ar exista)
            nu afectează mesajele strict necesare contului (ex. reset parolă), trimise în baza executării serviciului.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-black text-white">5. Destinatari și transferuri</h2>
          <p className="text-slate-300">
            Furnizori tipici: Supabase (baze de date și autentificare), Vercel (găzduire), furnizor de e-mail (ex.
            Resend), furnizori de date sportive / API. Transferurile către acești operatori sunt necesare pentru a
            rula aplicația; verifică politicile și DPA-urile lor pentru regiunea în care operezi.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-black text-white">6. Durata stocării</h2>
          <p className="text-slate-300">
            Păstrăm datele atât timp cât este necesar pentru scopurile de mai sus și conform politicilor de retenție
            ale infrastructurii (jurnale, backup-uri). Poți solicita ștergerea contului conform procedurilor
            furnizorului de autentificare și ale operatorului aplicației.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-black text-white">7. Drepturile tale</h2>
          <p className="text-slate-300">
            Ai dreptul de acces, rectificare, ștergere, restricționare, opoziție, portabilitate acolo unde se aplică,
            precum și dreptul de a depune plângere la autoritatea de supraveghere. În aplicație poți descărca un export
            JSON cu datele tale disponibile pe server după autentificare (secțiunea din dashboard utilizator).
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-black text-white">8. Securitate</h2>
          <p className="text-slate-300">
            Folosim conexiuni criptate (HTTPS), controale de acces pe server și reguli de securitate la nivel de bază
            de date (RLS) acolo unde este configurat. Nicio măsură nu garantează securitatea absolută.
          </p>
        </section>

        <footer className="border-t border-white/10 pt-6">
          <Link
            to="/login"
            className="text-xs font-black uppercase tracking-wide text-emerald-400 hover:text-emerald-300"
          >
            Înapoi la autentificare
          </Link>
        </footer>
      </div>
    </div>
  );
}
