import { Suspense, type ReactNode } from "react";
import { KolamMark } from "@/components/shell/KolamMark";
import { Still, type Scene } from "@/components/media/Still";

const FEATURES = [
  { title: "AI agents for filmmaking", sub: "From idea to release", tint: "#5fb3ff", d: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8c0-3.5 3.1-6 7-6s7 2.5 7 6" },
  { title: "Nine stages, one pipeline", sub: "Every gate tracked in the Project Brain", tint: "#b7a2ff", d: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" },
  { title: "Your crew signs every gate", sub: "Producers, HODs and writers together", tint: "#ff7ab6", d: "M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7 0a3 3 0 1 0 0-6M3 20c0-3 3-5 6-5s6 2 6 5M16 15c3 0 5 2 5 5" },
  { title: "Turn ideas into films", sub: "Agents draft, people decide", tint: "#ffb547", d: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7z" },
];

// Decorative previews of the sample slate, not account data.
// `light` is the grade from the reference art, laid over the still so real photos keep the same mood.
const POSTERS: { scene: Scene; title: string; stage: string; light: string; className: string }[] = [
  { scene: "ferry", title: "Last Ferry", stage: "Screenplay", light: "rgba(70,150,230,0.45)", className: "left-[2%] top-[26%] z-10 h-[64%] w-[30%] -rotate-[11deg]" },
  { scene: "kolam", title: "Kolam", stage: "Pre-production", light: "rgba(255,120,50,0.6)", className: "left-[27%] top-[2%] z-20 h-[86%] w-[41%] -rotate-[8deg]" },
  { scene: "radio", title: "Radio Thatha", stage: "Development", light: "rgba(215,60,170,0.55)", className: "left-[70%] top-[10%] z-10 h-[64%] w-[29%] rotate-[8deg]" },
];

function Brand() {
  return (
    <div className="flex items-center gap-3">
      <span className="flex h-11 w-11 items-center justify-center rounded-[11px] bg-white">
        <KolamMark size={30} dark />
      </span>
      <span className="flex flex-col leading-tight">
        <span className="text-[19px] font-semibold tracking-[-0.01em]">mithraa.SHI</span>
        <span className="text-[14px] text-[var(--ink-2)]">Film studio</span>
      </span>
    </div>
  );
}

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="auth-page flex min-h-screen items-center justify-center p-0 sm:p-6 lg:p-8">
      <div className="auth-frame relative flex w-full max-w-[1400px] flex-col overflow-hidden lg:flex-row">
        {/* brand side: full composition on desktop, just the mark and headline below lg */}
        <section className="relative flex w-full flex-col gap-6 self-center px-5 pb-2 pt-8 sm:max-w-[640px] sm:px-10 sm:pt-10 lg:w-[54%] lg:max-w-none lg:gap-0 lg:p-14 lg:pb-12">
          <div className="auth-glow" aria-hidden />
          <Brand />
          <p className="auth-headline relative lg:mt-14">
            Bring your
            <br />
            <span className="auth-gradient-text">story</span> to screen
          </p>
          <p className="relative -mt-3 text-[17px] text-[var(--ink-2)] lg:mt-4 lg:text-[21px]">Ideate. Plan. Collaborate. Create.</p>

          <ul className="relative mt-10 hidden flex-col gap-4 lg:flex">
            {FEATURES.map((f) => (
              <li key={f.title} className="flex items-center gap-4">
                <span className="flex h-[50px] w-[50px] shrink-0 items-center justify-center rounded-[13px] border border-white/[0.06]" style={{ background: `${f.tint}1f`, color: f.tint }}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d={f.d} />
                  </svg>
                </span>
                <span className="flex flex-col">
                  <span className="text-[15.5px] font-medium text-[var(--ink)]">{f.title}</span>
                  <span className="text-[14px] text-[var(--ink-2)] opacity-80">{f.sub}</span>
                </span>
              </li>
            ))}
          </ul>

          <div className="relative mt-auto hidden h-[250px] w-full max-w-[640px] pt-10 lg:block xl:h-[280px]" aria-hidden>
            <svg className="absolute -left-14 bottom-[18%] h-[150px] w-[calc(100%+200px)] text-[#08090b]" viewBox="0 0 800 200" preserveAspectRatio="none">
              <path d="M0 140 L90 95 L150 120 L240 70 L330 115 L420 60 L520 105 L600 40 L700 95 L800 55 V200 H0Z" fill="currentColor" />
            </svg>
            {POSTERS.map((p) => (
              <figure key={p.title} className={`auth-poster absolute ${p.className}`}>
                <Still scene={p.scene} label={p.title} />
                <span className="absolute inset-0 mix-blend-screen" style={{ background: `radial-gradient(70% 60% at 55% 55%, ${p.light}, transparent 75%)` }} />
                <figcaption className="absolute inset-x-0 bottom-0 flex flex-col gap-0.5 bg-gradient-to-t from-black/80 to-transparent p-4 pt-10">
                  <span className="font-[family-name:var(--font-title)] text-[19px] font-bold uppercase leading-none tracking-[-0.02em] text-white">{p.title}</span>
                  <span className="text-[11.5px] text-white/65">{p.stage}</span>
                </figcaption>
              </figure>
            ))}
          </div>
        </section>

        {/* form side */}
        <section className="relative flex flex-1 items-start justify-center px-4 pb-8 pt-4 sm:px-10 sm:pb-10 lg:items-stretch lg:p-6 lg:pl-0">
          <div className="auth-card w-full max-w-[560px] lg:flex lg:max-w-none lg:flex-col lg:justify-center">
            <Suspense fallback={<div className="min-h-[520px]" aria-busy="true" />}>{children}</Suspense>
          </div>
        </section>
      </div>
    </div>
  );
}
