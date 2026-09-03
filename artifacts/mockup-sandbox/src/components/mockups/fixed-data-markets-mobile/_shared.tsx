import { useState, type ReactNode, type CSSProperties } from "react";
import { ChevronDown, CircleDot, FileText, Newspaper, Network, Radar, BarChart3 } from "lucide-react";
import "./_group.css";

export const vendors = [
  {id:"v1",name:"Dell",product:"Dell PowerProtect Data Manager",x:78,y:72,color:"#087f83"},
  {id:"v2",name:"HPE",product:"HPE StoreOnce",x:61,y:57,color:"#c9674d"},
  {id:"v3",name:"ExaGrid",product:"ExaGrid Tiered Backup Storage",x:42,y:38,color:"#708c52"},
  {id:"v4",name:"IBM",product:"IBM Storage Protect",x:28,y:61,color:"#526a8e"},
  {id:"v5",name:"Quantum",product:"Quantum DXi",x:35,y:28,color:"#866b9c"},
];
export const criteria=[["Product capabilities","execution",30],["Customer experience","execution",20],["Innovation","execution",15],["Business model","viability",20],["Revenue","viability",15]];
export const vendorScores:Record<string,{criterion:string;score:number;commentary:string}[]>={
 v1:[{criterion:"Product capabilities",score:84,commentary:"Product capabilities score recorded from the fixed evaluation row."},{criterion:"Customer experience",score:76,commentary:"Customer experience score recorded from the fixed evaluation row."},{criterion:"Innovation",score:81,commentary:"Innovation score recorded from the fixed evaluation row."},{criterion:"Business model",score:79,commentary:"Business model score recorded from the fixed evaluation row."},{criterion:"Revenue",score:88,commentary:"Revenue score recorded from the fixed evaluation row."}],
 v2:[{criterion:"Product capabilities",score:78,commentary:"Product capabilities score recorded from the fixed evaluation row."},{criterion:"Customer experience",score:73,commentary:"Customer experience score recorded from the fixed evaluation row."},{criterion:"Innovation",score:69,commentary:"Innovation score recorded from the fixed evaluation row."},{criterion:"Business model",score:82,commentary:"Business model score recorded from the fixed evaluation row."},{criterion:"Revenue",score:85,commentary:"Revenue score recorded from the fixed evaluation row."}],
 v3:[{criterion:"Product capabilities",score:72,commentary:"Product capabilities score recorded from the fixed evaluation row."},{criterion:"Customer experience",score:71,commentary:"Customer experience score recorded from the fixed evaluation row."},{criterion:"Innovation",score:75,commentary:"Innovation score recorded from the fixed evaluation row."},{criterion:"Business model",score:70,commentary:"Business model score recorded from the fixed evaluation row."},{criterion:"Revenue",score:63,commentary:"Revenue score recorded from the fixed evaluation row."}],
 v4:[{criterion:"Product capabilities",score:66,commentary:"Product capabilities score recorded from the fixed evaluation row."},{criterion:"Customer experience",score:68,commentary:"Customer experience score recorded from the fixed evaluation row."},{criterion:"Innovation",score:64,commentary:"Innovation score recorded from the fixed evaluation row."},{criterion:"Business model",score:74,commentary:"Business model score recorded from the fixed evaluation row."},{criterion:"Revenue",score:77,commentary:"Revenue score recorded from the fixed evaluation row."}],
 v5:[{criterion:"Product capabilities",score:61,commentary:"Product capabilities score recorded from the fixed evaluation row."},{criterion:"Customer experience",score:65,commentary:"Customer experience score recorded from the fixed evaluation row."},{criterion:"Innovation",score:62,commentary:"Innovation score recorded from the fixed evaluation row."},{criterion:"Business model",score:67,commentary:"Business model score recorded from the fixed evaluation row."},{criterion:"Revenue",score:58,commentary:"Revenue score recorded from the fixed evaluation row."}],
};
export const productCategories=[{name:"Core platform",features:[["Policy automation","Controls and workflow configuration."],["Reporting workspace","Operational reporting and export capabilities."],["Administration","Role and access administration."]]},{name:"Operations",features:[["Monitoring","Monitoring and operational visibility."],["Workflow design","Design tools for repeatable workflows."]]}];
export const ecosystemCategories=[{name:"Cloud providers",features:[["Amazon Web Services","Cloud provider integration."],["Microsoft Azure","Cloud provider integration."]]},{name:"Technology partners",features:[["Identity providers","Identity and access integrations."],["Service management","Service management platform connections."]]}];
const supportRows = (
  product: [number, number, number, number, number],
  ecosystem: [number, number, number, number],
) => ({
  "Policy automation": { level: product[0], commentary: "The stored evaluation documents policy controls available in the product." },
  "Reporting workspace": { level: product[1], commentary: "The stored evaluation records the reporting and export support available." },
  "Administration": { level: product[2], commentary: "The stored evaluation describes the product's administration coverage." },
  "Monitoring": { level: product[3], commentary: "The stored evaluation records monitoring support for production operations." },
  "Workflow design": { level: product[4], commentary: "The stored evaluation documents support for repeatable recovery workflows." },
  "Amazon Web Services": { level: ecosystem[0], commentary: "The stored ecosystem row documents support for Amazon Web Services." },
  "Microsoft Azure": { level: ecosystem[1], commentary: "The stored ecosystem row documents support for Microsoft Azure." },
  "Identity providers": { level: ecosystem[2], commentary: "The stored ecosystem row records the available identity integrations." },
  "Service management": { level: ecosystem[3], commentary: "The stored ecosystem row records service-management integrations and limits." },
});
export const supportByVendor:Record<string,Record<string,{level:number;commentary:string}>> = {
  v1: supportRows([4,4,3,4,4], [4,4,3,3]),
  v2: supportRows([4,3,4,4,3], [4,4,3,4]),
  v3: supportRows([3,3,3,4,3], [3,3,2,2]),
  v4: supportRows([3,4,4,3,3], [3,4,4,4]),
  v5: supportRows([3,3,2,4,3], [3,2,2,2]),
};
export const news=[{title:"Dell expands PowerProtect appliance capabilities",source:"Dell newsroom",date:"Jun 12, 2024",vendor:"Dell",category:"Product Announcement",impact:"HIGH",summary:"The stored article describes expanded protection and recovery capabilities.",takeaway:"The stored takeaway records the added product scope."},{title:"HPE updates StoreOnce software support",source:"HPE newsroom",date:"May 28, 2024",vendor:"HPE",category:"Product Update",impact:"MEDIUM",summary:"The stored article records a software and platform support update.",takeaway:null}];
export const signals=[["HN","Dell","A stored Hacker News discussion linked to the vendor and market.","Jun 09, 2024"],["GitHub","IBM","Stored repository activity associated with the vendor.","May 18, 2024"],["CVE","Quantum","A stored CVE record mapped to the vendor.","Apr 30, 2024"]];
export const players=[["VectorField","vectorfield.example","Infrastructure observability for distributed systems.","$10–25M","Austin, TX"],["Harborline",null,"Security operations software for regulated teams.",null,"London, UK"],["Mosaic North","mosaicnorth.example",null,"$25–50M",null]];
export const reports=[["2024 Market Evaluation","Market analysis","Jun 18, 2024","Stored excerpt: this report documents the fixed evaluation scope and evidence fields.","HTML"],["Vendor Evidence Appendix","Supporting material","May 04, 2024","No Content Available","PDF"]];

export function Shell({active, title, subtitle, children}:{active:string;title:string;subtitle:string;children:ReactNode}){
 const nav=[["vendor","Vendor Evaluation","FixedVendorEvaluation"],["product","Product Evaluation","FixedProductEvaluation"],["ecosystem","Ecosystem Evaluation","FixedEcosystemEvaluation"],["intel","Vendor Intelligence","FixedVendorIntelligence"],["reports","Reports","FixedReports"]];
 const current=nav.find(x=>x[0]===active)!;
 return <div className="fdm-shell"><header className="fdm-top"><span className="fdm-wordmark">ITMAP</span><small>FIXED EVIDENCE / MOBILE</small></header><main className="fdm-main"><section className="fdm-hero"><div className="fdm-kicker">Markets / evidence workspace</div><h1>{title}</h1><p>{subtitle}</p><div className="fdm-meta"><span>Published evaluation</span><i/><span>Data snapshot · 18 Jun 2024</span></div></section><details className="fdm-switcher"><summary><span><b>SECTION</b>{current[1]}</span><span className="fdm-switcher-open">View all sections</span></summary><div>{nav.map(([key,label,path],i)=><a key={key} className={active===key?"active":""} href={`/__mockup/preview/fixed-data-markets-mobile/${path}`}><b>0{i+1}</b><span>{label}</span></a>)}</div></details><div className="fdm-content">{children}</div></main></div>
}
export function Section({n,title,action,children}:{n:string;title:string;action?:ReactNode;children:ReactNode}){return <section><div className="fdm-section-title"><span>{n}</span><h2>{title}</h2>{action}</div>{children}</section>}
export function Harvey({level}:{level:number}){return <span className="fdm-ball" style={{"--level":level} as CSSProperties} aria-label={`${level} of 4 support`}/> }
export function Legend(){return <div className="fdm-legend"><span><i style={{background:"#e5ebe4"}}/>0 none</span><span><i style={{background:"#c9a95f"}}/>1 limited</span><span><i style={{background:"#8b9d65"}}/>2 partial</span><span><i style={{background:"#4f8c86"}}/>3 good</span><span><i style={{background:"#087f83"}}/>4 full</span></div>}
export function IconFor({type}:{type:string}){return type==="News"?<Newspaper size={15}/>:type==="Signals"?<Radar size={15}/>:type==="Reports"?<FileText size={15}/>:type==="Ecosystem"?<Network size={15}/>:<BarChart3 size={15}/>}
export function useDisclosure(initial=false){return useState(initial)}