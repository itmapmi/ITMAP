import { QuadrantChart } from "./_QuadrantChart";

export function MiddleCompact() {
  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center bg-slate-50 p-8 gap-3">
      <div className="text-center">
        <h2 className="text-lg font-bold text-slate-800">Compact — 760×560</h2>
        <p className="text-sm text-slate-500">Band 18–82 · smaller than 860×640 but still roomy and readable</p>
      </div>
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-3">
        <QuadrantChart width={760} height={560} normMin={18} normMax={82} dotR={8} fontSize={12} />
      </div>
    </div>
  );
}
