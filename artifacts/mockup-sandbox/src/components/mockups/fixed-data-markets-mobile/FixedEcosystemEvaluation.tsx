import { useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { NotesPopup, Shell, Section, ecosystemCategories, vendors, Harvey, Legend, supportByVendor, type NotePayload } from "./_shared";
import "./FixedEcosystemEvaluation.css";

export function FixedEcosystemEvaluation() {
  const [selected, setSelected] = useState<string[]>(["v1", "v2"]);
  const [open, setOpen] = useState<string | null>("Cloud providers");
  const [note, setNote] = useState<NotePayload | null>(null);
  const toggle = (id: string) =>
    setSelected((current) =>
      current.includes(id)
        ? current.length > 2 ? current.filter((value) => value !== id) : current
        : current.length < 2 ? [...current, id] : current,
    );
  const chosen = vendors.filter((vendor) => selected.includes(vendor.id));
  return (
    <Shell active="ecosystem" title="Ecosystem evaluation" subtitle="Compare two stored ecosystem-support records across integrations and partners.">
      <Section n="01" title="Products to compare" action={<span className="fdm-label">Choose exactly 2</span>}>
        <div className="fdm-eco-picker">
          {vendors.map((vendor) => {
            const active = selected.includes(vendor.id);
            return <button key={vendor.id} className={active ? "active" : ""} onClick={() => toggle(vendor.id)} aria-pressed={active}>
              <span className="fdm-eco-check">{active && <Check size={13} />}</span>
              <span><strong>{vendor.name}</strong><small>{vendor.product}</small></span>
            </button>;
          })}
        </div>
        <p className="fdm-selection-help">Select two products. Each ecosystem row keeps both support records together.</p>
        <div className="fdm-card pad"><Legend /></div>
      </Section>
      <Section n="02" title="Ecosystem support & commentary">
        <div className="fdm-eco-comparison">
          <div className="fdm-eco-head"><span>Feature</span>{chosen.map((vendor) => <span key={vendor.id}><strong>{vendor.name}</strong><small>{vendor.product}</small></span>)}</div>
          {ecosystemCategories.map((category) => <div className="fdm-eco-category" key={category.name}>
            <button onClick={() => setOpen(open === category.name ? null : category.name)}><span><strong>{category.name}</strong><small>{category.features.length} stored rows</small></span><ChevronDown size={17} className={`fdm-chevron ${open === category.name ? "open" : ""}`} /></button>
            {open === category.name && category.features.map((feature) => <div className="fdm-eco-feature" key={feature[0] as string}>
              <h3>{feature[0] as string}</h3><p>{feature[1] as string}</p>
               <div className="fdm-eco-values">{chosen.map((vendor) => { const record = supportByVendor[vendor.id][feature[0] as string]; return <div className="fdm-support-cell" key={vendor.id}><div><Harvey level={record.level}/><b>{record.level} / 4</b></div><button onClick={() => setNote({vendor:vendor.name,product:vendor.product,subject:feature[0] as string,score:`${record.level} / 4 support`,commentary:record.commentary})}>View notes</button></div>; })}</div>
            </div>)}
          </div>)}
        </div>
      </Section>
      <NotesPopup note={note} onClose={() => setNote(null)} />
    </Shell>
  );
}

export default FixedEcosystemEvaluation;