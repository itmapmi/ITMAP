import { QuadrantChart } from "./_QuadrantChart";

export function WiderSpread() {
  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center bg-slate-50 p-8 gap-3">
      <div className="text-center">
        <h2 className="text-lg font-bold text-slate-800">Wider spread</h2>
        <p className="text-sm text-slate-500">Band 10–90 · size 600×400 — same chart, dots use more of each axis</p>
      </div>
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-3">
        <QuadrantChart width={600} height={400} normMin={10} normMax={90} dotR={7} />
      </div>
    </div>
  );
}
