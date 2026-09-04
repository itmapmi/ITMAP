import { useRef, useState, type PointerEvent, type WheelEvent } from "react";
import { Check, ChevronDown, Minus, Plus, RotateCcw } from "lucide-react";
import { NotesPopup, Shell, Section, vendors, criteria, vendorScores, type NotePayload } from "./_shared";
import "./FixedVendorEvaluation.css";

export function FixedVendorEvaluation() {
  const [definition, setDefinition] = useState(false);
  const [weights, setWeights] = useState(false);
  const [selected, setSelected] = useState<string[]>(["v1", "v2"]);
  const [note, setNote] = useState<NotePayload | null>(null);
  const chartViewportRef = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const dragOrigin = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const pinchOrigin = useRef({ distance: 0, scale: 1, x: 0, y: 0 });
  const dragMoved = useRef(false);
  const [chartScale, setChartScale] = useState(0.46);
  const [chartPan, setChartPan] = useState({ x: 0, y: 0 });

  const selectedVendors = vendors.filter((vendor) => selected.includes(vendor.id));

  const toggleVendor = (vendorId: string) => {
    setSelected((current) => {
      if (current.includes(vendorId)) {
        return current.length > 2 ? current.filter((id) => id !== vendorId) : current;
      }
      return current.length < 3 ? [...current, vendorId] : current;
    });
  };

  const clampPan = (x: number, y: number, scale = chartScale) => {
    const viewport = chartViewportRef.current;
    if (!viewport) return { x, y };
    const vw = viewport.clientWidth;
    const vh = viewport.clientHeight;
    const layerW = 760 * scale;
    const layerH = 547 * scale;
    return {
      x: Math.min(18, Math.max(vw - layerW - 18, x)),
      y: Math.min(10, Math.max(vh - layerH - 10, y)),
    };
  };
  const setScaleAround = (next: number, anchorX?: number, anchorY?: number) => {
    const scale = Math.min(1.35, Math.max(0.34, next));
    const factor = scale / chartScale;
    const ax = anchorX ?? (chartViewportRef.current?.clientWidth ?? 390) / 2;
    const ay = anchorY ?? 145;
    setChartPan((pan) => clampPan(ax - (ax - pan.x) * factor, ay - (ay - pan.y) * factor, scale));
    setChartScale(scale);
  };
  const resetChart = () => {
    setChartScale(0.46);
    setChartPan({ x: 0, y: 8 });
  };
  const onChartPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    dragMoved.current = false;
    if (pointers.current.size === 1) {
      dragOrigin.current = { x: event.clientX, y: event.clientY, panX: chartPan.x, panY: chartPan.y };
    } else if (pointers.current.size === 2) {
      const points = [...pointers.current.values()];
      pinchOrigin.current = {
        distance: Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y),
        scale: chartScale,
        x: (points[0].x + points[1].x) / 2,
        y: (points[0].y + points[1].y) / 2,
      };
    }
  };
  const onChartPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 2) {
      const points = [...pointers.current.values()];
      const distance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
      if (pinchOrigin.current.distance) {
        setScaleAround(
          pinchOrigin.current.scale * (distance / pinchOrigin.current.distance),
          pinchOrigin.current.x,
          pinchOrigin.current.y,
        );
      }
      dragMoved.current = true;
      return;
    }
    const dx = event.clientX - dragOrigin.current.x;
    const dy = event.clientY - dragOrigin.current.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) dragMoved.current = true;
    setChartPan(clampPan(dragOrigin.current.panX + dx, dragOrigin.current.panY + dy));
  };
  const onChartPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size === 0) dragMoved.current = false;
  };
  const onChartWheel = (event: WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    setScaleAround(chartScale * (event.deltaY > 0 ? 0.9 : 1.1), event.clientX - rect.left, event.clientY - rect.top);
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
          <div className="fdm-chart-tools" aria-label="Chart zoom controls">
            <span className="fdm-chart-hint">Pinch or use controls to zoom · drag to pan</span>
            <div>
              <button onClick={() => setScaleAround(chartScale - 0.12)} aria-label="Zoom out"><Minus size={14} /></button>
              <button onClick={() => setScaleAround(chartScale + 0.12)} aria-label="Zoom in"><Plus size={14} /></button>
              <button onClick={resetChart} aria-label="Reset chart to fit"><RotateCcw size={13} /><span>Fit</span></button>
            </div>
          </div>
          <div
            className="fdm-chart-viewport"
            ref={chartViewportRef}
            onPointerDown={onChartPointerDown}
            onPointerMove={onChartPointerMove}
            onPointerUp={onChartPointerUp}
            onPointerCancel={onChartPointerUp}
            onWheel={onChartWheel}
          >
            <div className="fdm-chart-layer" style={{ transform: `translate(${chartPan.x}px, ${chartPan.y}px) scale(${chartScale})` }}>
              <svg width="760" height="547" viewBox="0 0 760 547" role="img" aria-label="Vendor evaluation MagicQuadrant chart">
                <defs><linearGradient id="fdm-leaders" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stopColor="#f7f4ff" /><stop offset="100%" stopColor="#ebe4fd" /></linearGradient></defs>
                <rect x="60" y="44" width="680" height="421" fill="#fdfefe" stroke="#e2e8f0" strokeWidth="1.5" />
                <rect x="515.6" y="44" width="224.4" height="210.5" fill="url(#fdm-leaders)" />
                <path d="M284.4 44v421M515.6 44v421M60 254.5h680" fill="none" stroke="#e2e8f0" strokeWidth="1.5" />
                {[
                  [173, "Custodians", "#1e3a5f"], [400, "Contenders", "#1e3a5f"], [627, "Leaders", "#6d5bd0"],
                  [173, "Emerging Players", "#1e3a5f"], [400, "Specialists", "#1e3a5f"], [627, "Catalysts", "#1e3a5f"],
                ].map(([x, label, fill], index) => (
                  <g key={`${label}-${index}`}>
                    <line x1={x as number} x2={x as number} y1={index < 3 ? 38 : 465} y2={index < 3 ? 44 : 471} stroke="#cbd5e1" />
                    <rect x={(x as number) - (label === "Emerging Players" ? 62 : label === "Custodians" || label === "Contenders" ? 42 : 35)} y={index < 3 ? 20 : 475} width={label === "Emerging Players" ? 124 : label === "Custodians" || label === "Contenders" ? 84 : label === "Specialists" ? 76 : label === "Catalysts" ? 70 : 62} height="23" rx="4" fill={fill as string} />
                    <text x={x as number} y={index < 3 ? 36 : 491} textAnchor="middle" fontSize="12" fontWeight="600" fill="#fff">{label}</text>
                  </g>
                ))}
                <g fill="#64748b" fontSize="12" fontWeight="600"><text x="60" y="480">0</text><text x="740" y="480" textAnchor="end">100</text><text x="48" y="259" textAnchor="end">50</text><text x="48" y="48" textAnchor="end">100</text></g>
                <text x="400" y="531" textAnchor="middle" fontSize="14" fontWeight="600" fill="#374151">Product Strategy and Execution →</text>
                <text transform="rotate(-90)" x="-254.5" y="18" textAnchor="middle" fontSize="14" fontWeight="600" fill="#374151">Vendor Viability →</text>
                {vendors.map((vendor) => {
                  const cx = 60 + (vendor.x / 100) * 680;
                  const cy = 465 - (vendor.y / 100) * 421;
                  const isSelected = selected.includes(vendor.id);
                  return <g key={vendor.id} onClick={() => { if (!dragMoved.current) toggleVendor(vendor.id); }} style={{ cursor: "pointer" }}>
                    <circle cx={cx} cy={cy} r="25" fill="transparent" />
                    {isSelected && <circle cx={cx} cy={cy} r="13" fill="none" stroke={vendor.color} strokeWidth="2" opacity=".35" />}
                    <circle cx={cx} cy={cy} r="7" fill={vendor.color} stroke="#fff" strokeWidth="3" />
                    {isSelected && <text x={cx} y={cy - 16} textAnchor="middle" fontSize="12" fontWeight="700" fill="#304b52">{vendor.name}</text>}
                  </g>;
                })}
              </svg>
            </div>
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