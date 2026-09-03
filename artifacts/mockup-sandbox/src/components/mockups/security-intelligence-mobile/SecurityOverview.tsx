import { useState } from "react";
import { AlertTriangle, Shield, TrendingUp, Zap } from "lucide-react";
import { DataAsOf, Header, Mix, Stat } from "./_shared";
import "./_redesign.css";

const products = [["PAN-OS", 126], ["GlobalProtect", 39], ["Prisma Access", 17], ["Cortex XSOAR", 4]] as const;

export function SecurityOverview() {
  const [vendor, setVendor] = useState("paloalto");
  return (
    <main className="sir">
      <div className="sir-shell">
        <Header tab="overview" vendor={vendor} onVendor={setVendor} onTab={() => {}} />
        <div className="sir-content">
          <div className="sir-stats">
            <Stat icon={Shield} label="Total CVEs" value="186" />
            <Stat icon={AlertTriangle} label="Critical + High" value="50" />
            <Stat icon={Zap} label="Known Exploited (KEV)" value="6" />
            <Stat icon={TrendingUp} label="EPSS ≥ 90%" value="12" />
          </div>
          <section className="sir-section">
            <div className="sir-card">
              <h3>Severity breakdown</h3>
              <Mix />
              <div className="sir-breakdown">
                <div><b style={{ color: "var(--red)" }}>8</b><span>CRITICAL</span><em>4%</em></div>
                <div><b style={{ color: "var(--orange)" }}>42</b><span>HIGH</span><em>23%</em></div>
                <div><b style={{ color: "var(--yellow)" }}>89</b><span>MEDIUM</span><em>48%</em></div>
                <div><b style={{ color: "var(--blue)" }}>47</b><span>LOW</span><em>25%</em></div>
              </div>
            </div>
          </section>
          <section className="sir-section">
            <div className="sir-card">
              <h3>12-month CVE trend</h3>
              <div className="sir-trend">{[16, 12, 10, 15, 9, 14, 20, 17, 25, 19, 13, 16].map((n, i) => <span key={i}><i style={{ height: `${Math.max(2, n * 1.2)}px`, background: "#9db8bc" }} /><i style={{ height: `${i % 4 === 0 ? 5 : 3}px`, background: "var(--orange)" }} /><i style={{ height: `${i === 8 ? 6 : 2}px`, background: "var(--red)" }} /></span>)}</div>
              <div className="sir-axis"><span>2024-03</span><span>2025-02</span></div>
              <div className="sir-legend"><span><i style={{ background: "var(--red)" }} />Critical</span><span><i style={{ background: "var(--orange)" }} />High</span><span><i style={{ background: "#9db8bc" }} />Other</span></div>
            </div>
          </section>
          <section className="sir-section">
            <div className="sir-card">
              <h3>Confirmed CPE vendor tokens</h3>
              <span className="sir-token">paloaltonetworks</span><span className="sir-token">pan-os</span>
            </div>
          </section>
          <section className="sir-section">
            <div className="sir-card">
              <h3>Top affected products</h3>
              {products.map(([product, count]) => (
                <div className="sir-product" key={product}>
                  <div className="sir-product-top"><span>{product}</span><span>{count}</span></div>
                  <div className="sir-bar"><i style={{ width: `${count / 126 * 100}%` }} /></div>
                </div>
              ))}
            </div>
          </section>
          <DataAsOf />
        </div>
      </div>
    </main>
  );
}