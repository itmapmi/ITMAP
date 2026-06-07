import { QuadrantChart } from "./_QuadrantChart";

export function MiddleSquare() {
  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center bg-slate-50 p-8 gap-3">
      <div className="text-center">
        <h2 className="text-lg font-bold text-slate-800">Square grid <span className="text-cyan-600">(proposed)</span></h2>
        <p className="text-sm text-slate-500">Band 18–82 · 660×660 — equal margins make the quadrant grid a perfect square</p>
      </div>
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-3">
        <QuadrantChart width={660} height={660} normMin={18} normMax={82} dotR={8} fontSize={12} />
      </div>
    </div>
  );
}
