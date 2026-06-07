import { QuadrantChart } from "./_QuadrantChart";

export function Middle() {
  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center bg-slate-50 p-8 gap-3">
      <div className="text-center">
        <h2 className="text-lg font-bold text-slate-800">Middle ground <span className="text-cyan-600">(proposed)</span></h2>
        <p className="text-sm text-slate-500">Band 18–82 · size 860×640 — between the old tight 25–75 and the wide 10–90</p>
      </div>
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-3">
        <QuadrantChart width={860} height={640} normMin={18} normMax={82} dotR={9} fontSize={13} />
      </div>
    </div>
  );
}
