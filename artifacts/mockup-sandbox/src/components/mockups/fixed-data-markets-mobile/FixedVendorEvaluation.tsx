import { useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { NotesPopup, Shell, Section, vendors, criteria, vendorScores, type NotePayload } from "./_shared";
import "./FixedVendorEvaluation.css";

export function FixedVendorEvaluation() {
  const [definition, setDefinition] = useState(false);
  const [weights, setWeights] = useState(false);
  const [selected, setSelected] = useState<string[]>(["v1", "v2"]);
  const [note, setNote] = useState<NotePayload | null>(null);

  const selectedVendors = vendors.filter((vendor) => selected.includes(vendor.id));

  const toggleVendor = (vendorId: string) => {
    setSelected((current) => {
      if (current.includes(vendorId)) {
        return current.length > 2 ? current.filter((id) => id !== vendorId) : current;
      }
      return current.length < 3 ? [...current, vendorId] : current;
    });
  };

  return (
    <Shell
      active="vendor"
      title="Backup Target Appliances"
      subtitle="A fixed analyst evaluation of backup target appliances and the vendors providing them."
    >
      <Section
        n="01"
        title="Market definition"
        action={
          <button onClick={() => setDefinition(!definition)} aria-label="Toggle definition">
            <ChevronDown size={16} className={`fdm-chevron ${definition ? "open" : ""}`} />
          </button>
        }
      >
        <div className="fdm-card pad">
          <p className="fdm-note">
            Backup target appliances support data protection, recovery workflows, and operational
            readiness across enterprise environments.
          </p>
          <div className={`fdm-definition ${definition ? "open" : "closed"}`}>
            <div className="fdm-note">
              Scope is fixed to the stored market definition and vendor evidence.
            </div>
          </div>
          <button className="fdm-toggle" onClick={() => setDefinition(!definition)}>
            <span>{definition ? "Hide definition" : "Read full definition"}</span>
            <ChevronDown size={15} className={`fdm-chevron ${definition ? "open" : ""}`} />
          </button>
        </div>
      </Section>

      <Section n="02" title="Vendor positioning">
        <div className="fdm-card pad">
          <div className="fdm-label">Fixed score domain · 0–100</div>
          <div className="fdm-chart">
            <svg
              viewBox="0 0 420 360"
              preserveAspectRatio="xMidYMid meet"
              role="img"
              aria-label="Vendor quadrant chart"
            >
              <rect x="50" y="36" width="355" height="256" fill="#fbfaf4" stroke="#b8c7c2" />
              <path d="M227.5 36v256M50 164h355" stroke="#d3ddd6" />
              <text x="227.5" y="338" textAnchor="middle" fontSize="12" fill="#637579">
                Execution →
              </text>
              <text
                transform="translate(17 164) rotate(-90)"
                textAnchor="middle"
                fontSize="12"
                fill="#637579"
              >
                Viability →
              </text>
              <text x="335" y="54" fontSize="10" fill="#13a8f0" fontWeight="700">
                LEADERS
              </text>
              {vendors.map((vendor) => {
                const cx = 50 + vendor.x * 3.55;
                const cy = 292 - vendor.y * 2.56;
                const isSelected = selected.includes(vendor.id);
                return (
                  <g
                    key={vendor.id}
                    onClick={() => toggleVendor(vendor.id)}
                    style={{ cursor: "pointer" }}
                  >
                    <circle cx={cx} cy={cy} r="24" fill="transparent" />
                    {isSelected && (
                      <circle
                        cx={cx}
                        cy={cy}
                        r="12"
                        fill="none"
                        stroke={vendor.color}
                        strokeWidth="2"
                        opacity=".35"
                      />
                    )}
                    <circle
                      cx={cx}
                      cy={cy}
                      r="7"
                      fill={vendor.color}
                      stroke="#ffffff"
                      strokeWidth="3"
                    />
                    {isSelected && (
                      <text
                        x={cx}
                        y={cy - 16}
                        textAnchor="middle"
                        fontSize="10"
                        fontWeight="700"
                        fill="#304b52"
                      >
                        {vendor.name}
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>
          </div>
          <div className="fdm-chart-caption">
            <span>0</span>
            <span>Execution / product strategy</span>
            <span>100</span>
          </div>
        </div>
      </Section>

      <Section
        n="03"
        title="Compare products"
        action={<span className="fdm-label">{selected.length} selected · max 3</span>}
      >
        <div className="fdm-compare-picker" aria-label="Choose products to compare">
          {vendors.map((vendor) => {
            const isSelected = selected.includes(vendor.id);
            return (
              <button
                key={vendor.id}
                className={isSelected ? "active" : ""}
                onClick={() => toggleVendor(vendor.id)}
                aria-pressed={isSelected}
              >
                <span className="fdm-compare-check">{isSelected && <Check size={13} />}</span>
                <span>
                  <strong>{vendor.name}</strong>
                  <small>{vendor.product}</small>
                </span>
              </button>
            );
          })}
        </div>
        <p className="fdm-selection-help">Keep at least two products selected for comparison.</p>
      </Section>

      <Section n="04" title="Scores & commentary">
        <div className="fdm-comparison">
          <div
            className="fdm-comparison-head"
            style={{ gridTemplateColumns: `repeat(${selectedVendors.length}, minmax(0, 1fr))` }}
          >
            {selectedVendors.map((vendor) => (
              <span key={vendor.id}>
                <strong>{vendor.name}</strong>
                <small>{vendor.product}</small>
              </span>
            ))}
          </div>
          {criteria.map(([criterion]) => (
            <div className="fdm-comparison-row" key={criterion as string}>
              <h3>{criterion as string}</h3>
              <div
                className="fdm-comparison-values"
                style={{ gridTemplateColumns: `repeat(${selectedVendors.length}, minmax(0, 1fr))` }}
              >
                {selectedVendors.map((vendor) => {
                  const row = vendorScores[vendor.id].find((score) => score.criterion === criterion)!;
                  return (
                    <div className="fdm-score-cell" key={vendor.id}>
                      <span>{vendor.name}</span>
                      <strong>{row.score}</strong>
                      <button onClick={() => setNote({vendor:vendor.name,product:vendor.product,subject:row.criterion,score:`${row.score} / 100`,commentary:row.commentary})}>View notes</button>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section
        n="05"
        title="Criteria weights"
        action={
          <button onClick={() => setWeights(!weights)}>
            {weights ? "Hide" : "Show"}{" "}
            <ChevronDown size={15} className={`fdm-chevron ${weights ? "open" : ""}`} />
          </button>
        }
      >
        {weights && (
          <div className="fdm-card pad">
            {criteria.map(([name, axis, value]) => (
              <div className="fdm-weight" key={name as string}>
                <div>
                  <strong>{name}</strong>
                  <small>{axis} axis · persisted weight</small>
                </div>
                <b>{value}%</b>
              </div>
            ))}
          </div>
        )}
      </Section>
      <NotesPopup note={note} onClose={() => setNote(null)} />
    </Shell>
  );
}

export default FixedVendorEvaluation;