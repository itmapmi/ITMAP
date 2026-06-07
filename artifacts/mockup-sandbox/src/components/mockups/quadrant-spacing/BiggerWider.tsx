import { QuadrantChart } from "./_QuadrantChart";

export function BiggerWider() {
  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center bg-slate-50 p-8 gap-3">
      <div className="text-center">
        <h2 className="text-lg font-bold text-slate-800">Bigger + wider <span className="text-cyan-600">(recommended)</span></h2>
        <p className="text-sm text-slate-500">Band 10–90 · size 860×640 — larger, squarer canvas with bigger dots and labels</p>
      </div>
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-3">
        <QuadrantChart width={860} height={640} normMin={10} normMax={90} dotR={9} fontSize={13} />
      </div>
    </div>
  );
}
