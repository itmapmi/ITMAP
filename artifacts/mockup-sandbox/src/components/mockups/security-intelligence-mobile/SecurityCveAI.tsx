import { useState } from "react";
import { Header, CveRow, cves } from "./_shared";
import "./_redesign.css";
export function SecurityCveAI(){const [vendor,setVendor]=useState("paloalto");return <main className="sir"><div className="sir-shell"><Header tab="table" vendor={vendor} onVendor={setVendor} onTab={()=>{}}/><div className="sir-content"><div className="sir-section-head"><span className="sir-label">CVE record</span><h2>Expanded evidence</h2></div><CveRow cve={cves[0]} forceOpen/></div></div></main>}