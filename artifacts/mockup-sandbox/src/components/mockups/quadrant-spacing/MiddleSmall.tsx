import { QuadrantChart } from "./_QuadrantChart";

export function MiddleSmall() {
  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center bg-slate-50 p-8 gap-3">
      <div className="text-center">
        <h2 className="text-lg font-bold text-slate-800">Smaller — 680×500</h2>
        <p className="text-sm text-slate-500">Band 18–82 · most compact — closest to the old footprint</p>
      </div>
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-3">
        <QuadrantChart width={680} height={500} normMin={18} normMax={82} dotR={8} fontSize={12} />
      </div>
    </div>
  );
}
