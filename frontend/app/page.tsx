import { HomeNav } from "@/components/HomeNav";
import { HeroCTAs } from "@/components/HeroCTAs";

const STEPS = [
  {
    n: "01",
    title: "Fund treasury once",
    body: "Deposit USDC into your treasury wallet. Your treasury address exists on-chain from day one.",
  },
  {
    n: "02",
    title: "Auto-convert per employee",
    body: "Uniswap and SideShift convert each salary payment to exactly the asset each employee chose — ETH, WBTC, or SOL. Happens automatically, no manual steps.",
  },
  {
    n: "03",
    title: "CRE-verified, on-chain proof",
    body: "Every swap rate is attested by the Chainlink DON against live Chainlink Data Feed prices. Payments outside tolerance are blocked before any funds move.",
  },
];

export default function Home() {
  return (
    <div className="min-h-screen bg-bg">
      <HomeNav />
      <section className="relative overflow-hidden bg-grid">
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              "radial-gradient(ellipse 80% 50% at 50% -10%, rgba(212,148,42,0.08) 0%, transparent 60%)",
          }}
        />

        <div className="relative max-w-7xl mx-auto px-8 pt-28 pb-24">
          {/* Status pill */}
          <div className="fade-up fade-up-1 flex items-center gap-2 mb-10 font-mono text-xs tracking-looser">
            <span className="pulse-dot inline-block w-1.5 h-1.5 rounded-full bg-teal" />
            <span className="text-teal">POWERED BY CHAINLINK CRE</span>
          </div>

          {/* Headline */}
          <h1 className="fade-up fade-up-2 text-6xl md:text-8xl lg:text-9xl font-bold leading-none tracking-tight mb-8 font-heading">
            <span className="text-ink">Your salary.</span>
            <br />
            <span className="text-gradient-gold">Your crypto.</span>
          </h1>

          {/* Subhead */}
          <p className="fade-up fade-up-3 max-w-2xl text-lg leading-relaxed mb-12 text-muted font-ui">
            Companies fund a single treasury. Every developer, freelancer, and
            DAO contributor receives the exact asset they chose — ETH, WBTC, or
            SOL. Every conversion verified by the Chainlink DON against live
            oracle data and attested on-chain, forever.
          </p>
          <HeroCTAs />
        </div>
      </section>
      <section className="max-w-7xl mx-auto px-8 pb-28">
        <div className="flex items-baseline gap-6 mb-16">
          <span className="section-label">How it works</span>
          <div className="h-px flex-1 bg-line" />
        </div>

        <div className="grid md:grid-cols-3 gap-0">
          {STEPS.map((s) => (
            <div key={s.n} className="p-8">
              <div className="text-5xl font-bold mb-8 font-mono text-gold">
                {s.n}
              </div>
              <h3 className="text-xl font-bold mb-3 font-heading text-ink">
                {s.title}
              </h3>
              <p className="text-sm leading-relaxed text-muted">{s.body}</p>
            </div>
          ))}
        </div>
      </section>
      {/* ── CRE Rate Attestation callout ─────────────────────────── */}
      <section className=" bg-surface">
        <div className="max-w-7xl mx-auto px-8 py-16 grid md:grid-cols-2 gap-16 items-center">
          <div>
            <div className="section-label mb-4">
              Chainlink CRE Rate Attestation
            </div>
            <h2 className="text-4xl font-bold mb-5 font-heading text-ink">
              Every rate verified.
              <br />
              <span className="text-gradient-gold">Zero trust required.</span>
            </h2>
            <p className="text-sm leading-loose text-muted max-w-sm">
              The Chainlink DON reads live ETH/USD and BTC/USD prices from
              Chainlink Data Feeds and verifies that each Uniswap quote falls
              within the configured tolerance. Payments outside tolerance are
              blocked before any funds leave the treasury — cryptographic
              consensus, not a single point of trust.
            </p>
          </div>

          {/* Terminal mockup */}
          <div className="border border-rim bg-void font-mono text-xs scanlines">
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-line bg-surface">
              <span className="w-2.5 h-2.5 rounded-full bg-red" />
              <span
                className="w-2.5 h-2.5 rounded-full"
                style={{ background: "#C4A44A" }}
              />
              <span className="w-2.5 h-2.5 rounded-full bg-teal" />
              <span className="ml-3 text-xs text-faint tracking-wider">
                Chainlink CRE · DON attestation
              </span>
            </div>
            <div className="p-5 space-y-2 text-muted">
              {[
                ["employeeId", "emp-001", "text-ink"],
                ["settleAsset", "WETH", "text-gold"],
                ["settleAmount", "0.00732", "text-gold"],
                ["oraclePrice", "$2048.32", "text-teal"],
                ["deviationBps", "12", "text-teal"],
                ["toleranceBps", "8000", "text-ink"],
                ["withinRange", "true", "text-teal"],
              ].map(([k, v, c]) => (
                <div key={k} className="flex gap-4">
                  <span className="text-violet w-32 shrink-0">{k}</span>
                  <span className={c}>{v}</span>
                </div>
              ))}
              <div className="mt-4 pt-4 border-t border-line">
                <span className="text-teal">✓ queued</span>
                <span className="text-faint">
                  {" "}
                  · CRE consensus passed · dispatch authorized
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
